import Constants from 'expo-constants';
import * as Linking from 'expo-linking';
import React, { useCallback, useEffect, useState } from 'react';
import { AppState, Share, View } from 'react-native';

import { useLang, useTheme } from '@/ctx/Lang';
import { listWritableCalendars } from '@/lib/devicecal';
import { LoggedError, clearErrors, getErrors } from '@/lib/errlog';
import { InvokeLLM, aiRoutes, getAI } from '@/lib/integrations';
import { NotifyReport, initNotifications, notifyReport, testNotification } from '@/lib/notify';
import { hourlyCard } from '@/lib/logic';
import { hourlyCardAvailable, isLockAdmin, lockAvailable, setHourlyCard, showHourlyCard } from '@/lib/phonelock';
import { useEntity } from '@/lib/db';
import { Btn, Card, Row, Screen, Section, Txt, notice } from '@/ui/kit';

// A self-test: what the phone grants the app, what is booked, and what failed, in plain words.
export default function Check() {
  const c = useTheme();
  const { t } = useLang();
  const [n, setN] = useState<NotifyReport | null>(null);
  const [calendars, setCalendars] = useState<number | null>(null);
  const [hasKey, setHasKey] = useState(false);
  const [aiState, setAiState] = useState('');
  const [errors, setErrors] = useState<LoggedError[]>([]);
  const [admin, setAdmin] = useState(false);
  const goals = useEntity('Goal').items;

  const refresh = useCallback(async () => {
    setN(await notifyReport());
    setAdmin(isLockAdmin());
    const ai = await getAI();
    setHasKey(!!ai.apiKey || !!ai.fallbackKey);
    setErrors([...(await getErrors())]);
  }, []);

  useEffect(() => {
    refresh();
    const sub = AppState.addEventListener('change', (s) => s === 'active' && refresh());
    return () => sub.remove();
  }, [refresh]);

  const line = (ok: boolean, label: string, detail: string) => (
    <Row style={{ alignItems: 'flex-start' }}>
      <Txt>{ok ? '✅' : '❌'}</Txt>
      <View style={{ flex: 1 }}>
        <Txt style={{ fontWeight: '600' }}>{label}</Txt>
        <Txt v="small" color={ok ? c.muted : c.danger}>{detail}</Txt>
      </View>
    </Row>
  );
  const test = async (seconds: number, siren?: 'ambulance') => {
    const ok = await testNotification(t.checkin.now, t.checkin.bank[0], seconds, siren);
    notice(ok ? t.diag.sent : t.diag.failed);
    refresh();
  };
  const testAI = async () => {
    setAiState('…');
    const started = Date.now();
    try {
      await InvokeLLM('Reply with the single word OK.', 0);
      setAiState(`${t.diag.aiOk} (${Date.now() - started} ms)`);
    } catch (e) {
      setAiState(String((e as Error).message).slice(0, 160));
    }
  };
  const report = () =>
    [
      `Hayati ${Constants.expoConfig?.version ?? ''} · ${new Date().toISOString()}`,
      `notifications: granted=${n?.granted} canAsk=${n?.canAskAgain} scheduled=${n?.scheduled} hourly=${n?.checkins} alarms=${n?.alarms} reminders=${n?.reminders}`,
      `lock: module=${lockAvailable} admin=${admin}`,
      `calendars: ${calendars ?? 'not checked'} · ai key: ${hasKey} ${aiState}`,
      ...errors.map((e) => `${e.at} [${e.where}] ${e.message}`),
    ].join('\n');

  return (
    <Screen>
      <Txt v="muted">{t.diag.intro}</Txt>

      <Card>
        {line(!!n?.granted, t.diag.notif, n?.granted ? t.diag.granted : t.diag.denied)}
        {!n?.granted ? <Btn title={t.diag.allow} onPress={async () => { if (!(await initNotifications())) Linking.openSettings(); refresh(); }} /> : null}
        {line(!!n && n.checkins > 0, t.diag.booked, n?.scheduled ? `${t.diag.hourly}: ${n.checkins} · ${t.diag.alarms}: ${n.alarms} · ${t.diag.reminders}: ${n.reminders}` : t.diag.noneBooked)}
        <Txt v="small" color={c.warn}>⚠️ {t.diag.battery}</Txt>
        <Btn kind="ghost" title={`⚙️ ${t.diag.settings}`} onPress={() => Linking.openSettings()} />
      </Card>

      <Section title={t.diag.steps}>
        <Card>
          <Btn title={t.diag.testNow} onPress={() => test(0)} />
          <Btn kind="ghost" title={t.diag.test15} onPress={() => test(15)} />
          <Btn kind="ghost" title={`🚑 ${t.diag.testSiren}`} onPress={() => test(15, 'ambulance')} />
          {hourlyCardAvailable ? <Btn title={t.diag.testCard} onPress={async () => { await initNotifications(); setHourlyCard(true, 0, 23, { ...hourlyCard(t, goals), ai: await aiRoutes() }); notice(showHourlyCard() ? t.diag.sent : t.diag.failed); }} /> : null}
        </Card>
      </Section>

      <Card>
        {line(lockAvailable && admin, t.diag.lock, !lockAvailable ? t.diag.lockMissing : admin ? t.diag.lockReady : t.diag.lockNoAdmin)}
        {line(!!calendars, t.diag.calendar, calendars ? `${calendars} ${t.diag.calOk}` : t.diag.calNone)}
        <Btn small kind="ghost" title={t.cal.load} onPress={async () => setCalendars((await listWritableCalendars().catch(() => [])).length)} />
        {line(hasKey, t.diag.ai, hasKey ? aiState || '—' : t.diag.aiNoKey)}
        <Btn small kind="ghost" title={t.diag.aiTest} onPress={testAI} />
      </Card>

      <Section title={t.diag.errors} right={errors.length ? <Btn small kind="ghost" title={t.diag.clear} onPress={async () => { await clearErrors(); refresh(); }} /> : undefined}>
        <Card>
          {!errors.length ? <Txt v="muted">{t.diag.noErrors}</Txt> : errors.map((e, i) => (
            <View key={i}>
              <Txt v="small">{e.at} · {e.where}</Txt>
              <Txt v="small" color={c.danger}>{e.message}</Txt>
            </View>
          ))}
        </Card>
      </Section>

      <Row>
        <Btn kind="ghost" title={t.diag.refresh} onPress={refresh} style={{ flex: 1 }} />
        <Btn title={t.diag.share} onPress={() => Share.share({ message: report() })} style={{ flex: 2 }} />
      </Row>
      <Txt v="small" center>{t.diag.version} {Constants.expoConfig?.version} · {process.env.EXPO_PUBLIC_BUILD ?? 'local'}</Txt>
    </Screen>
  );
}
