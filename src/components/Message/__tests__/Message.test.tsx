import {render, screen} from '@testing-library/react-native';
import * as React from 'react';
import {Animated, Keyboard, Platform} from 'react-native';
import {EnrichedMarkdownText} from 'react-native-enriched-markdown';
import ReactNativeHapticFeedback from 'react-native-haptic-feedback';

import {
  derivedImageMessage,
  derivedTextMessage,
} from '../../../../jest/fixtures';
import {
  act,
  fireEvent,
  render as renderWithProviders,
} from '../../../../jest/test-utils';
import {l10n} from '../../../locales';
import * as plainText from '../../MarkdownView/markdownToPlainText';
import {Message} from '../Message';

const rowProps = {
  messageWidth: 440,
  roundBorder: true,
  showAvatar: true,
  showName: false,
  showStatus: true,
};

const TOUCH_HANDLERS = ['onPress', 'onLongPress', 'onPressIn', 'onPressOut'];

const touchHandlersAbove = (node: any) => {
  const found: string[] = [];
  for (let n = node.parent; n; n = n.parent) {
    found.push(
      ...TOUCH_HANDLERS.filter(h => typeof n.props?.[h] === 'function'),
    );
  }
  // v14: Pressable/TouchableOpacity render as host Views with responder
  // props, so onPress lives on the composite's fiber memoizedProps, not on
  // a host ancestor. Walk the fiber chain too. (useTouchLongPress only
  // returns onTouch* props, so the user-row [] assertions are unaffected.)
  let fiber = node?.unstable_fiber;
  while (fiber) {
    found.push(
      ...TOUCH_HANDLERS.filter(
        h => typeof fiber.memoizedProps?.[h] === 'function',
      ),
    );
    fiber = fiber.return;
  }
  return found;
};

const RESPONDER_HANDLERS = [
  'onStartShouldSetResponder',
  'onMoveShouldSetResponder',
  'onResponderGrant',
];

const responderHandlersAbove = (node: any) => {
  const found: string[] = [];
  for (let n = node.parent; n; n = n.parent) {
    found.push(
      ...RESPONDER_HANDLERS.filter(h => typeof n.props?.[h] === 'function'),
    );
  }
  return found;
};

const markdownSpy = EnrichedMarkdownText as unknown as jest.Mock;
const lastMarkdownProps = () =>
  markdownSpy.mock.calls[markdownSpy.mock.calls.length - 1][0];

const longPressHandlers = (root: any) =>
  root.queryAll(
    (n: any) => n.props && typeof n.props.onLongPress === 'function',
  );

describe('message', () => {
  it('renders undefined in ContentContainer', async () => {
    expect.assertions(2);
    const {getByTestId} = await render(
      <Message
        message={{...derivedTextMessage, type: 'custom'}}
        messageWidth={440}
        onMessagePress={jest.fn}
        roundBorder
        showAvatar
        showName
        showStatus
      />,
    );
    const ContentContainer = getByTestId('ContentContainer');
    expect(ContentContainer).toBeDefined();
    expect(ContentContainer.props.children).toBeNull();
  });

  it('renders undefined in ContentContainer with wrong message type', async () => {
    expect.assertions(2);
    const {getByTestId} = await render(
      <Message
        message={{...derivedTextMessage, type: 'unsupported'}}
        messageWidth={440}
        onMessagePress={jest.fn}
        roundBorder
        showAvatar
        showName
        showStatus
      />,
    );
    const ContentContainer = getByTestId('ContentContainer');
    expect(ContentContainer).toBeDefined();
    expect(ContentContainer.props.children).toBeNull();
  });

  describe('menu and touch handling', () => {
    it('opens the menu from a touch hold on a user text row, with a haptic, without claiming the JS responder', async () => {
      jest.useFakeTimers();
      const onMessageMenuPress = jest.fn();
      const {getByTestId, queryByTestId} = await renderWithProviders(
        <Message
          {...rowProps}
          message={derivedTextMessage}
          onMessageMenuPress={onMessageMenuPress}
        />,
      );

      const markdown = getByTestId('markdown-content');
      expect(responderHandlersAbove(markdown)).toEqual([]);
      expect(touchHandlersAbove(markdown)).toEqual([]);
      expect(longPressHandlers(screen.root)).toHaveLength(0);

      const rows = screen.container.queryAll(
        (n: any) =>
          typeof n.type === 'string' &&
          typeof n.props.onTouchCancel === 'function',
      );
      expect(rows).toHaveLength(1);
      const [row] = rows;
      expect(row.queryAll((n: any) => n === markdown)).toHaveLength(1);
      await fireEvent(row, 'touchStart', {nativeEvent: {pageX: 1, pageY: 2}});
      await act(() => {
        jest.advanceTimersByTime(500);
      });

      expect(onMessageMenuPress).toHaveBeenCalledWith(
        expect.objectContaining({id: derivedTextMessage.id, type: 'text'}),
        {nativeEvent: {pageX: 1, pageY: 2}},
      );
      expect(ReactNativeHapticFeedback.trigger).toHaveBeenCalledWith(
        'impactLight',
        expect.any(Object),
      );
      expect(queryByTestId('message-menu-button')).toBeNull();
      expect(queryByTestId('assistant-turn-footer')).toBeNull();
      jest.useRealTimers();
    });

    it('keeps a user text row from re-rendering its markdown for a new row object', async () => {
      const props = {...rowProps, onMessageMenuPress: jest.fn()};
      const {rerender} = await renderWithProviders(
        <Message {...props} message={{...derivedTextMessage}} />,
      );
      const renders = markdownSpy.mock.calls.length;

      await rerender(<Message {...props} message={{...derivedTextMessage}} />);

      expect(markdownSpy.mock.calls.length).toBe(renders);
    });

    describe('link long-press', () => {
      const originalOS = Platform.OS;
      afterEach(() => {
        (Platform as any).OS = originalOS;
      });

      const renderLinkRow = async (authorId: string, os: string) => {
        (Platform as any).OS = os;
        await renderWithProviders(
          <Message
            {...rowProps}
            message={{
              ...derivedTextMessage,
              author: {id: authorId},
              text: '[a](https://x.y)',
            }}
            onMessageMenuPress={jest.fn()}
          />,
        );
        return lastMarkdownProps();
      };

      it.each([
        ['a user row on Android', derivedTextMessage.author.id, 'android'],
        ['a user row on iOS', derivedTextMessage.author.id, 'ios'],
        ['an assistant row on Android', 'assistant', 'android'],
      ])('leaves it to the renderer on %s', async (_case, authorId, os) => {
        expect(
          (await renderLinkRow(authorId, os)).onLinkLongPress,
        ).toBeUndefined();
      });
    });

    const userRowOf = (root: any) =>
      root.queryAll(
        (n: any) =>
          typeof n.type === 'string' &&
          typeof n.props.onTouchCancel === 'function',
      )[0];

    it('makes the user bubble one accessible element whose long-press action opens the menu at its centre', async () => {
      const onMessageMenuPress = jest.fn();
      await renderWithProviders(
        <Message
          {...rowProps}
          message={{...derivedTextMessage, text: 'my question'}}
          onMessageMenuPress={onMessageMenuPress}
        />,
      );
      const row = userRowOf(screen.root);
      // v14: TestInstance has no public `.instance`. The ref target is the
      // nearest ancestor fiber whose stateNode has a `measure` function
      // (the Animated.View class instance above the host View).
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
      expect(native).toBeDefined();
      native!.measure = (cb: (...args: number[]) => void) =>
        cb(0, 0, 100, 40, 10, 20);

      expect(row.props.accessible).toBe(true);
      expect(row.props.accessibilityLabel).toBe('my question');
      expect(row.props.accessibilityActions).toEqual([
        {
          name: 'longpress',
          label: l10n.en.components.messageMenuButton.openMenuAction,
        },
      ]);

      await fireEvent(row, 'accessibilityAction', {
        nativeEvent: {actionName: 'longpress'},
      });

      expect(onMessageMenuPress).toHaveBeenCalledWith(
        expect.objectContaining({id: derivedTextMessage.id, type: 'text'}),
        {nativeEvent: {pageX: 60, pageY: 40}},
      );
    });

    it('labels the user bubble with the rendered text, not the markdown source', async () => {
      await renderWithProviders(
        <Message
          {...rowProps}
          message={{
            ...derivedTextMessage,
            text: '- first item\n- **second** item\n\nSee [the probe](http://x.y/probe).\n\n```py\nprint(1)\n```',
          }}
        />,
      );

      expect(userRowOf(screen.root).props.accessibilityLabel).toBe(
        'first item second item See the probe. print(1)',
      );
    });

    it('derives the label once per text, not per row object', async () => {
      const toPlain = jest.spyOn(plainText, 'markdownToPlainText');
      const {rerender} = await renderWithProviders(
        <Message {...rowProps} message={{...derivedTextMessage}} />,
      );
      await rerender(
        <Message {...rowProps} message={{...derivedTextMessage}} />,
      );
      expect(toPlain).toHaveBeenCalledTimes(1);

      await rerender(
        <Message
          {...rowProps}
          message={{...derivedTextMessage, text: 'another'}}
        />,
      );
      expect(toPlain).toHaveBeenCalledTimes(2);
      toPlain.mockRestore();
    });

    it.each([
      ['up at touch time', false, true],
      ['down at touch time', true, false],
    ])(
      'checks the keyboard when the touch starts (%s)',
      async (_case, visibleAtRender, visibleAtTouch) => {
        jest.useFakeTimers();
        const keyboard = jest
          .spyOn(Keyboard, 'isVisible')
          .mockReturnValue(visibleAtRender);
        const onMessageMenuPress = jest.fn();
        await renderWithProviders(
          <Message
            {...rowProps}
            message={derivedTextMessage}
            onMessageMenuPress={onMessageMenuPress}
          />,
        );
        const spring = jest.spyOn(Animated, 'spring');
        keyboard.mockReturnValue(visibleAtTouch);

        await fireEvent(userRowOf(screen.root), 'touchStart', {
          nativeEvent: {pageX: 1, pageY: 2},
        });
        await act(() => {
          jest.advanceTimersByTime(500);
        });

        expect(onMessageMenuPress).toHaveBeenCalledTimes(
          visibleAtTouch ? 0 : 1,
        );
        expect(spring).toHaveBeenCalledTimes(visibleAtTouch ? 0 : 1);
        keyboard.mockRestore();
        spring.mockRestore();
        jest.useRealTimers();
      },
    );

    it('springs the user bubble to 1.01 on touch start and back on release', async () => {
      const spring = jest.spyOn(Animated, 'spring');
      await renderWithProviders(
        <Message {...rowProps} message={derivedTextMessage} />,
      );
      const row = userRowOf(screen.root);

      await fireEvent(row, 'touchStart', {nativeEvent: {pageX: 1, pageY: 2}});
      expect(spring).toHaveBeenLastCalledWith(
        expect.anything(),
        expect.objectContaining({toValue: 1.01}),
      );
      await fireEvent(row, 'touchEnd', {nativeEvent: {pageX: 1, pageY: 2}});
      expect(spring).toHaveBeenLastCalledWith(
        expect.anything(),
        expect.objectContaining({toValue: 1}),
      );
      spring.mockRestore();
    });

    it('opens no menu from a long-press on an image thumbnail in a user text row', async () => {
      jest.useFakeTimers();
      const onMessageMenuPress = jest.fn();
      await renderWithProviders(
        <Message
          {...rowProps}
          message={{...derivedTextMessage, imageUris: ['file:///a.png']}}
          onMessageMenuPress={onMessageMenuPress}
        />,
      );
      const stopPropagation = jest.fn();

      await fireEvent(
        screen.container.queryAll(i => i.type === 'Image')[0],
        'touchStart',
        {
          nativeEvent: {pageX: 1, pageY: 2},
          stopPropagation,
        },
      );
      await act(() => {
        jest.advanceTimersByTime(500);
      });

      expect(stopPropagation).toHaveBeenCalled();
      expect(onMessageMenuPress).not.toHaveBeenCalled();
      jest.useRealTimers();
    });

    it('gives an assistant text row the assistant footer', async () => {
      const {getByTestId} = await renderWithProviders(
        <Message
          {...rowProps}
          message={{...derivedTextMessage, author: {id: 'assistant'}}}
        />,
      );

      expect(getByTestId('assistant-turn-footer')).toBeTruthy();
    });

    it('wraps an assistant text row in no touch handler', async () => {
      const {getByTestId} = await renderWithProviders(
        <Message
          {...rowProps}
          message={{...derivedTextMessage, author: {id: 'assistant'}}}
          onMessagePress={jest.fn()}
          onMessageMenuPress={jest.fn()}
        />,
      );

      expect(touchHandlersAbove(getByTestId('markdown-content'))).toEqual([]);
      expect(longPressHandlers(screen.root)).toHaveLength(0);
    });

    it('keeps the press on an image row, without a long-press or "…"', async () => {
      const onMessagePress = jest.fn();
      const {getByTestId, queryByTestId} = await renderWithProviders(
        <Message
          {...rowProps}
          message={derivedImageMessage}
          onMessagePress={onMessagePress}
        />,
      );

      expect(touchHandlersAbove(getByTestId('ContentContainer'))).toContain(
        'onPress',
      );
      await fireEvent.press(getByTestId('ContentContainer'));
      expect(onMessagePress).toHaveBeenCalledWith(
        expect.objectContaining({id: derivedImageMessage.id, type: 'image'}),
        // v14: fireEvent.press supplies a default synthetic event (with
        // the default 0,0 press point); v13 passed no event (undefined).
        expect.objectContaining({
          nativeEvent: expect.objectContaining({pageX: 0, pageY: 0}),
        }),
      );
      expect(longPressHandlers(screen.root)).toHaveLength(0);
      expect(queryByTestId('message-menu-button')).toBeNull();
    });
  });
});
