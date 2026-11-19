import {renderHook, act, waitFor} from '@testing-library/react-native';
import {useChatSession} from '../useChatSession';
import {chatSessionStore, modelStore} from '../../store';
import {User} from '../../utils/types';
import {assistant} from '../../utils/chat';
import {createDefaultContextInitParams} from '../../utils/contextInitParamsVersions';

const mockUser: User = {id: 'user_1', firstName: 'Tester'};
const mockAssistant: User = assistant;

describe('useChatSession compaction', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // These tests drive handleSendPress through sessions they build
    // themselves, so the mock's currentSessionMessages must return the
    // active session's messages (the mock returns [] by default — the
    // shared fixtures have no authors and would crash convertToChatMessages
    // if they ever flowed into a completion).
    Object.defineProperty(chatSessionStore, 'currentSessionMessages', {
      get: () => {
        const session = (chatSessionStore.sessions as any[]).find(
          s => s.id === chatSessionStore.activeSessionId,
        );
        return (
          session?.messages?.filter((m: any) => !m.metadata?.isCompacted) || []
        );
      },
      configurable: true,
    });
    modelStore.context = {
      completion: jest.fn().mockResolvedValue({
        text: 'Mock response',
        tokens_evaluated: 100,
        tokens_predicted: 50,
      }),
      stopCompletion: jest.fn(),
    } as any;
    modelStore.engine = {
      completion: jest.fn().mockResolvedValue({
        text: 'Mock response',
        tokens_evaluated: 100,
        tokens_predicted: 50,
      }),
      stopCompletion: jest.fn(),
    };
    (modelStore as any).context = {id: 'ctx-1'};
    (modelStore as any).activeModelId = 'model-1';
  });

  it('intercepts /compact and warns if message count is too low', async () => {
    jest.spyOn(chatSessionStore, 'addMessageToCurrentSession');
    jest.spyOn(chatSessionStore, 'compactActiveSession');

    // Only 2 messages
    const session = {
      id: 'sess_1',
      title: 'Short chat',
      messagesLoaded: true,
      messages: [
        {
          id: '1',
          type: 'text',
          author: mockUser,
          text: 'Hello',
          createdAt: 1000,
        },
        {
          id: '2',
          type: 'text',
          author: mockAssistant,
          text: 'Hi',
          createdAt: 2000,
        },
      ],
    };
    chatSessionStore.sessions = [session as any];
    chatSessionStore.activeSessionId = 'sess_1';

    const {result} = await renderHook(() =>
      useChatSession({current: null}, mockUser, mockAssistant),
    );

    await act(async () => {
      await result.current.handleSendPress({type: 'text', text: '/compact'});
    });

    expect(chatSessionStore.compactActiveSession).not.toHaveBeenCalled();
    expect(chatSessionStore.addMessageToCurrentSession).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'text',
        text: expect.stringContaining('Not enough messages'),
      }),
    );
  });

  it('intercepts /compact with focus instruction and triggers compaction', async () => {
    const spyCompact = jest
      .spyOn(chatSessionStore, 'compactActiveSession')
      .mockResolvedValue(true);

    // 6 messages in session
    const session = {
      id: 'sess_1',
      title: 'Long chat',
      messagesLoaded: true,
      messages: [
        {
          id: '1',
          type: 'text',
          author: mockUser,
          text: 'Msg 1',
          createdAt: 1000,
        },
        {
          id: '2',
          type: 'text',
          author: mockAssistant,
          text: 'Msg 2',
          createdAt: 2000,
        },
        {
          id: '3',
          type: 'text',
          author: mockUser,
          text: 'Msg 3',
          createdAt: 3000,
        },
        {
          id: '4',
          type: 'text',
          author: mockAssistant,
          text: 'Msg 4',
          createdAt: 4000,
        },
        {
          id: '5',
          type: 'text',
          author: mockUser,
          text: 'Msg 5',
          createdAt: 5000,
        },
        {
          id: '6',
          type: 'text',
          author: mockAssistant,
          text: 'Msg 6',
          createdAt: 6000,
        },
      ],
    };
    chatSessionStore.sessions = [session as any];
    chatSessionStore.activeSessionId = 'sess_1';

    const {result} = await renderHook(() =>
      useChatSession({current: null}, mockUser, mockAssistant),
    );

    await act(async () => {
      await result.current.handleSendPress({
        type: 'text',
        text: '/compact keep details about SQLite',
      });
    });

    expect(spyCompact).toHaveBeenCalledWith('keep details about SQLite');
  });

  it('blocks sends while compacting and hands the text back', async () => {
    jest.spyOn(chatSessionStore, 'addMessageToCurrentSession');
    const spyCompact = jest.spyOn(chatSessionStore, 'compactActiveSession');

    const session = {
      id: 'sess_1',
      title: 'Long chat',
      messagesLoaded: true,
      messages: [
        {
          id: '1',
          type: 'text',
          author: mockUser,
          text: 'Msg 1',
          createdAt: 1000,
        },
      ],
    };
    chatSessionStore.sessions = [session as any];
    chatSessionStore.activeSessionId = 'sess_1';
    chatSessionStore.isCompacting = true;

    const {result} = await renderHook(() =>
      useChatSession({current: null}, mockUser, mockAssistant),
    );

    let undone: unknown;
    await act(async () => {
      undone = await result.current.handleSendPress({
        type: 'text',
        text: 'hello while compacting',
      });
    });

    // No second completion starts on the busy engine, the user is told
    // why, and the text comes back so the composer restores it.
    expect(spyCompact).not.toHaveBeenCalled();
    expect(chatSessionStore.addMessageToCurrentSession).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'text',
        text: expect.stringContaining('Compaction is in progress'),
      }),
    );
    expect(undone).toEqual({
      message: expect.objectContaining({text: 'hello while compacting'}),
      sessionId: 'sess_1',
    });

    chatSessionStore.isCompacting = false;
  });

  describe('automatic compaction toggle', () => {
    const buildSession = () => {
      const session = {
        id: 'sess_1',
        title: 'Long chat',
        messagesLoaded: true,
        messages: [
          {
            id: '1',
            type: 'text',
            author: mockUser,
            text: 'Msg 1',
            createdAt: 1000,
          },
        ],
      };
      chatSessionStore.sessions = [session as any];
      chatSessionStore.activeSessionId = 'sess_1';
      chatSessionStore.isCompacting = false;
    };

    // Size the mock turn's token counts from the live effective
    // context length, so the finished turn crosses the trigger line
    // whatever the fixture model declares (used = evaluated +
    // predicted; trigger = n_ctx - max(512, ceil(n_ctx * 0.15))).
    const bigTurn = () => {
      const nCtx = modelStore.activeModelCaps.effectiveContextLength ?? 2048;
      const trigger = nCtx - Math.max(512, Math.ceil(nCtx * 0.15));
      const completion = jest.fn().mockResolvedValue({
        text: 'Mock response',
        tokens_evaluated: trigger + 100,
        tokens_predicted: 0,
      });
      (modelStore.engine as any).completion = completion;
      (modelStore.context as any).completion = completion;
    };

    beforeEach(() => {
      // The mock store starts with no loaded context, so the live
      // effective length would be undefined and the auto-check would
      // never fire. Load a 2048-token context for these tests.
      modelStore.activeContextSettings = createDefaultContextInitParams();
      chatSessionStore.autoCompactionEnabled = false;
    });

    afterEach(() => {
      modelStore.activeContextSettings = undefined;
      chatSessionStore.autoCompactionEnabled = false;
    });

    const sendHello = async () => {
      const {result} = await renderHook(() =>
        useChatSession({current: null}, mockUser, mockAssistant),
      );
      await act(async () => {
        await result.current.handleSendPress({
          type: 'text',
          text: 'hello',
        });
      });
    };

    it('auto-compacts after a turn that crosses the threshold when on', async () => {
      buildSession();
      bigTurn();
      chatSessionStore.autoCompactionEnabled = true;
      const spyCompact = jest.spyOn(chatSessionStore, 'compactActiveSession');

      await sendHello();

      await waitFor(() => expect(spyCompact).toHaveBeenCalledTimes(1));
    });

    it('does not auto-compact after the same turn when off', async () => {
      buildSession();
      bigTurn();
      chatSessionStore.autoCompactionEnabled = false;
      const spyCompact = jest.spyOn(chatSessionStore, 'compactActiveSession');

      await sendHello();

      // Longer than the 100 ms auto-compaction delay: if the gate were
      // open, the call would have landed by now.
      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 300));
      });
      expect(spyCompact).not.toHaveBeenCalled();
    });

    it('recovers by compacting on a context-full error when on', async () => {
      buildSession();
      const completion = jest
        .fn()
        .mockRejectedValue(new Error('context is full'));
      (modelStore.engine as any).completion = completion;
      (modelStore.context as any).completion = completion;
      chatSessionStore.autoCompactionEnabled = true;
      const spyCompact = jest.spyOn(chatSessionStore, 'compactActiveSession');

      await sendHello();

      await waitFor(() => expect(spyCompact).toHaveBeenCalledTimes(1));
    });

    it('does not recover by compacting on a context-full error when off', async () => {
      buildSession();
      const completion = jest
        .fn()
        .mockRejectedValue(new Error('context is full'));
      (modelStore.engine as any).completion = completion;
      (modelStore.context as any).completion = completion;
      chatSessionStore.autoCompactionEnabled = false;
      const spyCompact = jest.spyOn(chatSessionStore, 'compactActiveSession');

      await sendHello();

      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 300));
      });
      expect(spyCompact).not.toHaveBeenCalled();
    });
  });
});
