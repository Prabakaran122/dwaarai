import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: { extend: { colors: { primary: '#1e40af', accent: '#f59e0b' } } },
  plugins: [],
};
export default config;
