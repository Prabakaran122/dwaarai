/**
 * Jest global setup for React Native component tests.
 * Sets globals that react-native's BatchedBridge/NativeModules.js checks
 * before falling through to the real native bridge (which is unavailable in
 * the Jest / Node environment).
 */

// Satisfy the `nativeModuleProxy` path so NativeModules.js never tries to
// read __fbBatchedBridgeConfig.
global.nativeModuleProxy = new Proxy(
  {},
  {
    get(_target, name) {
      // Return a minimal module stub for any requested native module.
      return {
        getConstants: () => ({
          // PlatformConstants (iOS)
          isTesting: true,
          reactNativeVersion: { major: 0, minor: 76, patch: 0, prerelease: null },
          osVersion: '17.0',
          systemName: 'iOS',
          interfaceIdiom: 'phone',
          forceTouchAvailable: false,
          isDisableAnimations: false,
        }),
        addListener: jest.fn(),
        removeListeners: jest.fn(),
        addEventObserver: jest.fn(),
        removeEventObserver: jest.fn(),
      };
    },
  }
);

// TurboModuleRegistry calls global.__turboModuleProxy(name) as a function.
// Return per-module stubs for the native modules that StyleSheet / Platform
// initialisation chains require in the Jest / Node environment.
const DIMENSIONS = {
  screen: { width: 375, height: 812, scale: 2, fontScale: 1 },
  window: { width: 375, height: 812, scale: 2, fontScale: 1 },
};

const MODULE_STUBS = {
  PlatformConstants: {
    getConstants: () => ({
      isTesting: true,
      reactNativeVersion: { major: 0, minor: 76, patch: 0, prerelease: null },
      osVersion: '17.0',
      systemName: 'iOS',
      interfaceIdiom: 'phone',
      forceTouchAvailable: false,
      isDisableAnimations: false,
    }),
  },
  DeviceInfo: {
    getConstants: () => ({ Dimensions: DIMENSIONS }),
  },
  Appearance: {
    getColorScheme: () => 'light',
    addListener: jest.fn(),
    removeListeners: jest.fn(),
  },
  PlatformColor: { resolve: jest.fn() },
  I18nManager: {
    getConstants: () => ({
      isRTL: false,
      doLeftAndRightSwapInRTL: true,
      localeIdentifier: 'en_US',
    }),
  },
  AccessibilityInfo: {
    getConstants: () => ({
      isBoldTextEnabled: false,
      isGrayscaleEnabled: false,
      isInvertColorsEnabled: false,
      isReduceMotionEnabled: false,
      isReduceTransparencyEnabled: false,
      isScreenReaderEnabled: false,
    }),
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    setAccessibilityFocus: jest.fn(),
    announceForAccessibility: jest.fn(),
  },
};

const DEFAULT_STUB = {
  getConstants: () => ({}),
  addListener: jest.fn(),
  removeListeners: jest.fn(),
  addEventObserver: jest.fn(),
  removeEventObserver: jest.fn(),
};

global.__turboModuleProxy = function turboModuleProxy(name) {
  return MODULE_STUBS[name] || DEFAULT_STUB;
};
