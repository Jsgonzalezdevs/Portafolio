import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// jsdom ships no matchMedia at all, so any component that asks about a
// breakpoint throws on render. Reports "does not match" — jsdom's viewport is
// 1024x768 but it has no CSS layout to query, and every current caller uses this
// to detect the DESKTOP breakpoint, where "no" is the safe default: mobile
// affordances stay mounted rather than vanishing with no replacement.
if (!window.matchMedia) {
  window.matchMedia = (query: string): MediaQueryList =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList;
}

afterEach(() => {
  cleanup();
});
