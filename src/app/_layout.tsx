import { DarkTheme, DefaultTheme, ThemeProvider as NavThemeProvider, usePathname, useRouter } from 'expo-router';
import { Drawer } from 'expo-router/drawer';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';

import { AuthProvider, ProfileProvider, useAuth, useProfile } from '@/ctx/Auth';
import { LangProvider, ThemeProvider, useLang, useTheme, useThemeCtl } from '@/ctx/Lang';
import { PomodoroProvider } from '@/ctx/Pomodoro';
import { useEntity } from '@/lib/db';
import { LEVELS } from '@/lib/logic';
import { initNotifications, syncReminders } from '@/lib/notify';
import { IntentionModal, Landing, Login, Onboarding } from '@/screens/Entry';
import { Loading, Txt } from '@/ui/kit';
import { CelebrationProvider } from '@/ui/shared';

SplashScreen.preventAutoHideAsync().catch(() => {});

type Item = { label: string; path: string; icon: string };

function Menu({ close }: { close: () => void }) {
  const c = useTheme();
  const { t, dir, toggleLang } = useLang();
  const { isDark, toggleTheme } = useThemeCtl();
  const { user, logout } = useAuth();
  const router = useRouter();
  const path = usePathname();
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState<Record<string, boolean>>({});

  const main: Item[] = [
    { label: t.nav.home, path: '/', icon: '🏠' }, { label: t.nav.today, path: '/today', icon: '✅' }, { label: t.nav.habits, path: '/habits', icon: '🔥' },
    { label: t.nav.journal, path: '/journal', icon: '📔' }, { label: t.nav.progress, path: '/progress', icon: '📈' }, { label: t.nav.analytics, path: '/analytics', icon: '📊' },
    { label: t.nav.motivation, path: '/motivation', icon: '✉️' }, { label: t.nav.brainstorm, path: '/brainstorm', icon: '💡' }, { label: t.nav.kolb, path: '/kolb', icon: '🔄' },
    { label: t.nav.aiCoach, path: '/ai-coach', icon: '🤖' }, { label: t.nav.pomodoro, path: '/pomodoro', icon: '⏱' }, { label: t.nav.finance, path: '/finance', icon: '💰' },
    { label: t.nav.invite, path: '/invite', icon: '👥' }, { label: t.nav.pricing, path: '/pricing', icon: '💳' },
  ];
  const groups: { key: string; label: string; icon: string; items: Item[] }[] = [
    { key: 'content', label: t.nav.content, icon: '📱', items: [
      { label: t.nav.contentAll, path: '/content', icon: '' }, { label: t.nav.planner, path: '/content?tab=planner', icon: '' },
      { label: t.nav.scripts, path: '/content?tab=scripts', icon: '' }, { label: t.nav.ideas, path: '/content?tab=ideas', icon: '' }, { label: t.nav.links, path: '/content?tab=links', icon: '' },
    ] },
    { key: 'learning', label: t.nav.learning, icon: '🎓', items: [
      { label: t.nav.fields, path: '/learning', icon: '' }, { label: t.nav.inProgress, path: '/learning?filter=in_progress', icon: '' },
      { label: t.nav.completed, path: '/learning?filter=completed', icon: '' }, { label: t.nav.wishlist, path: '/learning?filter=wishlist', icon: '' },
    ] },
  ];

  const go = (p: string) => {
    close();
    router.navigate(p as any);
  };
  const row = (it: Item, indent = false) => {
    const on = path === it.path.split('?')[0] && !it.path.includes('?');
    return (
      <Pressable key={it.path} onPress={() => go(it.path)} accessibilityRole="link"
        style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, paddingHorizontal: 14, paddingStart: indent ? 42 : 14, backgroundColor: on ? c.soft : 'transparent', borderRadius: 8 }}>
        {it.icon ? <Text style={{ fontSize: 16 }}>{it.icon}</Text> : null}
        <Txt style={{ flex: 1, fontWeight: on ? '700' : '400' }}>{it.label}</Txt>
      </Pressable>
    );
  };
  const heading = (label: string) => <Txt v="small" style={{ paddingHorizontal: 14, paddingTop: 14, paddingBottom: 4 }}>{label}</Txt>;

  return (
    <ScrollView style={{ flex: 1, backgroundColor: c.card, direction: dir }} contentContainerStyle={{ paddingTop: insets.top + 8, paddingBottom: insets.bottom + 16, paddingHorizontal: 6 }}>
      <View style={{ padding: 14, gap: 2 }}>
        <Txt v="h">{t.appName}</Txt>
        <Txt v="small">{user?.name} · {user?.role === 'admin' ? t.auth.roleAdmin : t.auth.roleUser}</Txt>
      </View>
      {main.map((it) => row(it))}
      {groups.map((g) => (
        <View key={g.key}>
          <Pressable onPress={() => setOpen((o) => ({ ...o, [g.key]: !o[g.key] }))} accessibilityRole="button" accessibilityState={{ expanded: !!open[g.key] }}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, paddingHorizontal: 14 }}>
            <Text style={{ fontSize: 16 }}>{g.icon}</Text>
            <Txt style={{ flex: 1 }}>{g.label}</Txt>
            <Txt v="muted">{open[g.key] ? '▾' : '▸'}</Txt>
          </Pressable>
          {open[g.key] ? g.items.map((it) => row(it, true)) : null}
        </View>
      ))}
      {heading(t.nav.goalLevels)}
      {LEVELS.map((l) => row({ label: t.level[l], path: `/goals/${l}`, icon: '🎯' }))}
      {heading(t.nav.settings)}
      {row({ label: t.nav.settings, path: '/profile-settings', icon: '⚙️' })}
      <Pressable onPress={toggleLang} accessibilityRole="button" style={{ flexDirection: 'row', gap: 10, paddingVertical: 10, paddingHorizontal: 14 }}>
        <Text style={{ fontSize: 16 }}>🌐</Text><Txt>{t.c.language}</Txt>
      </Pressable>
      <Pressable onPress={toggleTheme} accessibilityRole="button" style={{ flexDirection: 'row', gap: 10, paddingVertical: 10, paddingHorizontal: 14 }}>
        <Text style={{ fontSize: 16 }}>{isDark ? '☀️' : '🌙'}</Text><Txt>{t.c.darkMode}</Txt>
      </Pressable>
      <Pressable onPress={logout} accessibilityRole="button" style={{ flexDirection: 'row', gap: 10, paddingVertical: 10, paddingHorizontal: 14 }}>
        <Text style={{ fontSize: 16 }}>🚪</Text><Txt color={c.danger}>{t.c.logout}</Txt>
      </Pressable>
    </ScrollView>
  );
}

// Keeps habit and high-priority-task reminders in step with the data.
function ReminderSync() {
  const { t } = useLang();
  const habits = useEntity('Habit').items;
  const tasks = useEntity('DailyTask').items;
  useEffect(() => {
    const id = setTimeout(() => syncReminders(habits, tasks, { habit: t.notif.habit, task: t.notif.highTask }), 1500);
    return () => clearTimeout(id);
  }, [habits, tasks, t]);
  return null;
}

function AppDrawer() {
  const c = useTheme();
  const { t, dir } = useLang();
  const rtl = dir === 'rtl';
  const titles: Record<string, string> = {
    index: t.nav.home, today: t.nav.today, habits: t.nav.habits, journal: t.nav.journal, progress: t.nav.progress, analytics: t.nav.analytics,
    motivation: t.nav.motivation, brainstorm: t.nav.brainstorm, kolb: t.nav.kolb, 'ai-coach': t.nav.aiCoach, pomodoro: t.nav.pomodoro, finance: t.nav.finance,
    invite: t.nav.invite, pricing: t.nav.pricing, content: t.nav.content, learning: t.nav.learning, 'goals/[level]': t.nav.goals, 'profile-settings': t.nav.settings,
  };
  return (
    <Drawer
      drawerContent={(p) => <Menu close={() => p.navigation.closeDrawer()} />}
      screenOptions={({ navigation, route }) => {
        const toggle = () => (
          <Pressable onPress={() => navigation.toggleDrawer()} hitSlop={10} accessibilityRole="button" accessibilityLabel="menu" style={{ paddingHorizontal: 16 }}>
            <Text style={{ fontSize: 22, color: c.text }}>☰</Text>
          </Pressable>
        );
        return {
          title: titles[route.name] ?? t.appName,
          drawerPosition: rtl ? 'right' : 'left',
          drawerType: 'front',
          headerTitleAlign: 'center',
          headerStyle: { backgroundColor: c.card },
          headerTintColor: c.text,
          headerLeft: rtl ? () => null : toggle,
          headerRight: rtl ? toggle : undefined,
          sceneStyle: { backgroundColor: c.bg },
        };
      }}
    />
  );
}

function Gate() {
  const c = useTheme();
  const { isDark } = useThemeCtl();
  const { user, isLoadingAuth, showLogin } = useAuth();
  const { loadingProfile, onboardingComplete } = useProfile();
  const loading = isLoadingAuth || (!!user && loadingProfile);

  useEffect(() => {
    if (!loading) SplashScreen.hideAsync().catch(() => {});
  }, [loading]);
  useEffect(() => {
    if (user && onboardingComplete) initNotifications();
  }, [user, onboardingComplete]);

  let body: React.ReactNode;
  if (loading) body = <View style={{ flex: 1, justifyContent: 'center', backgroundColor: c.bg }}><Loading /></View>;
  else if (!user) body = showLogin ? <Login /> : <Landing />;
  else if (!onboardingComplete) body = <Onboarding />;
  else
    body = (
      // the navigator stays in physical layout (it positions the drawer itself); each screen sets its own reading direction
      <View style={{ flex: 1 }}>
        <AppDrawer />
        <IntentionModal />
        <ReminderSync />
      </View>
    );

  const nav = isDark ? DarkTheme : DefaultTheme;
  return (
    <NavThemeProvider value={{ ...nav, colors: { ...nav.colors, background: c.bg, card: c.card, text: c.text, border: c.border, primary: c.primary } }}>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <CelebrationProvider>{body}</CelebrationProvider>
    </NavThemeProvider>
  );
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <LangProvider>
          <ThemeProvider>
            <AuthProvider>
              <ProfileProvider>
                <PomodoroProvider>
                  <Gate />
                </PomodoroProvider>
              </ProfileProvider>
            </AuthProvider>
          </ThemeProvider>
        </LangProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
