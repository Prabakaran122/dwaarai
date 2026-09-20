const React = require('react');

// Lightweight mock for @expo/vector-icons.
// Does NOT import react-native to avoid bridge initialization order issues.
// Returns a simple functional component that outputs null.
const Icon = (_props) => null;
Icon.glyphMap = new Proxy({}, { get: (_, prop) => prop });

const handler = { get: (_target, prop) => Icon };
module.exports = new Proxy({ MaterialCommunityIcons: Icon }, handler);
