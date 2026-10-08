import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Pressable, View } from 'react-native';

import { useLang, useTheme } from '@/ctx/Lang';
import { useKV } from '@/lib/db';
import { Btn, Check, Screen, Section, Txt } from '@/ui/kit';
import { NAV_CATALOG, NAV_DEFAULT } from '@/ui/NavBar';

// Choose which screens sit in the bottom bar and in what order.
export default function NavEdit() {
  const c = useTheme();
  const { t } = useLang();
  const [keys, setKeys] = useKV<string[]>('navbar', NAV_DEFAULT);
  const chosen = keys.filter((k) => NAV_CATALOG.some((x) => x.key === k));
  const rest = NAV_CATALOG.filter((x) => !chosen.includes(x.key));

  const move = (i: number, by: number) => {
    const j = i + by;
    if (j < 0 || j >= chosen.length) return;
    const next = [...chosen];
    [next[i], next[j]] = [next[j], next[i]];
    setKeys(next);
  };
  const arrow = (name: keyof typeof Ionicons.glyphMap, onPress: () => void, disabled: boolean) => (
    <Pressable onPress={onPress} disabled={disabled} hitSlop={6} accessibilityRole="button" style={{ padding: 6, opacity: disabled ? 0.25 : 1 }}>
      <Ionicons name={name} size={20} color={c.primary} />
    </Pressable>
  );
  const row = (key: string, on: boolean, extra?: React.ReactNode) => {
    const item = NAV_CATALOG.find((x) => x.key === key)!;
    return (
      <View key={key} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: c.card, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8 }}>
        <Check on={on} onPress={() => setKeys(on ? chosen.filter((k) => k !== key) : [...chosen, key])} />
        <Ionicons name={item.icon} size={21} color={on ? c.primary : c.muted} />
        <Txt style={{ flex: 1 }}>{item.label(t)}</Txt>
        {extra}
      </View>
    );
  };

  return (
    <Screen>
      <Txt v="small">{t.navbar.hint}</Txt>
      <Section title={`${t.navbar.inBar} (${chosen.length})`}>
        {chosen.map((k, i) => row(k, true, <>{arrow('arrow-up', () => move(i, -1), i === 0)}{arrow('arrow-down', () => move(i, 1), i === chosen.length - 1)}</>))}
      </Section>
      <Section title={t.navbar.available}>
        {rest.length ? rest.map((x) => row(x.key, false)) : <Txt v="muted">{t.navbar.allIn}</Txt>}
      </Section>
      <Btn kind="ghost" title={t.navbar.reset} onPress={() => setKeys(NAV_DEFAULT)} />
    </Screen>
  );
}
