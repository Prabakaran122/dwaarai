const React = require('react');
const { View } = require('react-native');

const LinearGradient = ({ children, ...props }) => React.createElement(View, props, children);

module.exports = { LinearGradient };
