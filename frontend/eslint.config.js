// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*'],
  },
  {
    // Alert must come from the cross-platform shim (src/lib/alert), never
    // react-native — the RN Alert is a no-op on web and silently drops the
    // message (audit 2026-10-02 regression). The shim itself is exempt.
    files: ['app/**/*.{ts,tsx}', 'src/**/*.{ts,tsx}'],
    ignores: ['src/lib/alert.tsx'],
    rules: {
      'no-restricted-imports': ['error', {
        paths: [{
          name: 'react-native',
          importNames: ['Alert'],
          message: "Import Alert from '@/src/lib/alert' (the cross-platform shim), not 'react-native'.",
        }],
      }],
    },
  },
]);
