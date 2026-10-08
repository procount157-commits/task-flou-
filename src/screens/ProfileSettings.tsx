import React, { useEffect, useState } from 'react';

import { useAuth, useProfile } from '@/ctx/Auth';
import { useLang, useTheme } from '@/ctx/Lang';
import { isDate, isTime } from '@/lib/dates';
import { AISettings, getAI, setAI } from '@/lib/integrations';
import { initNotifications } from '@/lib/notify';
import { Btn, Card, Input, Screen, Section, Txt, notice } from '@/ui/kit';
import { DaysPicker } from '@/ui/shared';

export default function ProfileSettings() {
  const c = useTheme();
  const { t } = useLang();
  const { user } = useAuth();
  const { profile, updateProfile } = useProfile();
  const [f, setF] = useState<Record<string, string>>({});
  const [days, setDays] = useState<number[]>([]);
  const [ai, setAi] = useState<AISettings | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!profile) return;
    setF({
      full_name: profile.full_name ?? '', birth_date: profile.birth_date ?? '', target_age: String(profile.target_age ?? 80), wake_time: profile.wake_time ?? '',
      sleep_time: profile.sleep_time ?? '', work_hours_start: profile.work_hours_start ?? '', work_hours_end: profile.work_hours_end ?? '',
      study_hours_daily: String(profile.study_hours_daily ?? ''), study_subjects: profile.study_subjects ?? '', free_time_hours: String(profile.free_time_hours ?? ''),
    });
    setDays((profile.work_days ?? '').split(',').filter(Boolean).map(Number));
  }, [profile]);
  useEffect(() => {
    getAI().then(setAi);
  }, []);

  const field = (k: string, label: string, kb: 'default' | 'number-pad' | 'decimal-pad' | 'numbers-and-punctuation' = 'default') => (
    <Input key={k} label={label} value={f[k] ?? ''} onChangeText={(v) => setF((p) => ({ ...p, [k]: v }))} keyboardType={kb} />
  );

  const save = async () => {
    const times = ['wake_time', 'sleep_time', 'work_hours_start', 'work_hours_end'];
    if (!f.full_name?.trim()) return setError(t.c.required);
    if (!isDate(f.birth_date)) return setError(t.c.invalidDate);
    if (times.some((k) => !isTime(f[k]))) return setError(t.c.invalidTime);
    if ([f.target_age, f.study_hours_daily || '0', f.free_time_hours || '0'].some((n) => isNaN(Number(n)))) return setError(t.c.invalidNumber);
    setError('');
    await updateProfile({
      full_name: f.full_name.trim(), birth_date: f.birth_date, target_age: Number(f.target_age), wake_time: f.wake_time, sleep_time: f.sleep_time,
      work_hours_start: f.work_hours_start, work_hours_end: f.work_hours_end, work_days: days.join(','), study_hours_daily: Number(f.study_hours_daily || 0),
      study_subjects: f.study_subjects.trim(), free_time_hours: Number(f.free_time_hours || 0),
    });
    notice(t.settings.saved);
  };

  const aiField = (k: keyof AISettings, label: string, secret = false) =>
    ai ? <Input key={k} label={label} value={ai[k]} onChangeText={(v) => setAi({ ...ai, [k]: v.trim() })} autoCapitalize="none" autoCorrect={false} secureTextEntry={secret} /> : null;

  return (
    <Screen>
      <Section title={`👤 ${t.settings.profile}`}>
        <Card>
          {field('full_name', t.onb.fullName)}
          {field('birth_date', t.onb.birthDate, 'numbers-and-punctuation')}
          {field('target_age', t.onb.targetAge, 'number-pad')}
          {field('wake_time', t.onb.wake, 'numbers-and-punctuation')}
          {field('sleep_time', t.onb.sleep, 'numbers-and-punctuation')}
          {field('work_hours_start', t.onb.workStart, 'numbers-and-punctuation')}
          {field('work_hours_end', t.onb.workEnd, 'numbers-and-punctuation')}
          <Txt v="muted">{t.onb.workDays}</Txt>
          <DaysPicker value={days} onChange={setDays} />
          {field('study_hours_daily', t.onb.studyHours, 'decimal-pad')}
          {field('study_subjects', t.onb.studySubjects)}
          {field('free_time_hours', t.onb.freeHours, 'decimal-pad')}
          {error ? <Txt v="small" color={c.danger}>{error}</Txt> : null}
          <Btn title={t.c.save} onPress={save} />
        </Card>
      </Section>

      <Section title={`🤖 ${t.settings.ai}`}>
        <Card>
          <Txt v="small">{t.settings.aiHint}</Txt>
          {aiField('baseUrl', t.settings.baseUrl)}
          {aiField('apiKey', t.settings.apiKey, true)}
          {aiField('model', t.settings.model)}
          {aiField('sttModel', t.settings.sttModel)}
          {aiField('fallbackUrl', `${t.settings.baseUrl} 2`)}
          {aiField('fallbackKey', `${t.settings.apiKey} 2`, true)}
          {aiField('fallbackModel', `${t.settings.model} 2`)}
          <Btn title={t.c.save} onPress={async () => { if (ai) { await setAI(ai); notice(t.settings.saved); } }} />
        </Card>
      </Section>

      <Section title={`⚙️ ${t.settings.account}`}>
        <Card>
          <Txt>{user?.name} · {user?.email}</Txt>
          <Txt v="muted">{t.invite.role}: {user?.role === 'admin' ? t.auth.roleAdmin : t.auth.roleUser}</Txt>
          <Btn kind="ghost" title={`🔔 ${t.settings.notifications}`} onPress={async () => notice((await initNotifications()) ? '✓' : '✕')} />
        </Card>
      </Section>
    </Screen>
  );
}
