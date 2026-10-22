/**
 * In-memory stand-in for expo-secure-store.
 *
 * The real module talks to the Android Keystore / iOS Keychain through a
 * native module Jest has no host for. Each function is a jest.fn so a suite
 * can assert what was stored; `__reset()` empties the store between tests
 * (jest.clearAllMocks keeps these implementations, so the map must be cleared
 * explicitly).
 */
let store = {};

module.exports = {
  getItemAsync: jest.fn(async (key) => (key in store ? store[key] : null)),
  setItemAsync: jest.fn(async (key, value) => { store[key] = String(value); }),
  deleteItemAsync: jest.fn(async (key) => { delete store[key]; }),
  isAvailableAsync: jest.fn(async () => true),
  __reset: () => { store = {}; },
};
