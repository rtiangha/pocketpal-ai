import {chatSessionStore} from '../ChatSessionStore';
import {chatSessionRepository} from '../../repositories/ChatSessionRepository';
import {MessageType, User} from '../../utils/types';
import {assistant} from '../../utils/chat';
import {CompletionEngine} from '../../utils/completionTypes';

const mockUser: User = {id: 'user_1', firstName: 'Tester'};

describe('ChatSessionStore compaction integration', () => {
  const createMsg = (
    id: string,
    text: string,
    createdAt: number,
    isAssistant = false,
  ): MessageType.Text => ({
    id,
    type: 'text',
    author: isAssistant ? assistant : mockUser,
    text,
    createdAt,
    metadata: {},
  });

  beforeEach(() => {
    jest.clearAllMocks();
    chatSessionStore.sessions = [];
    chatSessionStore.activeSessionId = null;
    chatSessionStore.isCompacting = false;
    chatSessionStore.isGenerating = false;
    chatSessionStore.autoCompactionEnabled = false;
    chatSessionStore.lastCompletionResult = {
      used: 1900,
      contextFull: true,
      isRemote: false,
    };
    chatSessionStore.consecutiveFullFailures = 2;
    chatSessionStore.dismissedBannerVariants = new Set(['context-full']);
  });

  it('filters out soft-archived messages from currentSessionMessages', () => {
    const session = {
      id: 'sess_1',
      title: 'Test Session',
      date: new Date().toISOString(),
      messagesLoaded: true,
      messages: [
        createMsg('1', 'Old message 1', 1000),
        {
          ...createMsg('2', 'Old message 2', 2000, true),
          metadata: {isCompacted: true},
        },
        createMsg('3', 'Recent message 3', 3000),
      ],
    };

    chatSessionStore.sessions = [session as any];
    chatSessionStore.activeSessionId = 'sess_1';

    const visible = chatSessionStore.currentSessionMessages;
    expect(visible.map(m => m.id)).toEqual(['1', '3']);
    expect(visible.some(m => m.metadata?.isCompacted)).toBe(false);
  });

  it('resets context metrics upon resetContextMetrics()', () => {
    expect(chatSessionStore.lastCompletionResult).toBeDefined();
    expect(chatSessionStore.consecutiveFullFailures).toBe(2);

    chatSessionStore.resetContextMetrics();

    expect(chatSessionStore.lastCompletionResult).toBeUndefined();
    expect(chatSessionStore.consecutiveFullFailures).toBe(0);
    expect(chatSessionStore.dismissedBannerVariants.size).toBe(0);
  });

  it('aborts and cleans up when cancelCompaction is invoked', () => {
    chatSessionStore.compactionAbortController = new AbortController();
    chatSessionStore.isCompacting = true;

    chatSessionStore.cancelCompaction();

    expect(chatSessionStore.isCompacting).toBe(false);
    expect(chatSessionStore.compactionAbortController).toBeNull();
  });

  it('executes compactActiveSession successfully', async () => {
    const session = {
      id: 'sess_1',
      title: 'Session to compact',
      date: new Date().toISOString(),
      messagesLoaded: true,
      messages: [
        createMsg('1', 'Turn 1 User', 1000),
        createMsg('2', 'Turn 1 Assistant', 2000, true),
        createMsg('3', 'Turn 2 User', 3000),
        createMsg('4', 'Turn 2 Assistant', 4000, true),
        createMsg('5', 'Turn 3 User', 5000),
        createMsg('6', 'Turn 3 Assistant', 6000, true),
      ],
    };

    chatSessionStore.sessions = [session as any];
    chatSessionStore.activeSessionId = 'sess_1';

    const mockEngine: CompletionEngine = {
      completion: jest.fn().mockResolvedValue({
        text: '### Primary Goal\nBuild features\n\n### Key Decisions & Facts\n- Decision A',
      }),
      stopCompletion: jest.fn().mockResolvedValue(undefined),
    };

    const spySoftArchive = jest.spyOn(
      chatSessionRepository,
      'softArchiveMessagesAndAddCompaction',
    );

    const success = await chatSessionStore.compactActiveSession(
      'focus on Decision A',
      mockEngine,
    );

    expect(success).toBe(true);
    expect(chatSessionStore.isCompacting).toBe(false);
    expect(chatSessionStore.lastCompletionResult).toBeUndefined();
    expect(chatSessionStore.consecutiveFullFailures).toBe(0);

    expect(spySoftArchive).toHaveBeenCalledWith(
      'sess_1',
      ['1', '2'], // Messages 1 and 2 summarized (last 4 preserved: 3, 4, 5, 6)
      expect.objectContaining({
        type: 'custom',
        metadata: expect.objectContaining({
          compaction: true,
          compactedCount: 2,
          focusInstruction: 'focus on Decision A',
        }),
      }),
    );
  });

  it('does not commit the compaction when Cancel lands mid-flight', async () => {
    const session = {
      id: 'sess_1',
      title: 'Session to compact',
      date: new Date().toISOString(),
      messagesLoaded: true,
      messages: [
        createMsg('1', 'Turn 1 User', 1000),
        createMsg('2', 'Turn 1 Assistant', 2000, true),
        createMsg('3', 'Turn 2 User', 3000),
        createMsg('4', 'Turn 2 Assistant', 4000, true),
        createMsg('5', 'Turn 3 User', 5000),
        createMsg('6', 'Turn 3 Assistant', 6000, true),
      ],
    };

    chatSessionStore.sessions = [session as any];
    chatSessionStore.activeSessionId = 'sess_1';

    const mockEngine: CompletionEngine = {
      completion: jest.fn().mockImplementation(async () => {
        // Cancel arrives while the summarizer is running, but the
        // engine resolves anyway: the write must still not happen.
        chatSessionStore.compactionAbortController?.abort();
        return {
          text: '### Primary Goal\nBuild features',
        };
      }),
      stopCompletion: jest.fn().mockResolvedValue(undefined),
    };

    const spySoftArchive = jest.spyOn(
      chatSessionRepository,
      'softArchiveMessagesAndAddCompaction',
    );

    const success = await chatSessionStore.compactActiveSession(
      undefined,
      mockEngine,
    );

    expect(success).toBe(false);
    expect(spySoftArchive).not.toHaveBeenCalled();
    expect(chatSessionStore.isCompacting).toBe(false);
    expect(chatSessionStore.compactionAbortController).toBeNull();
  });

  describe('restoreCompaction', () => {
    const markerMsg = {
      id: 'marker_1',
      type: 'custom',
      author: assistant,
      createdAt: 2500,
      metadata: {
        compaction: true,
        summary: '### Summary\n- Point',
        compactedCount: 2,
      },
    };

    const restoredSession = () => ({
      id: 'sess_1',
      title: 'Session to restore',
      date: new Date().toISOString(),
      messagesLoaded: true,
      messages: [
        createMsg('1', 'Old message 1', 1000),
        {
          ...createMsg('2', 'Old message 2', 2000, true),
          metadata: {isCompacted: true, compactionId: 'marker_1'},
        },
        markerMsg,
        createMsg('3', 'Recent message 3', 3000),
      ],
    });

    it('un-archives the marker group and refreshes the session', async () => {
      const session = restoredSession();
      chatSessionStore.sessions = [session as any];
      chatSessionStore.activeSessionId = 'sess_1';

      const spyRestore = jest
        .spyOn(chatSessionRepository, 'restoreCompactedMessages')
        .mockResolvedValue(2);
      const refreshedMessages = [
        createMsg('1', 'Old message 1', 1000),
        createMsg('2', 'Old message 2', 2000, true),
        createMsg('3', 'Recent message 3', 3000),
      ];
      const spyGetSession = jest
        .spyOn(chatSessionRepository, 'getSessionById')
        .mockResolvedValue({
          messages: refreshedMessages.map(m => ({
            toMessageObject: () => m,
          })),
        } as any);

      const success = await chatSessionStore.restoreCompaction('marker_1');

      expect(success).toBe(true);
      expect(spyRestore).toHaveBeenCalledWith('sess_1', 'marker_1');
      expect(spyGetSession).toHaveBeenCalledWith('sess_1');
      // Assert on the store's copy: assigning the session into the
      // observable sessions array converts it, so the local object is
      // not the reference the store mutates.
      const stored = chatSessionStore.sessions.find(s => s.id === 'sess_1');
      expect(stored?.messages.map(m => m.id)).toEqual(['1', '2', '3']);
      expect(chatSessionStore.lastCompletionResult).toBeUndefined();
      expect(chatSessionStore.consecutiveFullFailures).toBe(0);
    });

    it('returns false and touches nothing when the repo restores nothing', async () => {
      const session = restoredSession();
      chatSessionStore.sessions = [session as any];
      chatSessionStore.activeSessionId = 'sess_1';

      const spyRestore = jest
        .spyOn(chatSessionRepository, 'restoreCompactedMessages')
        .mockResolvedValue(0);
      const spyGetSession = jest.spyOn(chatSessionRepository, 'getSessionById');

      const success = await chatSessionStore.restoreCompaction('marker_1');

      expect(success).toBe(false);
      expect(spyRestore).toHaveBeenCalledWith('sess_1', 'marker_1');
      expect(spyGetSession).not.toHaveBeenCalled();
      expect(session.messages.map(m => m.id)).toEqual([
        '1',
        '2',
        'marker_1',
        '3',
      ]);
    });

    it('returns false without calling the repo when there is no active session', async () => {
      const spyRestore = jest.spyOn(
        chatSessionRepository,
        'restoreCompactedMessages',
      );

      expect(await chatSessionStore.restoreCompaction('marker_1')).toBe(false);
      expect(spyRestore).not.toHaveBeenCalled();
    });

    it('returns false without calling the repo while compacting', async () => {
      const session = restoredSession();
      chatSessionStore.sessions = [session as any];
      chatSessionStore.activeSessionId = 'sess_1';
      chatSessionStore.isCompacting = true;

      const spyRestore = jest.spyOn(
        chatSessionRepository,
        'restoreCompactedMessages',
      );

      expect(await chatSessionStore.restoreCompaction('marker_1')).toBe(false);
      expect(spyRestore).not.toHaveBeenCalled();
    });

    it('returns false without calling the repo while generating', async () => {
      const session = restoredSession();
      chatSessionStore.sessions = [session as any];
      chatSessionStore.activeSessionId = 'sess_1';
      chatSessionStore.isGenerating = true;

      const spyRestore = jest.spyOn(
        chatSessionRepository,
        'restoreCompactedMessages',
      );

      expect(await chatSessionStore.restoreCompaction('marker_1')).toBe(false);
      expect(spyRestore).not.toHaveBeenCalled();
    });
  });

  describe('autoCompactionEnabled', () => {
    it('is off by default and persists when set', async () => {
      expect(chatSessionStore.autoCompactionEnabled).toBe(false);

      const spySave = jest.spyOn(
        chatSessionRepository,
        'saveAutoCompactionEnabled',
      );

      await chatSessionStore.setAutoCompactionEnabled(true);

      expect(chatSessionStore.autoCompactionEnabled).toBe(true);
      expect(spySave).toHaveBeenCalledWith(true);

      await chatSessionStore.setAutoCompactionEnabled(false);

      expect(chatSessionStore.autoCompactionEnabled).toBe(false);
      expect(spySave).toHaveBeenCalledWith(false);
    });

    it('loads the persisted value with the other global settings', async () => {
      jest
        .spyOn(chatSessionRepository, 'getAutoCompactionEnabled')
        .mockResolvedValue(true);

      await chatSessionStore.loadGlobalSettings();

      expect(chatSessionStore.autoCompactionEnabled).toBe(true);
    });

    it('stays off when nothing was ever persisted', async () => {
      jest
        .spyOn(chatSessionRepository, 'getAutoCompactionEnabled')
        .mockResolvedValue(false);

      await chatSessionStore.loadGlobalSettings();

      expect(chatSessionStore.autoCompactionEnabled).toBe(false);
    });
  });
});
