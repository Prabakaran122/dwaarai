const { View } = require('react-native');
const React = require('react');

const insets = { top: 0, right: 0, bottom: 0, left: 0 };

module.exports = {
  useSafeAreaInsets: () => insets,
  SafeAreaProvider: ({ children }) => children,
  SafeAreaView: View,
  SafeAreaConsumer: ({ children }) => children(insets),
};
