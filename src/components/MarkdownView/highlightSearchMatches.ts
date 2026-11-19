/**
 * Wrap search-query matches in `==...==` highlight spans within markdown
 * SOURCE text.
 *
 * Fork redesign of upstream PR #622's `highlightSearchMatches`, which
 * operated on marked() HTML with `<mark>` tags for react-native-render-html.
 * This codebase renders with react-native-enriched-markdown, which parses
 * `==text==` spans when its `highlight` md4c flag is on, so the wrapping
 * happens on the source instead — MarkdownView turns the flag on only
 * while a search query is active, so old messages render exactly as
 * before outside a search.
 *
 * Guards (same intent as the PR's HTML version, applied at source level):
 *  - fenced code blocks (``` / ~~~) are never touched;
 *  - inline code spans (`...`) are never touched;
 *  - link destinations, autolinks and bare URLs are never touched, so
 *    wrapping can't corrupt a link target — only the visible link text
 *    is searchable;
 *  - raw HTML tags are never touched;
 *  - pre-existing `==` sequences are escaped to `\=\=` first, so an old
 *    message that already contains ==...== doesn't light up as a match;
 *  - matches never cross a formatting boundary (each plain segment is
 *    matched on its own), and the query's regex characters are literal.
 *
 * Known gaps vs the PR's HTML version: indented (4-space) code blocks
 * are not guarded — only fenced ones are — and a query spanning two
 * lines never matches, because lines are processed independently.
 */
export const highlightSearchMatches = (
  markdown: string,
  query: string,
): string => {
  const trimmed = query.trim();
  if (!trimmed) {
    return markdown;
  }
  const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const matchRegex = new RegExp(`(${escaped})`, 'gi');

  const wrapPlain = (text: string): string =>
    text.split('==').join('\\=\\=').replace(matchRegex, '==$1==');

  const lines = markdown.split('\n');
  let inFence = false;
  return lines
    .map(line => {
      if (/^\s*(```|~~~)/.test(line)) {
        inFence = !inFence;
        return line;
      }
      if (inFence) {
        return line;
      }
      return highlightLine(line, wrapPlain);
    })
    .join('\n');
};

// Protected spans within one line, in priority order: inline code, inline
// links [text](dest), reference links [text][ref], images, autolinks / raw
// HTML tags, bare URLs.
const SEGMENT =
  /(`+[^`\n]*?`+)|(\[[^\]\n]*\]\([^)\n]*\))|(\[[^\]\n]*\]\[[^\]\n]*\])|(!\[[^\]\n]*\]\([^)\n]*\))|(<[^>\n]+>)|(https?:\/\/[^\s)\n]+)/g;

const highlightLine = (
  line: string,
  wrapPlain: (text: string) => string,
): string => {
  let result = '';
  let lastIndex = 0;
  line.replace(
    SEGMENT,
    (
      match: string,
      _code: string | undefined,
      inlineLink: string | undefined,
      refLink: string | undefined,
      _image: string | undefined,
      _tag: string | undefined,
      _bareUrl: string | undefined,
      offset: number,
    ) => {
      result += wrapPlain(line.slice(lastIndex, offset));
      if (inlineLink) {
        // Wrap only the visible text; the destination stays untouched.
        const m = /^\[([^\]]*)\](\(.*\))$/.exec(inlineLink);
        result += m ? `[${wrapPlain(m[1])}]${m[2]}` : inlineLink;
      } else if (refLink) {
        const m = /^\[([^\]]*)\](\[.*\])$/.exec(refLink);
        result += m ? `[${wrapPlain(m[1])}]${m[2]}` : refLink;
      } else {
        // Inline code, image, HTML tag, bare URL: untouched.
        result += match;
      }
      lastIndex = offset + match.length;
      return match;
    },
  );
  result += wrapPlain(line.slice(lastIndex));
  return result;
};
