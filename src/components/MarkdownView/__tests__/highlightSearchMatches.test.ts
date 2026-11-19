import {
  countVisibleOccurrences,
  highlightSearchMatches,
} from '../highlightSearchMatches';

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

  it('wraps the current occurrence bolder than the others', () => {
    expect(highlightSearchMatches('ab ab ab', 'ab', 0)).toBe(
      '==**ab**== ==ab== ==ab==',
    );
    expect(highlightSearchMatches('ab ab ab', 'ab', 2)).toBe(
      '==ab== ==ab== ==**ab**==',
    );
  });

  it('wraps every occurrence plainly when there is no current one', () => {
    expect(highlightSearchMatches('ab ab ab', 'ab', undefined)).toBe(
      '==ab== ==ab== ==ab==',
    );
  });

  it('falls back to a plain wrap when the current match is already bold', () => {
    // Nesting another ** pair would produce **==**x**==** and break the
    // parse, so an already-bold current match keeps the plain wrap.
    expect(highlightSearchMatches('**hello** hello', 'hello', 0)).toBe(
      '**==hello==** ==hello==',
    );
  });

  it('falls back to a plain wrap when the match itself contains bold markers', () => {
    expect(highlightSearchMatches('a**b and a**b', 'a**b', 0)).toBe(
      '==a**b== and ==a**b==',
    );
  });

  it('counts the current occurrence across lines and link text', () => {
    const md = 'hello [hello](https://example.com/hello)\nhello';
    expect(highlightSearchMatches(md, 'hello', 2)).toBe(
      '==hello== [==hello==](https://example.com/hello)\n==**hello**==',
    );
  });
});

describe('countVisibleOccurrences', () => {
  it('returns 0 for an empty or whitespace query', () => {
    expect(countVisibleOccurrences('Hello world', '')).toBe(0);
    expect(countVisibleOccurrences('Hello world', '   ')).toBe(0);
  });

  it('counts every occurrence, case-insensitively', () => {
    expect(countVisibleOccurrences('ab Ab aB', 'ab')).toBe(3);
  });

  it('does not count occurrences inside code or link destinations', () => {
    const md = 'war in `war` code and [war](https://example.com/war) plus war';
    expect(countVisibleOccurrences(md, 'war')).toBe(3);
  });

  it('agrees with the number of spans highlightSearchMatches wraps', () => {
    const md = 'war in `war` code and [war](https://example.com/war) plus war';
    const wrapped = highlightSearchMatches(md, 'war');
    const spanCount = (wrapped.split('==').length - 1) / 2;
    expect(countVisibleOccurrences(md, 'war')).toBe(spanCount);
  });
});
