import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useLang, useTheme } from '@/ctx/Lang';
import { useKV } from '@/lib/db';
import type { Translations } from '@/lib/i18n';
import { Text } from '@/ui/text';

export type NavItem = { key: string; path: string; route: string; icon: keyof typeof Ionicons.glyphMap; label: (t: Translations) => string };

// Every screen that can sit in the bottom bar.
export const NAV_CATALOG: NavItem[] = [
  { key: 'tasks', path: '/', route: 'index', icon: 'checkbox-outline', label: (t) => t.nav.tasks },
  { key: 'day', path: '/day', route: 'day', icon: 'time-outline', label: (t) => t.day.title },
  { key: 'calendar', path: '/calendar', route: 'calendar', icon: 'calendar-outline', label: (t) => t.nav.calendar },
  { key: 'checkin', path: '/checkin', route: 'checkin', icon: 'mic-outline', label: (t) => t.checkin.tab },
  { key: 'ai', path: '/ai-coach', route: 'ai-coach', icon: 'sparkles-outline', label: (t) => t.nav.aiCoach },
  { key: 'plan', path: '/plan', route: 'plan', icon: 'rocket-outline', label: (t) => t.plan.title },
  { key: 'habits', path: '/habits', route: 'habits', icon: 'flame-outline', label: (t) => t.nav.habits },
  { key: 'matrix', path: '/matrix', route: 'matrix', icon: 'grid-outline', label: (t) => t.tasks.matrix },
  { key: 'focus', path: '/pomodoro', route: 'pomodoro', icon: 'timer-outline', label: (t) => t.nav.focus },
  { key: 'goals', path: '/roadmap', route: 'roadmap', icon: 'trophy-outline', label: (t) => t.roadmap.title },
  { key: 'review', path: '/review', route: 'review', icon: 'clipboard-outline', label: (t) => t.review.title },
  { key: 'dashboard', path: '/dashboard', route: 'dashboard', icon: 'home-outline', label: (t) => t.nav.dashboard },
  { key: 'journal', path: '/journal', route: 'journal', icon: 'book-outline', label: (t) => t.nav.journal },
  { key: 'analytics', path: '/analytics', route: 'analytics', icon: 'stats-chart-outline', label: (t) => t.nav.analytics },
  { key: 'progress', path: '/progress', route: 'progress', icon: 'trending-up-outline', label: (t) => t.nav.progress },
  { key: 'finance', path: '/finance', route: 'finance', icon: 'wallet-outline', label: (t) => t.nav.finance },
  { key: 'learning', path: '/learning', route: 'learning', icon: 'school-outline', label: (t) => t.nav.learning },
  { key: 'content', path: '/content', route: 'content', icon: 'phone-portrait-outline', label: (t) => t.nav.content },
  { key: 'brainstorm', path: '/brainstorm', route: 'brainstorm', icon: 'bulb-outline', label: (t) => t.nav.brainstorm },
  { key: 'kolb', path: '/kolb', route: 'kolb', icon: 'sync-outline', label: (t) => t.nav.kolb },
  { key: 'alarm', path: '/alarm', route: 'alarm', icon: 'alarm-outline', label: (t) => t.alarm.title },
  { key: 'lock', path: '/lock', route: 'lock', icon: 'lock-closed-outline', label: (t) => t.lock.title },
  { key: 'motivation', path: '/motivation', route: 'motivation', icon: 'mail-outline', label: (t) => t.nav.motivation },
  { key: 'search', path: '/search', route: 'search', icon: 'search-outline', label: (t) => t.search.title },
  { key: 'settings', path: '/profile-settings', route: 'profile-settings', icon: 'settings-outline', label: (t) => t.nav.settings },
];
export const NAV_DEFAULT = ['tasks', 'day', 'calendar', 'checkin', 'goals', 'ai', 'plan', 'habits', 'matrix', 'focus'];

type BarProps = { state: { index: number; routes: { name: string }[] } };

// The bottom bar: the user's own screens in their own order, scrolling sideways when they do not fit,
// with "More" pinned at the end. Long-press anywhere on it to edit.
export function NavBar({ state }: BarProps) {
  const c = useTheme();
  const { t, dir } = useLang();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [keys] = useKV<string[]>('navbar', NAV_DEFAULT);
  const active = state.routes[state.index]?.name;
  const items = keys.map((k) => NAV_CATALOG.find((x) => x.key === k)).filter((x): x is NavItem => !!x);

  const tab = (key: string, icon: keyof typeof Ionicons.glyphMap, label: string, on: boolean, go: () => void) => (
    <Pressable key={key} onPress={go} onLongPress={() => router.push('/navbar')} accessibilityRole="tab" accessibilityState={{ selected: on }} accessibilityLabel={label}
      style={{ width: 70, alignItems: 'center', paddingTop: 7, paddingBottom: 5, gap: 2 }}>
      <View style={{ paddingHorizontal: 14, paddingVertical: 3, borderRadius: 14, backgroundColor: on ? c.soft : 'transparent' }}>
        <Ionicons name={on ? (icon.replace('-outline', '') as typeof icon) : icon} size={22} color={on ? c.primary : c.muted} />
      </View>
      <Text numberOfLines={1} style={{ fontSize: 10, color: on ? c.primary : c.muted, fontWeight: on ? '700' : '400' }}>{label}</Text>
    </Pressable>
  );

  return (
    <View style={{ flexDirection: 'row', direction: dir, backgroundColor: c.card, borderTopWidth: 1, borderColor: c.border, paddingBottom: insets.bottom }}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flex: 1 }} contentContainerStyle={{ flexGrow: 1, justifyContent: 'space-around' }}>
        {items.map((x) => tab(x.key, x.icon, x.label(t), active === x.route, () => router.navigate(x.path as any)))}
      </ScrollView>
      <View style={{ width: 1, backgroundColor: c.border, marginVertical: 8 }} />
      {tab('more', 'apps-outline', t.nav.more, active === 'more' || active === 'navbar', () => router.navigate('/more'))}
    </View>
  );
}
