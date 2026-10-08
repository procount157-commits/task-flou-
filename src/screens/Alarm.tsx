import { Ionicons } from '@expo/vector-icons';
import { AudioPlayer, createAudioPlayer, setAudioModeAsync } from 'expo-audio';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Accelerometer } from 'expo-sensors';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { BackHandler, Modal, Platform, Pressable, Vibration, View } from 'react-native';

import { useLang, useTheme } from '@/ctx/Lang';
import { useKV } from '@/lib/db';
import { scheduleAlarms, silenceAlarm } from '@/lib/notify';
import type { Alarm } from '@/lib/types';
import { FormModal } from '@/ui/Form';
import { Badge, Btn, Card, Empty, Progress, Row, Screen, Toggle, Txt, confirm, opts } from '@/ui/kit';
import { useCelebrate } from '@/ui/shared';
import { Text } from '@/ui/text';

const SIRENS: Record<Alarm['sound'], number> = {
  ambulance: require('../../assets/sounds/alarm_ambulance.wav'),
  whistle: require('../../assets/sounds/alarm_whistle.wav'),
  wail: require('../../assets/sounds/alarm_wail.wav'),
};
// about ten metres of walking
const STEPS = 16;
const PROBLEMS = 3;
const NONE: Alarm[] = [];

function makeProblem() {
  const a = 6 + Math.floor(Math.random() * 14);
  const b = 3 + Math.floor(Math.random() * 7);
  const cc = 5 + Math.floor(Math.random() * 40);
  const answer = a * b + cc;
  const choices = new Set([answer]);
  while (choices.size < 4) choices.add(answer + (Math.floor(Math.random() * 9) - 4) * (Math.random() < 0.5 ? 1 : b) || answer + 7);
  return { text: `${a} × ${b} + ${cc}`, answer, choices: [...choices].sort(() => Math.random() - 0.5) };
}

// The ringing screen: the siren loops and the back button is dead until the challenge is done.
function Ringing({ alarm, onStop }: { alarm: Alarm; onStop: () => void }) {
  const c = useTheme();
  const { t, dir } = useLang();
  const [steps, setSteps] = useState(0);
  const [left, setLeft] = useState(PROBLEMS);
  const [problem, setProblem] = useState(makeProblem);
  const [wrong, setWrong] = useState(false);
  const [sensor, setSensor] = useState(true);
  const player = useRef<AudioPlayer | null>(null);
  const useSteps = alarm.challenge === 'steps' && sensor;

  useEffect(() => {
    setAudioModeAsync({ playsInSilentMode: true }).catch(() => {});
    try {
      const p = createAudioPlayer(SIRENS[alarm.sound]);
      p.loop = true;
      p.volume = 1;
      p.play();
      player.current = p;
    } catch {}
    if (Platform.OS !== 'web') Vibration.vibrate([0, 700, 300], true);
    const back = BackHandler.addEventListener('hardwareBackPress', () => true);
    return () => {
      back.remove();
      Vibration.cancel();
      try {
        player.current?.pause();
        player.current?.remove();
      } catch {}
    };
  }, [alarm.sound]);

  // A step is a spike in total acceleration after it has settled back near 1 g.
  useEffect(() => {
    if (alarm.challenge !== 'steps') return;
    let armed = true;
    let last = 0;
    let sub: { remove: () => void } | undefined;
    Accelerometer.isAvailableAsync()
      .then((ok) => {
        if (!ok) return setSensor(false);
        Accelerometer.setUpdateInterval(60);
        sub = Accelerometer.addListener(({ x, y, z }) => {
          const g = Math.sqrt(x * x + y * y + z * z);
          const now = Date.now();
          if (armed && g > 1.22 && now - last > 280) {
            armed = false;
            last = now;
            setSteps((s) => s + 1);
          } else if (g < 1.06) armed = true;
        });
      })
      .catch(() => setSensor(false));
    return () => sub?.remove();
  }, [alarm.challenge]);

  const solved = useSteps ? steps >= STEPS : left <= 0;
  useEffect(() => {
    if (solved) onStop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [solved]);

  const answer = (n: number) => {
    const ok = n === problem.answer;
    setWrong(!ok);
    setLeft((v) => (ok ? v - 1 : Math.min(PROBLEMS + 2, v + 1)));
    setProblem(makeProblem());
  };

  return (
    <View style={{ flex: 1, backgroundColor: c.danger, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 18, direction: dir }}>
      <Ionicons name="alarm" size={72} color="#fff" />
      <Text style={{ color: '#fff', fontSize: 34, fontWeight: '800' }}>{t.alarm.ringing}</Text>
      <Text style={{ color: '#fff', fontSize: 20 }}>{alarm.time}{alarm.label ? ` · ${alarm.label}` : ''}</Text>
      {useSteps ? (
        <View style={{ alignSelf: 'stretch', gap: 10, alignItems: 'center' }}>
          <Text style={{ color: '#fff', fontSize: 18 }}>🚶 {t.alarm.walk}</Text>
          <Text style={{ color: '#fff', fontSize: 54, fontWeight: '800' }}>{Math.max(0, STEPS - steps)}</Text>
          <Text style={{ color: '#fff' }}>{t.alarm.stepsLeft}</Text>
          <View style={{ alignSelf: 'stretch' }}><Progress value={(steps / STEPS) * 100} color="#fff" height={10} /></View>
        </View>
      ) : (
        <View style={{ alignSelf: 'stretch', gap: 12, alignItems: 'center' }}>
          <Text style={{ color: '#fff' }}>{left} {t.alarm.mathLeft}</Text>
          <Text style={{ color: '#fff', fontSize: 40, fontWeight: '800', writingDirection: 'ltr' }}>{problem.text} = ?</Text>
          {wrong ? <Text style={{ color: '#fff' }}>✕ {t.alarm.wrong}</Text> : null}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, justifyContent: 'center' }}>
            {problem.choices.map((n) => (
              <Pressable key={n} onPress={() => answer(n)} accessibilityRole="button" style={{ width: '44%', paddingVertical: 18, borderRadius: 14, backgroundColor: '#fff', alignItems: 'center' }}>
                <Text style={{ fontSize: 26, fontWeight: '700', color: c.danger }}>{n}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      )}
    </View>
  );
}

export default function AlarmScreen() {
  const c = useTheme();
  const { t } = useLang();
  const router = useRouter();
  const celebrate = useCelebrate();
  const params = useLocalSearchParams<{ ring?: string }>();
  const [alarms, setAlarms] = useKV<Alarm[]>('alarms', NONE);
  const [form, setForm] = useState<Partial<Alarm> | null>(null);
  const [testing, setTesting] = useState<Alarm | null>(null);
  const preview = useRef<AudioPlayer | null>(null);
  const ringing = useMemo(() => testing ?? alarms.find((a) => a.id === params.ring) ?? null, [testing, alarms, params.ring]);

  const save = async (next: Alarm[]) => {
    await setAlarms(next);
    await scheduleAlarms(next, t.alarm.ringing);
  };
  const stop = async () => {
    const id = ringing?.id;
    setTesting(null);
    router.setParams({ ring: '' });
    if (id) await silenceAlarm(id);
    celebrate(t.alarm.stopped);
  };
  const listen = (sound: Alarm['sound']) => {
    try {
      preview.current?.remove();
      const p = createAudioPlayer(SIRENS[sound]);
      p.volume = 0.6;
      p.play();
      preview.current = p;
      setTimeout(() => p === preview.current && (p.remove(), (preview.current = null)), 3500);
    } catch {}
  };

  // a full-screen modal, so neither the tab bar nor the back button offers a way out
  if (ringing)
    return (
      <Modal visible animationType="none" onRequestClose={() => {}} statusBarTranslucent>
        <Ringing alarm={ringing} onStop={stop} />
      </Modal>
    );

  return (
    <Screen>
      <Btn title={`+ ${t.alarm.add}`} onPress={() => setForm({})} />
      <Txt v="small">{t.alarm.note}</Txt>
      {!alarms.length ? <Empty icon="⏰" text={t.alarm.empty} /> : [...alarms].sort((a, b) => a.time.localeCompare(b.time)).map((a) => (
        <Card key={a.id}>
          <Toggle label={`${a.time}${a.label ? ` · ${a.label}` : ''}`} value={a.enabled} onChange={(enabled) => save(alarms.map((x) => (x.id === a.id ? { ...x, enabled } : x)))} />
          <Row wrap gap={4}>
            <Badge text={t.alarm.sounds[a.sound]} />
            <Badge text={t.alarm.ch[a.challenge]} color={c.primary} />
            <Badge text={a.days.length && a.days.length < 7 ? [...a.days].sort().map((d) => t.daysShort[d]).join(' ') : t.alarm.everyDay} />
          </Row>
          <Row wrap gap={4}>
            <Btn small kind="ghost" title={`🔊 ${t.alarm.preview}`} onPress={() => listen(a.sound)} />
            <Btn small kind="ghost" title={`▶ ${t.alarm.test}`} onPress={() => setTesting(a)} />
            <Btn small kind="ghost" title={t.c.edit} onPress={() => setForm(a)} />
            <Btn small kind="ghost" title={t.c.delete} onPress={() => confirm(t.c.confirmDelete, () => save(alarms.filter((x) => x.id !== a.id)), t.c.delete, t.c.cancel)} />
          </Row>
        </Card>
      ))}
      <FormModal visible={!!form} title={form?.id ? t.c.edit : t.alarm.add} onClose={() => setForm(null)}
        initial={{ time: '06:00', days: [], sound: 'ambulance', challenge: 'steps', enabled: true, ...form }}
        fields={[
          { key: 'time', label: t.c.time, type: 'time', required: true },
          { key: 'days', label: t.today.repeat, type: 'days' },
          { key: 'sound', label: t.alarm.sound, type: 'select', options: opts(t.alarm.sounds) },
          { key: 'challenge', label: t.alarm.challenge, type: 'select', options: opts(t.alarm.ch) },
          { key: 'label', label: t.alarm.label, suggestions: t.alarm.labels },
        ]}
        onSave={(v) => save(form?.id ? alarms.map((x) => (x.id === form.id ? ({ ...x, ...v } as Alarm) : x)) : [...alarms, { ...(v as Alarm), id: Date.now().toString(36), enabled: true }])} />
    </Screen>
  );
}
