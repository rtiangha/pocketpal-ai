import React from 'react';
import {StyleSheet} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {act, fireEvent, render, screen} from '../../../../jest/test-utils';
import {measuresIncludeStatusBar} from '../../../utils/edgeToEdge';
import {Menu} from '../Menu';

jest.mock('../../../utils/edgeToEdge', () => ({
  measuresIncludeStatusBar: jest.fn(() => false),
}));

// RNTL v14 no longer exposes Paper Menu's props in the host tree, so capture
// them via a thin mock. It reproduces Paper's hide animation timing (children
// stay mounted for 600ms after visible goes false, onDismiss fires 600ms
// after an overlay press / accessibility escape) because the animation tests
// below depend on it. The anchor (trigger element) renders whether the menu
// is open or closed.
const mockCapturedPaperMenus: any[] = [];
jest.mock('react-native-paper', () => {
  const actual = jest.requireActual('react-native-paper');
  const {
    createElement,
    Fragment,
    isValidElement,
    useState,
    useRef,
    useEffect,
  } = require('react');
  const {View, Pressable} = require('react-native');
  const HIDE_MS = 600;
  const MenuMock = (props: any) => {
    mockCapturedPaperMenus.push(props);
    const [hiding, setHiding] = useState(false);
    const timerRef = useRef(null);
    const dismissTimerRef = useRef(null);
    useEffect(() => {
      if (props.visible) {
        if (timerRef.current) {
          clearTimeout(timerRef.current);
          timerRef.current = null;
        }
        setHiding(false);
      } else if (!timerRef.current) {
        setHiding(true);
        timerRef.current = setTimeout(() => {
          setHiding(false);
          timerRef.current = null;
        }, HIDE_MS);
      }
      return () => {
        if (timerRef.current) {
          clearTimeout(timerRef.current);
          timerRef.current = null;
        }
        if (dismissTimerRef.current) {
          clearTimeout(dismissTimerRef.current);
          dismissTimerRef.current = null;
        }
      };
    }, [props.visible]);
    // Paper fires onDismiss when the hide animation completes after an
    // overlay press / accessibility escape.
    const scheduleDismiss = () => {
      if (dismissTimerRef.current) {
        return;
      }
      dismissTimerRef.current = setTimeout(() => {
        dismissTimerRef.current = null;
        props.onDismiss?.();
      }, HIDE_MS);
    };
    const anchor =
      typeof props.anchor === 'function' ? props.anchor() : props.anchor;
    const shown = props.visible || hiding;
    return createElement(
      Fragment,
      null,
      isValidElement(anchor) ? anchor : null,
      shown
        ? createElement(
            View,
            {testID: 'menu-view', onAccessibilityEscape: scheduleDismiss},
            createElement(Pressable, {
              accessibilityLabel: 'Close menu',
              onPress: scheduleDismiss,
            }),
            props.children,
          )
        : null,
    );
  };
  MenuMock.Item = actual.Menu.Item;
  return {...actual, Menu: MenuMock};
});
const paperMenu = () => {
  expect(mockCapturedPaperMenus.length).toBeGreaterThan(0);
  return mockCapturedPaperMenus[mockCapturedPaperMenus.length - 1];
};

describe('Menu', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders menu items correctly', async () => {
    const {getByText} = await render(
      <Menu visible={true} onDismiss={() => {}} anchor={undefined}>
        <Menu.Item label="Item 1" onPress={() => {}} />
        <Menu.Item label="Item 2" onPress={() => {}} />
      </Menu>,
    );

    expect(getByText('Item 1')).toBeTruthy();
    expect(getByText('Item 2')).toBeTruthy();
  });

  it('renders separators correctly', async () => {
    await render(
      <Menu visible={true} onDismiss={() => {}} anchor={undefined}>
        <Menu.Item label="Item 1" onPress={() => {}} />
        <Menu.Separator />
        <Menu.Item label="Item 2" onPress={() => {}} />
        <Menu.GroupSeparator />
        <Menu.Item label="Item 3" onPress={() => {}} />
      </Menu>,
    );

    // Separator renders a Paper Divider (a hairline-height host View);
    // GroupSeparator renders a Paper Menu.Item with an empty title (the only
    // empty Text in the tree). Host styles can be arrays in v14, so flatten.
    const separators = screen.container.queryAll(
      (n: any) =>
        n.type === 'View' &&
        StyleSheet.flatten(n.props.style)?.height === StyleSheet.hairlineWidth,
    );
    const groupSeparators = screen.container.queryAll(
      (n: any) => n.type === 'Text' && n.props.children === '',
    );

    expect(separators).toHaveLength(1);
    expect(groupSeparators).toHaveLength(1);
  });

  describe('statusBarHeight passed to PaperMenu', () => {
    const renderedStatusBarHeight = async (includesStatusBar: boolean) => {
      (measuresIncludeStatusBar as jest.Mock).mockReturnValue(
        includesStatusBar,
      );
      (useSafeAreaInsets as jest.Mock).mockReturnValue({
        top: 59,
        right: 0,
        bottom: 34,
        left: 0,
      });

      await render(
        <Menu visible={true} onDismiss={() => {}} anchor={undefined}>
          <Menu.Item label="Item 1" onPress={() => {}} />
        </Menu>,
      );
      return paperMenu().statusBarHeight;
    };

    afterEach(() => {
      (measuresIncludeStatusBar as jest.Mock).mockReturnValue(false);
    });

    it('is 0 when RN measures in edge-to-edge window coordinates', async () => {
      expect(await renderedStatusBarHeight(true)).toBe(0);
    });

    it('is the top inset when the measure excludes the status bar (no edge-to-edge, or iOS)', async () => {
      expect(await renderedStatusBarHeight(false)).toBe(59);
    });
  });

  it('does not render when visible is true but has no children', async () => {
    await render(
      <Menu visible={true} onDismiss={() => {}} anchor={undefined} />,
    );

    const paperMenuInstance = paperMenu();
    expect(paperMenuInstance.visible).toBe(false);
  });

  describe('open and close animation', () => {
    const elapse = async (ms: number) =>
      await act(() => new Promise<void>(resolve => setTimeout(resolve, ms)));

    const renderOpenMenu = async (onDismiss = jest.fn()) => {
      const ui = (isVisible: boolean) => (
        <Menu visible={isVisible} onDismiss={onDismiss} anchor={undefined}>
          <Menu.Item label="Item 1" onPress={() => {}} />
        </Menu>
      );

      const utils = await render(ui(true));
      await elapse(600);
      return {
        ...utils,
        setVisible: async (v: boolean) => await utils.rerender(ui(v)),
      };
    };

    it('unmounts the items once the hide animation finishes', async () => {
      const {queryByText, setVisible} = await renderOpenMenu();
      expect(queryByText('Item 1')).toBeTruthy();

      await setVisible(false);
      await elapse(600);

      expect(queryByText('Item 1')).toBeNull();
    });

    it('stays open when reopened while the hide animation is running', async () => {
      const {queryByText, setVisible} = await renderOpenMenu();

      await setVisible(false);
      await elapse(0);
      await setVisible(true);
      await elapse(600);

      expect(queryByText('Item 1')).toBeTruthy();
    });

    it('reopens after a completed hide', async () => {
      const {queryByText, setVisible} = await renderOpenMenu();

      await setVisible(false);
      await elapse(600);
      expect(queryByText('Item 1')).toBeNull();

      await setVisible(true);
      await elapse(600);

      expect(queryByText('Item 1')).toBeTruthy();
    });

    it('calls onDismiss from an overlay press only after the menu animates out', async () => {
      const onDismiss = jest.fn();
      const {getByLabelText} = await renderOpenMenu(onDismiss);

      await fireEvent.press(
        getByLabelText('Close menu', {includeHiddenElements: true}),
      );
      expect(onDismiss).not.toHaveBeenCalled();

      await elapse(600);
      expect(onDismiss).toHaveBeenCalledTimes(1);
    });

    it('calls onDismiss from an accessibility escape only after the menu animates out', async () => {
      const onDismiss = jest.fn();
      const {getByTestId} = await renderOpenMenu(onDismiss);

      await act(() => getByTestId('menu-view').props.onAccessibilityEscape());
      expect(onDismiss).not.toHaveBeenCalled();

      await elapse(600);
      expect(onDismiss).toHaveBeenCalledTimes(1);
    });
  });
});
