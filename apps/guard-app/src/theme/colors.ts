// apps/guard-app/src/theme/colors.ts
//
// Nazar dark palette — BRD §3 ("Night Mode is the ONLY mode for Nazar").
// See docs/superpowers/specs/2026-08-03-nazar-foundation-design.md §2.

const palette = {
  // Brand
  bgPrimary: '#0D2535',   // Deep Ocean Dark — main screen background
  surface: '#1B3A4B',     // Deep Ocean — navigation headers, bottom nav
  card: '#1E3A4F',        // Card background
  elevated: '#243F55',    // Input fields, elevated cards
  actionPrimary: '#F59E0B', // Amber Gate — CTA buttons, primary actions

  // Verification-layer accents
  teal: '#00BFA6',   // Gate Teal — verified / FASTag layer
  amber: '#F59E0B',  // ANPR layer / caution — same value as actionPrimary by design
  purple: '#A78BFA', // Face recognition layer
  green: '#34D399',  // AI anomaly / smart features

  danger: '#F87171', // Denied entry, emergency, alerts
  border: '#2A4A5E', // All card / field borders

  textPrimary: '#F0F4F8',
  textSecondary: '#8BAABB',
  textTertiary: '#5A7A8A',

  white: '#ffffff',
  transparent: 'transparent',
} as const;

// Back-compat aliases still used by several restyled-but-reused primitives
// (e.g. SosBanner, PlateText). New components should use the palette keys
// above directly.
export const colors = {
  ...palette,
  bgAlt: palette.bgPrimary,
  surfaceBorder: palette.border,
  surfaceHover: palette.elevated,
  textMuted: palette.textTertiary,

  success: palette.teal,
  successBg: 'rgba(0,191,166,0.15)',
  successBorder: 'rgba(0,191,166,0.15)',
  warning: palette.amber,
  warningBg: 'rgba(245,158,11,0.15)',
  warningBorder: 'rgba(245,158,11,0.15)',
  dangerBg: 'rgba(248,113,113,0.15)',
  dangerBorder: 'rgba(248,113,113,0.15)',
  info: palette.purple,
  infoBg: 'rgba(167,139,250,0.15)',

  // Flat 2-stop "gradients" (Nazar's flat dark cards have no gradients) so
  // existing LinearGradient call sites keep compiling unchanged.
  gradientBg: [palette.bgPrimary, palette.bgPrimary] as const,
  gradientPrimary: [palette.actionPrimary, palette.actionPrimary] as const,
  gradientAccent: [palette.purple, palette.purple] as const,
  gradientSuccess: [palette.teal, palette.teal] as const,
  gradientDanger: [palette.danger, palette.danger] as const,
  gradientWarning: [palette.amber, palette.amber] as const,
} as const;
