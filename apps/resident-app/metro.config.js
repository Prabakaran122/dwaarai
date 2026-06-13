// Monorepo-aware Metro config (pnpm workspace).
// https://docs.expo.dev/guides/monorepos/
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

// 1. Watch all files in the monorepo
config.watchFolders = [workspaceRoot];
// 2. Resolve modules from the app first, then the workspace root
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

// 3. Force a SINGLE copy of React. Under pnpm's virtual store, dependencies
//    like @expo-google-fonts/* can resolve their own nested React, giving the
//    web bundle two React instances → "Invalid hook call" (null dispatcher).
//    Pin every React entry point to the app's hoisted copy.
const reactSingletons = ['react', 'react-dom', 'react/jsx-runtime', 'react/jsx-dev-runtime'];
const singletonPath = {};
for (const name of reactSingletons) {
  try { singletonPath[name] = require.resolve(name); } catch (e) { /* not installed */ }
}
const baseResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (singletonPath[moduleName]) {
    return { type: 'sourceFile', filePath: singletonPath[moduleName] };
  }
  return (baseResolveRequest || context.resolveRequest)(context, moduleName, platform);
};

module.exports = config;
