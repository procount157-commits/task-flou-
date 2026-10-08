import { AudioModule, RecordingPresets, createAudioPlayer, setAudioModeAsync, useAudioRecorder } from 'expo-audio';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, Platform, Pressable, Text, View, useWindowDimensions } from 'react-native';

import { Btn, Card, IconBtn, Input, Row, Txt, notice } from './kit';
import { PALETTE, useLang, useTheme } from '@/ctx/Lang';
import { addDays, parse, today, ymd } from '@/lib/dates';
import { NoKeyError, TranscribeAudio, UploadFile } from '@/lib/integrations';
import { pick } from '@/lib/logic';

/* ───────── DaysPicker ───────── */
export function DaysPicker({ value, onChange }: { value: number[]; onChange: (v: number[]) => void }) {
  const c = useTheme();
  const { t } = useLang();
  const summary = !value.length || value.length === 7 ? t.daysPicker.daily : value.length > 3 ? `${value.length} ${t.daysPicker.nDays}` : [...value].sort().map((d) => t.days[d]).join('، ');
  return (
    <View style={{ gap: 6 }}>
      <Row gap={5}>
        {t.daysShort.map((d, i) => {
          const on = value.includes(i);
          return (
            <Pressable key={i} onPress={() => onChange(on ? value.filter((x) => x !== i) : [...value, i].sort())} accessibilityRole="button" accessibilityLabel={t.days[i]} accessibilityState={{ selected: on }}
              style={{ flex: 1, paddingVertical: 9, borderRadius: 8, alignItems: 'center', borderWidth: 1, borderColor: on ? c.primary : c.border, backgroundColor: on ? c.primary : c.card }}>
              <Text style={{ color: on ? c.onPrimary : c.text, fontSize: 12 }}>{d}</Text>
            </Pressable>
          );
        })}
      </Row>
      <Txt v="small">{summary}</Txt>
    </View>
  );
}

/* ───────── CelebrationPopup ───────── */
type Celebrate = (message?: string, ms?: number) => void;
const CelebrationCtx = createContext<Celebrate>(() => {});
export const useCelebrate = () => useContext(CelebrationCtx);

function Confetti() {
  const { width, height } = useWindowDimensions();
  const bits = useMemo(
    () => Array.from({ length: 36 }, (_, i) => ({ x: Math.random() * width, delay: Math.random() * 500, size: 6 + Math.random() * 8, color: PALETTE[i % PALETTE.length], drift: (Math.random() - 0.5) * 120, spin: 2 + Math.random() * 4 })),
    [width],
  );
  const fall = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(fall, { toValue: 1, duration: 2600, easing: Easing.out(Easing.quad), useNativeDriver: Platform.OS !== 'web' }).start();
  }, [fall]);
  return (
    <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}>
      {bits.map((b, i) => (
        <Animated.View key={i} style={{
          position: 'absolute', left: b.x, top: -20, width: b.size, height: b.size * 1.6, backgroundColor: b.color, borderRadius: 2,
          opacity: fall.interpolate({ inputRange: [0, 0.85, 1], outputRange: [1, 1, 0] }),
          transform: [
            { translateY: fall.interpolate({ inputRange: [0, 1], outputRange: [0, height * (0.6 + (b.delay / 500) * 0.5)] }) },
            { translateX: fall.interpolate({ inputRange: [0, 1], outputRange: [0, b.drift] }) },
            { rotate: fall.interpolate({ inputRange: [0, 1], outputRange: ['0deg', `${b.spin * 180}deg`] }) },
          ],
        }} />
      ))}
    </View>
  );
}

export function CelebrationProvider({ children }: { children: React.ReactNode }) {
  const c = useTheme();
  const { t, dir } = useLang();
  const [shown, setShown] = useState<{ id: number; message: string } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cheers = useRef(t.cheers);
  cheers.current = t.cheers;
  const celebrate = useCallback<Celebrate>((message, ms = 3000) => {
    setShown({ id: Date.now(), message: message ?? pick(cheers.current) });
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setShown(null), ms);
    if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    try {
      const p = createAudioPlayer(require('../../assets/sounds/success.wav'));
      p.play();
      setTimeout(() => p.remove(), 2500);
    } catch {}
  }, []);
  return (
    <CelebrationCtx.Provider value={celebrate}>
      {children}
      {shown ? (
        <Pressable key={shown.id} onPress={() => setShown(null)} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' }}>
          <Confetti />
          <View style={{ backgroundColor: c.card, borderRadius: 16, padding: 22, marginHorizontal: 30, borderWidth: 1, borderColor: c.border, direction: dir, alignItems: 'center', gap: 6, elevation: 8 }}>
            <Text style={{ fontSize: 40 }}>🎉</Text>
            <Txt v="sub" center>{shown.message}</Txt>
          </View>
        </Pressable>
      ) : null}
    </CelebrationCtx.Provider>
  );
}

/* ───────── RewardPicker ───────── */
export const REWARD_ICONS = ['🎁', '🍕', '🎮', '✈️', '👟', '📱', '☕', '🎬', '🛍', '🏖', '🍰', '📚'];
export type RewardValue = { reward_title?: string; reward_icon?: string; reward_description?: string };

export function RewardPicker({ value, onChange }: { value: RewardValue; onChange: (v: RewardValue) => void }) {
  const c = useTheme();
  const { t } = useLang();
  return (
    <Card>
      <Txt v="muted">🎁 {t.c.reward}</Txt>
      <Input placeholder={t.c.title} value={value.reward_title ?? ''} onChangeText={(reward_title) => onChange({ ...value, reward_title })} />
      <Row wrap gap={4}>
        {REWARD_ICONS.map((ic) => (
          <Pressable key={ic} onPress={() => onChange({ ...value, reward_icon: ic })} accessibilityRole="button" accessibilityLabel={ic}
            style={{ padding: 6, borderRadius: 8, borderWidth: 1, borderColor: value.reward_icon === ic ? c.primary : 'transparent', backgroundColor: value.reward_icon === ic ? c.soft : 'transparent' }}>
            <Text style={{ fontSize: 20 }}>{ic}</Text>
          </Pressable>
        ))}
      </Row>
      <Input placeholder={t.c.description} value={value.reward_description ?? ''} onChangeText={(reward_description) => onChange({ ...value, reward_description })} />
    </Card>
  );
}

/* ───────── VoiceToText ───────── */
// Mic button: record → keep the file → transcribe → hand the text (and the recording's URI) back.
export function VoiceToText({ onText, compact }: { onText: (text: string, audioUri: string) => void; compact?: boolean }) {
  const { t, lang } = useLang();
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const [state, setState] = useState<'idle' | 'recording' | 'busy'>('idle');

  const start = async () => {
    try {
      const perm = await AudioModule.requestRecordingPermissionsAsync();
      if (!perm.granted) return notice(t.c.micDenied);
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      setState('recording');
    } catch (e) {
      notice(String(e), t.c.error);
    }
  };

  const stop = async () => {
    setState('busy');
    let saved = '';
    try {
      await recorder.stop();
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(() => {});
      if (!recorder.uri) throw new Error('no recording');
      saved = await UploadFile(recorder.uri, 'voice.m4a');
      onText(await TranscribeAudio(saved, lang), saved);
    } catch (e) {
      // the recording itself is still worth keeping when only the transcription failed
      if (saved) onText('', saved);
      notice(e instanceof NoKeyError ? t.c.aiNeedKey : String(e), e instanceof NoKeyError ? '' : t.c.aiError);
    } finally {
      setState('idle');
    }
  };

  if (compact) return <IconBtn icon={state === 'recording' ? '⏹' : state === 'busy' ? '⏳' : '🎤'} onPress={state === 'recording' ? stop : start} disabled={state === 'busy'} label={state === 'recording' ? t.c.stopRecord : t.c.record} />;
  return (
    <Btn kind={state === 'recording' ? 'danger' : 'ghost'} small loading={state === 'busy'}
      title={state === 'recording' ? `⏹ ${t.c.stopRecord}` : state === 'busy' ? t.c.transcribing : `🎤 ${t.c.record}`}
      onPress={state === 'recording' ? stop : start} />
  );
}

export function AudioClip({ uri, onRemove }: { uri: string; onRemove?: () => void }) {
  const { t } = useLang();
  const play = () => {
    try {
      const p = createAudioPlayer({ uri });
      p.play();
      setTimeout(() => p.remove(), 10 * 60 * 1000);
    } catch (e) {
      notice(String(e), t.c.error);
    }
  };
  return (
    <Row>
      <Btn small kind="ghost" title={`▶ ${t.c.listen}`} onPress={play} />
      {onRemove ? <IconBtn icon="✕" onPress={onRemove} label={t.c.delete} /> : null}
    </Row>
  );
}

/* ───────── CalendarView ───────── */
export function CalendarView({ taskDates, habitDates, selected, onSelect }: { taskDates: Set<string>; habitDates: Set<string>; selected?: string; onSelect?: (d: string) => void }) {
  const c = useTheme();
  const { t, lang } = useLang();
  const [cursor, setCursor] = useState(() => today().slice(0, 7) + '-01');
  const first = parse(cursor);
  const count = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  const cells: (string | null)[] = [...Array(first.getDay()).fill(null), ...Array.from({ length: count }, (_, i) => addDays(cursor, i))];
  const shift = (n: number) => setCursor(ymd(new Date(first.getFullYear(), first.getMonth() + n, 1)));
  return (
    <Card>
      <Row style={{ justifyContent: 'space-between' }}>
        <IconBtn icon="‹" onPress={() => shift(-1)} label={t.c.back} />
        <Txt v="sub">{first.toLocaleDateString(lang === 'ar' ? 'ar' : 'en', { month: 'long', year: 'numeric' })}</Txt>
        <IconBtn icon="›" onPress={() => shift(1)} label={t.c.next} />
      </Row>
      <Row gap={0}>{t.daysShort.map((d, i) => <Text key={i} style={{ flex: 1, textAlign: 'center', fontSize: 11, color: c.muted }}>{d}</Text>)}</Row>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
        {cells.map((d, i) => (
          <Pressable key={i} disabled={!d} onPress={() => d && onSelect?.(d)} style={{ width: `${100 / 7}%`, height: 40, alignItems: 'center', justifyContent: 'center' }}>
            {d ? (
              <View style={{ alignItems: 'center', justifyContent: 'center', width: 34, height: 34, borderRadius: 17, backgroundColor: d === selected ? c.soft : 'transparent', borderWidth: d === today() ? 1.5 : 0, borderColor: c.primary }}>
                <Text style={{ color: c.text, fontSize: 12 }}>{Number(d.slice(8))}</Text>
                <View style={{ flexDirection: 'row', gap: 2, height: 5 }}>
                  {taskDates.has(d) ? <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: c.primary }} /> : null}
                  {habitDates.has(d) ? <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: c.warn }} /> : null}
                </View>
              </View>
            ) : null}
          </Pressable>
        ))}
      </View>
      <Row gap={14}>
        <Row gap={4}><View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: c.primary }} /><Txt v="small">{t.dash.legendTasks}</Txt></Row>
        <Row gap={4}><View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: c.warn }} /><Txt v="small">{t.dash.legendHabits}</Txt></Row>
      </Row>
    </Card>
  );
}

/* ───────── QuickAddFAB ───────── */
export function QuickAddFAB({ onTask, onHabit, onGoal }: { onTask: () => void; onHabit: () => void; onGoal: () => void }) {
  const c = useTheme();
  const { t } = useLang();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const items = [
    { icon: '✅', label: t.dash.quickTask, run: onTask },
    { icon: '🔥', label: t.dash.quickHabit, run: onHabit },
    { icon: '🎯', label: t.dash.quickGoal, run: onGoal },
    { icon: '📔', label: t.dash.quickJournal, run: () => router.push('/journal') },
  ];
  return (
    <View style={{ position: 'absolute', bottom: 22, end: 22, alignItems: 'flex-end', gap: 8 }}>
      {open ? items.map((it) => (
        <Pressable key={it.label} accessibilityRole="button" onPress={() => { setOpen(false); it.run(); }}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: c.card, borderWidth: 1, borderColor: c.border, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 9, elevation: 4 }}>
          <Text style={{ fontSize: 16 }}>{it.icon}</Text>
          <Text style={{ color: c.text, fontWeight: '600' }}>{it.label}</Text>
        </Pressable>
      )) : null}
      <Pressable onPress={() => setOpen((v) => !v)} accessibilityRole="button" accessibilityLabel={t.c.add}
        style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: c.primary, alignItems: 'center', justifyContent: 'center', elevation: 5 }}>
        <Text style={{ color: c.onPrimary, fontSize: 28, lineHeight: 30 }}>{open ? '✕' : '+'}</Text>
      </Pressable>
    </View>
  );
}
