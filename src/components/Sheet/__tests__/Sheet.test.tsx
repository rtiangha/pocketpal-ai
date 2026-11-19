import React from 'react';
import {BackHandler, Dimensions, Keyboard} from 'react-native';
import {useBottomSheetInternal} from '@gorhom/bottom-sheet';
import {
  useSafeAreaFrame,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';

import {act, render, screen} from '../../../../jest/test-utils';

import {Sheet} from '../Sheet';
import {SheetBackground} from '../SheetBackground';

const fullScreenFrame = {x: 0, y: 0, width: 390, height: 844};
const PERCENT_SNAP_POINTS = ['50%'];

const setFrameHeight = (height: number) => {
  (useSafeAreaFrame as jest.Mock).mockReturnValue({...fullScreenFrame, height});
};

// The project mock of @gorhom/bottom-sheet renders BottomSheetModal as a host
// View carrying all of its props, so the modal is found by its distinctive
// backgroundComponent prop (always passed by Sheet).
const getModal = () =>
  screen.container.queryAll(
    (n: any) => n.props.backgroundComponent !== undefined,
  )[0];

describe('Sheet', () => {
  beforeEach(() => {
    (useSafeAreaInsets as jest.Mock).mockReturnValue({
      top: 24,
      right: 0,
      bottom: 0,
      left: 0,
    });
  });

  afterEach(() => {
    (useSafeAreaInsets as jest.Mock).mockReturnValue({
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
    });
    (useSafeAreaFrame as jest.Mock).mockReturnValue(fullScreenFrame);
  });

  it('passes the top safe-area inset and resolved percentage snap points', async () => {
    await render(<Sheet snapPoints={['50%']} />);

    const modal = getModal();
    expect(modal.props.topInset).toBe(24);
    expect(modal.props.snapPoints).toEqual([fullScreenFrame.height / 2]);
  });

  it('renders the touch-taking SheetBackground', async () => {
    await render(<Sheet />);

    expect(getModal().props.backgroundComponent).toBe(SheetBackground);
  });

  it('resolves percentages against an app window shorter than the screen', async () => {
    setFrameHeight(400);
    await render(<Sheet snapPoints={['50%']} />);

    const modal = getModal();
    expect(modal.props.snapPoints).toEqual([200]);
    expect(modal.props.maxDynamicContentSize).toBe(360);
  });

  it('re-resolves percentages and the full-height cap when only the window resizes', async () => {
    const {rerender} = await render(<Sheet snapPoints={PERCENT_SNAP_POINTS} />);

    setFrameHeight(600);
    await rerender(<Sheet snapPoints={PERCENT_SNAP_POINTS} />);

    const modal = getModal();
    expect(modal.props.snapPoints).toEqual([300]);
    expect(modal.props.maxDynamicContentSize).toBe(560);
  });

  it('keeps the full-height snap point', async () => {
    await render(<Sheet displayFullHeight />);

    expect(getModal().props.snapPoints).toEqual([
      fullScreenFrame.height - 24 - 16,
    ]);
  });

  describe('when the screen rotates', () => {
    const portrait = {
      screen: Dimensions.get('screen'),
      window: Dimensions.get('window'),
    };
    const landscape = {
      ...portrait.screen,
      width: portrait.screen.height,
      height: portrait.screen.width,
    };

    afterEach(async () => {
      await act(() => {
        Dimensions.set(portrait);
      });
    });

    describe('with the keyboard up', () => {
      const focusSheetInput = (target?: number) => {
        (useBottomSheetInternal as jest.Mock).mockReturnValue({
          animatedKeyboardState: {get: () => ({target})},
        });
      };

      beforeEach(() => {
        jest.spyOn(Keyboard, 'dismiss');
      });

      afterEach(() => {
        (useBottomSheetInternal as jest.Mock).mockReturnValue(null);
        jest.restoreAllMocks();
      });

      it('dismisses the keyboard of a focused sheet input', async () => {
        focusSheetInput(42);
        await render(<Sheet snapPoints={['60%']} />);
        expect(Keyboard.dismiss).not.toHaveBeenCalled();

        await act(() => {
          Dimensions.set({screen: landscape, window: landscape});
        });

        expect(Keyboard.dismiss).toHaveBeenCalledTimes(1);
      });

      it('leaves the keyboard alone when no sheet input is focused', async () => {
        focusSheetInput(undefined);
        await render(<Sheet snapPoints={['60%']} />);

        await act(() => {
          Dimensions.set({screen: landscape, window: landscape});
        });

        expect(Keyboard.dismiss).not.toHaveBeenCalled();
      });

      it('leaves the keyboard alone when only the window changes', async () => {
        focusSheetInput(42);
        await render(<Sheet snapPoints={['60%']} />);

        await act(() => {
          Dimensions.set({
            screen: portrait.screen,
            window: {...portrait.window, height: portrait.window.height / 2},
          });
        });

        expect(Keyboard.dismiss).not.toHaveBeenCalled();
      });

      it('leaves the keyboard alone when only the app frame changes', async () => {
        focusSheetInput(42);
        const {rerender} = await render(
          <Sheet snapPoints={PERCENT_SNAP_POINTS} />,
        );

        setFrameHeight(400);
        await rerender(<Sheet snapPoints={PERCENT_SNAP_POINTS} />);

        expect(Keyboard.dismiss).not.toHaveBeenCalled();
      });
    });
  });

  it('enables dynamic sizing without snap points', async () => {
    await render(<Sheet />);

    const modal = getModal();
    expect(modal.props.snapPoints).toBeUndefined();
    expect(modal.props.enableDynamicSizing).toBe(true);
  });

  it('forwards change events to the caller and passes animate through unchanged', async () => {
    const onChange = jest.fn();
    const onAnimate = jest.fn();
    await render(<Sheet onChange={onChange} onAnimate={onAnimate} />);

    const modal = getModal();
    expect(modal.props.onAnimate).toBe(onAnimate);
    // onChange is wrapped so the Sheet can track presentation for the back
    // handler; the caller's handler must still receive all three args
    // (index, position, snap-point type).
    expect(modal.props.onChange).not.toBe(onChange);
    await act(() => {
      modal.props.onChange(0, 120, 'percent');
    });
    expect(onChange).toHaveBeenCalledWith(0, 120, 'percent');
  });

  describe('back button', () => {
    type Handler = Parameters<typeof BackHandler.addEventListener>[1];
    let backHandlers: Handler[] = [];

    // Mirror PlusHost.test.tsx: handlers run most-recent-first and the
    // first one to return true consumes the press.
    const pressBack = (): boolean => {
      for (const handler of [...backHandlers].reverse()) {
        if (handler({type: 'hardwareBackPress', timeStamp: 0})) {
          return true;
        }
      }
      return false;
    };

    // The Sheet forwards its modal methods to an inner ref in production,
    // which tests cannot reach. Passing a ref that already has a current
    // value makes the Sheet use it as its active ref, so the mock modal's
    // methods land on an object the test can observe.
    const modalRef = () => ({current: {}}) as any;
    const getModals = () =>
      screen.container.queryAll(
        (n: any) => n.props.backgroundComponent !== undefined,
      );

    beforeEach(() => {
      backHandlers = [];
      jest
        .spyOn(BackHandler, 'addEventListener')
        .mockImplementation((_event, handler) => {
          backHandlers.push(handler);
          return {
            remove: () => {
              backHandlers = backHandlers.filter(h => h !== handler);
            },
          };
        });
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('registers no back handler while the sheet is closed', async () => {
      await render(<Sheet />);

      expect(BackHandler.addEventListener).not.toHaveBeenCalled();
      expect(pressBack()).toBe(false);
    });

    it('dismisses the sheet and consumes the back press while presented', async () => {
      const ref = modalRef();
      await render(<Sheet ref={ref} />);

      await act(() => {
        getModal().props.onChange(0);
      });

      expect(BackHandler.addEventListener).toHaveBeenCalledTimes(1);
      expect(pressBack()).toBe(true);
      expect(ref.current.dismiss).toHaveBeenCalledTimes(1);
    });

    it('releases the back press once the sheet closes', async () => {
      const ref = modalRef();
      await render(<Sheet ref={ref} />);

      await act(() => {
        getModal().props.onChange(0);
      });
      expect(pressBack()).toBe(true);

      await act(() => {
        getModal().props.onChange(-1);
      });
      expect(pressBack()).toBe(false);
      expect(ref.current.dismiss).toHaveBeenCalledTimes(1);
    });

    it('dismisses only the top sheet when sheets are stacked', async () => {
      const bottomRef = modalRef();
      const topRef = modalRef();
      await render(
        <>
          <Sheet ref={bottomRef} />
          <Sheet ref={topRef} />
        </>,
      );

      const [bottomModal, topModal] = getModals();
      await act(() => {
        bottomModal.props.onChange(0);
        topModal.props.onChange(0);
      });

      // The top sheet registered last, so its handler runs first and
      // consumes the press; the bottom sheet stays put.
      expect(pressBack()).toBe(true);
      expect(topRef.current.dismiss).toHaveBeenCalledTimes(1);
      expect(bottomRef.current.dismiss).not.toHaveBeenCalled();

      // Once the top sheet closes, the next press reaches the bottom one.
      await act(() => {
        topModal.props.onChange(-1);
      });
      expect(pressBack()).toBe(true);
      expect(bottomRef.current.dismiss).toHaveBeenCalledTimes(1);
    });
  });
});
