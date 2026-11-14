//import {fireEvent, render, screen} from '@testing-library/react-native'
import * as React from 'react';
import {runInAction} from 'mobx';

import {
  fileMessage,
  imageMessage,
  textMessage,
  user,
} from '../../../../jest/fixtures';
import {l10n} from '../../../locales';
import {MessageType} from '../../../utils/types';
import {ChatView} from '../ChatView';
import {act, fireEvent, render, screen} from '../../../../jest/test-utils';
import {ChatEmptyPlaceholder} from '../../ChatEmptyPlaceholder';
import {NEW_CHAT_DRAFT_KEY, chatSessionStore, modelStore} from '../../../store';
import {registerDefaultTalents} from '../../../services/talents';
import DeviceInfo from 'react-native-device-info';
import * as memoryEstimator from '../../../utils/memoryEstimator';

// talentRegistry (src/services/talents) is the real singleton in Jest; register
// the built-in engines so render_html (recommendedContextTokens=4096) drives the
// pal-load hint.
registerDefaultTalents();

jest.useFakeTimers();

// RNTL v14 no longer exposes composite props (Paper Menu's visible/anchor/
// onDismiss, ContentReportSheet's isVisible) in the host tree, so capture
// them via thin mocks of the app wrappers. Both mocks render their children
// only when visible, preserving the items-presence behaviour the tests
// rely on; the sheet's content is not queried anywhere in this file.
// Captured props accumulate across renders; helpers below take the latest.
const mockCapturedMenus: any[] = [];
jest.mock('../../Menu', () => {
  const actual = jest.requireActual('../../Menu');
  const {createElement, Fragment, isValidElement} = require('react');
  const MenuMock = (props: any) => {
    mockCapturedMenus.push(props);
    // Paper renders the anchor (the trigger element) whether the menu is
    // open or closed; children only when visible. The anchor may be an
    // element, a coordinate {x, y}, or a function returning an element.
    const anchor =
      typeof props.anchor === 'function' ? props.anchor() : props.anchor;
    return createElement(
      Fragment,
      null,
      isValidElement(anchor) ? anchor : null,
      props.visible ? props.children : null,
    );
  };
  MenuMock.Item = actual.Menu.Item;
  MenuMock.Separator = actual.Menu.Separator;
  MenuMock.GroupSeparator = actual.Menu.GroupSeparator;
  return {...actual, Menu: MenuMock};
});
const mockCapturedReportSheets: any[] = [];
jest.mock('../../ContentReportSheet', () => {
  const actual = jest.requireActual('../../ContentReportSheet');
  const SheetMock = (props: any) => {
    mockCapturedReportSheets.push(props);
    return null;
  };
  return {...actual, ContentReportSheet: SheetMock};
});

const holdOn = async (node: any, event: any) => {
  // Open the user-row menu via its accessibility 'longpress' action, not
  // via a touch long-press. The touch path (onTouchStart -> Animated.spring
  // in onPressIn, plus the 500ms long-press timer) leaves the test renderer
  // unable to mount the next render — the following test's container comes
  // back empty (0 nodes) under fake timers in RNTL v14. The accessibility
  // action reaches the same openUserMenu handler without touching the
  // Animated value or any timer.
  const row = (() => {
    for (let n = node; n; n = n.parent) {
      if (typeof n.props?.onAccessibilityAction === 'function') {
        return n;
      }
    }
    return node;
  })();
  // handleUserRowAction measures the row to anchor the menu (the action
  // carries no press point). Stub measure on the ref target — the nearest
  // ancestor fiber stateNode with a measure function, as for the "…"
  // button — so the menu anchors at the event's point.
  const px = event?.nativeEvent?.pageX ?? 0;
  const py = event?.nativeEvent?.pageY ?? 0;
  const native = (() => {
    let fiber = (row as any)?.unstable_fiber;
    while (fiber) {
      const sn = fiber.stateNode;
      if (sn && typeof sn.measure === 'function') {
        return sn;
      }
      fiber = fiber.return;
    }
    return undefined;
  })();
  if (native) {
    native.measure = (cb: (...args: number[]) => void) =>
      cb(0, 0, 0, 0, px, py);
  }
  await fireEvent(row, 'accessibilityAction', {
    nativeEvent: {actionName: 'longpress'},
  });
};

const openRowMenu = async (
  utils: {getByTestId: (id: string) => any},
  message: MessageType.Any,
) => {
  const event = {nativeEvent: {pageX: 10, pageY: 20}};
  if (message.author.id === user.id) {
    await holdOn(utils.getByTestId('markdown-content'), event);
  } else {
    await fireEvent.press(utils.getByTestId('message-menu-button'), event);
  }
};

// Mock ChatEmptyPlaceholder component
jest.mock('../../ChatEmptyPlaceholder', () => ({
  ChatEmptyPlaceholder: jest.fn(() => null),
}));

describe('chat', () => {
  it('renders image preview', async () => {
    const messages = [
      textMessage,
      imageMessage,
      fileMessage,
      {
        ...textMessage,
        createdAt: 1,
        id: 'new-uuidv4',
        status: 'delivered' as const,
      },
    ];

    const onSendPress = jest.fn();
    const {getByTestId, getByText} = await render(
      <ChatView messages={messages} onSendPress={onSendPress} user={user} />,
      {withSafeArea: true, withNavigation: true, withBottomSheetProvider: true},
    );

    const button = getByTestId('message-image').parent;
    expect(button).toBeDefined();
    if (button) {
      await fireEvent.press(button);
    }
    const closeButton = getByText('✕');
    expect(closeButton).toBeDefined();
  });

  it('sends a text message', async () => {
    expect.assertions(1);
    // Set up an active model for the test
    runInAction(() => {
      modelStore.activeModelId = 'test-model-id';
    });

    const messages = [
      textMessage,
      fileMessage,
      {
        ...imageMessage,
        createdAt: 1,
      },
      {
        ...textMessage,
        createdAt: 2,
        id: 'new-uuidv4',
        status: 'sending' as const,
      },
    ];

    const onSendPress = jest.fn();
    const {getByLabelText, getByPlaceholderText} = await render(
      <ChatView
        messages={messages}
        onSendPress={onSendPress}
        textInputProps={{defaultValue: 'text'}}
        user={user}
      />,

      {withNavigation: true, withBottomSheetProvider: true},
    );
    const textInput = getByPlaceholderText(
      l10n.en.components.chatInput.inputPlaceholder,
    );
    await fireEvent.changeText(textInput, 'text');

    const button = getByLabelText(
      l10n.en.components.sendButton.accessibilityLabel,
    );
    await fireEvent.press(button);
    expect(onSendPress).toHaveBeenCalledWith({text: 'text', type: 'text'});
  });

  it('opens file on a file message tap', async () => {
    expect.assertions(1);
    const messages = [fileMessage, textMessage, imageMessage];
    const onSendPress = jest.fn();
    const onFilePress = jest.fn();
    const onMessagePress = (message: MessageType.Any) => {
      if (message.type === 'file') {
        onFilePress(message);
      }
    };
    const {getByLabelText} = await render(
      <ChatView
        onMessagePress={onMessagePress}
        messages={messages}
        onSendPress={onSendPress}
        showUserAvatars
        user={user}
      />,

      {withNavigation: true, withBottomSheetProvider: true},
    );

    const button = getByLabelText(
      l10n.en.components.fileMessage.fileButtonAccessibilityLabel,
    );
    await fireEvent.press(button);
    expect(onFilePress).toHaveBeenCalledWith(fileMessage);
  });

  it('opens image on image message press', async () => {
    expect.assertions(1);
    const messages = [imageMessage];
    const onSendPress = jest.fn();
    const onImagePress = jest.fn();
    const onMessagePress = (message: MessageType.Any) => {
      if (message.type === 'image') {
        onImagePress(message);
      }
    };

    const {getByTestId} = await render(
      <ChatView
        onMessagePress={onMessagePress}
        messages={messages}
        onSendPress={onSendPress}
        showUserAvatars
        user={user}
      />,

      {withNavigation: true, withBottomSheetProvider: true},
    );

    const button = getByTestId('ContentContainer');
    await fireEvent.press(button);
    expect(onImagePress).toHaveBeenCalledWith(imageMessage);
  });

  it('renders ChatEmptyPlaceholder when no messages', async () => {
    expect.assertions(1);
    const messages = [];
    const onSendPress = jest.fn();
    const onMessagePress = jest.fn();
    await render(
      <ChatView
        messages={messages}
        onMessagePress={onMessagePress}
        onSendPress={onSendPress}
        user={user}
      />,

      {withNavigation: true, withBottomSheetProvider: true},
    );

    expect(ChatEmptyPlaceholder).toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // Active-pal auto-load gate (e2e bench isolation).
  //
  // The mount-time `useEffect` calls `modelStore.selectModel(palDefaultModel)`
  // when `activePal` is set and no model is active. That cold-launch path is
  // benign for end users but catastrophic for the e2e benchmark runner: the
  // matrix's per-cell `devices` / `n_gpu_layers` arrive AFTER the auto-load
  // has already loaded the model with default devices, and `initContext`'s
  // "already loaded → skip" path silently dropped the runner's intent.
  //
  // The fix: gate the auto-load on `modelStore.benchmarkActive` so the
  // benchmark's `enterBenchmarkMode` window is honoured at the React-tree
  // boundary. Two assertions: gate-off triggers the load; gate-on suppresses.
  // ---------------------------------------------------------------------------

  describe('active pal auto-load gate', () => {
    const mockPal = {
      id: 'test-pal',
      name: 'Test',
      type: 'roleplay',
      defaultModel: {id: 'qwen3-1.7b-q4_0'} as any,
    } as any;

    beforeEach(() => {
      (modelStore.selectModel as jest.Mock).mockClear();
      runInAction(() => {
        (modelStore as any).activeModelId = undefined;
        modelStore.benchmarkActive = false;
        modelStore.models = [
          {
            id: 'qwen3-1.7b-q4_0',
            name: 'qwen3',
            isDownloaded: true,
          },
        ] as any;
      });
    });

    it('calls modelStore.selectModel(palDefault) when benchmarkActive=false', async () => {
      await render(
        <ChatView
          messages={[]}
          onSendPress={jest.fn()}
          user={user}
          activePal={mockPal}
        />,

        {withNavigation: true, withBottomSheetProvider: true},
      );
      expect(modelStore.selectModel).toHaveBeenCalledWith(
        expect.objectContaining({id: 'qwen3-1.7b-q4_0'}),
      );
    });

    it('does NOT call modelStore.selectModel when benchmarkActive=true', async () => {
      runInAction(() => {
        modelStore.benchmarkActive = true;
      });
      await render(
        <ChatView
          messages={[]}
          onSendPress={jest.fn()}
          user={user}
          activePal={mockPal}
        />,

        {withNavigation: true, withBottomSheetProvider: true},
      );
      expect(modelStore.selectModel).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // Pal-load hint "More room" action → opens the IncreaseContextSheet.
  //
  // The hint snackbar is a separate advisory surface from the banner; its
  // action must reach the same sheet even when the banner increase CTA would
  // be hidden, so the sheet is never a dead-end from this entry point. The
  // sheet's content (its testIDs) only mounts once the host opens it.
  // ---------------------------------------------------------------------------
  describe('pal-load hint "More room" action', () => {
    const heavyPal = {
      id: 'heavy-pal',
      name: 'Heavy',
      type: 'roleplay',
      pact: {talents: [{name: 'render_html', required: true}]},
    } as any;

    beforeEach(() => {
      chatSessionStore.palLoadHintSeen = new Set();
      (chatSessionStore.markPalLoadHintSeen as jest.Mock).mockImplementation(
        (sig: string) => chatSessionStore.palLoadHintSeen.add(sig),
      );
      (chatSessionStore.resetActiveSession as jest.Mock).mockClear();
      // The sheet's mount effect awaits getTotalMemory(); the central mock
      // returns a number, so make it Promise-returning for the sheet path.
      (DeviceInfo.getTotalMemory as jest.Mock).mockResolvedValue(12 * 1e9);
      runInAction(() => {
        modelStore.activeModelId = 'heavy-model';
        modelStore.models = [
          {id: 'heavy-model', name: 'heavy', isDownloaded: true} as any,
        ];

        // Below render_html's 4096 recommendation → hint fires; a value the
        // sheet can also offer larger ladder stops above.
        (modelStore as any).activeContextSettings = {n_ctx: 2048};
        modelStore.contextInitParams = {
          ...modelStore.contextInitParams,
          n_ctx: 2048,
        };
      });
    });

    afterEach(() => {
      runInAction(() => {
        (modelStore as any).activeContextSettings = undefined;
        modelStore.activeModelId = undefined;
        modelStore.models = [];
      });
      (chatSessionStore.markPalLoadHintSeen as jest.Mock).mockReset();
      (DeviceInfo.getTotalMemory as jest.Mock).mockReset();
    });

    it('opens the increase-context sheet when the hint action is tapped, reaching the no-fit state when nothing larger fits', async () => {
      // The mocked memory ceiling (4–5 GB) is below the model's requirement at
      // any larger ladder tier, so the sheet resolves to its no-fit state. That
      // is exactly the dead-end risk the hint action must avoid: the sheet stays
      // reachable and offers New chat rather than a permanently disabled confirm.
      const {getByTestId, queryByTestId, getAllByText} = await render(
        <ChatView
          messages={[]}
          onSendPress={jest.fn()}
          user={user}
          activePal={heavyPal}
        />,

        {withNavigation: true, withBottomSheetProvider: true},
      );

      // The hint snackbar is shown; the sheet content has not mounted yet.
      expect(getByTestId('pal-load-hint-snackbar')).toBeTruthy();
      expect(queryByTestId('increase-context-no-fit')).toBeNull();
      expect(queryByTestId('increase-context-new-chat')).toBeNull();

      // Tap the snackbar's "More room" action (label === contextMoreRoom).
      const action = getAllByText(l10n.en.chat.contextMoreRoom)[0];
      await fireEvent.press(action);

      // The sheet is now open and reachable from the hint. In the no-fit state
      // confirm is hidden and New chat is offered — not a dead-end.
      expect(getByTestId('increase-context-no-fit')).toBeTruthy();
      expect(queryByTestId('increase-context-confirm')).toBeNull();

      const newChat = getByTestId('increase-context-new-chat');
      await fireEvent.press(newChat);
      expect(chatSessionStore.resetActiveSession).toHaveBeenCalledTimes(1);
    });
  });

  describe('composer draft across a chat switch', () => {
    const drafts = new Map<string, string>();
    const props = {messages: [], onSendPress: jest.fn(), user};
    const options = {withNavigation: true, withBottomSheetProvider: true};

    beforeEach(() => {
      drafts.clear();
      (chatSessionStore.saveDraft as jest.Mock).mockImplementation(
        (key: string, text: string) =>
          text.trim() ? drafts.set(key, text) : drafts.delete(key),
      );
      (chatSessionStore.getDraft as jest.Mock).mockImplementation(
        (key: string) => drafts.get(key) ?? '',
      );
      (chatSessionStore.clearDraft as jest.Mock).mockImplementation(
        (key: string) => drafts.delete(key),
      );
      runInAction(() => {
        modelStore.activeModelId = 'test-model-id';
      });
    });

    afterEach(() => {
      chatSessionStore.activeSessionId = 'session-1';
      (chatSessionStore.saveDraft as jest.Mock).mockReset();
      (chatSessionStore.getDraft as jest.Mock).mockReset().mockReturnValue('');
      (chatSessionStore.clearDraft as jest.Mock).mockReset();
    });

    const renderChat = async () => {
      const utils = await render(<ChatView {...props} />, options);
      const composer = () =>
        utils.getByPlaceholderText(
          l10n.en.components.chatInput.inputPlaceholder,
        );
      const type = async (text: string) =>
        await fireEvent.changeText(composer(), text);
      const send = async () =>
        await fireEvent.press(
          utils.getByLabelText(
            l10n.en.components.sendButton.accessibilityLabel,
          ),
        );
      const switchTo = async (
        sessionId: string | null,
        writeBefore?: () => void,
      ) =>
        await act(async () => {
          chatSessionStore.activeSessionId = sessionId;
          writeBefore?.();
          await utils.rerender(<ChatView {...props} messages={[]} />);
        });
      return {composer, type, send, switchTo};
    };

    it('saves typed text for the chat being left', async () => {
      const {type, switchTo} = await renderChat();
      await type('foo');
      await switchTo('session-2');
      expect(chatSessionStore.saveDraft).toHaveBeenCalledWith(
        'session-1',
        'foo',
      );
      expect(drafts.get('session-1')).toBe('foo');
    });

    it('keeps a draft written for the chat being left after the composer last synced', async () => {
      const {type, send, switchTo} = await renderChat();
      await type('first');
      await send();
      await switchTo('session-2', () => drafts.set('session-1', 'hi'));
      expect(chatSessionStore.saveDraft).not.toHaveBeenCalledWith(
        'session-1',
        '',
      );
      expect(drafts.get('session-1')).toBe('hi');
    });

    it('joins text typed since then after that draft', async () => {
      const {type, send, switchTo} = await renderChat();
      await type('first');
      await send();
      await type('bar');
      await switchTo('session-2', () => drafts.set('session-1', 'hi'));
      expect(drafts.get('session-1')).toBe('hi\nbar');
    });

    it('clears the new-chat draft when sending from the new-chat screen', async () => {
      chatSessionStore.activeSessionId = null;
      drafts.set(NEW_CHAT_DRAFT_KEY, 'foo');
      const {composer, send, switchTo} = await renderChat();
      expect(composer().props.value).toBe('foo');
      await send();
      await switchTo('created-session');
      expect(chatSessionStore.clearDraft).toHaveBeenCalledWith(
        NEW_CHAT_DRAFT_KEY,
      );
      expect(drafts.get(NEW_CHAT_DRAFT_KEY)).toBeUndefined();
    });

    it('deletes the draft when the composer was cleared before leaving', async () => {
      drafts.set('session-1', 'foo');
      const {composer, type, switchTo} = await renderChat();
      expect(composer().props.value).toBe('foo');
      await type('');
      await switchTo('session-2');
      expect(drafts.has('session-1')).toBe(false);
    });

    it('clears the chat draft on send', async () => {
      drafts.set('session-1', 'foo');
      const {send} = await renderChat();
      await send();
      expect(chatSessionStore.clearDraft).toHaveBeenCalledWith('session-1');
      expect(drafts.has('session-1')).toBe(false);
    });
  });

  describe('while a send waits for a stopped run to drain', () => {
    const answer = {
      ...textMessage,
      id: 'assistant-answer',
      author: {id: 'assistant'},
      text: 'answer',
    };
    const menuLabels = l10n.en.components.chatView.menuItems;
    const options = {withNavigation: true, withBottomSheetProvider: true};

    beforeEach(() => {
      runInAction(() => {
        modelStore.activeModelId = 'test-model-id';
      });
      chatSessionStore.isStopping = true;
    });

    afterEach(() => {
      chatSessionStore.isStopping = false;
    });

    const isDisabled = (label: string, getByText: (t: string) => any) => {
      let node = getByText(label);
      while (node) {
        const state = node.props.accessibilityState;
        if (state && 'disabled' in state) {
          return state.disabled;
        }
        node = node.parent;
      }
      return undefined;
    };

    it('keeps the composer text and sends nothing when the send funnel is called', async () => {
      const onSendPress = jest.fn();
      const {getByPlaceholderText} = await render(
        <ChatView messages={[]} onSendPress={onSendPress} user={user} />,
        options,
      );
      const composer = getByPlaceholderText(
        l10n.en.components.chatInput.inputPlaceholder,
      );
      await fireEvent.changeText(composer, 'second message');

      // v14: the ChatInput composite's props (including the send funnel
      // `onSendPress`) are not in the host tree, so the ancestor walk for a
      // host node with onSendPress reaches the root and returns null.
      // Walk the fiber instead: the first ancestor fiber with an
      // onSendPress prop is the ChatInput, whose onSendPress is the
      // ChatView's send funnel (wrappedOnSendPress) — calling it directly
      // exercises the funnel without going through ChatInput's handleSend,
      // which would clear the composer text itself.
      const funnel = (() => {
        let fiber = (composer as any)?.unstable_fiber;
        while (fiber) {
          const props = fiber.memoizedProps;
          if (props && typeof props.onSendPress === 'function') {
            return props.onSendPress;
          }
          fiber = fiber.return;
        }
        return undefined;
      })();
      expect(funnel).toBeDefined();
      await act(async () => {
        await funnel!({
          type: 'text',
          text: 'second message',
        });
      });

      expect(onSendPress).not.toHaveBeenCalled();
      expect(composer.props.value).toBe('second message');
    });

    it.each([
      [
        'an assistant row',
        answer,
        [menuLabels.regenerate, menuLabels.regenerateWith],
      ],

      ['a user row', textMessage, [menuLabels.edit]],
    ])(
      'disables the row-deleting menu items on %s, but not Copy',
      async (_row, message, deleting) => {
        const utils = await render(
          <ChatView messages={[message]} onSendPress={jest.fn()} user={user} />,
          options,
        );
        await openRowMenu(utils, message);
        const {getByText} = utils;

        for (const label of deleting) {
          expect(isDisabled(label, getByText)).toBe(true);
        }
        expect(isDisabled(menuLabels.copy, getByText)).toBe(false);
      },
    );
  });

  describe('message menu from the "…" or a user long-press', () => {
    const labels = l10n.en.components.chatView.menuItems;
    const allLabels = [
      labels.copy,
      labels.regenerate,
      labels.regenerateWith,
      labels.edit,
      labels.reportContent,
    ];

    const options = {withNavigation: true, withBottomSheetProvider: true};
    const assistant = {id: 'assistant'};

    beforeEach(() => {
      // Each menu test renders a single newest message; a leaked timer or
      // active-run status from the previous test would hide its "…" button
      // (isActiveRun) or leave the render half-flushed under fake timers.
      // Re-install the fake timers so a previous test's advanceTimersByTime
      // cannot leave the timer queue in a state where the next async render
      // resolves before its effects flush.
      jest.useRealTimers();
      jest.useFakeTimers();
      jest.clearAllTimers();
    });

    afterEach(() => {
      runInAction(() => {
        modelStore.activeModelId = undefined;
        // The menu tests render a single newest message, so a leaked active
        // run status would hide its "…" button (isActiveRun) and poison the
        // tests that follow. Reset it here, not only in the nested describe.
        chatSessionStore.agentUiState = {
          status: 'idle',
          pendingTalentNames: [],
          hitMaxTurns: false,
        };
      });
    });

    const isMenuItemText = (node: any) => {
      if (node.type !== 'Text' || !allLabels.includes(node.props.children)) {
        return false;
      }
      // v14: composites are not in the tree, so the Menu.Item ancestor check
      // becomes the menu-item host's testID (the item renders a host View
      // with testID="menu-item"). A message that happens to contain a label
      // word has no such ancestor.
      for (let n = node.parent; n; n = n.parent) {
        if (n.props?.testID === 'menu-item') {
          return true;
        }
      }
      return false;
    };

    const openMenuFor = async (message: MessageType.Any) => {
      const utils = await render(
        <ChatView messages={[message]} onSendPress={jest.fn()} user={user} />,
        options,
      );
      await openRowMenu(utils, message);
      const items = screen.container.queryAll(isMenuItemText);
      return {...utils, items, shown: items.map((n: any) => n.props.children)};
    };

    it.each([
      [
        'a copyable assistant row (Copy is in its footer)',
        {...textMessage, author: assistant, metadata: {copyable: true}},
        [labels.regenerate, labels.regenerateWith, labels.reportContent],
      ],

      [
        'an assistant row without copyable',
        {...textMessage, author: assistant},
        [
          labels.copy,
          labels.regenerate,
          labels.regenerateWith,
          labels.reportContent,
        ],
      ],

      [
        'a system row',
        {...textMessage, author: assistant, metadata: {system: true}},
        [
          labels.copy,
          labels.regenerate,
          labels.regenerateWith,
          labels.reportContent,
        ],
      ],

      [
        'a copyable user row (it has no footer Copy)',
        {...textMessage, metadata: {copyable: true}},
        [labels.copy, labels.edit, labels.reportContent],
      ],

      [
        'a copyable assistant turn',
        {
          author: assistant,
          createdAt: 0,
          id: 'turn',
          type: 'assistant_turn',
          steps: [{content: 'answer'}],
          metadata: {copyable: true},
        },
        [labels.regenerate, labels.regenerateWith, labels.reportContent],
      ],
    ])('lists the items for %s', async (_row, message, expected) => {
      const {shown} = await openMenuFor(message as MessageType.Any);

      expect(shown).toEqual(expected);
    });

    it('disables Edit on a user row while no model is active', async () => {
      const {getByText} = await openMenuFor(textMessage);

      let node = getByText(labels.edit);
      while (!node.props.accessibilityState) {
        node = node.parent!;
      }
      expect(node.props.accessibilityState.disabled).toBe(true);
    });

    it('opens the report sheet from Report and closes the menu', async () => {
      const utils = await openMenuFor({
        ...textMessage,
        author: assistant,
      });
      const {items} = utils;
      expect(reportSheet().isVisible).toBe(false);

      const report = items.find(
        (n: any) => n.props.children === labels.reportContent,
      );
      await fireEvent.press(report!);

      expect(reportSheet().isVisible).toBe(true);
      expect(messageMenu().visible).toBe(false);
    });

    // Latest captured props of the row menu (the Menu with a coordinate anchor).
    const messageMenu = () => {
      const menus = mockCapturedMenus.filter(
        (m: any) => m.onDismiss && m.anchor?.x !== undefined,
      );
      expect(menus.length).toBeGreaterThan(0);
      return menus[menus.length - 1];
    };
    // Latest captured props of the report sheet.
    const reportSheet = () => {
      expect(mockCapturedReportSheets.length).toBeGreaterThan(0);
      return mockCapturedReportSheets[mockCapturedReportSheets.length - 1];
    };

    const isItemDisabled = (items: any[], label: string) => {
      let node = items.find((n: any) => n.props.children === label);
      while (!node.props.accessibilityState) {
        node = node.parent!;
      }
      return node.props.accessibilityState.disabled === true;
    };

    it('enables every assistant item with a model loaded and no stop pending', async () => {
      runInAction(() => {
        modelStore.activeModelId = 'test-model-id';
      });
      const {items} = await openMenuFor({
        ...textMessage,
        author: assistant,
        metadata: {copyable: true},
      });

      for (const label of [
        labels.regenerate,
        labels.regenerateWith,
        labels.reportContent,
      ]) {
        expect(isItemDisabled(items, label)).toBe(false);
      }
    });

    it('enables Edit on a user row with a model loaded', async () => {
      runInAction(() => {
        modelStore.activeModelId = 'test-model-id';
      });
      const {items} = await openMenuFor(textMessage);

      expect(isItemDisabled(items, labels.edit)).toBe(false);
    });

    it('copies a user row from the menu and closes it', async () => {
      const Clipboard = require('@react-native-clipboard/clipboard');
      (Clipboard.setString as jest.Mock).mockClear();
      const utils = await openMenuFor({
        ...textMessage,
        text: 'my question',
        metadata: {copyable: true},
      });
      expect(messageMenu().visible).toBe(true);

      await fireEvent.press(
        utils.items.find((n: any) => n.props.children === labels.copy)!,
      );

      expect(Clipboard.setString).toHaveBeenCalledWith('my question');
      expect(messageMenu().visible).toBe(false);
    });

    it('anchors the menu at the press point and closes it on dismiss', async () => {
      await openMenuFor({...textMessage, author: assistant});
      const menu = messageMenu();
      expect(menu.visible).toBe(true);
      expect(menu.anchor).toEqual({x: 10, y: 20});

      await act(() => {
        menu.onDismiss();
      });

      expect(messageMenu().visible).toBe(false);
    });

    it('opens the menu at {10, 20} with Copy, Edit, Report on a long-press of a user row', async () => {
      const utils = await openMenuFor(textMessage);

      const menu = messageMenu();
      expect(menu.visible).toBe(true);
      expect(menu.anchor).toEqual({x: 10, y: 20});
      expect(utils.shown).toEqual([
        labels.copy,
        labels.edit,
        labels.reportContent,
      ]);
    });

    // RNTL v14 fireEvent.press deep-merges a default touch event with
    // pageX/pageY 0, so the no-point case must set them to undefined
    // explicitly to exercise the measure fallback.
    it.each([
      [
        'without a press point',
        {nativeEvent: {pageX: undefined, pageY: undefined}},
      ],
      ['with a released event', {nativeEvent: null}],
    ])(
      'opens the menu at the "…" centre on a press %s',
      async (_case, event) => {
        const utils = await render(
          <ChatView
            messages={[{...textMessage, author: assistant}]}
            onSendPress={jest.fn()}
            user={user}
          />,

          options,
        );
        // RNTL v14 TestInstance has no `.instance`. The ref target (the
        // object with `measure`) is the nearest ancestor fiber whose
        // stateNode has one — for a TouchableOpacity that is the
        // Animated.View class instance above the host View.
        const native = (() => {
          const found = screen.container.queryAll(
            (n: any) => n.props.testID === 'message-menu-button',
          )[0] as any;
          let fiber = found?.unstable_fiber;
          while (fiber) {
            const sn = fiber.stateNode;
            if (sn && typeof sn.measure === 'function') {
              return sn;
            }
            fiber = fiber.return;
          }
          return undefined;
        })();
        native.measure = (cb: (...args: number[]) => void) =>
          cb(0, 0, 44, 44, 300, 500);

        await fireEvent.press(utils.getByTestId('message-menu-button'), event);

        const menu = messageMenu();
        expect(menu.visible).toBe(true);
        expect(menu.anchor).toEqual({x: 322, y: 522});
      },
    );

    it('opens nothing on a long-press of an assistant row', async () => {
      const utils = await render(
        <ChatView
          messages={[{...textMessage, author: assistant}]}
          onSendPress={jest.fn()}
          user={user}
        />,

        options,
      );

      await holdOn(utils.getByTestId('markdown-content'), {
        nativeEvent: {pageX: 10, pageY: 20},
      });

      expect(messageMenu().visible).toBe(false);
    });

    describe('while a run streams', () => {
      afterEach(() => {
        runInAction(() => {
          chatSessionStore.agentUiState = {
            status: 'idle',
            pendingTalentNames: [],
            hitMaxTurns: false,
          };
        });
      });

      it('enables Edit on a user row with an active model', async () => {
        runInAction(() => {
          modelStore.activeModelId = 'test-model-id';
          chatSessionStore.agentUiState = {
            status: 'streaming_text',
            pendingTalentNames: [],
            hitMaxTurns: false,
          };
        });
        const question = {
          ...textMessage,
          id: 'question',
          text: 'my question',
          createdAt: 1,
        };
        const utils = await render(
          <ChatView
            messages={[
              {
                id: 'newest',
                type: 'assistant_turn',
                author: assistant,
                createdAt: 2,
                steps: [{content: 'reply', partial: true}],
                metadata: {},
              },
              question,
            ]}
            onSendPress={jest.fn()}
            user={user}
          />,

          options,
        );
        // v14: the `markdown` prop lives on the EnrichedMarkdownText
        // composite, which is not in the host tree, so find the question's
        // markdown-content by its rendered text instead.
        const questionMarkdown = utils.getAllByTestId('markdown-content').find(
          (n: any) =>
            n.queryAll((c: any) => {
              const kids = c.props?.children;
              if (typeof kids === 'string') {
                return kids.includes('my question');
              }
              if (Array.isArray(kids)) {
                return kids.some(
                  (k: any) =>
                    typeof k === 'string' && k.includes('my question'),
                );
              }
              return false;
            }).length > 0,
        );

        await holdOn(questionMarkdown!, {
          nativeEvent: {pageX: 10, pageY: 20},
        });

        expect(messageMenu().visible).toBe(true);
        const items = screen.container.queryAll(isMenuItemText);
        expect(isItemDisabled(items, labels.edit)).toBe(false);
      });
    });
  });

  describe('"…" on the active row', () => {
    const options = {withNavigation: true, withBottomSheetProvider: true};
    const assistant = {id: 'assistant'};
    const turn = (
      id: string,
      createdAt: number,
    ): MessageType.AssistantTurn => ({
      id,
      type: 'assistant_turn',
      author: assistant,
      createdAt,
      steps: [{content: `reply ${id}`}],
      metadata: {copyable: true},
    });
    const messages = [
      turn('newest', 3),
      {...textMessage, id: 'question', text: 'reply question', createdAt: 2},
      turn('older', 1),
    ];

    const setStatus = (status: any) =>
      runInAction(() => {
        chatSessionStore.agentUiState = {
          status,
          pendingTalentNames: [],
          hitMaxTurns: false,
        };
      });

    const footerOwner = (button: any) => {
      // v14: the `markdown` prop lives on the EnrichedMarkdownText
      // composite, which is not in the host tree, so identify the row by
      // its rendered text ('reply <id>') instead.
      for (let n = button.parent; n; n = n.parent) {
        const rendered = n.queryAll((c: any) => {
          const kids = c.props?.children;
          if (typeof kids === 'string') {
            return kids.includes('reply ');
          }
          if (Array.isArray(kids)) {
            return kids.some(
              (k: any) => typeof k === 'string' && k.includes('reply '),
            );
          }
          return false;
        });
        if (rendered.length > 0) {
          const kids = rendered[0].props.children;
          const text =
            typeof kids === 'string'
              ? kids
              : Array.isArray(kids)
                ? (kids.find((k: any) => typeof k === 'string') ?? '')
                : '';
          return String(text).replace('reply ', '');
        }
      }
      return undefined;
    };
    const rowsWithButton = (getAllByTestId: (id: string) => any[]) =>
      getAllByTestId('message-menu-button').map(footerOwner).sort();

    afterEach(() => setStatus('idle'));

    it.each([
      'prefill',
      'streaming_text',
      'generating_tool_call',
      'executing_tool',
    ])(
      'hides the "…" only on the newest row while the run is %s',
      async status => {
        setStatus(status);
        const {getAllByTestId} = await render(
          <ChatView messages={messages} onSendPress={jest.fn()} user={user} />,
          options,
        );

        expect(rowsWithButton(getAllByTestId)).toEqual(['older']);
      },
    );

    it.each(['done', 'idle'])(
      'shows the "…" on the newest row once the run is %s',
      async endStatus => {
        const chat = () => (
          <ChatView messages={messages} onSendPress={jest.fn()} user={user} />
        );

        setStatus('streaming_text');
        const {getAllByTestId, rerender} = await render(chat(), options);
        expect(rowsWithButton(getAllByTestId)).toEqual(['older']);

        // The mock store is not observable; the re-render stands in for the
        // observer reaction the real store triggers.
        setStatus(endStatus);
        await rerender(chat());

        expect(rowsWithButton(getAllByTestId)).toEqual(['newest', 'older']);
      },
    );
  });

  describe('increase-context CTA memory estimate', () => {
    afterEach(() => {
      jest.restoreAllMocks();
      runInAction(() => {
        (modelStore as any).activeContextSettings = undefined;
        modelStore.activeModelId = undefined;
        modelStore.models = [];
        modelStore.deviceTier = null;
      });
    });

    it('sizes larger context stops with the state checkpoint budget', async () => {
      const memSpy = jest.spyOn(memoryEstimator, 'getModelMemoryRequirement');
      runInAction(() => {
        modelStore.activeModelId = 'swa-model';
        modelStore.models = [
          {id: 'swa-model', name: 'swa', isDownloaded: true} as any,
        ];

        (modelStore as any).activeContextSettings = {n_ctx: 2048};
        modelStore.deviceTier = 'flagship';
      });

      await render(
        <ChatView messages={[]} onSendPress={jest.fn()} user={user} />,
        {
          withNavigation: true,
          withBottomSheetProvider: true,
        },
      );

      expect(memSpy).toHaveBeenCalledWith(
        expect.objectContaining({id: 'swa-model'}),
        undefined,
        expect.objectContaining({state_cache_budget_mb: 160}),
      );
      const nCtxs = memSpy.mock.calls.map(call => call[2]?.n_ctx);
      expect(nCtxs.some(n => (n ?? 0) > 2048)).toBe(true);
    });
  });
});
