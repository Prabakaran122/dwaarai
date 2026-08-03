import { TextStyle } from 'react-native';
import { colors } from './colors';

export type FontWeight = 400 | 500 | 700;

const FAMILY: Record<FontWeight, string> = {
  400: 'DMSans_400Regular',
  500: 'DMSans_500Medium',
  700: 'DMSans_700Bold',
};

export function font(weight: FontWeight = 400): { fontFamily: string } {
  return { fontFamily: FAMILY[weight] };
}

export const type = {
  h1: { ...font(700), fontSize: 20, color: colors.textPrimary },
  h2: { ...font(700), fontSize: 18, color: colors.textPrimary },
  h3: { ...font(500), fontSize: 15, color: colors.textPrimary },
  body: { ...font(400), fontSize: 14, color: colors.textPrimary },
  bodySecondary: { ...font(400), fontSize: 13, color: colors.textSecondary },
  caption: { ...font(500), fontSize: 11, color: colors.textSecondary },
  micro: { ...font(400), fontSize: 10, color: colors.textTertiary },
} satisfies Record<string, TextStyle>;
