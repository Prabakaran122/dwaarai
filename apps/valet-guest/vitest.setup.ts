import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// vitest.config.ts runs with globals:false (matching the rest of the repo), so
// Testing Library's automatic afterEach cleanup never registers itself and
// every render would stack up in the same document. Register it explicitly.
afterEach(cleanup);
