import React, { useEffect, useState } from 'react';

import { useAuth } from '@/ctx/Auth';
import { useLang, useTheme } from '@/ctx/Lang';
import { isTime, today } from '@/lib/dates';
import { useEntity } from '@/lib/db';
import { GenerateSpeech, SendEmail } from '@/lib/integrations';
import { cancel, scheduleDaily } from '@/lib/notify';
import { goalStats, habitStats, taskStats } from '@/lib/stats';
import { View } from 'react-native';

import { Btn, Card, Input, Loading, Row, Screen, Toggle, Txt, notice } from '@/ui/kit';
import { TimeField } from '@/ui/pickers';

export default function Motivation() {
  const c = useTheme();
  const { t, lang } = useLang();
  const { user } = useAuth();
  const settings = useEntity('MotivationSettings');
  const tasks = useEntity('DailyTask').items;
  const goals = useEntity('Goal').items;
  const habits = useEntity('Habit').items;
  const logs = useEntity('HabitLog').items;
  const saved = settings.items[0];
  const [email, setEmail] = useState('');
  const [time, setTime] = useState('08:00');
  const [sent, setSent] = useState(false);

  useEffect(() => {
    setEmail(saved?.email ?? user?.email ?? '');
    setTime(saved?.reminder_time ?? '08:00');
  }, [saved?.email, saved?.reminder_time, user?.email]);

  // the quote rotates with the calendar day, so it is stable for the whole day
  const quote = t.quotes[Math.floor(Date.now() / 86400000) % t.quotes.length];
  const day = today();
  const dayTasks = tasks.filter((x) => x.date === day && !x.parent_id);
  const summary = [
    `✅ ${t.dash.tasksToday}: ${dayTasks.filter((x) => x.completed).length}/${dayTasks.length}`,
    ...dayTasks.filter((x) => !x.completed).slice(0, 5).map((x) => `   • ${x.title}`),
    `🔥 ${t.dash.activeHabits}: ${habitStats(habits, logs).active}`,
    `🎯 ${t.dash.avgGoals}: ${goalStats(goals).avg}%`,
    `📊 ${t.ana.taskRate}: ${taskStats(tasks).rate}%`,
  ].join('\n');
  const body = `"${quote}"\n\n${t.motiv.summary} (${day})\n${summary}`;

  const patch = async (p: Parameters<typeof settings.update>[1]) => {
    if (saved) await settings.update(saved.id, p);
    else await settings.create({ email, reminder_time: time, ...p });
  };

  const send = async () => {
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) return notice(t.auth.error);
    await SendEmail({ to: email.trim(), subject: t.motiv.subject, body });
    await patch({ email: email.trim(), last_email_sent: new Date().toISOString(), motivational_quote: quote });
    setSent(true);
  };

  const setReminder = async (on: boolean, at = time) => {
    if (on && !isTime(at)) return notice(t.c.invalidTime);
    await patch({ send_daily_reminder: on, reminder_time: at });
    if (on) await scheduleDaily('motiv', t.motiv.reminderTitle, quote, at);
    else await cancel('motiv');
  };

  if (settings.loading) return <Screen><Loading /></Screen>;

  return (
    <Screen>
      <Card style={{ borderColor: c.primary }}>
        <Txt v="small">💬 {t.motiv.quote}</Txt>
        <Txt v="h">{quote}</Txt>
        <Btn small kind="ghost" title={`🔊 ${t.c.listen}`} onPress={() => GenerateSpeech(quote, lang)} />
      </Card>

      <Card>
        <Input label={t.motiv.sendTo} value={email} onChangeText={(v) => { setEmail(v); setSent(false); }} keyboardType="email-address" autoCapitalize="none" />
        <Btn title={`✉️ ${t.motiv.send}`} onPress={send} />
        <Txt v="small">{t.motiv.mailNote}</Txt>
        {sent ? <Txt color={c.success}>{t.motiv.sent}</Txt> : null}
        {saved?.last_email_sent ? <Txt v="small">{t.motiv.lastSent}: {saved.last_email_sent.slice(0, 16).replace('T', ' ')}</Txt> : null}
      </Card>

      <Card>
        <Toggle label={`🔔 ${t.motiv.dailyReminder}`} value={!!saved?.send_daily_reminder} onChange={(on) => setReminder(on)} />
        <Toggle label={t.motiv.dailyEmail} value={!!saved?.send_daily_email} onChange={(send_daily_email) => patch({ send_daily_email })} />
        <Row>
          <View style={{ flex: 1 }}><TimeField label={t.motiv.reminderTime} value={time} allowClear={false} onChange={(v) => { if (v) { setTime(v); setReminder(!!saved?.send_daily_reminder, v); } }} /></View>
        </Row>
      </Card>

      <Card>
        <Txt v="sub">👁 {t.motiv.preview}</Txt>
        <Txt v="small">{t.motiv.subject}</Txt>
        <Txt>{body}</Txt>
      </Card>
    </Screen>
  );
}
