import React from 'react';
import {MenuItem} from '../MenuItem';
import {useTheme} from '../../../../hooks';
import {fireEvent, render, screen} from '../../../../../jest/test-utils';

describe('MenuItem', () => {
  beforeEach(() => {
    (useTheme as jest.Mock).mockReturnValue({
      colors: {
        menuText: '#000000',
        menuDangerText: '#FF0000',
        menuBackgroundActive: '#E0E0E0',
      },
      fonts: {
        bodySmall: {},
      },
    });
  });

  it('renders basic menu item correctly', async () => {
    const onPress = jest.fn();
    const {getByText} = await render(
      <MenuItem label="Test Item" onPress={onPress} />,
    );

    expect(getByText('Test Item')).toBeTruthy();
  });

  it('handles press events', async () => {
    const onPress = jest.fn();
    const {getByText} = await render(
      <MenuItem label="Test Item" onPress={onPress} />,
    );

    await fireEvent.press(getByText('Test Item'));
    expect(onPress).toHaveBeenCalled();
  });

  it('renders leading icon when provided', async () => {
    await render(
      <MenuItem label="Test Item" leadingIcon="check" onPress={() => {}} />,
    );

    // Paper renders leadingIcon as a font glyph (MaterialCommunityIcons
    // 'check' = U+F012C) inside a Text. The `source` prop is not present on
    // host nodes in v14.
    expect(
      screen.container.queryAll((node: any) => {
        const kids = node.props?.children;
        const arr = Array.isArray(kids) ? kids : [kids];
        return arr.some(
          (c: any) =>
            typeof c === 'string' && c.includes(String.fromCodePoint(0xf012c)),
        );
      }),
    ).toHaveLength(1);
  });

  it('renders trailing icon when provided', async () => {
    await render(
      <MenuItem label="Test Item" trailingIcon="close" onPress={() => {}} />,
    );

    // Paper renders trailingIcon as a font glyph (MaterialCommunityIcons
    // 'close' = U+F0156) inside a Text.
    expect(
      screen.container.queryAll((node: any) => {
        const kids = node.props?.children;
        const arr = Array.isArray(kids) ? kids : [kids];
        return arr.some(
          (c: any) =>
            typeof c === 'string' && c.includes(String.fromCodePoint(0xf0156)),
        );
      }),
    ).toHaveLength(1);
  });

  it('handles disabled state correctly', async () => {
    const onPress = jest.fn();
    const {getByText} = await render(
      <MenuItem label="Test Item" onPress={onPress} disabled={true} />,
    );

    await fireEvent.press(getByText('Test Item'));
    expect(onPress).not.toHaveBeenCalled();
  });
});
