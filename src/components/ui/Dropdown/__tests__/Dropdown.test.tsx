import React from 'react';
import {fireEvent, screen} from '@testing-library/react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';

import {render} from '../../../../../jest/test-utils';
import {measuresIncludeStatusBar} from '../../../../utils/edgeToEdge';
import {Dropdown} from '../Dropdown';

// RNTL v14 no longer exposes Paper Menu's props in the host tree, so capture
// them via a thin mock. It renders children only when visible; the closed
// menu renders nothing into snapshots, so the snapshot matrix is unaffected.
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
import {runSnapshotMatrix} from '../../__tests__/helpers/snapshotMatrix';

const options = [
  {value: 'a', label: 'Alpha'},
  {value: 'b', label: 'Beta'},
];

jest.mock('../../../../utils/edgeToEdge', () => ({
  measuresIncludeStatusBar: jest.fn(() => false),
}));

describe('Dropdown', () => {
  afterEach(() => {
    (measuresIncludeStatusBar as jest.Mock).mockReturnValue(false);
  });

  it('defaults to testID=ui-dropdown and role=button', async () => {
    const {getByTestId} = await render(
      <Dropdown value="a" options={options} onChange={() => {}} />,
    );
    expect(getByTestId('ui-dropdown').props.accessibilityRole).toBe('button');
  });

  it('opens menu on press', async () => {
    const onChange = jest.fn();
    const {getByTestId, getByText} = await render(
      <Dropdown value="a" options={options} onChange={onChange} />,
    );
    await fireEvent.press(getByTestId('ui-dropdown'));
    expect(getByText('Beta')).toBeTruthy();
    await fireEvent.press(getByText('Beta'));
    expect(onChange).toHaveBeenCalledWith('b');
  });

  it('gives the trigger a >=44pt touch target', async () => {
    const {getByTestId} = await render(
      <Dropdown value="a" options={options} onChange={() => {}} />,
    );
    const trigger = getByTestId('ui-dropdown');
    const flattened = Array.isArray(trigger.props.style)
      ? Object.assign({}, ...trigger.props.style.flat())
      : trigger.props.style;
    expect(flattened.minHeight).toBeGreaterThanOrEqual(44);
  });

  it('marks the currently-selected option in the open menu', async () => {
    const {getByTestId} = await render(
      <Dropdown value="a" options={options} onChange={() => {}} />,
    );
    await fireEvent.press(getByTestId('ui-dropdown'));
    // Paper renders leadingIcon='check' as a font glyph (MaterialCommunityIcons
    // 'check' = U+F012C) inside a Text on the selected item only. The `source`
    // prop is not present on host nodes in v14.
    const checks = screen.container.queryAll((node: any) => {
      const kids = node.props?.children;
      const arr = Array.isArray(kids) ? kids : [kids];
      return arr.some(
        (c: any) =>
          typeof c === 'string' && c.includes(String.fromCodePoint(0xf012c)),
      );
    });
    expect(checks.length).toBe(1);
  });

  it('passes statusBarHeight 0 when RN measures in edge-to-edge window coordinates', async () => {
    (measuresIncludeStatusBar as jest.Mock).mockReturnValue(true);
    (useSafeAreaInsets as jest.Mock).mockReturnValue({
      top: 47,
      right: 0,
      bottom: 34,
      left: 0,
    });
    const {getByTestId} = await render(
      <Dropdown value="a" options={options} onChange={() => {}} />,
    );
    await fireEvent.press(getByTestId('ui-dropdown'));

    expect(paperMenu().statusBarHeight).toBe(0);
  });
});

runSnapshotMatrix(
  'Dropdown',
  ({variant: _v, size, state}) => (
    <Dropdown
      size={size}
      value="a"
      options={options}
      onChange={() => {}}
      disabled={state === 'disabled'}
    />
  ),
  {
    variants: ['standard'] as const,
    sizes: ['s', 'm', 'l'] as const,
    langs: ['fa'] as const,
  },
);
