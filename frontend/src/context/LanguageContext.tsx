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

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>('es');

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then(val => {
      if (val && (val === 'es' || val === 'en' || val === 'fr' || val === 'pt')) {
        setLangState(val as Lang);
      }
    });
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
