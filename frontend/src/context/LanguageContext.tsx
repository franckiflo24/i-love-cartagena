import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Localization from 'expo-localization';
import { Lang, t, LANG_LABELS, LANG_FLAGS } from '../i18n/translations';

type LangContextType = {
  lang: Lang;
  setLang: (l: Lang) => void;
  s: (key: string, params?: Record<string, string | number>) => string;
};

const LangContext = createContext<LangContextType>({
  lang: 'es',
  setLang: () => {},
  s: (key: string) => key,
});

export const useLang = () => useContext(LangContext);

const STORAGE_KEY = '@musica_lang';

// First-run language = the visitor's DEVICE language, so a tourist from the US
// lands in English, Brazil in Portuguese, France in French — and locals in
// Spanish — instead of everyone defaulting to Spanish. A manual pick still wins
// (restored from storage in the effect below) and persists. Any other language
// on a tourism app → English, the international default (not Spanish).
//
// expo-localization is the authoritative source on NATIVE (iOS/Android), where
// `navigator.language` is undefined — the old navigator-only path silently fell
// through to 'es', forcing Spanish on every native tourist AND leaving the app
// UI in a different language than the iOS permission prompts (Apple 4.0
// rejection: "permissions requests not written in the same language as the app's
// localization"). navigator stays as the web fallback.
function normalizeLang(code: string): Lang | null {
  const c = code.toLowerCase();
  if (c.startsWith('es')) return 'es';
  if (c.startsWith('en')) return 'en';
  if (c.startsWith('fr')) return 'fr';
  if (c.startsWith('pt')) return 'pt';
  return c ? 'en' : null;
}

function detectDeviceLang(): Lang {
  try {
    const code = Localization.getLocales?.()[0]?.languageTag
      || Localization.getLocales?.()[0]?.languageCode
      || '';
    const fromDevice = normalizeLang(code);
    if (fromDevice) return fromDevice;
  } catch {}
  try {
    if (typeof navigator !== 'undefined') {
      const nav = (
        (Array.isArray((navigator as any).languages) && (navigator as any).languages[0]) ||
        navigator.language || ''
      );
      const fromNav = normalizeLang(nav);
      if (fromNav) return fromNav;
    }
  } catch {}
  return 'es';
}

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>(detectDeviceLang);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then(val => {
      if (val && (val === 'es' || val === 'en' || val === 'fr' || val === 'pt')) {
        setLangState(val as Lang);
      }
    }).catch(() => {});
  }, []);

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    AsyncStorage.setItem(STORAGE_KEY, l);
  }, []);

  const s = useCallback((key: string, params?: Record<string, string | number>) => {
    let str = t[lang]?.[key] || t['es']?.[key] || key;
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        str = str.replace(`{${k}}`, String(v));
      }
    }
    return str;
  }, [lang]);

  return (
    <LangContext.Provider value={{ lang, setLang, s }}>
      {children}
    </LangContext.Provider>
  );
}
