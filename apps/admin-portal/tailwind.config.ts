import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        surface: {
          DEFAULT: 'rgba(255,255,255,0.04)',
          hover: 'rgba(255,255,255,0.08)',
          border: 'rgba(255,255,255,0.06)',
          active: 'rgba(255,255,255,0.12)',
        },
        glow: {
          blue: '#3b82f6',
          purple: '#8b5cf6',
          pink: '#ec4899',
          cyan: '#06b6d4',
        },
        status: {
          success: '#34d399',
          'success-bg': 'rgba(34,197,94,0.15)',
          danger: '#f87171',
          'danger-bg': 'rgba(239,68,68,0.15)',
          warning: '#fbbf24',
          'warning-bg': 'rgba(251,191,36,0.15)',
          info: '#818cf8',
          'info-bg': 'rgba(99,102,241,0.15)',
        },
        navy: {
          900: '#0c1222',
          800: '#111827',
          700: '#1a1145',
        },
      },
      backgroundImage: {
        'gradient-radial': 'radial-gradient(var(--tw-gradient-stops))',
        'glow-primary': 'linear-gradient(135deg, #3b82f6, #8b5cf6)',
        'glow-accent': 'linear-gradient(135deg, #a855f7, #ec4899)',
        'glow-success': 'linear-gradient(135deg, #22c55e, #10b981)',
        'glow-danger': 'linear-gradient(135deg, #ef4444, #dc2626)',
      },
      fontFamily: {
        mono: ['JetBrains Mono', 'ui-monospace', 'monospace'],
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'glow': 'glow 2s ease-in-out infinite alternate',
      },
      keyframes: {
        glow: {
          '0%': { boxShadow: '0 0 5px rgba(99,102,241,0.2)' },
          '100%': { boxShadow: '0 0 20px rgba(99,102,241,0.4)' },
        },
      },
    },
  },
  plugins: [],
};
export default config;
