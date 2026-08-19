import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
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
// Spanish — instead of everyone defaulting to Spanish. navigator.language
// already encodes exactly this (es-CO, en-US, pt-BR, fr-FR). A manual pick still
// wins (restored from storage in the effect below) and persists. Any other
// language on a tourism app → English, the international default (not Spanish).
function detectDeviceLang(): Lang {
  try {
    if (typeof navigator !== 'undefined') {
      const nav = (
        (Array.isArray((navigator as any).languages) && (navigator as any).languages[0]) ||
        navigator.language || ''
      ).toLowerCase();
      if (nav.startsWith('es')) return 'es';
      if (nav.startsWith('en')) return 'en';
      if (nav.startsWith('fr')) return 'fr';
      if (nav.startsWith('pt')) return 'pt';
      if (nav) return 'en';
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
