import {makeAutoObservable, runInAction} from 'mobx';
import {isToday, isYesterday} from 'date-fns';
import * as RNFS from '@dr.pogodin/react-native-fs';

import {
  AgentStep,
  AgentToolCall,
  AgentToolOutcome,
  MessageType,
} from '../utils/types';
import {
  BannerVariant,
  CompletionEngine,
  CompletionParams,
  CompletionResultSnapshot,
} from '../utils/completionTypes';
import {chatSessionRepository} from '../repositories/ChatSessionRepository';
import {defaultCompletionParams} from '../utils/completionSettingsVersions';
import {assistant, derivedText} from '../utils/chat';
import {
  buildSearchOccurrences,
  SearchOccurrence,
} from '../utils/searchHighlight';
import {randId} from '../utils';
import {
  partitionMessagesForCompaction,
  buildCompactionPrompt,
  executeCompaction,
} from '../services/compaction';
import {palStore} from './PalStore';
import {deriveToolSchemas} from '../services/talents';
import {
  AgentUiState,
  DEFAULT_MAX_TURNS,
  MAX_TOOL_TURNS,
  MIN_TOOL_TURNS,
  initialAgentUiState,
} from '../services/agent';

/**
 * Update payload accepted by `updateMessage` / `updateMessageStreaming`.
 * Covers both `Text` updates (timings, copyable) and `AssistantTurn`
 * updates which carry top-level `steps` plus arbitrary metadata fields
 * (interrupted, copyable, etc.).
 */
type MessageUpdate =
  | Partial<MessageType.Text>
  | Partial<Omit<MessageType.AssistantTurn, 'type' | 'id' | 'author'>>;

export const NEW_SESSION_TITLE = 'New Session';
const TITLE_LIMIT = 40;

// Coalesce per-token writes into batched UI flushes (~33 Hz).
const STREAMING_THROTTLE_MS = 30;

export interface SessionMetaData {
  id: string;
  title: string;
  date: string;
  messages: MessageType.Any[];
  completionSettings: CompletionParams;
  activePalId?: string;
  pinned?: boolean;
  settingsSource: 'pal' | 'custom'; // Explicit choice: use pal settings or custom settings
  messagesLoaded?: boolean; // Track if messages are loaded for lazy loading
}

interface SessionGroup {
  [key: string]: SessionMetaData[];
}

// Default group names in English as fallback
const DEFAULT_GROUP_NAMES = {
  pinned: 'Pinned',
  today: 'Today',
  yesterday: 'Yesterday',
  thisWeek: 'This week',
  lastWeek: 'Last week',
  twoWeeksAgo: '2 weeks ago',
  threeWeeksAgo: '3 weeks ago',
  fourWeeksAgo: '4 weeks ago',
  lastMonth: 'Last month',
  older: 'Older',
};

export const NEW_CHAT_DRAFT_KEY = '__new_chat__';

export const defaultCompletionSettings = {...defaultCompletionParams};

/**
 * `tools` is derived state, not stored state: the tool schemas a model sees
 * are rebuilt from the active pal's `pact.talents` on every resolve. Any
 * `tools` value carried by a saved settings object is a stale snapshot —
 * it was resolved for a different pal, or for no pal at all — so strip it
 * before persisting, loading, or spreading settings. The pact injection in
 * `resolveCompletionSettings` is the only place `tools` is ever set.
 */
function withoutTools(settings: CompletionParams): CompletionParams {
  const cleanSettings = {...settings};
  delete cleanSettings.tools;
  return cleanSettings;
}
delete defaultCompletionSettings.prompt;
delete defaultCompletionSettings.stop;

class ChatSessionStore {
  sessions: SessionMetaData[] = [];
  activeSessionId: string | null = null;
  isEditMode: boolean = false;
  editingMessageId: string | null = null;
  isGenerating: boolean = false;
  /** A send is waiting for a stopped run to drain. */
  isStopping: boolean = false;
  newChatCompletionSettings: CompletionParams = defaultCompletionSettings;
  newChatPalId: string | undefined = undefined;
  newChatSettingsSource: 'pal' | 'custom' = 'pal';
  // User's manual thinking toggle in the no-session chat path. When set,
  // the resolver applies it as the last layer (after pal) so the toggle
  // persists; cleared on session creation, new-chat reset, and session
  // switch.
  newChatThinkingOverride: boolean | undefined = undefined;
  // User's manual graded-effort choice in the no-session chat path, paired with
  // newChatThinkingOverride. Carries the effort grade (low/medium/high) so a
  // graded pill round-trips before the first message creates a session; cleared
  // alongside newChatThinkingOverride.
  newChatReasoningEffort: string | undefined = undefined;
  // Store localized date group names
  dateGroupNames: typeof DEFAULT_GROUP_NAMES = DEFAULT_GROUP_NAMES;
  // Migration status
  isMigrating: boolean = false;
  migrationComplete: boolean = false;
  // Draft autosave: ephemeral map of sessionId → unsent input text
  sessionDrafts: Map<string, string> = new Map();
  // Selection mode state
  isSelectionMode: boolean = false;
  selectedSessionIds: Set<string> = new Set();
  // Search mode state
  isSearchMode: boolean = false;
  searchQuery: string = '';
  // Index of the current match within searchOccurrences (-1 = none
  // selected yet). Bumped on every prev/next tap so ChatView re-scrolls
  // even when the target message doesn't change (e.g. a single match).
  searchMatchIndex: number = -1;
  searchScrollNonce: number = 0;

  // UX state for the active agent run. Driven by `agentStateReducer`
  // from `AgentEvent`s emitted by the runner. The only writer is
  // `setAgentUiState`. Renderers compute the active-vs-persisted
  // predicate at the ChatView level.
  agentUiState: AgentUiState = initialAgentUiState;

  // Per-token counter for PendingIndicator's tool-call suffix. Lives
  // outside `agentUiState` so broad observers (ChatView) aren't
  // invalidated on every tool-call token; only `PendingIndicatorView`
  // reads it.
  toolCallTokenCount: number = 0;

  // Banner state for the context-limit warning. All ephemeral (MobX-only,
  // no DB column). The snapshot is mirrored from the newest finished turn's
  // metadata.completionResult; the rest track per-draft dismissals, the run
  // of back-to-back full turns, and which pal-load hints have already shown.
  lastCompletionResult: CompletionResultSnapshot | undefined = undefined;
  dismissedBannerVariants: Set<BannerVariant> = new Set();
  consecutiveFullFailures: number = 0;
  palLoadHintSeen: Set<string> = new Set();

  // Compaction state
  isCompacting: boolean = false;
  compactionAbortController: AbortController | null = null;
  // Fork-only: whether compaction runs automatically (threshold +
  // recovery). Default off, so conversations behave as before the
  // compaction PR until the user turns it on in Settings. Manual
  // compaction (/compact, banner Compact buttons, restore) works
  // regardless of this flag.
  autoCompactionEnabled: boolean = false;

  // Fork-only: max tool-calling turns per assistant reply, set in
  // Settings. Default 5 (DEFAULT_MAX_TURNS), so behaviour is unchanged
  // until the user changes it. The model is told a budget of
  // maxToolTurns - 1. Range 2-20, clamped in setMaxToolTurns.
  maxToolTurns: number = DEFAULT_MAX_TURNS;

  constructor() {
    makeAutoObservable(this);
    this.initialize();
  }

  async initialize() {
    try {
      // First check if migration is needed without setting isMigrating flag
      // This is a quick check that just looks for the flag file
      const migrationNeeded = await this.isMigrationNeeded();

      if (migrationNeeded) {
        // Only set isMigrating to true if migration is actually needed
        runInAction(() => {
          this.isMigrating = true;
        });

        // Perform the actual migration
        await chatSessionRepository.checkAndMigrateFromJSON();

        runInAction(() => {
          this.isMigrating = false;
          this.migrationComplete = true;
        });
      } else {
        // Migration not needed, just mark as complete
        runInAction(() => {
          this.migrationComplete = true;
        });
      }

      // Load data from database (whether migration happened or not)
      await this.loadSessionList();
      await this.loadGlobalSettings();
    } catch (error) {
      console.error('Failed to initialize ChatSessionStore:', error);
      runInAction(() => {
        this.isMigrating = false;
        this.migrationComplete = false;
      });
    }
  }

  // Helper method to check if migration is needed without setting isMigrating flag
  private async isMigrationNeeded(): Promise<boolean> {
    try {
      // Check if migration flag file exists
      const migrationFlagPath = `${RNFS.DocumentDirectoryPath}/db-migration-complete.flag`;
      const migrationComplete = await RNFS.exists(migrationFlagPath);

      return !migrationComplete;
    } catch (error) {
      console.error('Error checking migration status:', error);
      return false; // Assume no migration needed if we can't check
    }
  }

  // Method to set localized date group names from React components
  setDateGroupNames(l10nDateGroups: typeof DEFAULT_GROUP_NAMES) {
    this.dateGroupNames = l10nDateGroups;
  }

  get shouldShowHeaderDivider(): boolean {
    return (
      !this.activeSessionId ||
      (this.currentSessionMessages.length === 0 &&
        !this.isGenerating &&
        !this.isEditMode)
    );
  }

  setIsGenerating(value: boolean) {
    this.isGenerating = value;
  }

  setIsStopping(value: boolean) {
    this.isStopping = value;
  }

  /**
   * The single writer of `agentUiState`. The hook drives this from the
   * `AgentEvent` stream via `agentStateReducer`. There is intentionally
   * NO imperative `setIsGeneratingToolCall` setter — UI flags derive
   * from `agentUiState.status` via `@computed get`.
   */
  setAgentUiState(state: AgentUiState) {
    this.agentUiState = state;
  }

  setToolCallTokenCount(value: number) {
    if (this.toolCallTokenCount === value) {
      return;
    }
    this.toolCallTokenCount = value;
  }

  // Mirror a finished turn's snapshot into the store and advance banner
  // bookkeeping: a fresh finished turn clears per-draft dismissals, and the
  // full-turn run either increments or resets.
  recordCompletionSnapshot(snapshot: CompletionResultSnapshot) {
    this.lastCompletionResult = snapshot;
    this.dismissedBannerVariants = new Set();
    this.consecutiveFullFailures = snapshot.contextFull
      ? this.consecutiveFullFailures + 1
      : 0;
  }

  setBannerDismissed(variant: BannerVariant) {
    if (this.dismissedBannerVariants.has(variant)) {
      return;
    }
    const next = new Set(this.dismissedBannerVariants);
    next.add(variant);
    this.dismissedBannerVariants = next;
  }

  markPalLoadHintSeen(signature: string) {
    if (this.palLoadHintSeen.has(signature)) {
      return;
    }
    const next = new Set(this.palLoadHintSeen);
    next.add(signature);
    this.palLoadHintSeen = next;
  }

  /**
   * Convenience derived flag for renderers that previously consulted a
   * boolean. Single source of truth: `agentUiState.status`.
   */
  get isGeneratingToolCall(): boolean {
    return this.agentUiState.status === 'generating_tool_call';
  }

  async loadSessionList(): Promise<void> {
    try {
      const sessions = await chatSessionRepository.getAllSessions();

      // Convert to SessionMetaData format
      const sessionMetadata: SessionMetaData[] = [];

      for (const session of sessions) {
        // Use metadata-only method instead of full getSessionById
        const sessionData =
          await chatSessionRepository.getSessionMetadataWithSettings(
            session.id,
          );
        if (!sessionData) {
          continue;
        }

        // DON'T load messages - leave array empty
        const messages: MessageType.Any[] = [];

        // Handle case where completionSettings might be null
        let completionSettings = defaultCompletionSettings;
        if (sessionData.completionSettings) {
          completionSettings = sessionData.completionSettings.getSettings();
        } else {
          console.warn(
            `No completion settings found for session ${session.id}, using defaults`,
          );
        }

        sessionMetadata.push({
          id: session.id,
          title: session.title,
          date: session.date,
          messages,
          completionSettings,
          activePalId: session.activePalId,
          settingsSource: (session.settingsSource as 'pal' | 'custom') || 'pal',
          pinned: session.pinned || false,
          messagesLoaded: false, // Mark as not loaded for lazy loading
        });
      }

      runInAction(() => {
        this.sessions = sessionMetadata;
      });
    } catch (error) {
      console.error('Failed to load session list:', error);
    }
  }

  async loadGlobalSettings(): Promise<void> {
    try {
      const settings =
        await chatSessionRepository.getGlobalCompletionSettings();
      const autoCompactionEnabled =
        await chatSessionRepository.getAutoCompactionEnabled();
      const maxToolTurns = await chatSessionRepository.getMaxToolTurns();

      runInAction(() => {
        // Heal a preset saved before tools were stripped on save: a stale
        // `tools` snapshot in the persisted global preset is dropped on
        // load, so the next resolve derives tools from the pact alone.
        this.newChatCompletionSettings = withoutTools(settings);
        this.autoCompactionEnabled = autoCompactionEnabled;
        this.maxToolTurns = maxToolTurns;
      });
    } catch (error) {
      console.error('Failed to load global settings:', error);
    }
  }

  async setAutoCompactionEnabled(value: boolean): Promise<void> {
    runInAction(() => {
      this.autoCompactionEnabled = value;
    });
    try {
      await chatSessionRepository.saveAutoCompactionEnabled(value);
    } catch (error) {
      console.warn(
        '[compaction] failed to persist autoCompactionEnabled:',
        error,
      );
    }
  }

  async setMaxToolTurns(value: number): Promise<void> {
    const clamped = Number.isFinite(value)
      ? Math.min(MAX_TOOL_TURNS, Math.max(MIN_TOOL_TURNS, Math.floor(value)))
      : DEFAULT_MAX_TURNS;
    runInAction(() => {
      this.maxToolTurns = clamped;
    });
    try {
      await chatSessionRepository.saveMaxToolTurns(clamped);
    } catch (error) {
      console.warn('[tools] failed to persist maxToolTurns:', error);
    }
  }

  async deleteSession(id: string): Promise<void> {
    try {
      await chatSessionRepository.deleteSession(id);

      if (id === this.activeSessionId) {
        this.resetActiveSession();
      }

      runInAction(() => {
        this.sessions = this.sessions.filter(session => session.id !== id);
        this.sessionDrafts.delete(id);
        this.dismissedBannerVariants = new Set();
      });
    } catch (error) {
      console.error('Failed to delete session:', error);
    }
  }

  async duplicateSession(id: string) {
    const session = this.sessions.find(s => s.id === id);
    if (session) {
      await this.createNewSession(
        `${session.title} - Copy`,
        session.messages,
        session.completionSettings,
      );
    }
  }

  resetActiveSession() {
    runInAction(() => {
      this.newChatPalId = this.activePalId;
      this.newChatSettingsSource = 'pal'; // Reset to default for new chat
      this.newChatThinkingOverride = undefined;
      this.newChatReasoningEffort = undefined;
      // Do not copy completion settings from session to global settings
      // Instead, preserve global settings as they are
      this.exitEditMode();
      // Search is a per-session view; don't carry it into a new chat.
      this.isSearchMode = false;
      this.searchQuery = '';
      this.searchMatchIndex = -1;
      this.activeSessionId = null;
      this.lastCompletionResult = undefined;
      this.dismissedBannerVariants = new Set();
      this.consecutiveFullFailures = 0;
      this.palLoadHintSeen = new Set();
    });
  }

  // Helper method to load messages for a session
  private async loadSessionMessages(sessionId: string): Promise<void> {
    try {
      const sessionData = await chatSessionRepository.getSessionById(sessionId);
      if (!sessionData) {
        console.warn(`Session ${sessionId} not found when loading messages`);
        return;
      }

      const session = this.sessions.find(s => s.id === sessionId);
      if (!session) {
        return;
      }

      const messages = sessionData.messages.map(msg => msg.toMessageObject());

      runInAction(() => {
        session.messages = messages;
        session.messagesLoaded = true;
      });
    } catch (error) {
      console.error(`Failed to load messages for session ${sessionId}:`, error);
    }
  }

  async setActiveSession(sessionId: string): Promise<void> {
    const session = this.sessions.find(s => s.id === sessionId);

    // Lazy-load messages if not already loaded
    if (session && !session.messagesLoaded) {
      await this.loadSessionMessages(sessionId);
    }

    runInAction(() => {
      this.exitEditMode();
      // Search is a per-session view; don't carry a stale query across sessions.
      this.isSearchMode = false;
      this.searchQuery = '';
      this.searchMatchIndex = -1;
      this.activeSessionId = sessionId;
      // Don't modify global settings when changing sessions
      this.newChatPalId = undefined;
      this.newChatSettingsSource = 'pal'; // Reset for consistency
      this.newChatThinkingOverride = undefined;
      this.newChatReasoningEffort = undefined;
      this.lastCompletionResult = this.hydrateCompletionSnapshot(session);
      this.dismissedBannerVariants = new Set();
      this.consecutiveFullFailures = 0;
      // palLoadHintSeen is intentionally NOT cleared here: it's an
      // app-lifetime, per-(pal,n_ctx,talents) one-shot suppressor, so it must
      // survive session switches. Only resetActiveSession clears it.
    });
  }

  // Read the newest assistant turn's persisted snapshot so the banner
  // reflects the loaded chat without waiting for a new turn. Messages are
  // unshift-ordered ([0] newest); snapshots predating this feature lack the
  // fields and resolve to not-full.
  private hydrateCompletionSnapshot(
    session: SessionMetaData | undefined,
  ): CompletionResultSnapshot | undefined {
    const snapshot = session?.messages.find(
      msg => msg.metadata?.completionResult,
    )?.metadata?.completionResult;
    return snapshot as CompletionResultSnapshot | undefined;
  }

  // Update session title by session ID
  async updateSessionTitleBySessionId(
    sessionId: string,
    newTitle: string,
  ): Promise<void> {
    try {
      await chatSessionRepository.updateSessionTitle(sessionId, newTitle);

      const session = this.sessions.find(s => s.id === sessionId);
      if (session) {
        runInAction(() => {
          session.title = newTitle;
        });
      }
    } catch (error) {
      console.error('Failed to update session title:', error);
    }
  }

  async updateSessionTitle(session: SessionMetaData) {
    if (session.messages.length === 0 || session.title !== NEW_SESSION_TITLE) {
      return;
    }
    // `updateSessionTitle` reads the LAST message of the session, which
    // is the most recently added one. The gate accepts both `text` and
    // `assistant_turn` rows so sessions whose latest message is an
    // assistant_turn (greeting bubbles, single-reply sessions, sessions
    // where the assistant has just replied) get titled correctly.
    const message = session.messages[session.messages.length - 1];
    if (message.type !== 'text' && message.type !== 'assistant_turn') {
      return;
    }
    const titleSource = derivedText(message);
    if (!titleSource) {
      return;
    }
    runInAction(() => {
      session.title =
        titleSource.length > TITLE_LIMIT
          ? `${titleSource.substring(0, TITLE_LIMIT)}...`
          : titleSource;
    });

    await chatSessionRepository.updateSessionTitle(session.id, session.title);
  }

  async addMessageToCurrentSession(message: MessageType.Any): Promise<void> {
    if (this.activeSessionId) {
      const session = this.sessions.find(s => s.id === this.activeSessionId);
      if (session) {
        await this.updateSessionTitle(session);
        await this.addMessageToSession(session.id, message);
      }
    } else {
      // Resolve settings using the selected settings source so the
      // session snapshot matches what the model actually receives
      const palIdForSettings =
        this.newChatSettingsSource === 'pal' ? this.newChatPalId : undefined;
      const settings = await this.resolveCompletionSettings(
        undefined,
        palIdForSettings,
      );
      await this.createNewSession(NEW_SESSION_TITLE, [message], settings);
      const created = this.sessions.find(s => s.id === this.activeSessionId);
      if (created?.messages[0]) {
        message.id = created.messages[0].id;
      }
    }
  }

  async addMessageToSession(
    sessionId: string,
    message: MessageType.Any,
  ): Promise<void> {
    const session = this.sessions.find(s => s.id === sessionId);
    if (!session) {
      return;
    }
    const newMessage = await chatSessionRepository.addMessageToSession(
      sessionId,
      message,
    );
    if (!newMessage) {
      return;
    }
    message.id = newMessage.id;
    runInAction(() => {
      session.messages.unshift(message);
    });
  }

  async deleteMessageFromSession(
    sessionId: string,
    messageId: string,
  ): Promise<void> {
    try {
      await chatSessionRepository.deleteMessage(messageId);
      const session = this.sessions.find(s => s.id === sessionId);
      if (session) {
        runInAction(() => {
          session.messages = session.messages.filter(
            msg => msg.id !== messageId,
          );
        });
      }
    } catch (error) {
      console.error('Failed to delete message:', error);
    }
  }

  get currentSessionMessages(): MessageType.Any[] {
    if (this.activeSessionId) {
      const session = this.sessions.find(s => s.id === this.activeSessionId);
      if (session) {
        let msgs = session.messages;
        if (this.isEditMode && this.editingMessageId) {
          const messageIndex = msgs.findIndex(
            msg => msg.id === this.editingMessageId,
          );
          if (messageIndex >= 0) {
            msgs = msgs.slice(messageIndex + 1);
          }
        }
        return msgs.filter(msg => !msg.metadata?.isCompacted);
      }
    }
    return [];
  }

  resetContextMetrics(): void {
    runInAction(() => {
      this.lastCompletionResult = undefined;
      this.dismissedBannerVariants = new Set();
      this.consecutiveFullFailures = 0;
    });
  }

  cancelCompaction(): void {
    if (this.compactionAbortController) {
      this.compactionAbortController.abort();
      this.compactionAbortController = null;
    }
    import('./ModelStore')
      .then(({modelStore}) => {
        modelStore.engine?.stopCompletion().catch(err => {
          console.warn('[compaction] stopCompletion on cancel failed:', err);
        });
      })
      .catch(() => {});
    runInAction(() => {
      this.isCompacting = false;
    });
  }

  async compactActiveSession(
    focusInstruction?: string,
    completionEngine?: CompletionEngine,
  ): Promise<boolean> {
    if (this.isCompacting || this.isGenerating) {
      return false;
    }

    const sessionId = this.activeSessionId;
    if (!sessionId) {
      return false;
    }

    const session = this.sessions.find(s => s.id === sessionId);
    if (!session) {
      return false;
    }

    let engine = completionEngine;
    if (!engine) {
      const {modelStore} = await import('./ModelStore');
      engine = modelStore.engine;
    }

    if (!engine) {
      return false;
    }

    if (!session.messagesLoaded) {
      await this.loadSessionMessages(sessionId);
    }

    const partition = partitionMessagesForCompaction(session.messages, 2);
    if (!partition || partition.toSummarize.length === 0) {
      return false;
    }

    this.compactionAbortController = new AbortController();
    // Capture the signal now: cancelCompaction() nulls the controller
    // field when it runs, so checking the field later would miss a Cancel
    // that landed mid-flight.
    const abortSignal = this.compactionAbortController.signal;
    runInAction(() => {
      this.isCompacting = true;
    });

    try {
      const prompt = buildCompactionPrompt(
        partition.toSummarize,
        focusInstruction,
        partition.priorSummary,
      );

      const summaryText = await executeCompaction(
        engine,
        prompt,
        this.compactionAbortController.signal,
      );

      // Fork fix: a Cancel that landed after the summarizer already
      // resolved must not commit the compaction. The engine has no abort
      // signal support, so stopCompletion is the only in-flight cancel;
      // this check is what makes Cancel actually prevent the write.
      if (abortSignal.aborted) {
        runInAction(() => {
          this.isCompacting = false;
          this.compactionAbortController = null;
        });
        return false;
      }

      const compactionMessage: MessageType.Custom = {
        id: randId(),
        type: 'custom',
        author: assistant,
        createdAt: partition.markerTimestamp,
        metadata: {
          compaction: true,
          summary: summaryText,
          compactedCount: partition.messageIdsToArchive.length,
          focusInstruction: focusInstruction?.trim() || undefined,
          timestamp: Date.now(),
        },
      };

      const createdRecord =
        await chatSessionRepository.softArchiveMessagesAndAddCompaction(
          sessionId,
          partition.messageIdsToArchive,
          compactionMessage,
        );
      compactionMessage.id = createdRecord.id;

      const updated = await chatSessionRepository.getSessionById(sessionId);

      runInAction(() => {
        if (updated?.messages) {
          session.messages = updated.messages.map(m => m.toMessageObject());
        }
        this.resetContextMetrics();
        this.isCompacting = false;
        this.compactionAbortController = null;
      });

      return true;
    } catch (err: any) {
      console.warn('[compaction] compactActiveSession failed:', err);
      runInAction(() => {
        this.isCompacting = false;
        this.compactionAbortController = null;
      });
      return false;
    }
  }

  // Undo one compaction: un-archive the messages that were archived under
  // this marker and drop the marker. The restored messages re-enter the
  // context, so the previous completion snapshot no longer describes the
  // conversation and the context metrics are reset. Returns false when
  // nothing was restored. A later completion that crosses the threshold
  // can compact again, which is expected, not a failure.
  async restoreCompaction(compactionId: string): Promise<boolean> {
    if (this.isCompacting || this.isGenerating) {
      return false;
    }

    const sessionId = this.activeSessionId;
    if (!sessionId) {
      return false;
    }

    const session = this.sessions.find(s => s.id === sessionId);
    if (!session) {
      return false;
    }

    try {
      const restored = await chatSessionRepository.restoreCompactedMessages(
        sessionId,
        compactionId,
      );
      if (restored === 0) {
        return false;
      }

      const updated = await chatSessionRepository.getSessionById(sessionId);

      runInAction(() => {
        if (updated?.messages) {
          session.messages = updated.messages.map(m => m.toMessageObject());
        }
        this.resetContextMetrics();
      });

      return true;
    } catch (err: any) {
      console.warn('[compaction] restoreCompaction failed:', err);
      return false;
    }
  }

  async setNewChatCompletionSettings(settings: CompletionParams) {
    // Never persist `tools`: it is derived from the pal's pact at resolve
    // time, and a snapshot saved here can go stale (wrong pal / no pal)
    // and later be copied into session or pal settings verbatim.
    const cleanSettings = withoutTools(settings);
    this.newChatCompletionSettings = cleanSettings;
    await chatSessionRepository.saveGlobalCompletionSettings(cleanSettings);
  }

  async resetNewChatCompletionSettings() {
    this.newChatCompletionSettings = {...defaultCompletionSettings};
    await chatSessionRepository.saveGlobalCompletionSettings(
      this.newChatCompletionSettings,
    );
  }

  async createNewSession(
    title: string,
    initialMessages: MessageType.Any[] = [],
    completionSettings: CompletionParams = defaultCompletionSettings,
  ): Promise<void> {
    try {
      // If the user has staged a thinking override for the new-chat path,
      // the resolved snapshot in `completionSettings` already carries it
      // (applied last in `resolveCompletionSettings`). Birth the session as
      // 'custom' so the resolver returns that snapshot verbatim on every
      // subsequent inference — pal-derived params survive (merged before
      // the override) and the user's choice is preserved.
      const birthSource: 'pal' | 'custom' =
        this.newChatThinkingOverride !== undefined
          ? 'custom'
          : this.newChatSettingsSource;

      // Create in database
      const newSession = await chatSessionRepository.createSession(
        title,
        initialMessages,
        completionSettings,
        this.newChatPalId,
        birthSource,
      );

      // Get the full session data
      const sessionData = await chatSessionRepository.getSessionById(
        newSession.id,
      );
      if (!sessionData) {
        return;
      }

      const messages = sessionData.messages.map(msg => msg.toMessageObject());

      // Handle case where completionSettings might be null
      let settings = completionSettings; // Use the settings passed to createNewSession as fallback
      if (sessionData.completionSettings) {
        settings = sessionData.completionSettings.getSettings();
      } else {
        console.warn(
          `No completion settings found for new session ${newSession.id}, using provided settings`,
        );
      }

      // Create metadata object
      const metaData: SessionMetaData = {
        id: newSession.id,
        title,
        date: newSession.date,
        messages,
        completionSettings: settings,
        settingsSource: birthSource, // 'custom' if a thinking override was staged, else stored source
        pinned: false,
        messagesLoaded: true, // Mark as loaded since we have the messages
      };

      if (this.newChatPalId) {
        metaData.activePalId = this.newChatPalId;
      }

      await this.updateSessionTitle(metaData);

      runInAction(() => {
        this.sessions.push(metaData);
        this.activeSessionId = newSession.id;
        this.newChatPalId = undefined;
        this.newChatThinkingOverride = undefined;
        this.newChatReasoningEffort = undefined;
        // Search is a per-session view; don't carry a stale query into the new
        // session (reachable one tap away via Duplicate → createNewSession).
        this.isSearchMode = false;
        this.searchQuery = '';
        this.searchMatchIndex = -1;
      });
    } catch (error) {
      console.error('Failed to create new session:', error);
    }
  }

  private streamingThrottleTimer: NodeJS.Timeout | null = null;
  /**
   * Pending throttled update. Discriminated so the same throttle slot
   * can serve both legacy `Text` updates (`kind: 'text'`) and the new
   * AssistantTurn active-step updates (`kind: 'step'`). Per-token writes
   * coalesce — they don't stack — because each call overwrites this slot.
   */
  private pendingStreamingUpdate:
    | {
        kind: 'text';
        id: string;
        sessionId: string;
        update: Partial<MessageType.Text>;
      }
    | {
        kind: 'step';
        id: string;
        sessionId: string;
        partial: Partial<AgentStep>;
      }
    | null = null;
  private lastStreamingUpdateTime: number = 0;

  /**
   * Schedule a throttled update through the shared throttle slot. The
   * scheduling logic is identical for both `text` and `step` shapes; only
   * the eventual `applyStreamingUpdate` dispatch differs.
   */
  private scheduleStreamingUpdate(): void {
    if (this.streamingThrottleTimer) {
      return;
    }

    // Never apply inline: tokens queued behind a slow render must merge into one apply.
    const remainingTime = Math.max(
      0,
      STREAMING_THROTTLE_MS - (Date.now() - this.lastStreamingUpdateTime),
    );
    this.streamingThrottleTimer = setTimeout(() => {
      this.streamingThrottleTimer = null;
      if (this.pendingStreamingUpdate) {
        this.applyStreamingUpdate();
        this.lastStreamingUpdateTime = Date.now();
      }
    }, remainingTime);
  }

  /**
   * Drain the throttled streaming slot synchronously. Call before any
   * structural change to `turn.steps` (e.g. pushAgentStep or
   * finalizeActiveStep) so a pending update scheduled for the previous
   * `lastIdx` lands on the step it was intended for, not on a freshly
   * pushed step that happens to be `lastIdx` when the timer fires.
   *
   * Without this, the regression sequence is: final `token` for step 0
   * schedules the throttle (fires in 150ms) → step_finished + tool_call
   * events run synchronously → step_started(1) pushes step 1 → throttle
   * timer fires → applies step 0's pending content to step 1, briefly
   * showing step 0's text duplicated under the talent block until the
   * follow-up step's first real token replaces it.
   */
  private flushStreamingUpdate(): void {
    if (this.streamingThrottleTimer) {
      clearTimeout(this.streamingThrottleTimer);
      this.streamingThrottleTimer = null;
    }
    if (this.pendingStreamingUpdate) {
      this.applyStreamingUpdate();
      this.lastStreamingUpdateTime = Date.now();
    }
  }

  // Update message during streaming - no database write, triggers reactivity
  // Throttled to avoid excessive re-renders. Accepts either a Text-shaped
  // partial (legacy path) or an AssistantTurn-shaped partial (new
  // pipeline). The hook should prefer `updateActiveStepStreaming` for
  // assistant_turn rows; this remains for the legacy code path.
  updateMessageStreaming(
    id: string,
    sessionId: string,
    update: MessageUpdate,
  ): void {
    this.pendingStreamingUpdate = {
      kind: 'text',
      id,
      sessionId,
      update: update as Partial<MessageType.Text>,
    };
    this.scheduleStreamingUpdate();
  }

  /**
   * Throttled streaming update for an `assistant_turn` row's active
   * (last) step. Reuses the same `streamingThrottleTimer` slot as
   * `updateMessageStreaming` so per-token writes coalesce and do not
   * stack across the two paths.
   */
  updateActiveStepStreaming(
    id: string,
    sessionId: string,
    partial: Partial<AgentStep>,
  ): void {
    this.pendingStreamingUpdate = {kind: 'step', id, sessionId, partial};
    this.scheduleStreamingUpdate();
  }

  private applyStreamingUpdate(): void {
    if (!this.pendingStreamingUpdate) {
      return;
    }

    const pending = this.pendingStreamingUpdate;
    this.pendingStreamingUpdate = null;

    const targetSessionId = pending.sessionId || this.activeSessionId;
    if (!targetSessionId) {
      return;
    }

    const session = this.sessions.find(s => s.id === targetSessionId);
    if (!session) {
      return;
    }

    const message = session.messages.find(msg => msg.id === pending.id);
    if (!message) {
      return;
    }

    if (pending.kind === 'text') {
      // Legacy text path. Gate widened to also accept assistant_turn so
      // ad-hoc metadata writes (e.g. error rollback) don't silently no-op
      // on the new shape.
      if (message.type !== 'text' && message.type !== 'assistant_turn') {
        return;
      }
      const update = pending.update;
      runInAction(() => {
        if (message.type === 'text' && update.text !== undefined) {
          (message as MessageType.Text).text = update.text;
        }
        if (update.metadata !== undefined) {
          message.metadata = {
            ...(message.metadata || {}),
            ...update.metadata,
          };
        }
      });
      chatSessionRepository
        .updateMessage(pending.id, update)
        .catch(error =>
          console.error('Failed to persist streaming update to DB:', error),
        );
      return;
    }

    // pending.kind === 'step'
    if (message.type !== 'assistant_turn') {
      return;
    }
    const turn = message as MessageType.AssistantTurn;
    if (!turn.steps || turn.steps.length === 0) {
      return;
    }
    const partial = pending.partial;
    runInAction(() => {
      const lastIdx = turn.steps.length - 1;
      const last = turn.steps[lastIdx];
      // Shallow merge of step fields. `pushAgentStep` adds new steps;
      // this only mutates the active (last) one in place.
      turn.steps[lastIdx] = {
        ...last,
        ...partial,
      };
    });
    chatSessionRepository
      .updateMessage(pending.id, {steps: turn.steps})
      .catch(error =>
        console.error('Failed to persist streaming step update to DB:', error),
      );
  }

  async updateMessage(
    id: string,
    sessionId: string,
    update: MessageUpdate,
  ): Promise<void> {
    try {
      // Update in database
      await chatSessionRepository.updateMessage(id, update);

      // Determine which session to update
      const targetSessionId = sessionId || this.activeSessionId;
      if (targetSessionId) {
        const session = this.sessions.find(s => s.id === targetSessionId);
        if (session) {
          const index = session.messages.findIndex(msg => msg.id === id);
          if (index < 0) {
            return;
          }
          const existingType = session.messages[index].type;
          if (existingType !== 'text' && existingType !== 'assistant_turn') {
            return;
          }

          // Update local state - only update the specific message
          runInAction(() => {
            const existingMessage = session.messages[index];
            const mergedUpdate: Record<string, any> = {...update};

            // Merge metadata instead of replacing, to preserve existing
            // fields (e.g., timings written by an earlier event, or
            // metadata.steps if a caller naively passes metadata.steps —
            // though this should not happen since metadata.steps is a
            // persistence-layer detail).
            if (update.metadata !== undefined && existingMessage.metadata) {
              mergedUpdate.metadata = {
                ...existingMessage.metadata,
                ...update.metadata,
              };
            }

            session.messages[index] = {
              ...existingMessage,
              ...mergedUpdate,
            } as MessageType.Any;
          });
        }
      }
    } catch (error) {
      console.error('Failed to update message:', error);
    }
  }

  /**
   * Append a new step to an `assistant_turn` row. Writes the whole
   * `steps` array wholesale (no shallow-merge tricks — see Persistence
   * notes in the story). Used by the agent runner via `applyEventToStore`
   * on `step_started`.
   */
  async pushAgentStep(
    id: string,
    sessionId: string,
    step: AgentStep,
  ): Promise<void> {
    // Drain any pending throttled update onto the CURRENT lastIdx
    // before structurally extending the array. Otherwise a pending
    // step-0 write would land on the freshly pushed step-1 when the
    // timer fires.
    this.flushStreamingUpdate();
    const targetSessionId = sessionId || this.activeSessionId;
    if (!targetSessionId) {
      return;
    }
    const session = this.sessions.find(s => s.id === targetSessionId);
    if (!session) {
      return;
    }
    const index = session.messages.findIndex(msg => msg.id === id);
    if (index < 0) {
      return;
    }
    const message = session.messages[index];
    if (message.type !== 'assistant_turn') {
      return;
    }
    const turn = message as MessageType.AssistantTurn;
    let nextSteps: AgentStep[] = [];
    runInAction(() => {
      nextSteps = [...(turn.steps ?? []), step];
      turn.steps = nextSteps;
    });
    try {
      await chatSessionRepository.updateMessage(id, {steps: nextSteps});
    } catch (error) {
      console.error('Failed to persist pushAgentStep:', error);
    }
  }

  /**
   * Replace the active (last) step's `toolCalls` array with the
   * runner's authoritative normalized list. Called from the hook
   * once per step on `step_finished`, with ids that match the
   * upcoming `appendToolOutcome` callIds by construction.
   *
   * Single writer for `step.toolCalls` — the streaming partial in
   * `applyEventToStore` does not write this field.
   */
  async appendToolCall(
    id: string,
    sessionId: string,
    calls: AgentToolCall[],
  ): Promise<void> {
    const targetSessionId = sessionId || this.activeSessionId;
    if (!targetSessionId) {
      return;
    }
    const session = this.sessions.find(s => s.id === targetSessionId);
    if (!session) {
      return;
    }
    const index = session.messages.findIndex(msg => msg.id === id);
    if (index < 0) {
      return;
    }
    const message = session.messages[index];
    if (message.type !== 'assistant_turn') {
      return;
    }
    const turn = message as MessageType.AssistantTurn;
    if (!turn.steps || turn.steps.length === 0) {
      return;
    }
    let nextSteps: AgentStep[] = [];
    runInAction(() => {
      const lastIdx = turn.steps.length - 1;
      const last = turn.steps[lastIdx];
      const nextLast: AgentStep = {...last, toolCalls: calls};
      nextSteps = [...turn.steps.slice(0, lastIdx), nextLast];
      turn.steps = nextSteps;
    });
    try {
      await chatSessionRepository.updateMessage(id, {steps: nextSteps});
    } catch (error) {
      console.error('Failed to persist appendToolCall:', error);
    }
  }

  /**
   * Append a tool outcome to the active (last) step of an
   * `assistant_turn` row. Writes the whole `steps` array wholesale.
   */
  async appendToolOutcome(
    id: string,
    sessionId: string,
    outcome: AgentToolOutcome,
  ): Promise<void> {
    const targetSessionId = sessionId || this.activeSessionId;
    if (!targetSessionId) {
      return;
    }
    const session = this.sessions.find(s => s.id === targetSessionId);
    if (!session) {
      return;
    }
    const index = session.messages.findIndex(msg => msg.id === id);
    if (index < 0) {
      return;
    }
    const message = session.messages[index];
    if (message.type !== 'assistant_turn') {
      return;
    }
    const turn = message as MessageType.AssistantTurn;
    if (!turn.steps || turn.steps.length === 0) {
      return;
    }
    let nextSteps: AgentStep[] = [];
    runInAction(() => {
      const lastIdx = turn.steps.length - 1;
      const last = turn.steps[lastIdx];
      const nextLast: AgentStep = {
        ...last,
        toolOutcomes: [...(last.toolOutcomes ?? []), outcome],
      };
      nextSteps = [...turn.steps.slice(0, lastIdx), nextLast];
      turn.steps = nextSteps;
    });
    try {
      await chatSessionRepository.updateMessage(id, {steps: nextSteps});
    } catch (error) {
      console.error('Failed to persist appendToolOutcome:', error);
    }
  }

  /**
   * Mark the active (last) step as no longer streaming. Writes the
   * whole `steps` array wholesale.
   */
  async finalizeActiveStep(id: string, sessionId: string): Promise<void> {
    // Drain any pending throttled update first so the final partial
    // content for this step lands BEFORE we mark it `partial: false`
    // and replace the array. Otherwise a late-firing timer could
    // either (a) write to a stale array reference or (b) write to
    // whatever step happens to be lastIdx after this finalize completes.
    this.flushStreamingUpdate();
    const targetSessionId = sessionId || this.activeSessionId;
    if (!targetSessionId) {
      return;
    }
    const session = this.sessions.find(s => s.id === targetSessionId);
    if (!session) {
      return;
    }
    const index = session.messages.findIndex(msg => msg.id === id);
    if (index < 0) {
      return;
    }
    const message = session.messages[index];
    if (message.type !== 'assistant_turn') {
      return;
    }
    const turn = message as MessageType.AssistantTurn;
    if (!turn.steps || turn.steps.length === 0) {
      return;
    }
    let nextSteps: AgentStep[] = [];
    runInAction(() => {
      const lastIdx = turn.steps.length - 1;
      const last = turn.steps[lastIdx];
      const nextLast: AgentStep = {...last, partial: false};
      nextSteps = [...turn.steps.slice(0, lastIdx), nextLast];
      turn.steps = nextSteps;
    });
    try {
      await chatSessionRepository.updateMessage(id, {steps: nextSteps});
    } catch (error) {
      console.error('Failed to persist finalizeActiveStep:', error);
    }
  }

  async updateSessionCompletionSettings(settings: CompletionParams) {
    if (this.activeSessionId) {
      const session = this.sessions.find(s => s.id === this.activeSessionId);
      if (session) {
        try {
          // Never persist `tools` (see setNewChatCompletionSettings).
          const cleanSettings = withoutTools(settings);
          // Update in database
          await chatSessionRepository.updateSessionCompletionSettings(
            this.activeSessionId,
            cleanSettings,
          );
          await chatSessionRepository.setSessionSettingsSource(
            this.activeSessionId,
            'custom',
          );

          // Update local state directly - no need to reload from database
          runInAction(() => {
            session.completionSettings = cleanSettings;
            session.settingsSource = 'custom'; // Mark as using custom settings
          });
        } catch (error) {
          console.error('Failed to update session completion settings:', error);
        }
      }
    }
  }

  async updateSessionSettingsSource(source: 'pal' | 'custom') {
    if (this.activeSessionId) {
      const session = this.sessions.find(s => s.id === this.activeSessionId);
      if (session) {
        await chatSessionRepository.setSessionSettingsSource(
          this.activeSessionId,
          source,
        );
        runInAction(() => {
          session.settingsSource = source;
        });
      }
    }
  }

  setNewChatSettingsSource(source: 'pal' | 'custom') {
    runInAction(() => {
      this.newChatSettingsSource = source;
    });
  }

  // Called when the active pal changes in a session
  async updateSessionActivePal(palId: string) {
    if (this.activeSessionId) {
      const session = this.sessions.find(s => s.id === this.activeSessionId);
      if (session) {
        runInAction(() => {
          session.activePalId = palId;
          session.settingsSource = 'pal'; // Switch to pal settings when changing pal
        });
      }
    }
  }

  // Apply current session settings to global settings
  async applySessionSettingsToGlobal() {
    if (this.activeSessionId) {
      const session = this.sessions.find(s => s.id === this.activeSessionId);
      if (session) {
        await this.setNewChatCompletionSettings({
          ...session.completionSettings,
        });
      }
    }
  }

  // Reset current session settings to match global settings
  async resetSessionSettingsToGlobal() {
    if (this.activeSessionId) {
      const session = this.sessions.find(s => s.id === this.activeSessionId);
      if (session) {
        await this.updateSessionCompletionSettings({
          ...this.newChatCompletionSettings,
        });
      }
    }
  }

  get groupedSessions(): SessionGroup {
    const pinnedSessions = this.sessions.filter(s => s.pinned);
    const unpinnedSessions = this.sessions.filter(s => !s.pinned);

    const groups: SessionGroup = unpinnedSessions.reduce(
      (acc: SessionGroup, session) => {
        const date = new Date(session.date);
        let dateKey: string;
        const today = new Date();
        const daysAgo = Math.ceil(
          (today.getTime() - date.getTime()) / (1000 * 3600 * 24),
        );

        if (isToday(date)) {
          dateKey = this.dateGroupNames.today;
        } else if (isYesterday(date)) {
          dateKey = this.dateGroupNames.yesterday;
        } else if (daysAgo <= 6) {
          dateKey = this.dateGroupNames.thisWeek;
        } else if (daysAgo <= 13) {
          dateKey = this.dateGroupNames.lastWeek;
        } else if (daysAgo <= 20) {
          dateKey = this.dateGroupNames.twoWeeksAgo;
        } else if (daysAgo <= 27) {
          dateKey = this.dateGroupNames.threeWeeksAgo;
        } else if (daysAgo <= 34) {
          dateKey = this.dateGroupNames.fourWeeksAgo;
        } else if (daysAgo <= 60) {
          dateKey = this.dateGroupNames.lastMonth;
        } else {
          dateKey = this.dateGroupNames.older;
        }

        if (!acc[dateKey]) {
          acc[dateKey] = [];
        }
        acc[dateKey].push(session);
        return acc;
      },
      {},
    );

    // Define the order of keys using the localized group names
    const orderedKeys = [
      this.dateGroupNames.today,
      this.dateGroupNames.yesterday,
      this.dateGroupNames.thisWeek,
      this.dateGroupNames.lastWeek,
      this.dateGroupNames.twoWeeksAgo,
      this.dateGroupNames.threeWeeksAgo,
      this.dateGroupNames.fourWeeksAgo,
      this.dateGroupNames.lastMonth,
      this.dateGroupNames.older,
    ];

    const orderedGroups: SessionGroup = {};

    if (pinnedSessions.length > 0) {
      orderedGroups[this.dateGroupNames.pinned] = pinnedSessions.sort(
        (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
      );
    }

    orderedKeys.forEach(key => {
      if (groups[key]) {
        orderedGroups[key] = groups[key].sort(
          (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
        );
      }
    });

    // Add any remaining keys that weren't in our predefined list
    Object.keys(groups).forEach(key => {
      if (!orderedGroups[key]) {
        orderedGroups[key] = groups[key].sort(
          (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
        );
      }
    });

    return orderedGroups;
  }

  /**
   * Enters edit mode for a specific message
   */
  enterEditMode(messageId: string): void {
    if (this.activeSessionId) {
      const session = this.sessions.find(s => s.id === this.activeSessionId);
      if (session) {
        const messageIndex = session.messages.findIndex(
          msg => msg.id === messageId,
        );
        if (messageIndex >= 0) {
          runInAction(() => {
            this.isEditMode = true;
            this.editingMessageId = messageId;
          });
        }
      }
    }
  }

  /**
   * Exits edit mode without making changes
   */
  exitEditMode(): void {
    runInAction(() => {
      this.isEditMode = false;
      this.editingMessageId = null;
    });
  }

  /**
   * Commits the edit by actually removing messages after the edited message
   */
  async commitEdit(): Promise<void> {
    if (this.editingMessageId) {
      // Remove messages after the edited message including the edited message as well.
      await this.removeMessagesFromId(this.editingMessageId, true);
      runInAction(() => {
        this.isEditMode = false;
        this.editingMessageId = null;
      });
    }
  }

  /**
   * Removes messages from the current active session starting from a specific message ID.
   * If includeMessage is true, the message with the given ID is also removed.
   *
   * @param messageId - The ID of the message to start removal from.
   * @param includeMessage - Whether to include the message with the given ID in the removal.
   */
  async removeMessagesFromId(
    messageId: string,
    includeMessage: boolean = true,
  ): Promise<void> {
    if (this.activeSessionId) {
      const session = this.sessions.find(s => s.id === this.activeSessionId);
      if (session) {
        const messageIndex = session.messages.findIndex(
          msg => msg.id === messageId,
        );
        if (messageIndex >= 0) {
          // Get messages to remove
          const endIndex = includeMessage ? messageIndex + 1 : messageIndex;
          // Slice from the start to the end index, since messages are in reverse order, ie 0 is the latest.
          const messagesToRemove = session.messages.slice(0, endIndex);

          // Remove from database
          for (const msg of messagesToRemove) {
            await chatSessionRepository.deleteMessage(msg.id);
          }

          const updatedSession = await chatSessionRepository.getSessionById(
            this.activeSessionId,
          );

          // Update local state
          runInAction(() => {
            session.messages =
              updatedSession?.messages?.map(msg => msg.toMessageObject()) || [];
            // The frozen completion snapshot described the pre-edit
            // conversation; editing/regenerating shortens the context, so the
            // banner state is stale. Clear it and let the next turn re-evaluate.
            this.lastCompletionResult = undefined;
            this.dismissedBannerVariants = new Set();
            this.consecutiveFullFailures = 0;
          });
        }
      }
    }
  }

  get activePalId(): string | undefined {
    if (this.activeSessionId) {
      const session = this.sessions.find(s => s.id === this.activeSessionId);
      return session?.activePalId;
    }
    return this.newChatPalId;
  }

  // Selection mode computed properties
  get selectedCount(): number {
    return this.selectedSessionIds.size;
  }

  get allSelected(): boolean {
    return (
      this.sessions.length > 0 &&
      this.selectedSessionIds.size === this.sessions.length
    );
  }

  // Selection mode actions
  enterSelectionMode(sessionId?: string) {
    runInAction(() => {
      this.isSelectionMode = true;
      this.selectedSessionIds.clear();
      if (sessionId) {
        this.selectedSessionIds.add(sessionId);
      }
    });
  }

  exitSelectionMode() {
    runInAction(() => {
      this.isSelectionMode = false;
      this.selectedSessionIds.clear();
    });
  }

  toggleSessionSelection(sessionId: string) {
    runInAction(() => {
      if (this.selectedSessionIds.has(sessionId)) {
        this.selectedSessionIds.delete(sessionId);
      } else {
        this.selectedSessionIds.add(sessionId);
      }
    });
  }

  selectAllSessions() {
    runInAction(() => {
      this.sessions.forEach(session => {
        this.selectedSessionIds.add(session.id);
      });
    });
  }

  deselectAllSessions() {
    runInAction(() => {
      this.selectedSessionIds.clear();
    });
  }

  async bulkDeleteSessions(): Promise<void> {
    try {
      const idsToDelete = Array.from(this.selectedSessionIds);

      // Delete from database
      await chatSessionRepository.deleteSessions(idsToDelete);

      // Check if active session was deleted
      const wasActiveSessionDeleted =
        this.activeSessionId && idsToDelete.includes(this.activeSessionId);

      if (wasActiveSessionDeleted) {
        this.resetActiveSession();
      }

      // Update local state and exit selection mode
      runInAction(() => {
        idsToDelete.forEach(deletedId => this.sessionDrafts.delete(deletedId));
        this.sessions = this.sessions.filter(
          session => !idsToDelete.includes(session.id),
        );
        this.exitSelectionMode();
        this.dismissedBannerVariants = new Set();
      });
    } catch (error) {
      console.error('Failed to bulk delete sessions:', error);
      throw error;
    }
  }

  async bulkExportSessions(): Promise<void> {
    try {
      const idsToExport = Array.from(this.selectedSessionIds);
      await chatSessionRepository.exportSessions(idsToExport);

      runInAction(() => {
        this.exitSelectionMode();
      });
    } catch (error) {
      console.error('Failed to bulk export sessions:', error);
      throw error;
    }
  }

  // Draft autosave methods (ephemeral, not persisted to DB)
  saveDraft(sessionId: string, text: string) {
    if (text.trim()) {
      this.sessionDrafts.set(sessionId, text);
    } else {
      this.sessionDrafts.delete(sessionId);
    }
  }

  getDraft(sessionId: string): string {
    return this.sessionDrafts.get(sessionId) || '';
  }

  clearDraft(sessionId: string) {
    this.sessionDrafts.delete(sessionId);
  }

  restoreUnsentText(sessionId: string | null, text: string) {
    if (sessionId !== null && !this.sessions.some(s => s.id === sessionId)) {
      return;
    }
    const key = sessionId ?? NEW_CHAT_DRAFT_KEY;
    this.saveDraft(key, [text, this.getDraft(key)].filter(Boolean).join('\n'));
  }

  // Search mode actions
  enterSearchMode() {
    runInAction(() => {
      // Leave edit mode first: while editing, currentSessionMessages is sliced
      // to the messages after the edit point, so search would otherwise scan a
      // truncated conversation.
      this.exitEditMode();
      this.isSearchMode = true;
      this.searchQuery = '';
      this.searchMatchIndex = -1;
    });
  }

  exitSearchMode() {
    runInAction(() => {
      this.isSearchMode = false;
      this.searchQuery = '';
      this.searchMatchIndex = -1;
    });
  }

  setSearchQuery(query: string) {
    this.searchQuery = query;
    // A new query means a new match set; drop the previous selection.
    this.searchMatchIndex = -1;
  }

  /**
   * Every visible occurrence of the current query in the active session,
   * in conversation order, then chunk order, then position within the
   * chunk (see `buildSearchOccurrences`). The count and the navigation
   * are occurrence-based, not message-based, so the bar's "N of M"
   * equals the number of highlighted spans on screen: occurrences
   * inside code blocks, link destinations and URLs are not counted,
   * because they are never highlighted.
   *
   * Matches on the same text MarkdownView renders (text messages, or
   * each visible step of an assistant turn), so the Nth counted
   * occurrence is the Nth highlighted one.
   *
   * Session messages are stored newest-first (DB `position` desc,
   * new messages `unshift`ed — the inverted list's order), so the
   * list is reversed here: search navigates chronologically, oldest
   * match first, like find-in-page in a browser. Without this the
   * first match was the newest message.
   */
  get searchOccurrences(): SearchOccurrence[] {
    if (!this.isSearchMode || !this.searchQuery.trim()) {
      return [];
    }
    return buildSearchOccurrences(
      [...this.currentSessionMessages].reverse(),
      this.searchQuery,
    );
  }

  /** Number of highlighted occurrences of the current query. */
  get searchMatchCount(): number {
    return this.searchOccurrences.length;
  }

  /** The occurrence the prev/next navigation currently points at. */
  get searchCurrentOccurrence(): SearchOccurrence | undefined {
    return this.searchOccurrences[this.searchMatchIndex];
  }

  /** Id of the message the prev/next navigation currently points at. */
  get searchCurrentMatchId(): string | undefined {
    return this.searchCurrentOccurrence?.messageId;
  }

  // Prev/next navigation moves between OCCURRENCES (the unit the count
  // reports), wrapping around at both ends like find-in-page in a
  // browser. The first tap from no selection lands on the first
  // occurrence (next) or the last occurrence (previous). The nonce
  // bumps on every tap so the scroll fires even when the target
  // doesn't change (one occurrence).
  goToNextSearchMatch() {
    const occurrences = this.searchOccurrences;
    if (occurrences.length === 0) {
      return;
    }
    runInAction(() => {
      this.searchMatchIndex =
        this.searchMatchIndex < 0
          ? 0
          : (this.searchMatchIndex + 1) % occurrences.length;
      this.searchScrollNonce += 1;
    });
  }

  goToPreviousSearchMatch() {
    const occurrences = this.searchOccurrences;
    if (occurrences.length === 0) {
      return;
    }
    runInAction(() => {
      this.searchMatchIndex =
        this.searchMatchIndex < 0
          ? occurrences.length - 1
          : (this.searchMatchIndex - 1 + occurrences.length) %
            occurrences.length;
      this.searchScrollNonce += 1;
    });
  }

  async setActivePal(palId: string | undefined): Promise<void> {
    if (this.activeSessionId) {
      const session = this.sessions.find(s => s.id === this.activeSessionId);
      if (session) {
        // Update in database
        await chatSessionRepository.setSessionActivePal(
          this.activeSessionId,
          palId,
        );

        // Update local state
        runInAction(() => {
          session.activePalId = palId;
        });
      }
    } else {
      this.newChatPalId = palId;
    }
  }

  async togglePinSession(sessionId: string): Promise<void> {
    const session = this.sessions.find(s => s.id === sessionId);
    if (!session) {
      return;
    }

    const pinned = !session.pinned;

    try {
      await chatSessionRepository.setSessionPinned(sessionId, pinned);
      runInAction(() => {
        session.pinned = pinned;
      });
    } catch (error) {
      console.error('Failed to toggle pin session:', error);
    }
  }

  /**
   * Resolves completion settings according to the precedence hierarchy:
   * System Defaults → Global User Settings → Pal-Specific Settings → Session-Specific Settings (only if explicitly modified)
   */
  async resolveCompletionSettings(
    sessionId?: string,
    palId?: string,
  ): Promise<CompletionParams> {
    // Start with system defaults
    let resolvedSettings: CompletionParams = {...defaultCompletionSettings};

    // Apply global user settings. Stored settings never contribute tools
    // (see withoutTools): a snapshot saved for another pal — or no pal —
    // must not reach the model. The pact injection below is the only
    // source of `tools`.
    resolvedSettings = {
      ...resolvedSettings,
      ...withoutTools(this.newChatCompletionSettings),
    };

    // Apply pal-specific settings if available
    if (palId) {
      // Use in-memory pal store as the source of truth (avoids cache invalidation issues)
      const pal = palStore.pals.find(p => p.id === palId);
      const palSettings = pal?.completionSettings;

      if (palSettings) {
        resolvedSettings = {
          ...resolvedSettings,
          ...withoutTools(palSettings),
        };
      }

      // Inject tool schemas from pact.talents (PACT → completionSettings.tools)
      const talentNames = pal?.pact?.talents?.map(t => t.name);
      if (talentNames && talentNames.length > 0) {
        const tools = deriveToolSchemas(talentNames);
        if (tools.length > 0) {
          resolvedSettings = {
            ...resolvedSettings,
            tools,
          };
        }
      }
    }

    // No-session-only: apply user's explicit thinking override last so it
    // wins over pal's enable_thinking. Overlays the local enable_thinking flag
    // AND the reasoning carrier (so the remote wire path honors the on/off
    // intent for the first message of the new chat, not just local thinking).
    // Does NOT touch any other field, and does NOT affect tool availability.
    if (!sessionId && this.newChatThinkingOverride !== undefined) {
      resolvedSettings = {
        ...resolvedSettings,
        enable_thinking: this.newChatThinkingOverride,
        reasoning: {
          ...resolvedSettings.reasoning,
          enabled: this.newChatThinkingOverride,
          effort: this.newChatReasoningEffort,
        },
      };
    }

    // Apply session-specific settings based on explicit user choice
    if (sessionId) {
      const session = this.sessions.find(s => s.id === sessionId);

      if (session?.settingsSource === 'custom') {
        // User explicitly chose custom settings - use session settings.
        // Preserve PACT-derived tools — custom settings control generation
        // params (temperature, etc.) but pact.talents is the source of truth
        // for tool availability. Stored session settings never contribute
        // tools: strip any stale snapshot before re-attaching the
        // pact-derived tools (if any), so a custom session can never run
        // on tools saved for another pal — or for no pal.
        const pactTools = resolvedSettings.tools;
        resolvedSettings = withoutTools(session.completionSettings);
        if (pactTools) {
          resolvedSettings = {...resolvedSettings, tools: pactTools};
        }
      }
    }

    return resolvedSettings;
  }

  /**
   * Gets the effective completion settings for the current context
   */
  async getCurrentCompletionSettings(): Promise<CompletionParams> {
    const activePalId = this.activeSessionId
      ? this.sessions.find(s => s.id === this.activeSessionId)?.activePalId
      : this.newChatPalId;

    return this.resolveCompletionSettings(
      this.activeSessionId || undefined,
      activePalId,
    );
  }
}

export const chatSessionStore = new ChatSessionStore();
