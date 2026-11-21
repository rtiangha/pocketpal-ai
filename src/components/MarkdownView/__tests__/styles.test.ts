import {createMarkdownStyle} from '../styles';
import {themeFixtures} from '../../../../jest/fixtures/theme';

describe('createMarkdownStyle math colors', () => {
  it.each([
    ['dark body', themeFixtures.darkTheme, 'body'],
    ['light body', themeFixtures.lightTheme, 'body'],
    ['dark reasoning', themeFixtures.darkTheme, 'reasoning'],
    ['light reasoning', themeFixtures.lightTheme, 'reasoning'],
  ] as const)('follows the theme text color (%s)', (_label, theme, variant) => {
    const style = createMarkdownStyle(theme, variant);
    const expected =
      variant === 'reasoning'
        ? theme.colors.thinkingBubbleText
        : theme.colors.text;
    // Display math: theme text on a transparent background, so it
    // stays readable in dark mode instead of falling back to the
    // library's light defaults (dark text, white card).
    expect(style.math?.color).toBe(expected);
    expect(style.math?.backgroundColor).toBe('transparent');
    // Inline math has no background; its color is the whole fix.
    expect(style.inlineMath?.color).toBe(expected);
  });
});
