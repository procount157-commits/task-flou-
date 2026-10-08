import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useColorScheme } from 'react-native';

import { Lang, Translations, translations } from '@/lib/i18n';

type LangCtx = { lang: Lang; t: Translations; dir: 'rtl' | 'ltr'; toggleLang: () => void };
const Ctx = createContext<LangCtx>({ lang: 'ar', t: translations.ar, dir: 'rtl', toggleLang: () => {} });
export const useLang = () => useContext(Ctx);

export function LangProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLang] = useState<Lang>('ar');
  useEffect(() => {
    AsyncStorage.getItem('lang').then((v) => (v === 'en' || v === 'ar') && setLang(v));
  }, []);
  const toggleLang = useCallback(() => {
    setLang((l) => {
      const next = l === 'ar' ? 'en' : 'ar';
      AsyncStorage.setItem('lang', next);
      return next;
    });
  }, []);
  const value = useMemo<LangCtx>(() => ({ lang, t: translations[lang], dir: lang === 'ar' ? 'rtl' : 'ltr', toggleLang }), [lang, toggleLang]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

const light = {
  bg: '#f4f5f7', card: '#ffffff', text: '#16181d', muted: '#6b7280', border: '#e2e4e9', primary: '#4f46e5', onPrimary: '#ffffff',
  danger: '#dc2626', success: '#16a34a', warn: '#d97706', soft: '#eef0ff', track: '#e5e7eb',
};
const dark: typeof light = {
  bg: '#0f1115', card: '#1a1d24', text: '#f1f2f4', muted: '#9aa1ad', border: '#2b2f39', primary: '#818cf8', onPrimary: '#0f1115',
  danger: '#f87171', success: '#4ade80', warn: '#fbbf24', soft: '#23263a', track: '#2b2f39',
};
export type Colors = typeof light;
export const PALETTE = ['#4f46e5', '#16a34a', '#d97706', '#dc2626', '#0891b2', '#a855f7', '#ec4899', '#6b7280', '#84cc16', '#f97316', '#14b8a6', '#eab308', '#3b82f6'];

type ThemeCtx = { c: Colors; isDark: boolean; toggleTheme: () => void };
const TCtx = createContext<ThemeCtx>({ c: light, isDark: false, toggleTheme: () => {} });
export const useTheme = () => useContext(TCtx).c;
export const useThemeCtl = () => useContext(TCtx);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const system = useColorScheme();
  const [override, setOverride] = useState<'light' | 'dark' | null>(null);
  useEffect(() => {
    AsyncStorage.getItem('theme').then((v) => (v === 'light' || v === 'dark') && setOverride(v));
  }, []);
  const isDark = (override ?? system) === 'dark';
  const value = useMemo<ThemeCtx>(
    () => ({
      c: isDark ? dark : light,
      isDark,
      toggleTheme: () => {
        const next = isDark ? 'light' : 'dark';
        setOverride(next);
        AsyncStorage.setItem('theme', next);
      },
    }),
    [isDark],
  );
  return <TCtx.Provider value={value}>{children}</TCtx.Provider>;
}
