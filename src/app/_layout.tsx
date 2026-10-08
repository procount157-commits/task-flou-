import { Ionicons } from '@expo/vector-icons';
import { DarkTheme, DefaultTheme, ThemeProvider as NavThemeProvider, useRouter } from 'expo-router';
import { Tabs } from 'expo-router/js-tabs';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect } from 'react';
import { Pressable, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AuthProvider, ProfileProvider, useAuth, useProfile } from '@/ctx/Auth';
import { LangProvider, ThemeProvider, useLang, useTheme, useThemeCtl } from '@/ctx/Lang';
import { PomodoroProvider } from '@/ctx/Pomodoro';
import { useEntity, useKV } from '@/lib/db';
import { CHECKIN_DEFAULTS, CheckinSettings, initNotifications, onNotificationOpen, scheduleAlarms, scheduleCheckins, syncReminders } from '@/lib/notify';
import type { Alarm } from '@/lib/types';
import { IntentionModal, Landing, Login, Onboarding } from '@/screens/Entry';
import { Loading } from '@/ui/kit';
import { CelebrationProvider } from '@/ui/shared';

SplashScreen.preventAutoHideAsync().catch(() => {});
const NO_ALARMS: Alarm[] = [];

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

const TABS: { name: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { name: 'index', icon: 'checkbox-outline' },
  { name: 'calendar', icon: 'calendar-outline' },
  { name: 'checkin', icon: 'mic-outline' },
  { name: 'ai-coach', icon: 'sparkles-outline' },
  { name: 'pomodoro', icon: 'timer-outline' },
  { name: 'more', icon: 'apps-outline' },
];
const HIDDEN = ['dashboard', 'today', 'matrix', 'habits', 'alarm', 'lock', 'journal', 'progress', 'analytics', 'motivation', 'brainstorm', 'kolb', 'finance', 'invite', 'pricing', 'content', 'learning', 'goals/[level]', 'profile-settings', 'join', 'explore'];

function AppTabs() {
  const c = useTheme();
  const { t, dir } = useLang();
  const router = useRouter();
  const rtl = dir === 'rtl';
  const titles: Record<string, string> = {
    index: t.nav.tasks, calendar: t.nav.calendar, 'ai-coach': t.nav.aiCoach, pomodoro: t.nav.focus, habits: t.nav.habits, more: t.nav.more,
    dashboard: t.nav.dashboard, matrix: t.tasks.matrix, checkin: t.checkin.tab, alarm: t.alarm.title, lock: t.lock.title, journal: t.nav.journal, progress: t.nav.progress,
    analytics: t.nav.analytics, motivation: t.nav.motivation, brainstorm: t.nav.brainstorm, kolb: t.nav.kolb, finance: t.nav.finance, invite: t.nav.invite,
    pricing: t.nav.pricing, content: t.nav.content, learning: t.nav.learning, 'goals/[level]': t.nav.goals, 'profile-settings': t.nav.settings,
  };
  const back = () => (
    <Pressable onPress={() => (router.canGoBack() ? router.back() : router.navigate('/more'))} hitSlop={10} accessibilityRole="button" accessibilityLabel={t.c.back} style={{ paddingHorizontal: 16 }}>
      <Ionicons name={rtl ? 'chevron-forward' : 'chevron-back'} size={24} color={c.text} />
    </Pressable>
  );
  return (
    <Tabs
      screenOptions={({ route }) => {
        const inner = HIDDEN.includes(route.name);
        return {
          title: titles[route.name] ?? t.appName,
          headerTitleAlign: 'center',
          headerStyle: { backgroundColor: c.card },
          headerTintColor: c.text,
          headerShadowVisible: false,
          // the header is physical, so the back arrow moves to the reading-start side by hand
          headerLeft: inner && !rtl ? back : () => null,
          headerRight: inner && rtl ? back : undefined,
          tabBarActiveTintColor: c.primary,
          tabBarInactiveTintColor: c.muted,
          tabBarStyle: { backgroundColor: c.card, borderTopColor: c.border, direction: dir },
          tabBarLabelStyle: { fontSize: 10 },
          sceneStyle: { backgroundColor: c.bg },
          // screens that are not on show stop re-rendering when data changes
          freezeOnBlur: true,
        };
      }}>
      {TABS.map((tab) => (
        <Tabs.Screen key={tab.name} name={tab.name} options={{ headerShown: tab.name !== 'index', tabBarIcon: ({ color, size }) => <Ionicons name={tab.icon} size={size} color={color} /> }} />
      ))}
      {HIDDEN.map((name) => <Tabs.Screen key={name} name={name} options={{ href: null }} />)}
    </Tabs>
  );
}

// Re-books check-ins and alarms when the app opens, and follows a tapped notification to its screen.
function Background() {
  const { t } = useLang();
  const router = useRouter();
  const [alarms] = useKV<Alarm[]>('alarms', NO_ALARMS);
  const [checkin] = useKV<CheckinSettings>('checkin', CHECKIN_DEFAULTS);
  useEffect(() => onNotificationOpen((url) => router.navigate(url as any)), [router]);
  useEffect(() => {
    const id = setTimeout(() => {
      scheduleAlarms(alarms, t.alarm.ringing);
      scheduleCheckins(checkin, t.checkin.now, t.checkin.bank);
    }, 3000);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alarms.length, checkin.enabled]);
  return null;
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
        <AppTabs />
        <Background />
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
