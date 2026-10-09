import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React from 'react';
import { Pressable, View } from 'react-native';

import { useAuth } from '@/ctx/Auth';
import { useLang, useTheme, useThemeCtl } from '@/ctx/Lang';
import { LEVELS } from '@/lib/logic';
import { Chips, Screen, Section, Txt } from '@/ui/kit';

type Tile = { label: string; path: string; icon: keyof typeof Ionicons.glyphMap };

export default function More() {
  const c = useTheme();
  const { t, toggleLang } = useLang();
  const { isDark, toggleTheme } = useThemeCtl();
  const { logout } = useAuth();
  const router = useRouter();
  const groups: { title: string; tiles: Tile[] }[] = [
    { title: t.nav.tasks, tiles: [
      { label: t.plan.title, path: '/plan', icon: 'sparkles-outline' },
      { label: t.roadmap.title, path: '/roadmap', icon: 'trophy-outline' },
      { label: t.review.title, path: '/review', icon: 'clipboard-outline' },
      { label: t.day.title, path: '/day', icon: 'time-outline' },
      { label: t.search.title, path: '/search', icon: 'search-outline' },
      { label: t.nav.dashboard, path: '/dashboard', icon: 'home-outline' }, { label: t.tasks.matrix, path: '/matrix', icon: 'grid-outline' },
      { label: t.nav.habits, path: '/habits', icon: 'flame-outline' }, { label: t.alarm.title, path: '/alarm', icon: 'alarm-outline' },
      { label: t.lock.title, path: '/lock', icon: 'lock-closed-outline' },
      { label: t.diag.title, path: '/check', icon: 'pulse-outline' },
    ] },
    { title: t.nav.progress, tiles: [
      { label: t.nav.journal, path: '/journal', icon: 'book-outline' }, { label: t.nav.analytics, path: '/analytics', icon: 'stats-chart-outline' },
      { label: t.nav.progress, path: '/progress', icon: 'trending-up-outline' }, { label: t.nav.kolb, path: '/kolb', icon: 'sync-outline' },
    ] },
    { title: t.nav.content, tiles: [
      { label: t.nav.finance, path: '/finance', icon: 'wallet-outline' }, { label: t.nav.learning, path: '/learning', icon: 'school-outline' },
      { label: t.nav.content, path: '/content', icon: 'phone-portrait-outline' }, { label: t.nav.brainstorm, path: '/brainstorm', icon: 'bulb-outline' },
    ] },
    { title: t.nav.settings, tiles: [
      { label: t.navbar.title, path: '/navbar', icon: 'options-outline' },
      { label: t.nav.motivation, path: '/motivation', icon: 'mail-outline' }, { label: t.nav.invite, path: '/invite', icon: 'people-outline' },
      { label: t.nav.pricing, path: '/pricing', icon: 'card-outline' }, { label: t.nav.settings, path: '/profile-settings', icon: 'settings-outline' },
    ] },
  ];
  const tile = (x: { label: string; icon: keyof typeof Ionicons.glyphMap; onPress: () => void; color?: string }) => (
    <Pressable key={x.label} onPress={x.onPress} accessibilityRole="button" style={{ width: '25%', alignItems: 'center', gap: 6, paddingVertical: 12 }}>
      <View style={{ width: 46, height: 46, borderRadius: 14, backgroundColor: c.soft, alignItems: 'center', justifyContent: 'center' }}>
        <Ionicons name={x.icon} size={23} color={x.color ?? c.primary} />
      </View>
      <Txt v="small" center color={c.text} numberOfLines={2}>{x.label}</Txt>
    </Pressable>
  );
  return (
    <Screen>
      {groups.map((g) => (
        <View key={g.title} style={{ backgroundColor: c.card, borderRadius: 14, flexDirection: 'row', flexWrap: 'wrap', paddingVertical: 4 }}>
          {g.tiles.map((x) => tile({ ...x, onPress: () => router.push(x.path as any) }))}
        </View>
      ))}
      <Section title={`🎯 ${t.nav.goalLevels}`}>
        <Chips options={LEVELS.map((l) => ({ value: l, label: t.level[l] }))} value={null} onChange={(l) => router.push(`/goals/${l}` as any)} />
      </Section>
      <View style={{ backgroundColor: c.card, borderRadius: 14, flexDirection: 'row', flexWrap: 'wrap', paddingVertical: 4 }}>
        {tile({ label: t.c.language, icon: 'language-outline', onPress: toggleLang })}
        {tile({ label: t.c.darkMode, icon: isDark ? 'sunny-outline' : 'moon-outline', onPress: toggleTheme })}
        {tile({ label: t.c.logout, icon: 'log-out-outline', onPress: logout, color: c.danger })}
      </View>
    </Screen>
  );
}
