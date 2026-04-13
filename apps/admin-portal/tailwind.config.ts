import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        surface: {
          DEFAULT: '#f8f9fb',
          hover: '#f0f2f5',
          border: '#e5e7eb',
          active: '#d1d5db',
        },
        glow: {
          blue: '#0d9488',
          purple: '#0d9488',
          pink: '#0d9488',
          cyan: '#0d9488',
        },
        status: {
          success: '#059669',
          'success-bg': 'rgba(5,150,105,0.08)',
          danger: '#dc2626',
          'danger-bg': 'rgba(220,38,38,0.06)',
          warning: '#d97706',
          'warning-bg': 'rgba(217,119,6,0.06)',
          info: '#0d9488',
          'info-bg': 'rgba(13,148,136,0.06)',
        },
        navy: {
          900: '#1a2332',
          800: '#243044',
          700: '#2e3d52',
        },
      },
      backgroundImage: {
        'gradient-radial': 'radial-gradient(var(--tw-gradient-stops))',
        'glow-primary': 'linear-gradient(135deg, #0d9488, #0a7c72)',
        'glow-accent': 'linear-gradient(135deg, #0d9488, #14b8a6)',
        'glow-success': 'linear-gradient(135deg, #059669, #10b981)',
        'glow-danger': 'linear-gradient(135deg, #dc2626, #b91c1c)',
      },
      fontFamily: {
        sans: ['DM Sans', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'monospace'],
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'glow': 'glow 2s ease-in-out infinite alternate',
      },
      keyframes: {
        glow: {
          '0%': { boxShadow: '0 0 5px rgba(13,148,136,0.15)' },
          '100%': { boxShadow: '0 0 15px rgba(13,148,136,0.25)' },
        },
      },
    },
  },
  plugins: [],
};
export default config;
