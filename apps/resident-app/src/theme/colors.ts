// Dwaar AI light palette — Brief §3. Resident app = light mode.
const palette = {
  // Brand
  brandPrimary: '#1B3A4B',
  oceanDark: '#0D2535',
  teal: '#00BFA6',
  mist: '#E8F4F8',
  // Action
  actionPrimary: '#F59E0B',
  actionHover: '#D97706',
  // Status signal
  success: '#2ECC71',
  error: '#E84C3D',
  warning: '#F6C90E',
  info: '#3498DB',
  // Status tint backgrounds
  tintSuccess: '#EAFAF1',
  tintError: '#FDEDEC',
  tintWarning: '#FEFDE7',
  tintInfo: '#EBF5FB',
  // Status on-tint text
  textSuccess: '#1A7A44',
  textError: '#922B21',
  textWarning: '#7D6608',
  textInfo: '#1B5276',
  // Typography
  textPrimary: '#1B3A4B',
  textSecondary: '#557A8F',
  textTertiary: '#8DAFC0',
  textInverse: '#FFFFFF',
  // Surfaces
  surface: '#FFFFFF',
  surfaceBorder: 'rgba(27,58,75,0.15)',
  overlayLight: 'rgba(255,255,255,0.15)',
  inputBorder: 'rgba(27,58,75,0.20)',
  notifBadge: '#E84C3D',
  white: '#FFFFFF',
  transparent: 'transparent',
} as const;

// Back-compat aliases for dark-era screens (removed as each screen is rebuilt).
export const colors = {
  ...palette,
  bgPrimary: palette.mist,
  bgSecondary: palette.mist,
  surfaceHover: palette.mist,
  textMuted: palette.textTertiary,
  danger: palette.error,
  dangerBg: palette.tintError,
  dangerBorder: palette.tintError,
  successBg: palette.tintSuccess,
  successBorder: palette.tintSuccess,
  warningBg: palette.tintWarning,
  warningBorder: palette.tintWarning,
  infoBg: palette.tintInfo,
  gradientBg: [palette.mist, palette.mist] as const,
  gradientPrimary: [palette.brandPrimary, palette.brandPrimary] as const,
  gradientAccent: [palette.actionPrimary, palette.actionPrimary] as const,
  gradientSuccess: [palette.success, palette.success] as const,
  gradientDanger: [palette.error, palette.error] as const,
  gradientWarning: [palette.warning, palette.warning] as const,
} as const;
