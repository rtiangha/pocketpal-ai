/**
 * Search occurrence counting and highlight wrapping, shared by the store
 * and the renderer so the two can never disagree.
 *
 * The count the bar shows and the spans MarkdownView renders are defined
 * by the SAME segment walk: only plain-text segments of the markdown
 * source are searchable — fenced code blocks, inline code, link
 * destinations, autolinks, bare URLs and raw HTML tags are protected.
 * Counting and highlighting from one walk means the counter ("3 of 7")
 * always equals the number of highlighted spans, and the Nth counted
 * occurrence is the Nth highlighted one.
 *
 * Moved here from src/components/MarkdownView/highlightSearchMatches.ts
 * (kept there as a re-export shim) so the store can import the counting
 * without depending on a component module.
 */

import {MessageType} from './types';
import {visibleStepContent} from './chat';

/** One highlighted occurrence: its message, the rendered chunk inside it
 * (chunk 0 for a text message; the Nth visible step for an assistant
 * turn, matching TextMessage's per-step rendering), and its index within
 * that chunk. */
export interface SearchOccurrence {
  messageId: string;
  chunkIndex: number;
  occurrenceIndex: number;
}

/** Rendered text chunks of one message, in order — the same chunks
 * TextMessage renders: the whole text for a text message, each visible
 * step for an assistant turn. Other message types have no text. */
const chunksForMessage = (message: MessageType.Any): string[] => {
  if (message.type === 'assistant_turn') {
    return ((message as MessageType.AssistantTurn).steps ?? [])
      .map(visibleStepContent)
      .filter(c => c.length > 0);
  }
  return 'text' in message && message.text ? [message.text] : [];
};

/**
 * Every visible occurrence of the query across the given messages, in
 * conversation order, then chunk order, then position within the chunk.
 * An empty or whitespace-only query matches nothing.
 */
export const buildSearchOccurrences = (
  messages: MessageType.Any[],
  query: string,
): SearchOccurrence[] => {
  const trimmed = query.trim();
  if (!trimmed) {
    return [];
  }
  const occurrences: SearchOccurrence[] = [];
  messages.forEach(msg => {
    chunksForMessage(msg).forEach((chunk, chunkIndex) => {
      const count = countVisibleOccurrences(chunk, trimmed);
      for (let i = 0; i < count; i++) {
        occurrences.push({
          messageId: msg.id,
          chunkIndex,
          occurrenceIndex: i,
        });
      }
    });
  });
  return occurrences;
};

/** Number of visible (highlightable) occurrences of the query in one
 * markdown source string. */
export const countVisibleOccurrences = (
  markdown: string,
  query: string,
): number => {
  const trimmed = query.trim();
  if (!trimmed) {
    return 0;
  }
  const matchRegex = new RegExp(`(${escapeRegExp(trimmed)})`, 'gi');
  let count = 0;
  for (const part of splitVisibleSegments(markdown)) {
    if (!part.plain) {
      continue;
    }
    const matches = part.text.match(matchRegex);
    if (matches) {
      count += matches.length;
    }
  }
  return count;
};

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
 * `currentOccurrence` (0-based, in document order across the whole
 * message) wraps that one occurrence as `==**...**==` — bold inside the
 * highlight — so prev/next navigation has a visible current match. It
 * falls back to a plain wrap when the match is already bold (adjacent
 * `**`/`__`) or contains `**`/`__` itself, where nesting the extra bold
 * markers would break the parse.
 *
 * Known gaps vs the PR's HTML version: indented (4-space) code blocks
 * are not guarded — only fenced ones are — and a query spanning two
 * lines never matches, because lines are processed independently.
 */
export const highlightSearchMatches = (
  markdown: string,
  query: string,
  currentOccurrence?: number,
): string => {
  const trimmed = query.trim();
  if (!trimmed) {
    return markdown;
  }
  const matchRegex = new RegExp(`(${escapeRegExp(trimmed)})`, 'gi');
  let seen = 0;
  return splitVisibleSegments(markdown)
    .map(part => {
      if (!part.plain) {
        return part.text;
      }
      return part.text.replace(
        matchRegex,
        (match: string, _capture: string, offset: number, full: string) => {
          const occurrence = seen++;
          if (
            currentOccurrence !== undefined &&
            occurrence === currentOccurrence &&
            !isAlreadyBold(full, offset, match) &&
            !match.includes('**') &&
            !match.includes('__')
          ) {
            return `==**${match}**==`;
          }
          return `==${match}==`;
        },
      );
    })
    .join('');
};

const escapeRegExp = (text: string): string =>
  text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// True when the match sits inside (or abuts) an existing bold span, so
// wrapping it in another `**` pair would produce `**==**x**==**` and
// break the parse. Only the `**` / `__` forms are checked — a single
// `*` italic span nests cleanly (`*==**x**==*`).
const isAlreadyBold = (
  segment: string,
  offset: number,
  match: string,
): boolean =>
  segment.slice(offset - 2, offset) === '**' ||
  segment.slice(offset - 2, offset) === '__' ||
  segment.slice(offset + match.length, offset + match.length + 2) === '**' ||
  segment.slice(offset + match.length, offset + match.length + 2) === '__';

interface Segment {
  text: string;
  /** Searchable plain text (already `==`-escaped) vs protected source. */
  plain: boolean;
}

// Splits markdown source into plain and protected segments, in document
// order, skipping fenced code blocks. The `==` escaping happens here so
// counting and highlighting read identical plain text.
const splitVisibleSegments = (markdown: string): Segment[] => {
  const parts: Segment[] = [];
  const lines = markdown.split('\n');
  let inFence = false;
  lines.forEach((line, lineIndex) => {
    if (lineIndex > 0) {
      parts.push({text: '\n', plain: false});
    }
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      parts.push({text: line, plain: false});
      return;
    }
    if (inFence) {
      parts.push({text: line, plain: false});
      return;
    }
    parts.push(...splitLine(line));
  });
  return parts;
};

// Protected spans within one line, in priority order: inline code, inline
// links [text](dest), reference links [text][ref], images, autolinks / raw
// HTML tags, bare URLs.
const SEGMENT =
  /(`+[^`\n]*?`+)|(\[[^\]\n]*\]\([^)\n]*\))|(\[[^\]\n]*\]\[[^\]\n]*\])|(!\[[^\]\n]*\]\([^)\n]*\))|(<[^>\n]+>)|(https?:\/\/[^\s)\n]+)/g;

const escapeEquals = (text: string): string => text.split('==').join('\\=\\=');

const splitLine = (line: string): Segment[] => {
  const parts: Segment[] = [];
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
      if (offset > lastIndex) {
        parts.push({
          text: escapeEquals(line.slice(lastIndex, offset)),
          plain: true,
        });
      }
      if (inlineLink) {
        // Only the visible text is searchable; the destination stays
        // untouched.
        const m = /^\[([^\]]*)\](\(.*\))$/.exec(inlineLink);
        if (m) {
          parts.push({text: '[', plain: false});
          parts.push({text: escapeEquals(m[1]), plain: true});
          parts.push({text: `]${m[2]}`, plain: false});
        } else {
          parts.push({text: inlineLink, plain: false});
        }
      } else if (refLink) {
        const m = /^\[([^\]]*)\](\[.*\])$/.exec(refLink);
        if (m) {
          parts.push({text: '[', plain: false});
          parts.push({text: escapeEquals(m[1]), plain: true});
          parts.push({text: `]${m[2]}`, plain: false});
        } else {
          parts.push({text: refLink, plain: false});
        }
      } else {
        // Inline code, image, HTML tag, bare URL: untouched.
        parts.push({text: match, plain: false});
      }
      lastIndex = offset + match.length;
      return match;
    },
  );
  if (lastIndex < line.length) {
    parts.push({text: escapeEquals(line.slice(lastIndex)), plain: true});
  }
  return parts;
};
