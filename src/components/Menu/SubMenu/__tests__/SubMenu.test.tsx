import React from 'react';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {render} from '../../../../../jest/test-utils';
import {measuresIncludeStatusBar} from '../../../../utils/edgeToEdge';
import {SubMenu} from '../SubMenu';
import {MenuItem} from '../../MenuItem';

jest.mock('../../../../utils/edgeToEdge', () => ({
  measuresIncludeStatusBar: jest.fn(() => false),
}));

// RNTL v14 no longer exposes Paper Menu's props in the host tree, so capture
// them via a thin mock. It renders children only when visible, preserving
// the items-presence behaviour the tests rely on.
const mockCapturedPaperMenus: any[] = [];
jest.mock('react-native-paper', () => {
  const actual = jest.requireActual('react-native-paper');
  const {createElement, Fragment, isValidElement} = require('react');
  const MenuMock = (props: any) => {
    mockCapturedPaperMenus.push(props);
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
  return {...actual, Menu: MenuMock};
});
const paperMenu = () => {
  expect(mockCapturedPaperMenus.length).toBeGreaterThan(0);
  return mockCapturedPaperMenus[mockCapturedPaperMenus.length - 1];
};

describe('SubMenu', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders when visible', async () => {
    const {getByText} = await render(
      <SubMenu visible={true} onDismiss={() => {}} anchor={{x: 100, y: 100}}>
        <MenuItem label="SubMenu Item" onPress={() => {}} />
      </SubMenu>,
    );

    expect(getByText('SubMenu Item')).toBeTruthy();
  });

  it('does not render when not visible', async () => {
    const {queryByText} = await render(
      <SubMenu visible={false} onDismiss={() => {}} anchor={{x: 100, y: 100}}>
        <MenuItem label="SubMenu Item" onPress={() => {}} />
      </SubMenu>,
    );

    expect(queryByText('SubMenu Item')).toBeNull();
  });

  it('handles multiple menu items', async () => {
    const {getByText} = await render(
      <SubMenu visible={true} onDismiss={() => {}} anchor={{x: 100, y: 100}}>
        <MenuItem label="Item 1" onPress={() => {}} />
        <MenuItem label="Item 2" onPress={() => {}} />
        <MenuItem label="Item 3" onPress={() => {}} />
      </SubMenu>,
    );

    expect(getByText('Item 1')).toBeTruthy();
    expect(getByText('Item 2')).toBeTruthy();
    expect(getByText('Item 3')).toBeTruthy();
  });

  it('passes statusBarHeight to PaperMenu', async () => {
    await render(
      <SubMenu visible={true} onDismiss={() => {}} anchor={{x: 100, y: 100}}>
        <MenuItem label="Item 1" onPress={() => {}} />
      </SubMenu>,
    );

    const paperMenuInstance = paperMenu();
    expect(paperMenuInstance.statusBarHeight).toBeDefined();
    expect(typeof paperMenuInstance.statusBarHeight).toBe('number');
  });

  it('uses insets.top when the edge-to-edge measure is off or on iOS', async () => {
    (useSafeAreaInsets as jest.Mock).mockReturnValue({
      top: 47,
      right: 0,
      bottom: 34,
      left: 0,
    });

    await render(
      <SubMenu visible={true} onDismiss={() => {}} anchor={{x: 100, y: 100}}>
        <MenuItem label="Item 1" onPress={() => {}} />
      </SubMenu>,
    );

    const paperMenuInstance = paperMenu();
    expect(paperMenuInstance.statusBarHeight).toBe(47);
  });

  it('passes 0 when RN measures in edge-to-edge window coordinates', async () => {
    (measuresIncludeStatusBar as jest.Mock).mockReturnValueOnce(true);
    (useSafeAreaInsets as jest.Mock).mockReturnValue({
      top: 47,
      right: 0,
      bottom: 34,
      left: 0,
    });

    await render(
      <SubMenu visible={true} onDismiss={() => {}} anchor={{x: 100, y: 100}}>
        <MenuItem label="Item 1" onPress={() => {}} />
      </SubMenu>,
    );

    expect(paperMenu().statusBarHeight).toBe(0);
  });

  it('passes custom style alongside default styles', async () => {
    const customStyle = {marginTop: 10};
    await render(
      <SubMenu
        visible={true}
        onDismiss={() => {}}
        anchor={{x: 100, y: 100}}
        style={customStyle}>
        <MenuItem label="Item 1" onPress={() => {}} />
      </SubMenu>,
    );

    const paperMenuInstance = paperMenu();
    const styleArray = paperMenuInstance.style;
    expect(styleArray).toEqual(
      expect.arrayContaining([expect.objectContaining(customStyle)]),
    );
  });

  it('forwards additional props to PaperMenu', async () => {
    await render(
      <SubMenu
        visible={true}
        onDismiss={() => {}}
        anchor={{x: 200, y: 300}}
        testID="submenu-test">
        <MenuItem label="Item 1" onPress={() => {}} />
      </SubMenu>,
    );

    const paperMenuInstance = paperMenu();
    expect(paperMenuInstance.anchor).toEqual({x: 200, y: 300});
    expect(paperMenuInstance.testID).toBe('submenu-test');
  });

  it('passes contentStyle to PaperMenu', async () => {
    await render(
      <SubMenu visible={true} onDismiss={() => {}} anchor={{x: 100, y: 100}}>
        <MenuItem label="Item 1" onPress={() => {}} />
      </SubMenu>,
    );

    const paperMenuInstance = paperMenu();
    expect(paperMenuInstance.contentStyle).toBeDefined();
  });
});
