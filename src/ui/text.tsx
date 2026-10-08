import React from 'react';
import { StyleSheet, Text as RNText, TextProps } from 'react-native';

import { useLang } from '@/ctx/Lang';

// Cairo ships one file per weight, so the weight is chosen by family name rather than by fontWeight.
export const cairo = (weight?: string | number) => {
  const w = weight === 'bold' ? 700 : Number(weight ?? 400);
  return w >= 700 ? 'Cairo_700Bold' : w >= 600 ? 'Cairo_600SemiBold' : 'Cairo_400Regular';
};

// The family for plain text in the current language: Cairo for Arabic, the system font otherwise.
export function useFontFamily(weight?: string | number) {
  const { lang } = useLang();
  return lang === 'ar' ? cairo(weight) : undefined;
}

// Drop-in replacement for React Native's Text that sets Arabic text in Cairo.
export function Text(props: TextProps) {
  const { lang } = useLang();
  if (lang !== 'ar') return <RNText {...props} />;
  const weight = StyleSheet.flatten(props.style)?.fontWeight;
  return <RNText {...props} style={[props.style, { fontFamily: cairo(weight), fontWeight: 'normal' }]} />;
}
