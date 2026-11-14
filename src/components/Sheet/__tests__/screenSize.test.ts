import {Dimensions} from 'react-native';
import {useSafeAreaFrame} from 'react-native-safe-area-context';

import {act, renderHook} from '../../../../jest/test-utils';

import {useAppWindowFillsScreen, useScreenHeight} from '../screenSize';

const initialDimensions = {
  screen: Dimensions.get('screen'),
  window: Dimensions.get('window'),
};
const screen = initialDimensions.screen;
const jestSetupFrame = (useSafeAreaFrame as jest.Mock).getMockImplementation();

const setFrame = (width: number, height: number) => {
  (useSafeAreaFrame as jest.Mock).mockReturnValue({x: 0, y: 0, width, height});
};

describe('useAppWindowFillsScreen', () => {
  afterEach(async () => {
    await act(() => {
      Dimensions.set(initialDimensions);
    });
    (useSafeAreaFrame as jest.Mock).mockReset();
    (useSafeAreaFrame as jest.Mock).mockImplementation(jestSetupFrame);
    jest.restoreAllMocks();
  });

  it.each([
    ['equals the screen', screen.width, screen.height],
    ['is within 1 dp of the screen', screen.width - 0.4, screen.height - 0.4],
    ['is the screen transposed', screen.height, screen.width],
  ])('is true when the frame %s', async (_, width, height) => {
    setFrame(width, height);

    const {result} = await renderHook(() => useAppWindowFillsScreen());

    expect(result.current).toBe(true);
  });

  it.each([
    ['shorter', screen.width, screen.height - 100],
    ['narrower', screen.width - 100, screen.height],
  ])(
    'is false when the frame is %s than the screen',
    async (_, width, height) => {
      setFrame(width, height);

      const {result} = await renderHook(() => useAppWindowFillsScreen());

      expect(result.current).toBe(false);
    },
  );

  it('re-evaluates when the screen changes', async () => {
    setFrame(screen.width, screen.height);
    const {result} = await renderHook(() => useAppWindowFillsScreen());

    await act(() => {
      Dimensions.set({
        ...initialDimensions,
        screen: {...screen, height: screen.height + 100},
      });
    });

    expect(result.current).toBe(false);
  });
});

describe('screen subscription', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('shares one Dimensions listener across consumers', async () => {
    const addEventListener = jest.spyOn(Dimensions, 'addEventListener');

    const first = await renderHook(() => useScreenHeight());
    const second = await renderHook(() => useAppWindowFillsScreen());

    expect(addEventListener).toHaveBeenCalledTimes(1);
    await first.unmount();
    await second.unmount();
  });

  it('removes the listener once the last consumer unmounts', async () => {
    const remove = jest.fn();
    jest
      .spyOn(Dimensions, 'addEventListener')
      .mockReturnValue({remove} as never);

    const first = await renderHook(() => useScreenHeight());
    const second = await renderHook(() => useScreenHeight());
    await first.unmount();
    expect(remove).not.toHaveBeenCalled();

    await second.unmount();
    expect(remove).toHaveBeenCalledTimes(1);
  });
});
