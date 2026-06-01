import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Lang, translate } from '../i18n/translations';
import { setGuardLanguage } from '../api/client';

const STORAGE_KEY = 'communitygate_guard_lang';

interface LangState {
  lang: Lang;
  rehydrate: () => Promise<void>;
  // Apply a language from the server on login (no server write-back).
  applyFromServer: (lang?: string) => void;
  // User switched language: update UI, persist locally, sync to server.
  setLang: (lang: Lang) => void;
}

function isLang(v: any): v is Lang {
  return v === 'en' || v === 'hi' || v === 'kn';
}

export const useLangStore = create<LangState>((set, get) => ({
  lang: 'en',
  rehydrate: async () => {
    try {
      const saved = await AsyncStorage.getItem(STORAGE_KEY);
      if (isLang(saved)) set({ lang: saved });
    } catch { /* keep default */ }
  },
  applyFromServer: (lang) => {
    if (isLang(lang)) {
      set({ lang });
      AsyncStorage.setItem(STORAGE_KEY, lang).catch(() => {});
    }
  },
  setLang: (lang) => {
    if (get().lang === lang) return;
    set({ lang });
    AsyncStorage.setItem(STORAGE_KEY, lang).catch(() => {});
    // Sync to server; offline is fine — the local store is the source of truth.
    setGuardLanguage(lang).catch(() => {});
  },
}));

// Hook returning a translator bound to the current language. Components that call
// this re-render automatically when the language changes.
export function useT() {
  const lang = useLangStore((s) => s.lang);
  return (key: string) => translate(key, lang);
}
