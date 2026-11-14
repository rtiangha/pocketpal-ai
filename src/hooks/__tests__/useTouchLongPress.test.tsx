import * as React from 'react';
import {View} from 'react-native';

import {act, fireEvent, render} from '@testing-library/react-native';

import {useTouchLongPress} from '../useTouchLongPress';

type Handlers = {
  onLongPress: jest.Mock;
  canStart?: () => boolean;
  onPressIn?: jest.Mock;
  onPressOut?: jest.Mock;
};

const Target = (handlers: Handlers) => (
  <View testID="target" {...useTouchLongPress(handlers)} />
);

const touch = (pageX: number, pageY: number) => ({nativeEvent: {pageX, pageY}});

describe('useTouchLongPress', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  const setup = async () => {
    const onLongPress = jest.fn();
    const utils = await render(<Target onLongPress={onLongPress} />);
    return {onLongPress, target: utils.getByTestId('target'), ...utils};
  };

  const wait = async (ms: number) =>
    await act(() => {
      jest.advanceTimersByTime(ms);
    });

  it('gives the view no responder handlers', async () => {
    const {target} = await setup();

    expect(target.props.onStartShouldSetResponder).toBeUndefined();
    expect(target.props.onResponderGrant).toBeUndefined();
  });

  it('fires once after a 500 ms hold with the touch-start point', async () => {
    const {onLongPress, target} = await setup();
    const start: {nativeEvent: unknown} = touch(3, 4);

    await fireEvent(target, 'touchStart', start);
    start.nativeEvent = null;
    await wait(499);
    expect(onLongPress).not.toHaveBeenCalled();
    await wait(1);

    expect(onLongPress).toHaveBeenCalledTimes(1);
    expect(onLongPress).toHaveBeenCalledWith(touch(3, 4));
  });

  it('still fires when the finger drifts within 10 px', async () => {
    const {onLongPress, target} = await setup();

    await fireEvent(target, 'touchStart', touch(0, 0));
    await fireEvent(target, 'touchMove', touch(6, 8));
    await wait(500);

    expect(onLongPress).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['a drag past 10 px', 'touchMove', touch(11, 0)],
    ['a release', 'touchEnd', touch(0, 0)],
    ['a cancelled touch', 'touchCancel', touch(0, 0)],
  ])('does not fire after %s', async (_case, eventName, event) => {
    const {onLongPress, target} = await setup();

    await fireEvent(target, 'touchStart', touch(0, 0));
    await fireEvent(target, eventName, event);
    await wait(500);

    expect(onLongPress).not.toHaveBeenCalled();
  });

  it.each([
    ['a release', 'touchEnd', touch(0, 0)],
    ['a drag past 10 px', 'touchMove', touch(0, 11)],
    ['a cancelled touch', 'touchCancel', touch(0, 0)],
  ])(
    'presses in on touch start and out once on %s',
    async (_case, eventName, event) => {
      const onPressIn = jest.fn();
      const onPressOut = jest.fn();
      const {getByTestId} = await render(
        <Target
          onLongPress={jest.fn()}
          onPressIn={onPressIn}
          onPressOut={onPressOut}
        />,
      );
      const target = getByTestId('target');

      await fireEvent(target, 'touchStart', touch(0, 0));
      expect(onPressIn).toHaveBeenCalledTimes(1);
      expect(onPressOut).not.toHaveBeenCalled();
      await fireEvent(target, eventName, event);
      await fireEvent(target, 'touchEnd', touch(0, 0));

      expect(onPressOut).toHaveBeenCalledTimes(1);
    },
  );

  it('stays pressed through a long-press until release', async () => {
    const onLongPress = jest.fn();
    const onPressOut = jest.fn();
    const {getByTestId} = await render(
      <Target onLongPress={onLongPress} onPressOut={onPressOut} />,
    );
    const target = getByTestId('target');

    await fireEvent(target, 'touchStart', touch(0, 0));
    await wait(500);
    expect(onLongPress).toHaveBeenCalledTimes(1);
    expect(onPressOut).not.toHaveBeenCalled();
    await fireEvent(target, 'touchEnd', touch(0, 0));

    expect(onPressOut).toHaveBeenCalledTimes(1);
  });

  it('starts nothing when canStart says no', async () => {
    const onLongPress = jest.fn();
    const onPressIn = jest.fn();
    const {getByTestId} = await render(
      <Target
        onLongPress={onLongPress}
        onPressIn={onPressIn}
        canStart={() => false}
      />,
    );

    await fireEvent(getByTestId('target'), 'touchStart', touch(0, 0));
    await wait(500);

    expect(onPressIn).not.toHaveBeenCalled();
    expect(onLongPress).not.toHaveBeenCalled();
  });

  it('does not fire after unmount', async () => {
    const {onLongPress, target, unmount} = await setup();

    await fireEvent(target, 'touchStart', touch(0, 0));
    await unmount();
    await wait(500);

    expect(onLongPress).not.toHaveBeenCalled();
  });
});
