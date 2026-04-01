// apps/guard-app/src/theme/colors.ts

export const colors = {
  // Backgrounds
  bgPrimary: '#0c1222',
  bgAlt: '#1a1145',
  surface: 'rgba(255,255,255,0.04)',
  surfaceBorder: 'rgba(255,255,255,0.06)',
  surfaceHover: 'rgba(255,255,255,0.08)',

  // Gradients (arrays for LinearGradient)
  gradientPrimary: ['#3b82f6', '#8b5cf6'] as const,
  gradientAccent: ['#a855f7', '#ec4899'] as const,
  gradientSuccess: ['#22c55e', '#10b981'] as const,
  gradientDanger: ['#ef4444', '#dc2626'] as const,
  gradientWarning: ['#f59e0b', '#eab308'] as const,
  gradientBg: ['#0c1222', '#1a1145'] as const,

  // Status
  success: '#34d399',
  successBg: 'rgba(34,197,94,0.2)',
  successBorder: 'rgba(34,197,94,0.15)',
  danger: '#f87171',
  dangerBg: 'rgba(239,68,68,0.2)',
  dangerBorder: 'rgba(239,68,68,0.15)',
  warning: '#fbbf24',
  warningBg: 'rgba(251,191,36,0.2)',
  warningBorder: 'rgba(251,191,36,0.15)',
  info: '#818cf8',
  infoBg: 'rgba(99,102,241,0.2)',

  // Text
  textPrimary: '#e2e8f0',
  textSecondary: '#6366f1',
  textMuted: '#475569',

  // Misc
  white: '#ffffff',
  transparent: 'transparent',
} as const;
