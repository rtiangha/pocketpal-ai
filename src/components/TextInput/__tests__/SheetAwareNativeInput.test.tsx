import React from 'react';
import {
  Dimensions,
  Keyboard,
  TextInput as NativeTextInput,
  type TextInputInstance,
} from 'react-native';
import {useBottomSheetInternal} from '@gorhom/bottom-sheet';
import {useSafeAreaFrame} from 'react-native-safe-area-context';

import {fireEvent, render, screen} from '../../../../jest/test-utils';
import {
  mockSheetContext,
  type MockSheetContext,
} from '../../../../jest/sheetContext';

import {
  renderSheetAwareInput,
  SheetAwareNativeInput,
} from '../SheetAwareNativeInput';
import {TextInput} from '../TextInput';

const mockUseBottomSheetInternal = useBottomSheetInternal as jest.Mock;
const mockUseSafeAreaFrame = useSafeAreaFrame as jest.Mock;
const jestSetupFrame = mockUseSafeAreaFrame.getMockImplementation();

const OWN_TAG = 42;
const OTHER_TAG = 7;
const otherField = {};
const deviceScreen = Dimensions.get('screen');

const setFrame = (width: number, height: number) => {
  mockUseSafeAreaFrame.mockReturnValue({x: 0, y: 0, width, height});
};
const fullScreen = () => setFrame(deviceScreen.width, deviceScreen.height);
const windowed = () => setFrame(deviceScreen.width, deviceScreen.height - 100);

let sheet: MockSheetContext;

const enterSheet = (state = {}) => {
  sheet = mockSheetContext(state);
  mockUseBottomSheetInternal.mockImplementation(() => sheet);
};

const mockNodeHandles = (mountTag: number | null = OWN_TAG) =>
  jest
    .spyOn(require('react-native'), 'findNodeHandle')
    .mockImplementation(instance => {
      if (instance === otherField) {
        return OTHER_TAG;
      }
      return instance ? mountTag : null;
    });

const focusMovesTo = (field: object | null) =>
  jest
    .spyOn(NativeTextInput.State, 'currentlyFocusedInput')
    .mockReturnValue(field as never);

const focusEvent = (target = OWN_TAG) => ({nativeEvent: {target}});

describe('TextInput sheet registration', () => {
  afterEach(() => {
    mockUseBottomSheetInternal.mockImplementation(() => null);
  });

  it('renders RN TextInput, not BottomSheetTextInput, inside a sheet context', async () => {
    enterSheet();

    const {getByTestId} = await render(<TextInput testID="x" />);

    expect(
      screen.container.queryAll(i => i.type === 'TextInput')[0].props.testID,
    ).toBe('x');
    expect(getByTestId('x').type).toBe('TextInput');
  });

  it('renders a plain native input outside a sheet context', async () => {
    const {getByTestId} = await render(<TextInput testID="x" />);

    expect(getByTestId('x').type).toBe('TextInput');
  });

  it.each([
    ['inside', () => enterSheet()],
    [
      'outside',
      () => mockUseBottomSheetInternal.mockImplementation(() => null),
    ],
  ])('forwards the ref to the native field %s a sheet', async (_, context) => {
    context();
    const ref = jest.fn();

    await render(<>{renderSheetAwareInput({ref, style: {}, testID: 'x'})}</>);

    expect(ref).toHaveBeenCalledWith(
      expect.objectContaining({focus: expect.any(Function)}),
    );
  });

  it('lets a caller-supplied render win', async () => {
    enterSheet();

    const {getByTestId} = await render(
      <TextInput
        testID="x"
        render={props => (
          <NativeTextInput
            {...(props as React.ComponentProps<typeof NativeTextInput>)}
            testID="custom"
          />
        )}
      />,
    );

    expect(getByTestId('custom')).toBeTruthy();
  });
});

describe('SheetAwareNativeInput keyboard registration', () => {
  let onFocus: jest.Mock;
  let onBlur: jest.Mock;
  let ref: jest.Mock;

  const renderInput = async () => {
    const utils = await render(
      <SheetAwareNativeInput
        ref={ref}
        testID="x"
        onFocus={onFocus}
        onBlur={onBlur}
      />,
    );
    return {
      ...utils,
      rerenderInput: async () =>
        await utils.rerender(
          <SheetAwareNativeInput
            ref={ref}
            testID="x"
            onFocus={onFocus}
            onBlur={onBlur}
          />,
        ),
    };
  };

  const focus = async (
    getByTestId: (id: string) => unknown,
    target = OWN_TAG,
  ) => {
    await fireEvent(getByTestId('x') as never, 'focus', focusEvent(target));
  };

  const blur = async (
    getByTestId: (id: string) => unknown,
    target = OWN_TAG,
  ) => {
    await fireEvent(getByTestId('x') as never, 'blur', focusEvent(target));
  };

  beforeEach(() => {
    onFocus = jest.fn();
    onBlur = jest.fn();
    ref = jest.fn();
    enterSheet();
    mockNodeHandles();
    focusMovesTo(null);
    jest.spyOn(Keyboard, 'dismiss');
  });

  afterEach(() => {
    mockUseBottomSheetInternal.mockImplementation(() => null);
    mockUseSafeAreaFrame.mockReset();
    mockUseSafeAreaFrame.mockImplementation(jestSetupFrame);
    jest.restoreAllMocks();
  });

  describe('lifecycle', () => {
    it('registers its tag at mount and removes it at unmount', async () => {
      const {unmount} = await renderInput();

      expect([...sheet.textInputNodesRef.current]).toEqual([OWN_TAG]);

      await unmount();

      expect(sheet.textInputNodesRef.current.size).toBe(0);
    });

    it.each([
      ['clears its own target', OWN_TAG, undefined],
      ["leaves another input's target", OTHER_TAG, OTHER_TAG],
    ])('%s at unmount', async (_, heldTarget, expectedTarget) => {
      const {unmount} = await renderInput();
      sheet.keyboardState = {target: heldTarget};

      await unmount();

      expect(sheet.keyboardState.target).toBe(expectedTarget);
    });

    it('registers nothing and writes nothing when the field has no tag', async () => {
      mockNodeHandles(null);
      const {unmount} = await renderInput();

      expect(sheet.textInputNodesRef.current.size).toBe(0);

      await unmount();

      expect(sheet.animatedKeyboardState.set).not.toHaveBeenCalled();
    });
  });

  describe('ref', () => {
    it('passes the native field to a callback ref, then null at unmount', async () => {
      const {unmount} = await renderInput();

      expect(ref).toHaveBeenLastCalledWith(
        expect.objectContaining({focus: expect.any(Function)}),
      );

      await unmount();

      expect(ref).toHaveBeenLastCalledWith(null);
    });

    it('fills an object ref, then clears it at unmount', async () => {
      const objectRef = React.createRef<TextInputInstance>();
      const {unmount} = await render(<SheetAwareNativeInput ref={objectRef} />);

      expect(objectRef.current).toEqual(
        expect.objectContaining({focus: expect.any(Function)}),
      );

      await unmount();

      expect(objectRef.current).toBeNull();
    });
  });

  describe('when the app window fills the screen', () => {
    it.each([
      ['equals', 0],
      ['is within 1 dp of', 0.4],
    ])(
      'sets its own target, then calls onFocus, when the frame %s the screen',
      async (_, shortBy) => {
        setFrame(deviceScreen.width - shortBy, deviceScreen.height - shortBy);
        const {getByTestId} = await renderInput();

        await focus(getByTestId);

        expect(sheet.keyboardState.target).toBe(OWN_TAG);
        expect(sheet.animatedKeyboardState.set).toHaveBeenCalledTimes(1);
        expect(onFocus).toHaveBeenCalledTimes(1);
        expect(onFocus).toHaveBeenCalledWith(focusEvent());
        expect(
          sheet.animatedKeyboardState.set.mock.invocationCallOrder[0],
        ).toBeLessThan(onFocus.mock.invocationCallOrder[0]);
      },
    );

    it('passes blur to the caller once', async () => {
      fullScreen();
      const {getByTestId} = await renderInput();
      await focus(getByTestId);

      await blur(getByTestId);

      expect(onBlur).toHaveBeenCalledTimes(1);
      expect(onBlur).toHaveBeenCalledWith(focusEvent());
    });

    it('keeps its target when focus moves to another sheet input', async () => {
      fullScreen();
      const {getByTestId} = await renderInput();
      await focus(getByTestId);
      sheet.textInputNodesRef.current.add(OTHER_TAG);
      focusMovesTo(otherField);

      await blur(getByTestId);

      expect(sheet.keyboardState.target).toBe(OWN_TAG);
    });

    it.each([
      ['nothing', null],
      ['an input outside the sheet', otherField],
    ])('clears its target when focus moves to %s', async (_, next) => {
      fullScreen();
      const {getByTestId} = await renderInput();
      await focus(getByTestId);
      focusMovesTo(next);

      await blur(getByTestId);

      expect(sheet.keyboardState.target).toBeUndefined();
    });
  });

  describe('when the app window is smaller than the screen', () => {
    it.each([
      ['shorter', deviceScreen.width, deviceScreen.height - 100],
      ['only narrower', deviceScreen.width - 100, deviceScreen.height],
    ])(
      'never writes a target when the window is %s',
      async (_, width, height) => {
        setFrame(width, height);
        const {getByTestId} = await renderInput();

        await focus(getByTestId);

        expect(sheet.keyboardState.target).toBeUndefined();
        expect(sheet.animatedKeyboardState.set).not.toHaveBeenCalled();
        expect(onFocus).toHaveBeenCalledTimes(1);
        expect(onFocus).toHaveBeenCalledWith(focusEvent());
      },
    );

    it('leaves a target held by another input alone on focus', async () => {
      enterSheet({target: OTHER_TAG});
      windowed();
      const {getByTestId} = await renderInput();

      await focus(getByTestId);

      expect(sheet.keyboardState.target).toBe(OTHER_TAG);
      expect(sheet.animatedKeyboardState.set).not.toHaveBeenCalled();
    });

    it('clears its own target on blur even when focus stays in the sheet', async () => {
      enterSheet({target: OWN_TAG});
      windowed();
      const {getByTestId} = await renderInput();
      sheet.textInputNodesRef.current.add(OTHER_TAG);
      focusMovesTo(otherField);

      await blur(getByTestId);

      expect(sheet.keyboardState.target).toBeUndefined();
    });
  });

  it.each([
    ['full screen', fullScreen],
    ['windowed', windowed],
  ])("never clears another input's target on blur, %s", async (_, frame) => {
    enterSheet({target: OTHER_TAG});
    frame();
    const {getByTestId} = await renderInput();

    await blur(getByTestId);

    expect(sheet.keyboardState.target).toBe(OTHER_TAG);
    expect(sheet.animatedKeyboardState.set).not.toHaveBeenCalled();
  });

  describe('when the window changes while focused', () => {
    it('ignores a rotation that transposes the frame before the screen', async () => {
      fullScreen();
      const {getByTestId, rerenderInput} = await renderInput();
      await focus(getByTestId);

      setFrame(deviceScreen.height, deviceScreen.width);
      await rerenderInput();

      expect(Keyboard.dismiss).not.toHaveBeenCalled();
      expect(ref).toHaveBeenCalledTimes(1);
    });

    it('dismisses the keyboard when the window narrows into a split', async () => {
      fullScreen();
      const {getByTestId, rerenderInput} = await renderInput();
      await focus(getByTestId);
      sheet.animatedKeyboardState.set.mockClear();

      setFrame(deviceScreen.width - 100, deviceScreen.height);
      await rerenderInput();

      expect(Keyboard.dismiss).toHaveBeenCalledTimes(1);
      expect(ref).toHaveBeenCalledTimes(1);
      expect(sheet.animatedKeyboardState.set).not.toHaveBeenCalled();
    });

    it('dismisses the keyboard when a narrow window goes full screen', async () => {
      setFrame(deviceScreen.width - 100, deviceScreen.height);
      const {getByTestId, rerenderInput} = await renderInput();
      await focus(getByTestId);

      fullScreen();
      await rerenderInput();

      expect(Keyboard.dismiss).toHaveBeenCalledTimes(1);
    });

    it('never dismisses when the keyboard alone shrinks the frame', async () => {
      fullScreen();
      const {getByTestId, rerenderInput} = await renderInput();
      await focus(getByTestId);

      setFrame(deviceScreen.width, deviceScreen.height - 300);
      await rerenderInput();
      fullScreen();
      await rerenderInput();

      expect(Keyboard.dismiss).not.toHaveBeenCalled();
    });

    it('keeps a height-only window change focused and gates the next focus', async () => {
      fullScreen();
      const {getByTestId, rerenderInput} = await renderInput();
      await focus(getByTestId);

      setFrame(deviceScreen.width, deviceScreen.height - 100);
      await rerenderInput();
      setFrame(deviceScreen.width - 100, deviceScreen.height - 100);
      await rerenderInput();

      expect(Keyboard.dismiss).not.toHaveBeenCalled();

      await blur(getByTestId);
      await focus(getByTestId);

      expect(sheet.keyboardState.target).toBeUndefined();
    });
  });

  describe('when the window changes while not focused', () => {
    it('does not dismiss once the field has blurred', async () => {
      fullScreen();
      const {getByTestId, rerenderInput} = await renderInput();
      await focus(getByTestId);
      await blur(getByTestId);

      setFrame(deviceScreen.width - 100, deviceScreen.height);
      await rerenderInput();

      expect(Keyboard.dismiss).not.toHaveBeenCalled();
    });

    it.each([
      [
        'full screen to windowed',
        fullScreen,
        () => setFrame(deviceScreen.width - 100, deviceScreen.height),
        undefined,
      ],

      [
        'windowed to full screen',
        () => setFrame(deviceScreen.width - 100, deviceScreen.height),
        fullScreen,
        OWN_TAG,
      ],
    ])(
      'does not dismiss on %s, and the next focus follows the new window',
      async (_, before, after, expectedTarget) => {
        before();
        const {getByTestId, rerenderInput} = await renderInput();

        after();
        await rerenderInput();

        expect(Keyboard.dismiss).not.toHaveBeenCalled();

        await focus(getByTestId);

        expect(sheet.keyboardState.target).toBe(expectedTarget);
      },
    );
  });

  describe('outside a sheet', () => {
    it('renders a plain input and never touches the window or keyboard', async () => {
      mockUseBottomSheetInternal.mockImplementation(() => null);
      const addEventListener = jest.spyOn(Dimensions, 'addEventListener');
      mockUseSafeAreaFrame.mockClear();
      setFrame(deviceScreen.width - 100, deviceScreen.height);
      const {getByTestId, rerenderInput} = await renderInput();

      await focus(getByTestId);
      fullScreen();
      await rerenderInput();

      expect(sheet.textInputNodesRef.current.size).toBe(0);
      expect(sheet.animatedKeyboardState.set).not.toHaveBeenCalled();
      expect(Keyboard.dismiss).not.toHaveBeenCalled();
      expect(addEventListener).not.toHaveBeenCalled();
      expect(mockUseSafeAreaFrame).not.toHaveBeenCalled();
      expect(onFocus).toHaveBeenCalledTimes(1);
    });
  });
});
