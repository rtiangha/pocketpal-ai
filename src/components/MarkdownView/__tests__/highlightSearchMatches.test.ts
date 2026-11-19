import {highlightSearchMatches} from '../highlightSearchMatches';

describe('highlightSearchMatches', () => {
  it('returns markdown unchanged for an empty or whitespace query', () => {
    const md = 'Hello world';
    expect(highlightSearchMatches(md, '')).toBe(md);
    expect(highlightSearchMatches(md, '   ')).toBe(md);
  });

  it('wraps a plain text match in highlight spans', () => {
    expect(highlightSearchMatches('Hello world', 'world')).toBe(
      'Hello ==world==',
    );
  });

  it('matches case-insensitively and preserves the original casing', () => {
    expect(highlightSearchMatches('HELLO world', 'hello')).toBe(
      '==HELLO== world',
    );
  });

  it('highlights every occurrence', () => {
    expect(highlightSearchMatches('ab ab ab', 'ab')).toBe(
      '==ab== ==ab== ==ab==',
    );
  });

  it('treats regex special characters in the query literally', () => {
    expect(highlightSearchMatches('a.b and axb', 'a.b')).toBe(
      '==a.b== and axb',
    );
  });

  it('does not inject spans inside fenced code blocks', () => {
    const md = 'before hello\n```js\nconst hello = 1;\n```\nafter hello';
    expect(highlightSearchMatches(md, 'hello')).toBe(
      'before ==hello==\n```js\nconst hello = 1;\n```\nafter ==hello==',
    );
  });

  it('does not inject spans inside an unclosed fenced block', () => {
    const md = 'before hello\n```\nconst hello = 1;';
    expect(highlightSearchMatches(md, 'hello')).toBe(
      'before ==hello==\n```\nconst hello = 1;',
    );
  });

  it('does not inject spans inside inline code', () => {
    expect(highlightSearchMatches('run `hello` now hello', 'hello')).toBe(
      'run `hello` now ==hello==',
    );
  });

  it('highlights link text but never the destination', () => {
    expect(
      highlightSearchMatches('[hello](https://example.com/hello)', 'hello'),
    ).toBe('[==hello==](https://example.com/hello)');
  });

  it('does not inject spans inside bare URLs', () => {
    expect(
      highlightSearchMatches('see https://example.com/hello now', 'hello'),
    ).toBe('see https://example.com/hello now');
  });

  it('does not inject spans inside raw HTML tags', () => {
    expect(highlightSearchMatches('a <br> hello', 'br')).toBe('a <br> hello');
  });

  it('escapes pre-existing == spans so they do not light up', () => {
    expect(highlightSearchMatches('old ==mark== hello', 'hello')).toBe(
      'old \\=\\=mark\\=\\= ==hello==',
    );
  });

  it('does not match a query split across a formatting boundary', () => {
    // "hello world" is split by the bold markers, so it must not match.
    expect(highlightSearchMatches('hello **world**', 'hello world')).toBe(
      'hello **world**',
    );
  });

  it('does not match across lines', () => {
    expect(highlightSearchMatches('hello\nworld', 'hello\nworld')).toBe(
      'hello\nworld',
    );
  });
});
