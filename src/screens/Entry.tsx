import React, { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAuth, useProfile } from '@/ctx/Auth';
import { useLang, useTheme } from '@/ctx/Lang';
import { isDate, isTime, today } from '@/lib/dates';
import { Btn, Card, Chips, Input, Progress, Row, Sheet, Txt } from '@/ui/kit';
import { DaysPicker } from '@/ui/shared';

function Shell({ children }: { children: React.ReactNode }) {
  const c = useTheme();
  const { dir, t, toggleLang } = useLang();
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flex: 1, backgroundColor: c.bg, direction: dir, paddingTop: insets.top }}>
      <ScrollView contentContainerStyle={{ padding: 20, gap: 14, maxWidth: 640, width: '100%', alignSelf: 'center', paddingBottom: insets.bottom + 30 }} keyboardShouldPersistTaps="handled">
        <Row style={{ justifyContent: 'space-between' }}>
          <Txt v="h">{t.appName}</Txt>
          <Btn small kind="ghost" title={`🌐 ${t.c.language}`} onPress={toggleLang} />
        </Row>
        {children}
      </ScrollView>
    </View>
  );
}

export function Landing() {
  const { t } = useLang();
  const { navigateToLogin } = useAuth();
  return (
    <Shell>
      <Txt v="h" style={{ fontSize: 28, marginTop: 20 }}>{t.landing.headline}</Txt>
      <Txt v="muted">{t.landing.sub}</Txt>
      <Card>{t.landing.features.map((f) => <Txt key={f}>{f}</Txt>)}</Card>
      <Btn title={t.landing.cta} onPress={navigateToLogin} />
    </Shell>
  );
}

export function Login() {
  const { t } = useLang();
  const c = useTheme();
  const { login, pendingInvite } = useAuth();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  return (
    <Shell>
      <Txt v="h">{t.auth.loginTitle}</Txt>
      <Txt v="muted">{t.auth.loginHint}</Txt>
      {pendingInvite ? <Card><Txt>✉️ {t.auth.invitedBy} {pendingInvite.by} — {t.auth.roleUser}</Txt></Card> : null}
      <Input label={t.c.name} value={name} onChangeText={setName} />
      <Input label={t.c.email} value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" />
      {error ? <Txt v="small" color={c.danger}>{error}</Txt> : null}
      <Btn title={t.auth.login} onPress={async () => setError((await login(name, email)) ? '' : t.auth.error)} />
    </Shell>
  );
}

// Five mandatory steps; "next" stays blocked until the current step's fields are valid.
export function Onboarding() {
  const { t } = useLang();
  const c = useTheme();
  const { user } = useAuth();
  const { updateProfile } = useProfile();
  const [step, setStep] = useState(0);
  const [error, setError] = useState('');
  const [f, setF] = useState({
    full_name: user?.name ?? '', birth_date: '', target_age: '80', wake_time: '06:00', sleep_time: '23:00',
    work_hours_start: '09:00', work_hours_end: '17:00', work_days: [0, 1, 2, 3, 4] as number[], study_hours_daily: '', study_subjects: '', free_time_hours: '',
  });
  const set = (k: keyof typeof f) => (v: any) => setF((p) => ({ ...p, [k]: v }));
  const num = (s: string) => s.trim() !== '' && !isNaN(Number(s)) && Number(s) >= 0;
  const valid = [
    f.full_name.trim() && isDate(f.birth_date) && f.birth_date < today() && num(f.target_age) && Number(f.target_age) > 0,
    isTime(f.wake_time) && isTime(f.sleep_time),
    isTime(f.work_hours_start) && isTime(f.work_hours_end),
    f.work_days.length > 0,
    num(f.study_hours_daily) && f.study_subjects.trim() && num(f.free_time_hours),
  ][step];
  const titles = [t.onb.s1, t.onb.s2, t.onb.s3, t.onb.s4, t.onb.s5];

  const next = async () => {
    if (!valid) return setError(step === 3 ? t.onb.pickDay : t.onb.fillAll);
    setError('');
    if (step < 4) return setStep(step + 1);
    await updateProfile({
      full_name: f.full_name.trim(), birth_date: f.birth_date, target_age: Number(f.target_age), wake_time: f.wake_time, sleep_time: f.sleep_time,
      work_hours_start: f.work_hours_start, work_hours_end: f.work_hours_end, work_days: f.work_days.join(','),
      study_hours_daily: Number(f.study_hours_daily), study_subjects: f.study_subjects.trim(), free_time_hours: Number(f.free_time_hours), onboarding_complete: true,
    });
  };

  return (
    <Shell>
      <Txt v="h">{t.onb.title}</Txt>
      <Txt v="muted">{t.onb.step} {step + 1} / 5 — {titles[step]}</Txt>
      <Progress value={((step + 1) / 5) * 100} />
      {step === 0 ? (
        <>
          <Input label={t.onb.fullName} value={f.full_name} onChangeText={set('full_name')} />
          <Input label={t.onb.birthDate} value={f.birth_date} onChangeText={set('birth_date')} placeholder="1995-04-23" keyboardType="numbers-and-punctuation" />
          <Input label={t.onb.targetAge} value={f.target_age} onChangeText={set('target_age')} keyboardType="number-pad" />
        </>
      ) : step === 1 ? (
        <>
          <Input label={t.onb.wake} value={f.wake_time} onChangeText={set('wake_time')} keyboardType="numbers-and-punctuation" />
          <Input label={t.onb.sleep} value={f.sleep_time} onChangeText={set('sleep_time')} keyboardType="numbers-and-punctuation" />
        </>
      ) : step === 2 ? (
        <>
          <Input label={t.onb.workStart} value={f.work_hours_start} onChangeText={set('work_hours_start')} keyboardType="numbers-and-punctuation" />
          <Input label={t.onb.workEnd} value={f.work_hours_end} onChangeText={set('work_hours_end')} keyboardType="numbers-and-punctuation" />
        </>
      ) : step === 3 ? (
        <>
          <Txt v="muted">{t.onb.workDays}</Txt>
          <DaysPicker value={f.work_days} onChange={set('work_days')} />
        </>
      ) : (
        <>
          <Input label={t.onb.studyHours} value={f.study_hours_daily} onChangeText={set('study_hours_daily')} keyboardType="decimal-pad" />
          <Input label={t.onb.studySubjects} value={f.study_subjects} onChangeText={set('study_subjects')} />
          <Input label={t.onb.freeHours} value={f.free_time_hours} onChangeText={set('free_time_hours')} keyboardType="decimal-pad" />
        </>
      )}
      {error ? <Txt v="small" color={c.danger}>{error}</Txt> : null}
      <Row>
        {step > 0 ? <Btn kind="ghost" title={t.c.back} onPress={() => { setError(''); setStep(step - 1); }} style={{ flex: 1 }} /> : null}
        <Btn title={step === 4 ? t.onb.finish : t.c.next} onPress={next} disabled={!valid} style={{ flex: 2 }} />
      </Row>
    </Shell>
  );
}

// Asked once per day, on the first open; it cannot be dismissed without an intention.
export function IntentionModal() {
  const { t } = useLang();
  const { needsIntention, updateProfile } = useProfile();
  const [text, setText] = useState('');
  const save = (value: string) => value.trim() && updateProfile({ daily_intention: value.trim(), last_intention_date: today() }).then(() => setText(''));
  return (
    <Sheet visible={needsIntention} onClose={() => {}} title={`🌅 ${t.intention.title}`} footer={<Btn title={t.intention.set} disabled={!text.trim()} onPress={() => save(text)} />}>
      <Chips options={t.intention.suggestions.map((s) => ({ value: s, label: s }))} value={text} onChange={save} />
      <Input placeholder={t.intention.placeholder} value={text} onChangeText={setText} />
    </Sheet>
  );
}
