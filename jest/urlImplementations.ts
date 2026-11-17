import {URL as PolyfillURL} from 'react-native-url-polyfill';

const NODE_URL = globalThis.URL;

export const URL_IMPLEMENTATIONS: Array<[string, typeof URL]> = [
  ['node URL', NODE_URL],
  ['react-native-url-polyfill URL', PolyfillURL as unknown as typeof URL],
];

export const POLYFILL_URL = URL_IMPLEMENTATIONS[1][1];

/** Swap `globalThis.URL` for each test in the enclosing describe. */
export const useUrlImplementation = (impl: typeof URL): void => {
  let saved: typeof URL;
  beforeEach(() => {
    saved = globalThis.URL;
    globalThis.URL = impl;
  });
  afterEach(() => {
    globalThis.URL = saved;
  });
};

/** Non-ASCII host case survives parsing only under the polyfill: proves the swap is live.
 * (ASCII host case no longer discriminates: url-polyfill 4.x lowercases ASCII
 * hostnames like Node does, per the WHATWG URL Standard. The Kelvin sign does
 * discriminate: Node's IDNA processing folds U+212A to 'k', the polyfill
 * passes it through unchanged, in both 3.x and 4.x.) */
export const expectUrlImplementationActive = (impl: typeof URL): void => {
  expect(new URL('https://\u212A.com/').hostname).toBe(
    impl === NODE_URL ? 'k.com' : '\u212A.com',
  );
};
