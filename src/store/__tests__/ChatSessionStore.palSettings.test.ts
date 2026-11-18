import {chatSessionStore} from '../ChatSessionStore';
import {palStore} from '../PalStore';
import {defaultCompletionSettings} from '../ChatSessionStore';
import {chatSessionRepository} from '../../repositories/ChatSessionRepository';
import {deriveToolSchemas} from '../../services/talents';
import {CompletionParams} from '../../utils/completionTypes';
import type {Pal} from '../PalStore';
import {bodyExtras} from '../../api/servers';

describe('ChatSessionStore - Pal Settings', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Reset store state
    chatSessionStore.sessions = [];
    chatSessionStore.activeSessionId = null;
    chatSessionStore.newChatPalId = undefined;
    chatSessionStore.newChatCompletionSettings = {...defaultCompletionSettings};
    chatSessionStore.newChatThinkingOverride = undefined;
    // Reset palStore
    palStore.pals = [];
  });

  describe('resolveCompletionSettings', () => {
    it('should return system defaults when no other settings are available', async () => {
      const result = await chatSessionStore.resolveCompletionSettings();

      expect(result).toEqual(defaultCompletionSettings);
    });

    it('should apply global settings over system defaults', async () => {
      const globalSettings: Partial<CompletionParams> = {
        temperature: 0.8,
        top_p: 0.9,
      };

      chatSessionStore.newChatCompletionSettings = {
        ...defaultCompletionSettings,
        ...globalSettings,
      };

      const result = await chatSessionStore.resolveCompletionSettings();

      expect(result.temperature).toBe(0.8);
      expect(result.top_p).toBe(0.9);
    });

    it('should apply pal settings over global settings', async () => {
      const globalSettings: Partial<CompletionParams> = {
        temperature: 0.8,
        top_p: 0.9,
      };

      const palSettings: Partial<CompletionParams> = {
        temperature: 0.5,
        top_k: 30,
      };

      chatSessionStore.newChatCompletionSettings = {
        ...defaultCompletionSettings,
        ...globalSettings,
      };

      // Set up a pal in the palStore with completion settings
      const testPal: Pal = {
        type: 'local',
        id: 'test-pal-id',
        name: 'Test Pal',
        description: 'Test pal for settings',
        systemPrompt: 'Test prompt',
        isSystemPromptChanged: false,
        useAIPrompt: false,
        parameters: {},
        parameterSchema: [],
        completionSettings: palSettings as CompletionParams,
        source: 'local',
      };
      palStore.pals.push(testPal);

      const result = await chatSessionStore.resolveCompletionSettings(
        undefined,
        'test-pal-id',
      );

      expect(result.temperature).toBe(0.5); // From pal settings
      expect(result.top_p).toBe(0.9); // From global settings
      expect(result.top_k).toBe(30); // From pal settings
    });

    it('should apply session settings over all other settings', async () => {
      const globalSettings: Partial<CompletionParams> = {
        temperature: 0.8,
        top_p: 0.9,
      };

      const palSettings: Partial<CompletionParams> = {
        temperature: 0.5,
        top_k: 30,
      };

      const sessionSettings: CompletionParams = {
        ...defaultCompletionSettings,
        temperature: 0.3,
        n_predict: 200,
      };

      chatSessionStore.newChatCompletionSettings = {
        ...defaultCompletionSettings,
        ...globalSettings,
      };

      chatSessionStore.sessions = [
        {
          id: 'test-session',
          title: 'Test Session',
          date: '2024-01-01',
          messages: [],
          completionSettings: sessionSettings,
          activePalId: 'test-pal-id',
          settingsSource: 'custom',
        },
      ];

      // Set up a pal in the palStore with completion settings
      const testPal: Pal = {
        type: 'local',
        id: 'test-pal-id',
        name: 'Test Pal',
        description: 'Test pal for settings',
        systemPrompt: 'Test prompt',
        isSystemPromptChanged: false,
        useAIPrompt: false,
        parameters: {},
        parameterSchema: [],
        completionSettings: palSettings as CompletionParams,
        source: 'local',
      };
      palStore.pals.push(testPal);

      const result = await chatSessionStore.resolveCompletionSettings(
        'test-session',
        'test-pal-id',
      );

      expect(result.temperature).toBe(0.3); // From session settings
      expect(result.top_p).toBe(0.95); // From session settings (default value)
      expect(result.top_k).toBe(40); // From session settings (default value)
      expect(result.n_predict).toBe(200); // From session settings
    });
  });

  describe('getCurrentCompletionSettings', () => {
    it('should resolve settings for new chat with pal', async () => {
      const palSettings: Partial<CompletionParams> = {
        temperature: 0.7,
      };

      chatSessionStore.newChatPalId = 'test-pal-id';

      // Set up a pal in the palStore with completion settings
      const testPal: Pal = {
        type: 'local',
        id: 'test-pal-id',
        name: 'Test Pal',
        description: 'Test pal for settings',
        systemPrompt: 'Test prompt',
        isSystemPromptChanged: false,
        useAIPrompt: false,
        parameters: {},
        parameterSchema: [],
        completionSettings: palSettings as CompletionParams,
        source: 'local',
      };
      palStore.pals.push(testPal);

      const result = await chatSessionStore.getCurrentCompletionSettings();

      expect(result.temperature).toBe(0.7);
    });

    it('should resolve settings for active session', async () => {
      const sessionSettings: CompletionParams = {
        ...defaultCompletionSettings,
        temperature: 0.9,
      };

      chatSessionStore.activeSessionId = 'test-session';
      chatSessionStore.sessions = [
        {
          id: 'test-session',
          title: 'Test Session',
          date: '2024-01-01',
          messages: [],
          completionSettings: sessionSettings,
          activePalId: 'test-pal-id',
          settingsSource: 'custom',
        },
      ];

      const result = await chatSessionStore.getCurrentCompletionSettings();

      expect(result.temperature).toBe(0.9);
    });
  });

  describe('newChatThinkingOverride', () => {
    const makeThinkingPal = (
      id: string,
      enableThinking: boolean,
      extra: Partial<CompletionParams> = {},
    ): Pal => ({
      type: 'local',
      id,
      name: `Pal ${id}`,
      description: '',
      systemPrompt: '',
      isSystemPromptChanged: false,
      useAIPrompt: false,
      parameters: {},
      parameterSchema: [],
      completionSettings: {
        ...defaultCompletionSettings,
        enable_thinking: enableThinking,
        ...extra,
      } as CompletionParams,
      source: 'local',
    });

    it('override wins over pal in no-session resolve (default pal flips OFF)', async () => {
      palStore.pals.push(makeThinkingPal('palX', true, {temperature: 0.5}));
      chatSessionStore.newChatPalId = 'palX';
      chatSessionStore.newChatThinkingOverride = false;

      const result = await chatSessionStore.resolveCompletionSettings(
        undefined,
        'palX',
      );

      // Override wins for enable_thinking.
      expect(result.enable_thinking).toBe(false);
      // Reasoning carrier mirrors the override so the remote wire path honors
      // the OFF intent for the first message of the new chat (not local-only).
      expect(result.reasoning).toEqual({enabled: false});
      // Pal's other completion settings survive — override is single-key.
      expect(result.temperature).toBe(0.5);
    });

    it('override wins over pal in no-session resolve (authored pal flips ON)', async () => {
      // Pal has enable_thinking: false; user flips to true via override.
      palStore.pals.push(makeThinkingPal('palX', false));
      chatSessionStore.newChatPalId = 'palX';
      chatSessionStore.newChatThinkingOverride = true;

      const result = await chatSessionStore.resolveCompletionSettings(
        undefined,
        'palX',
      );

      expect(result.enable_thinking).toBe(true);
      expect(result.reasoning).toEqual({enabled: true});
    });

    it('no-session OFF override carrier yields per-serverType OFF payload', async () => {
      // The whole point of carrying the override on `reasoning`: a brand-new
      // remote chat opened with thinking OFF must produce a real OFF wire
      // payload, not an empty object.
      palStore.pals.push(makeThinkingPal('palRemote', true));
      chatSessionStore.newChatPalId = 'palRemote';
      chatSessionStore.newChatThinkingOverride = false;

      const result = await chatSessionStore.resolveCompletionSettings(
        undefined,
        'palRemote',
      );

      expect(result.reasoning?.enabled).toBe(false);
      expect(
        bodyExtras('llama.cpp', {
          samplers: {},
          reasoning: result.reasoning,
        }),
      ).toEqual({
        reasoning_format: 'auto',
        chat_template_kwargs: {enable_thinking: false},
      });
      expect(
        bodyExtras('Ollama', {
          samplers: {},
          reasoning: result.reasoning,
        }),
      ).toEqual({
        reasoning_effort: 'none',
      });
    });

    it('override is ignored on session-branch resolution (settingsSource pal)', async () => {
      palStore.pals.push(makeThinkingPal('palX', true));
      // Active session with settingsSource='pal' — resolver should
      // return pal's enable_thinking, NOT the no-session override.
      chatSessionStore.sessions = [
        {
          id: 'session-1',
          title: 'Session 1',
          date: '2024-01-01',
          messages: [],
          completionSettings: {
            ...defaultCompletionSettings,
            enable_thinking: true,
          },
          activePalId: 'palX',
          settingsSource: 'pal',
        },
      ];
      chatSessionStore.newChatThinkingOverride = false;

      const result = await chatSessionStore.resolveCompletionSettings(
        'session-1',
        'palX',
      );

      // Pal's value wins; override is not applied on the session branch.
      expect(result.enable_thinking).toBe(true);
    });

    it('override does NOT strip PACT-derived tools', async () => {
      // Pal advertises a registered talent — resolver should inject
      // tools AND still let the override flip enable_thinking last.
      const palWithTalent: Pal = {
        ...makeThinkingPal('palToolful', true),
        pact: {
          talents: [{name: 'calculate', necessity: 'required'}],
        },
      };
      palStore.pals.push(palWithTalent);
      chatSessionStore.newChatPalId = 'palToolful';
      chatSessionStore.newChatThinkingOverride = false;

      const result = await chatSessionStore.resolveCompletionSettings(
        undefined,
        'palToolful',
      );

      expect(result.enable_thinking).toBe(false);
      const tools = (result.tools ?? []) as any[];
      expect(Array.isArray(tools)).toBe(true);
      expect(tools.length).toBeGreaterThan(0);
      // Tools came from the requested talent.
      const toolNames = tools.map((t: any) => t?.function?.name ?? t?.name);
      expect(toolNames).toContain('calculate');
    });
  });

  describe('resolveCompletionSettings — tools are derived from the pact, never stored', () => {
    // A tool definition that no registered talent produces: if it ever
    // shows up in a resolved result, a stored snapshot leaked through.
    const staleTools = [
      {
        type: 'function',
        function: {
          name: 'stale_snapshot_tool',
          description: 'stale snapshot, must never reach the model',
          parameters: {type: 'object', properties: {}},
        },
      },
    ] as unknown as CompletionParams['tools'];

    const toolNames = (result: CompletionParams): string[] =>
      ((result.tools ?? []) as any[]).map(t => t?.function?.name ?? t?.name);

    const makePal = (
      id: string,
      pact?: Pal['pact'],
      completionSettings?: Partial<CompletionParams>,
    ): Pal => ({
      type: 'local',
      id,
      name: `Pal ${id}`,
      description: '',
      systemPrompt: '',
      isSystemPromptChanged: false,
      useAIPrompt: false,
      parameters: {},
      parameterSchema: [],
      ...(completionSettings
        ? {completionSettings: completionSettings as CompletionParams}
        : {}),
      ...(pact ? {pact} : {}),
      source: 'local',
    });

    const pushSession = (
      sessionSettings: CompletionParams,
      activePalId: string,
      settingsSource: 'pal' | 'custom' = 'custom',
    ) => {
      chatSessionStore.sessions = [
        {
          id: 'test-session',
          title: 'Test Session',
          date: '2024-01-01',
          messages: [],
          completionSettings: sessionSettings,
          activePalId,
          settingsSource,
        },
      ];
    };

    it('ignores stale tools in the global preset when the pal has a pact', async () => {
      // Global preset saved while another pal — or no pal — was active.
      chatSessionStore.newChatCompletionSettings = {
        ...defaultCompletionSettings,
        tools: staleTools,
      };
      palStore.pals.push(
        makePal('palToolful', {
          talents: [{name: 'web_search', necessity: 'required'}],
        }),
      );

      const result = await chatSessionStore.resolveCompletionSettings(
        undefined,
        'palToolful',
      );

      expect(toolNames(result)).toEqual(['web_search']);
    });

    it('keeps only pact talents when the global preset holds a full stale snapshot', async () => {
      // All five talents, saved as the global preset at some earlier point.
      chatSessionStore.newChatCompletionSettings = {
        ...defaultCompletionSettings,
        tools: deriveToolSchemas(),
      };
      palStore.pals.push(
        makePal('palToolful', {
          talents: [{name: 'calculate', necessity: 'required'}],
        }),
      );

      const result = await chatSessionStore.resolveCompletionSettings(
        undefined,
        'palToolful',
      );

      expect(toolNames(result)).toEqual(['calculate']);
    });

    it('ignores stale tools in the pal’s own completionSettings', async () => {
      palStore.pals.push(
        makePal(
          'palToolful',
          {talents: [{name: 'web_search', necessity: 'required'}]},
          {tools: staleTools},
        ),
      );

      const result = await chatSessionStore.resolveCompletionSettings(
        undefined,
        'palToolful',
      );

      expect(toolNames(result)).toEqual(['web_search']);
    });

    it('custom session: stored session tools never leak, pact tools win', async () => {
      pushSession(
        {
          ...defaultCompletionSettings,
          temperature: 0.3,
          tools: deriveToolSchemas(),
        },
        'palToolful',
        'custom',
      );
      palStore.pals.push(
        makePal('palToolful', {
          talents: [{name: 'web_search', necessity: 'required'}],
        }),
      );

      const result = await chatSessionStore.resolveCompletionSettings(
        'test-session',
        'palToolful',
      );

      expect(toolNames(result)).toEqual(['web_search']);
      // The rest of the custom session settings still win.
      expect(result.temperature).toBe(0.3);
    });

    it('custom session: no stale tools leak when the pal has no pact', async () => {
      pushSession(
        {...defaultCompletionSettings, tools: deriveToolSchemas()},
        'palPlain',
        'custom',
      );
      palStore.pals.push(makePal('palPlain'));

      const result = await chatSessionStore.resolveCompletionSettings(
        'test-session',
        'palPlain',
      );

      expect(result.tools).toBeUndefined();
    });

    it('no pal: stale tools in the global preset never reach the model', async () => {
      chatSessionStore.newChatCompletionSettings = {
        ...defaultCompletionSettings,
        temperature: 0.8,
        tools: deriveToolSchemas(),
      };

      const result = await chatSessionStore.resolveCompletionSettings();

      expect(result.tools).toBeUndefined();
      // Other global settings still apply — only tools are stripped.
      expect(result.temperature).toBe(0.8);
    });

    it('setNewChatCompletionSettings strips tools before persisting', async () => {
      const saveSpy = jest
        .spyOn(chatSessionRepository, 'saveGlobalCompletionSettings')
        .mockResolvedValue(undefined as never);
      try {
        await chatSessionStore.setNewChatCompletionSettings({
          ...defaultCompletionSettings,
          tools: deriveToolSchemas(),
        });

        expect('tools' in chatSessionStore.newChatCompletionSettings).toBe(
          false,
        );
        expect(saveSpy).toHaveBeenCalledTimes(1);
        expect('tools' in (saveSpy.mock.calls[0]?.[0] ?? {})).toBe(false);
      } finally {
        saveSpy.mockRestore();
      }
    });

    it('updateSessionCompletionSettings strips tools before persisting', async () => {
      chatSessionStore.activeSessionId = 'test-session';
      pushSession({...defaultCompletionSettings}, 'palPlain', 'custom');
      const updateSpy = jest
        .spyOn(chatSessionRepository, 'updateSessionCompletionSettings')
        .mockResolvedValue(undefined as never);
      const sourceSpy = jest
        .spyOn(chatSessionRepository, 'setSessionSettingsSource')
        .mockResolvedValue(undefined as never);
      try {
        await chatSessionStore.updateSessionCompletionSettings({
          ...defaultCompletionSettings,
          tools: deriveToolSchemas(),
        });

        const session = chatSessionStore.sessions.find(
          s => s.id === 'test-session',
        );
        expect('tools' in (session?.completionSettings ?? {})).toBe(false);
        expect(updateSpy).toHaveBeenCalledTimes(1);
        expect('tools' in (updateSpy.mock.calls[0]?.[1] ?? {})).toBe(false);
      } finally {
        updateSpy.mockRestore();
        sourceSpy.mockRestore();
      }
    });
  });
});
