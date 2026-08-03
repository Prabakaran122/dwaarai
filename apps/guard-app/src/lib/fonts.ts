import {
  useFonts,
  DMSans_400Regular,
  DMSans_500Medium,
  DMSans_700Bold,
} from '@expo-google-fonts/dm-sans';
import { NotoSansDevanagari_400Regular } from '@expo-google-fonts/noto-sans-devanagari';
import { NotoSansKannada_400Regular } from '@expo-google-fonts/noto-sans-kannada';

export function useAppFonts(): boolean {
  const [loaded] = useFonts({
    DMSans_400Regular,
    DMSans_500Medium,
    DMSans_700Bold,
    NotoSansDevanagari_400Regular,
    NotoSansKannada_400Regular,
  });
  return loaded;
}
