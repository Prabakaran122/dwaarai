import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        /* Dwaar AI — Design_Brief_v1.0_Dwaar_AI.docx §3/§4 is the single source
           of truth. The Brief forbids introducing new primary colours; anything
           not literally in it below is an opacity layer over a Brief colour,
           which is the extension the Brief sanctions.

           Tailwind's `teal` scale is REMAPPED onto Gate Teal rather than adding
           a new scale, because 47 `teal-*` classes across 17 pages already
           exist — remapping realigns every one at once with no half-converted
           pages.

           NOTE the 500/600 split. Gate Teal is 2.33:1 on white: correct for
           fills, dots, active indicators and chart marks, but far below the
           4.5:1 body-text bar. teal-600 — the step carrying nearly all the
           text/icon usage — is therefore Gate Teal @55% over Deep Ocean
           (4.61:1). Use 500 for fills, 600+ for text. */
        teal: {
          50:  '#E0F7F4',   // Gate Teal @12% over white — tints, active nav bg
          100: '#D6F5F1',
          200: '#C7F1EB',
          300: '#66D9C9',
          400: '#26C9B4',
          500: '#00BFA6',   // GATE TEAL — fills, dots, active indicators (2.33:1)
          600: '#0C837D',   // text-safe (4.61:1) — labels, icons, links
          700: '#0E7D79',   // hover (4.97:1)
          800: '#106F6F',
          900: '#0D2535',   // Abyss
        },
        brand: {
          primary: '#1B3A4B',   // Deep Ocean
          ocean:   '#0D2535',   // Abyss
          teal:    '#00BFA6',   // Gate Teal
          mist:    '#E8F4F8',   // Mist
          amber:   '#F59E0B',   // Amber Gate — primary CTAs
          'amber-hover': '#D97706',
        },
        surface: {
          DEFAULT: '#F4F8FA',   // Mist, lightened for a data-dense portal
          hover: '#E8F4F8',     // Mist
          border: 'rgba(27,58,75,0.12)',
          active: 'rgba(27,58,75,0.20)',
        },
        /* Kept so existing `glow-` class names keep resolving. Prefer the
           brand and teal tokens in new code. */
        glow: {
          blue: '#0C837D',
          purple: '#0C837D',
        },
        status: {
          success: '#2ECC71',
          'success-bg': '#EAFAF1',
          'success-text': '#1A7A44',
          danger: '#E84C3D',
          'danger-bg': '#FDEDEC',
          'danger-text': '#922B21',
          warning: '#F6C90E',
          'warning-bg': '#FEFDE7',
          'warning-text': '#7D6608',
          info: '#3498DB',
          'info-bg': '#EBF5FB',
          'info-text': '#1B5276',
        },
        navy: {
          900: '#0D2535',   // Abyss
          800: '#1B3A4B',   // Deep Ocean / text-primary
          700: '#557A8F',   // text-secondary
          600: '#8DAFC0',   // text-tertiary
        },
      },
      backgroundImage: {
        'glow-primary': 'linear-gradient(135deg, #1B3A4B, #00BFA6)',
        'glow-success': 'linear-gradient(135deg, #1A7A44, #2ECC71)',
        'glow-danger': 'linear-gradient(135deg, #E84C3D, #922B21)',
      },
      fontFamily: {
        sans: ['DM Sans', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'monospace'],
      },
    },
  },
  plugins: [],
};
export default config;
