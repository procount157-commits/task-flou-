import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Platform, View } from 'react-native';

import { useAI } from './taskparts';
import { useLang, useTheme } from '@/ctx/Lang';
import { SOUND_KEYS, usePomodoro } from '@/ctx/Pomodoro';
import { fmtClock, monthKey, today } from '@/lib/dates';
import { useEntity } from '@/lib/db';
import { GenerateSpeech, splitTask } from '@/lib/integrations';
import { sortTasks } from '@/lib/logic';
import type { DailyTask } from '@/lib/types';
import { isLockAdmin, lockAvailable } from '@/lib/phonelock';
import { Btn, Card, Chips, Empty, Input, Progress, Row, Screen, Section, Stat, Toggle, Txt, notice } from '@/ui/kit';

const BREATH = [{ key: 'inhale', ms: 4000, to: 1 }, { key: 'hold', ms: 4000, to: 1 }, { key: 'exhale', ms: 6000, to: 0.45 }] as const;

function Breathing() {
  const c = useTheme();
  const { t } = useLang();
  const scale = useRef(new Animated.Value(0.45)).current;
  const [i, setI] = useState(0);
  useEffect(() => {
    const p = BREATH[i];
    Animated.timing(scale, { toValue: p.to, duration: p.ms, easing: Easing.inOut(Easing.quad), useNativeDriver: Platform.OS !== 'web' }).start();
    const id = setTimeout(() => setI((i + 1) % BREATH.length), p.ms);
    return () => clearTimeout(id);
  }, [i, scale]);
  return (
    <Card style={{ alignItems: 'center' }}>
      <Txt v="sub">🌬 {t.pomo.breathe}</Txt>
      <View style={{ width: 150, height: 150, alignItems: 'center', justifyContent: 'center' }}>
        <Animated.View style={{ position: 'absolute', width: 150, height: 150, borderRadius: 75, backgroundColor: c.soft, borderWidth: 2, borderColor: c.primary, transform: [{ scale }] }} />
        <Txt v="sub">{t.pomo[BREATH[i].key]}</Txt>
      </View>
      {t.pomo.tips.map((tip) => <Txt key={tip} v="muted">• {tip}</Txt>)}
    </Card>
  );
}

export default function Pomodoro() {
  const c = useTheme();
  const { t, lang } = useLang();
  const p = usePomodoro();
  const ai = useAI();
  const tasks = useEntity('DailyTask').items;
  const history = useEntity('PomodoroSession').items;
  const [busy, setBusy] = useState<string | null>(null);
  const [focus, setFocus] = useState(String(p.settings.focusMin));
  const [brk, setBrk] = useState(String(p.settings.breakMin));
  const s = p.session;
  const day = today();

  useEffect(() => {
    setFocus(String(p.settings.focusMin));
    setBrk(String(p.settings.breakMin));
  }, [p.settings.focusMin, p.settings.breakMin]);

  const commitMinutes = () => {
    const f = Math.min(240, Math.max(1, Math.round(Number(focus)) || 90));
    const b = Math.min(120, Math.max(1, Math.round(Number(brk)) || 20));
    p.setSettings({ ...p.settings, focusMin: f, breakMin: b });
  };

  const pending = sortTasks(tasks.filter((x) => x.date === day && !x.parent_id && !x.completed));
  const hours = (xs: typeof history) => (xs.reduce((sum, x) => sum + (x.focus_minutes ?? 0), 0) / 60).toFixed(1);

  const startWithAI = async (task: DailyTask) => {
    setBusy(task.id);
    const steps = await ai(() => splitTask(task.title, lang));
    setBusy(null);
    if (steps?.length) p.startSession({ taskId: task.id, taskTitle: task.title, subTasks: steps });
  };

  const total = s ? (s.phase === 'focus' ? s.focusMin : s.breakMin) * 60000 : 1;

  return (
    <Screen>
      <Row wrap>
        <Stat label={t.pomo.statsToday} value={`${hours(history.filter((x) => x.date === day))} ${t.c.hours}`} />
        <Stat label={t.pomo.statsMonth} value={`${hours(history.filter((x) => monthKey(x.date) === monthKey(day)))} ${t.c.hours}`} />
        <Stat label={t.pomo.statsTotal} value={`${hours(history)} ${t.c.hours}`} />
      </Row>

      {p.completedSession ? (
        <Card style={{ borderColor: c.success, alignItems: 'center' }}>
          <Txt v="h">🎉 {t.pomo.done}</Txt>
          <Txt>{p.completedSession.taskTitle}</Txt>
          <Txt v="muted">{p.completedSession.focusMinutes} {t.c.minutes} · {p.completedSession.sessions} {t.pomo.sessions}</Txt>
          <Btn small kind="ghost" title={t.c.close} onPress={p.clearCompleted} />
        </Card>
      ) : null}

      {s ? (
        <>
          <Card style={{ alignItems: 'center' }}>
            <Row gap={20}>
              {(['focus', 'break'] as const).map((ph) => (
                <View key={ph} style={{ width: 86, height: 86, borderRadius: 43, borderWidth: 3, borderColor: s.phase === ph ? (ph === 'focus' ? c.primary : c.success) : c.border, alignItems: 'center', justifyContent: 'center', backgroundColor: s.phase === ph ? c.soft : 'transparent' }}>
                  <Txt center>{ph === 'focus' ? '🎯' : '⏸'}</Txt>
                  <Txt v="small" center>{t.pomo[ph]}</Txt>
                </View>
              ))}
            </Row>
            <Txt style={{ fontSize: 56, fontWeight: '700', fontVariant: ['tabular-nums'] }} center>{fmtClock(p.remainingMs)}</Txt>
            <View style={{ alignSelf: 'stretch' }}><Progress value={(1 - p.remainingMs / total) * 100} color={s.phase === 'focus' ? c.primary : c.success} /></View>
            <Txt v="sub" center>{s.subTasks[s.step] ?? s.taskTitle}</Txt>
            {s.subTasks.length ? <Txt v="small" center>{s.taskTitle} · {t.pomo.step} {s.step + 1}/{s.subTasks.length}</Txt> : null}
            {s.paused ? <Txt v="muted" center>⏸ {t.pomo.paused}</Txt> : null}
            <Row wrap style={{ justifyContent: 'center' }}>
              {s.paused ? <Btn title={`▶ ${t.pomo.resume}`} onPress={p.resumeSession} /> : <Btn title={`⏸ ${t.pomo.pause}`} onPress={p.pauseSession} />}
              <Btn kind="ghost" title={`⏭ ${t.pomo.skip}`} onPress={p.skipPhase} />
              <Btn kind="ghost" title={`↺ ${t.pomo.reset}`} onPress={p.resetSession} />
              <Btn kind="danger" title={`⏹ ${t.pomo.stop}`} onPress={p.interruptSession} />
            </Row>
          </Card>
          {s.subTasks.length ? (
            <Card>
              {s.subTasks.map((st, i) => <Txt key={i} v={i === s.step ? 'body' : 'muted'} style={{ fontWeight: i === s.step ? '700' : '400', textDecorationLine: i < s.step ? 'line-through' : 'none' }}>{i + 1}. {st}</Txt>)}
            </Card>
          ) : null}
          {s.phase === 'break' ? (
            <>
              <Breathing />
              <Btn kind="ghost" title={`🔊 ${t.pomo.voiceGuide}`} onPress={() => GenerateSpeech(t.pomo.tips.join('. '), lang)} />
            </>
          ) : null}
        </>
      ) : null}

      <Section title={`🔊 ${t.pomo.sound}`}>
        <Chips options={SOUND_KEYS.map((k) => ({ value: k, label: t.sounds[k as keyof typeof t.sounds] }))} value={p.settings.sound} onChange={(sound) => p.setSettings({ ...p.settings, sound })} />
        <Row>
          <Txt v="muted">{t.pomo.volume}</Txt>
          <Btn small kind="ghost" title="−" onPress={() => p.setSettings({ ...p.settings, volume: Math.max(0, Math.round((p.settings.volume - 0.1) * 10) / 10) })} />
          <View style={{ flex: 1 }}><Progress value={p.settings.volume * 100} /></View>
          <Btn small kind="ghost" title="+" onPress={() => p.setSettings({ ...p.settings, volume: Math.min(1, Math.round((p.settings.volume + 0.1) * 10) / 10) })} />
        </Row>
      </Section>

      {!s ? (
        <>
          <Btn title={`${t.pomo.startNow} — ${p.settings.focusMin} ${t.c.minutes}`} onPress={() => p.startSession({ taskTitle: t.pomo.freeSession })} style={{ paddingVertical: 18 }} />
          <Row>
            <View style={{ flex: 1 }}><Input label={`🎯 ${t.pomo.focusMin}`} value={focus} onChangeText={setFocus} onBlur={commitMinutes} keyboardType="number-pad" /></View>
            <View style={{ flex: 1 }}><Input label={`⏸ ${t.pomo.breakMin}`} value={brk} onChangeText={setBrk} onBlur={commitMinutes} keyboardType="number-pad" /></View>
          </Row>
          {lockAvailable ? <Toggle label={t.lock.withFocus} value={!!p.settings.lockPhone} onChange={(lockPhone) => (lockPhone && !isLockAdmin() ? notice(t.lock.needGrant) : p.setSettings({ ...p.settings, lockPhone }))} /> : null}
          <Section title={t.pomo.pickTask} right={<Btn small title={`▶ ${t.pomo.freeSession}`} onPress={() => p.startSession({ taskTitle: t.pomo.freeSession })} />}>
            {pending.length ? pending.map((x) => (
              <Card key={x.id}>
                <Txt style={{ fontWeight: '600' }}>{x.title}</Txt>
                <Row wrap>
                  <Btn small title={`▶ ${t.c.start}`} onPress={() => p.startSession({ taskId: x.id, taskTitle: x.title, subTasks: tasks.filter((k) => k.parent_id === x.id && !k.completed).map((k) => k.title) })} />
                  <Btn small kind="ghost" title={`🤖 ${t.c.aiSplit}`} loading={busy === x.id} onPress={() => startWithAI(x)} />
                </Row>
              </Card>
            )) : <Empty icon="⏱" text={t.pomo.noTasks} />}
          </Section>
        </>
      ) : null}
    </Screen>
  );
}
