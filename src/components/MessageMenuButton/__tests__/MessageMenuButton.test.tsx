import React from 'react';
import {StyleSheet} from 'react-native';

import {fireEvent, render, screen} from '../../../../jest/test-utils';
import {l10n} from '../../../locales';

import {MessageMenuButton} from '../MessageMenuButton';

const MIN_TARGET = 44;
const FOOTPRINT_WIDTH = 25;
const FOOTPRINT_HEIGHT = 16;

describe('MessageMenuButton', () => {
  it('is an accessible button with a localized label', async () => {
    const {getByTestId} = await render(<MessageMenuButton />);
    const button = getByTestId('message-menu-button');

    expect(button.props.accessibilityRole).toBe('button');
    expect(button.props.accessibilityLabel).toBe(
      l10n.en.components.messageMenuButton.accessibilityLabel,
    );
  });

  it('is a 44 dp layout box that keeps the 25 x 16 dp footprint', async () => {
    const {getByTestId} = await render(<MessageMenuButton />);
    const button = getByTestId('message-menu-button');
    const style = StyleSheet.flatten(button.props.style) ?? {};

    expect(style.minWidth).toBe(MIN_TARGET);
    expect(style.minHeight).toBe(MIN_TARGET);
    expect(style.flexShrink).toBe(0);
    expect(
      MIN_TARGET + Number(style.marginLeft) + Number(style.marginRight),
    ).toBe(FOOTPRINT_WIDTH);
    expect(
      MIN_TARGET + Number(style.marginTop) + Number(style.marginBottom),
    ).toBe(FOOTPRINT_HEIGHT);
    expect(style).toMatchObject({
      marginLeft: -5,
      marginTop: -14,
      marginRight: -14,
      marginBottom: -14,
    });
    expect(button.props.hitSlop).toBeUndefined();
  });

  it('calls onPress at the press point', async () => {
    const onPress = jest.fn();
    const {getByTestId} = await render(<MessageMenuButton onPress={onPress} />);

    await fireEvent.press(getByTestId('message-menu-button'), {
      nativeEvent: {pageX: 1, pageY: 2},
    });

    expect(onPress).toHaveBeenCalledWith({nativeEvent: {pageX: 1, pageY: 2}});
  });

  // RNTL v14 fireEvent.press deep-merges a default touch event with
  // pageX/pageY 0, so the no-point cases must set them to undefined
  // explicitly to exercise the measure fallback.
  it.each([
    [
      'an empty click event',
      {nativeEvent: {pageX: undefined, pageY: undefined}},
    ],
    ['no event', {nativeEvent: {pageX: undefined, pageY: undefined}}],
  ])(
    'calls onPress at the button centre for %s (TalkBack, Switch Access, keyboard)',
    async (_case, event) => {
      const onPress = jest.fn();
      const {getByTestId} = await render(
        <MessageMenuButton onPress={onPress} />,
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

      await fireEvent.press(getByTestId('message-menu-button'), event);

      expect(onPress).toHaveBeenCalledWith({
        nativeEvent: {pageX: 322, pageY: 522},
      });
    },
  );
});
