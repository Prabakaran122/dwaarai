module.exports = {
  preset: 'jest-expo',
  setupFiles: ['<rootDir>/jest.setup.js'],
  setupFilesAfterEnv: ['@testing-library/react-native/extend-expect'],
  // pnpm stores packages under node_modules/.pnpm/<pkg>/node_modules/<pkg>.
  // A leading-slash pattern would match the inner node_modules/ and then see
  // "react-native" right after it, causing the negative-lookahead to wrongly
  // exclude RN from transformation. Use the no-leading-slash form so the
  // pattern matches from the FIRST node_modules in the path (.pnpm level),
  // where the next token is ".pnpm" — safely inside the ignore list.
  transformIgnorePatterns: [
    'node_modules/(?!\\.pnpm)(?!((jest-)?react-native|@react-native(-community)?|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@unimodules/.*|unimodules|sentry-expo|native-base|react-native-svg|@react-native-async-storage/.*))',
  ],
  moduleNameMapper: {
    '^@expo/vector-icons$': '<rootDir>/src/__mocks__/@expo/vector-icons.js',
    '^@expo/vector-icons/(.*)$': '<rootDir>/src/__mocks__/@expo/vector-icons.js',
    // Force all React imports to the single hoisted copy so hooks work across
    // the pnpm virtual store (avoids "Invalid hook call" when react-native loads
    // its own react from .pnpm while react-test-renderer uses the hoisted copy).
    '^react$': require.resolve('react'),
    '^react/jsx-runtime$': require.resolve('react/jsx-runtime'),
    '^react/jsx-dev-runtime$': require.resolve('react/jsx-dev-runtime'),
    // Same problem for react-native itself: under pnpm the test file and
    // @testing-library/react-native each resolve their own react-native symlink,
    // giving two copies of RN's host-component registry. RNTL then detects host
    // names ("Text") from its copy that don't match the names the test renders
    // ("RCTText") — so getByText/getByRole silently match nothing. Pin both to one
    // instance so host-component detection agrees with what tests render.
    '^react-native$': require.resolve('react-native'),
  },
};
