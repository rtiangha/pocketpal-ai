/**
 * Re-export shim: the implementation moved to
 * src/utils/searchHighlight.ts so the store can share the occurrence
 * counting (the count must agree with the highlighting by construction).
 * Kept here so existing imports from the MarkdownView feature keep
 * working.
 */
export {
  buildSearchOccurrences,
  countVisibleOccurrences,
  highlightSearchMatches,
} from '../../utils/searchHighlight';
export type {SearchOccurrence} from '../../utils/searchHighlight';
