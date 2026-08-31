jest.mock('../api/valet');
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn().mockResolvedValue(null),
  setItem: jest.fn().mockResolvedValue(undefined),
  multiRemove: jest.fn().mockResolvedValue(undefined),
}));

// expo-status-bar reaches for a native module that Jest has no host for.
// Nothing here asserts on the status bar; stubbing it keeps the entry
// renderable without pulling in a native dependency.
jest.mock('expo-status-bar', () => ({ StatusBar: () => null }));

const mockUseAppFonts = jest.fn(() => true);
jest.mock('../lib/fonts', () => ({ useAppFonts: () => mockUseAppFonts() }));

import React from 'react';
import { render, waitFor } from '@testing-library/react-native';
import App from '../../app/index';
import { useAuthStore } from '../store/authStore';
import * as api from '../api/valet';

/**
 * The app entry.
 *
 * These exist because the first APK crashed on launch on every Android device.
 * Every screen styles text through `font()`, which returns a fontFamily of
 * 'DMSans_*'; on Android, naming a family that was never loaded is FATAL, not a
 * fallback. Web silently substitutes a system font, so the whole flow tested
 * green in a browser and died on a real phone.
 *
 * The lesson these encode: gating on fonts is load-bearing, not cosmetic.
 */

beforeEach(() => {
  jest.clearAllMocks();
  mockUseAppFonts.mockReturnValue(true);
  (api.listTickets as jest.Mock).mockResolvedValue({ data: { tickets: [] } });
  useAuthStore.setState({ token: null, user: null, loading: false, restoring: false, error: null });
});

describe('font gating', () => {
  it('renders nothing that styles text until the fonts have loaded', () => {
    mockUseAppFonts.mockReturnValue(false);
    useAuthStore.setState({ restoring: false, token: null });

    const { queryByTestId } = render(<App />);

    // Neither the login screen nor the valet flow may mount early — both style
    // every label with a DMSans family that does not exist yet.
    expect(queryByTestId('login-submit')).toBeNull();
    expect(queryByTestId('new-valet-ticket')).toBeNull();
  });

  it('renders the login screen once fonts are ready', async () => {
    mockUseAppFonts.mockReturnValue(true);
    useAuthStore.setState({ restoring: false, token: null });

    const { getByTestId } = render(<App />);

    await waitFor(() => expect(getByTestId('login-submit')).toBeTruthy());
  });

  it('keeps waiting while the stored session is still being restored', () => {
    useAuthStore.setState({ restoring: true, token: null });

    const { queryByTestId } = render(<App />);

    expect(queryByTestId('login-submit')).toBeNull();
  });

  it('goes straight to the valet flow for a restored session', async () => {
    useAuthStore.setState({ restoring: false, token: 'jwt-123' });

    const { getByTestId } = render(<App />);

    await waitFor(() => expect(getByTestId('new-valet-ticket')).toBeTruthy());
  });
});

describe('font family contract', () => {
  it('every family the theme names is one the loader actually loads', () => {
    // The crash was a mismatch between these two lists. Asserting them against
    // each other is cheaper than discovering it on a device again.
    const { font } = require('../theme/typography');
    const named = new Set([400, 500, 700].map((w) => font(w).fontFamily));

    const loaderSource = require('fs').readFileSync(
      require('path').join(__dirname, '../lib/fonts.ts'), 'utf8'
    );

    for (const family of named) {
      expect(loaderSource).toContain(family);
    }
  });
});
