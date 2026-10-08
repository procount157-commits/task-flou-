import React, { useEffect, useState } from 'react';

import { useAuth, useProfile } from '@/ctx/Auth';
import { useLang, useTheme } from '@/ctx/Lang';
import { isDate, isTime } from '@/lib/dates';
import { AISettings, getAI, setAI } from '@/lib/integrations';
import { initNotifications } from '@/lib/notify';
import { NoTelegramError, TG_DEFAULTS, TelegramSettings, detectChatId, getTelegram, sendTelegram, setTelegram } from '@/lib/telegram';
import { Btn, Card, Input, Screen, Section, Txt, notice } from '@/ui/kit';
import { DateField, TimeField } from '@/ui/pickers';
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
  const [tg, setTg] = useState<TelegramSettings>(TG_DEFAULTS);

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
    getTelegram().then(setTg);
  }, []);

  const tgRun = async (run: () => Promise<void>) => {
    try {
      await run();
    } catch (e) {
      notice(e instanceof NoTelegramError ? t.tg.missing : String((e as Error).message), t.c.error);
    }
  };

  const field = (k: string, label: string, kb: 'default' | 'number-pad' | 'decimal-pad' = 'default', suggestions?: string[]) => (
    <Input key={k} label={label} value={f[k] ?? ''} onChangeText={(v) => setF((p) => ({ ...p, [k]: v }))} keyboardType={kb} suggestions={suggestions} />
  );
  const time = (k: string, label: string) => <TimeField key={k} label={label} value={f[k]} allowClear={false} onChange={(v) => setF((p) => ({ ...p, [k]: v ?? '' }))} />;

  const save = async () => {
    const times = ['wake_time', 'sleep_time', 'work_hours_start', 'work_hours_end'];
    if (!isDate(f.birth_date)) return setError(t.c.invalidDate);
    if (times.some((k) => !isTime(f[k]))) return setError(t.c.invalidTime);
    if ([f.target_age, f.study_hours_daily || '0', f.free_time_hours || '0'].some((n) => isNaN(Number(n)))) return setError(t.c.invalidNumber);
    setError('');
    await updateProfile({
      full_name: (f.full_name ?? '').trim(), birth_date: f.birth_date, target_age: Number(f.target_age), wake_time: f.wake_time, sleep_time: f.sleep_time,
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
          <DateField label={t.onb.birthDate} value={f.birth_date} onChange={(v) => setF((p) => ({ ...p, birth_date: v ?? '' }))} allowClear={false} past />
          {field('target_age', t.onb.targetAge, 'number-pad', t.sug.ages)}
          {time('wake_time', t.onb.wake)}
          {time('sleep_time', t.onb.sleep)}
          {time('work_hours_start', t.onb.workStart)}
          {time('work_hours_end', t.onb.workEnd)}
          <Txt v="muted">{t.onb.workDays}</Txt>
          <DaysPicker value={days} onChange={setDays} />
          {field('study_hours_daily', t.onb.studyHours, 'decimal-pad', t.sug.hours)}
          {field('study_subjects', t.onb.studySubjects, 'default', t.sug.subjects)}
          {field('free_time_hours', t.onb.freeHours, 'decimal-pad', t.sug.hours)}
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

      <Section title={`✈️ ${t.tg.title}`}>
        <Card>
          <Txt v="small">{t.tg.hint}</Txt>
          <Input label={t.tg.token} value={tg.token} onChangeText={(v) => setTg({ ...tg, token: v.trim() })} autoCapitalize="none" autoCorrect={false} secureTextEntry />
          <Input label={t.tg.chatId} value={tg.chatId} onChangeText={(v) => setTg({ ...tg, chatId: v.trim() })} keyboardType="numbers-and-punctuation" />
          <Btn kind="ghost" title={`🔎 ${t.tg.detect}`} disabled={!tg.token} onPress={() => tgRun(async () => {
            const chatId = await detectChatId(tg.token);
            if (!chatId) return notice(t.tg.noChat);
            const next = { ...tg, chatId };
            setTg(next);
            await setTelegram(next);
            await sendTelegram(t.tg.hello, next);
            notice(t.tg.sent);
          })} />
          <Btn title={t.c.save} onPress={async () => { await setTelegram(tg); notice(t.settings.saved); }} />
          <Btn kind="ghost" title={t.tg.test} onPress={() => tgRun(async () => { await setTelegram(tg); await sendTelegram(t.tg.hello, tg); notice(t.tg.sent); })} />
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
