import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Lang, translate } from '../i18n/translations';

const STORAGE_KEY = 'sarthi_valet_lang';

/**
 * Language is stored on the device only.
 *
 * The guard app writes a valet's choice back to the server because a guard has
 * a profile there to hold it; Sarthi has no per-valet preference endpoint, and
 * inventing one to hold a UI toggle would be more surface than it is worth. A
 * valet who switches devices re-picks a language once.
 */
interface LangState {
  lang: Lang;
  rehydrate: () => Promise<void>;
  setLang: (lang: Lang) => void;
}

function isLang(v: unknown): v is Lang {
  return v === 'en' || v === 'hi' || v === 'kn';
}

export const useLangStore = create<LangState>((set) => ({
  lang: 'en',

  rehydrate: async () => {
    try {
      const saved = await AsyncStorage.getItem(STORAGE_KEY);
      if (isLang(saved)) set({ lang: saved });
    } catch {
      /* first run, or unreadable storage — English is the default */
    }
  },

  setLang: (lang) => {
    set({ lang });
    AsyncStorage.setItem(STORAGE_KEY, lang).catch(() => {});
  },
}));

export function useT() {
  const lang = useLangStore((s) => s.lang);
  return (key: string) => translate(key, lang);
}
