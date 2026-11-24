/** Vitest setup: DOM matchers, MSW API mocking, and cleanup between tests. */
import '@testing-library/jest-dom/vitest';
import { cleanup, configure } from '@testing-library/react';
import { afterAll, afterEach, beforeAll } from 'vitest';
import { clearTokens } from '../auth/tokenStore';
import { server } from './server';

// jsdom lacks ResizeObserver, which the MUI DataGrid uses for layout.
if (!globalThis.ResizeObserver) {
  globalThis.ResizeObserver = class {
    observe() {}

    unobserve() {}

    disconnect() {}
  };
}

// Lazy-loaded pages compile on first use; allow slower machines/CI more time than the 1s default.
configure({ asyncUtilTimeout: 5000 });

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  cleanup();
  window.localStorage.clear();
  clearTokens();
  server.resetHandlers();
});
afterAll(() => server.close());
