import AsyncStorage from '@react-native-async-storage/async-storage';
import { AudioPlayer, createAudioPlayer } from 'expo-audio';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { useLang } from './Lang';
import { nowTime, today } from '@/lib/dates';
import { db, useKV } from '@/lib/db';
import { addPoints, POINTS } from '@/lib/logic';
import { cancel, scheduleAt } from '@/lib/notify';
import { startPhoneLock } from '@/lib/phonelock';

export const SOUNDS: Record<string, number> = {
  white: require('../../assets/sounds/white.wav'),
  rain: require('../../assets/sounds/rain.wav'),
  thunder: require('../../assets/sounds/thunder.wav'),
  wind: require('../../assets/sounds/wind.wav'),
  waves: require('../../assets/sounds/waves.wav'),
  fan: require('../../assets/sounds/fan.wav'),
  forest: require('../../assets/sounds/forest.wav'),
  fire: require('../../assets/sounds/fire.wav'),
};
export const SOUND_KEYS = ['none', ...Object.keys(SOUNDS)] as const;

export type Phase = 'focus' | 'break';
export type Session = {
  taskId?: string;
  taskTitle: string;
  subTasks: string[];
  step: number;
  phase: Phase;
  endsAt: number;
  paused: boolean;
  remainingMs: number;
  focusMin: number;
  breakMin: number;
  sessionsCompleted: number;
  cyclesCompleted: number;
  focusedMs: number;
  startedAt: number;
};
export type Completed = { taskTitle: string; focusMinutes: number; sessions: number; cycles: number };
export type PomoSettings = { focusMin: number; breakMin: number; sound: string; volume: number; lockPhone?: boolean };
const DEFAULTS: PomoSettings = { focusMin: 90, breakMin: 20, sound: 'none', volume: 0.5 };
const KEY = 'pomodoro:session';
const NOTIF_IDS = Array.from({ length: 12 }, (_, i) => `pomo-${i}`);

type Ctx = {
  session: Session | null;
  completedSession: Completed | null;
  settings: PomoSettings;
  setSettings: (s: PomoSettings) => void;
  remainingMs: number;
  isActive: boolean;
  startSession: (o: { taskId?: string; taskTitle: string; subTasks?: string[] }) => void;
  pauseSession: () => void;
  resumeSession: () => void;
  skipPhase: () => void;
  resetSession: () => void;
  interruptSession: () => void;
  clearCompleted: () => void;
};
const C = createContext<Ctx>(null as any);
export const usePomodoro = () => useContext(C);

const phaseMs = (s: Session, phase = s.phase) => (phase === 'focus' ? s.focusMin : s.breakMin) * 60000;

// Moves one phase forward as of `at`; null means the whole session is finished.
function advance(s: Session, at: number, countFull: boolean): Session | null {
  if (s.phase === 'focus')
    return { ...s, phase: 'break', endsAt: at + s.breakMin * 60000, sessionsCompleted: s.sessionsCompleted + 1, focusedMs: s.focusedMs + (countFull ? phaseMs(s) : Math.max(0, phaseMs(s) - (s.endsAt - at))) };
  if (s.step < s.subTasks.length - 1)
    return { ...s, phase: 'focus', step: s.step + 1, endsAt: at + s.focusMin * 60000, cyclesCompleted: s.cyclesCompleted + 1 };
  return null;
}

export function PomodoroProvider({ children }: { children: React.ReactNode }) {
  const { t } = useLang();
  const [session, setSession] = useState<Session | null>(null);
  const [completedSession, setCompleted] = useState<Completed | null>(null);
  const [settings, setSettings] = useKV<PomoSettings>('pomodoro:settings', DEFAULTS);
  const [now, setNow] = useState(Date.now());
  const ref = useRef<Session | null>(null);
  const tRef = useRef(t);
  tRef.current = t;

  const record = useCallback(async (s: Session, finished: boolean) => {
    const minutes = Math.round(s.focusedMs / 60000);
    if (minutes < 1 && !finished) return;
    await db.create('PomodoroSession', {
      date: today(), focus_minutes: minutes, break_minutes: s.breakMin, sessions_completed: s.sessionsCompleted,
      cycles_completed: s.cyclesCompleted + (finished ? 1 : 0), task_title: s.taskTitle,
      start_time: new Date(s.startedAt).toTimeString().slice(0, 5), end_time: nowTime(), sound_preference: settings.sound,
    });
    if (finished && s.taskId) {
      const task = (await db.list('DailyTask')).find((x) => x.id === s.taskId);
      if (task && !task.completed) {
        await db.update('DailyTask', task.id, { completed: true });
        await addPoints(POINTS[task.priority ?? 'medium']);
      }
    }
    if (finished) setCompleted({ taskTitle: s.taskTitle, focusMinutes: minutes, sessions: s.sessionsCompleted, cycles: s.cyclesCompleted + 1 });
  }, [settings.sound]);

  // One notification per upcoming phase boundary, so they still fire while the app is closed.
  const reschedule = useCallback(async (s: Session | null) => {
    await cancel(...NOTIF_IDS);
    if (!s || s.paused) return;
    let cur: Session | null = s;
    for (let i = 0; cur && i < NOTIF_IDS.length; i++) {
      const next: Session | null = advance(cur, cur.endsAt, true);
      const body = !next ? tRef.current.pomo.sessionDone : cur.phase === 'focus' ? tRef.current.pomo.focusEnded : tRef.current.pomo.breakEnded;
      await scheduleAt(NOTIF_IDS[i], `⏱ ${s.taskTitle}`, body, new Date(cur.endsAt));
      cur = next;
    }
  }, []);

  const apply = useCallback((s: Session | null, notify = true) => {
    ref.current = s;
    setSession(s);
    if (s) AsyncStorage.setItem(KEY, JSON.stringify(s));
    else AsyncStorage.removeItem(KEY);
    if (notify) reschedule(s);
  }, [reschedule]);

  // Fast-forwards through every phase whose wall-clock end has already passed.
  const catchUp = useCallback(() => {
    let s = ref.current;
    if (!s || s.paused) return;
    const t0 = Date.now();
    let changed = false;
    while (s && t0 >= s.endsAt) {
      const next: Session | null = advance(s, s.endsAt, true);
      changed = true;
      if (!next) {
        record(s, true);
        apply(null);
        return;
      }
      s = next;
    }
    if (changed) apply(s, false);
  }, [apply, record]);

  useEffect(() => {
    AsyncStorage.getItem(KEY).then((raw) => {
      if (!raw) return;
      try {
        ref.current = JSON.parse(raw);
        setSession(ref.current);
        catchUp();
      } catch {}
    });
    const sub = AppState.addEventListener('change', (st) => st === 'active' && (setNow(Date.now()), catchUp()));
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const running = !!session && !session.paused;
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => {
      setNow(Date.now());
      catchUp();
    }, 1000);
    return () => clearInterval(id);
  }, [running, catchUp]);

  // The ambient loop lives here so it keeps playing across screens; it only runs during focus.
  const player = useRef<{ key: string; p: AudioPlayer } | null>(null);
  const wantSound = running && session?.phase === 'focus' && settings.sound !== 'none' ? settings.sound : null;
  useEffect(() => {
    try {
      if (player.current && player.current.key !== wantSound) {
        player.current.p.pause();
        player.current.p.remove();
        player.current = null;
      }
      if (wantSound && SOUNDS[wantSound] && !player.current) {
        const p = createAudioPlayer(SOUNDS[wantSound]);
        p.loop = true;
        p.volume = settings.volume;
        p.play();
        player.current = { key: wantSound, p };
      } else if (player.current) player.current.p.volume = settings.volume;
    } catch {}
  }, [wantSound, settings.volume]);

  const value = useMemo<Ctx>(() => {
    const s = session;
    return {
      session,
      completedSession,
      settings,
      setSettings: (v) => void setSettings(v),
      remainingMs: !s ? 0 : s.paused ? s.remainingMs : Math.max(0, s.endsAt - now),
      isActive: !!s,
      startSession: ({ taskId, taskTitle, subTasks = [] }) => {
        setCompleted(null);
        // the hard lock covers the focus period only, never the break
        if (settings.lockPhone) startPhoneLock(settings.focusMin);
        const t0 = Date.now();
        setNow(t0);
        apply({
          taskId, taskTitle, subTasks, step: 0, phase: 'focus', endsAt: t0 + settings.focusMin * 60000, paused: false, remainingMs: 0,
          focusMin: settings.focusMin, breakMin: settings.breakMin, sessionsCompleted: 0, cyclesCompleted: 0, focusedMs: 0, startedAt: t0,
        });
      },
      pauseSession: () => s && !s.paused && apply({ ...s, paused: true, remainingMs: Math.max(0, s.endsAt - Date.now()) }),
      resumeSession: () => {
        if (!s?.paused) return;
        setNow(Date.now());
        apply({ ...s, paused: false, endsAt: Date.now() + s.remainingMs });
      },
      skipPhase: () => {
        if (!s) return;
        const t0 = Date.now();
        // a paused session's endsAt is stale, so rebuild it from what was left
        const live = s.paused ? { ...s, paused: false, endsAt: t0 + s.remainingMs } : s;
        const next = advance(live, t0, false);
        setNow(t0);
        if (next) apply(next);
        else {
          record(live, true);
          apply(null);
        }
      },
      resetSession: () => {
        if (!s) return;
        setNow(Date.now());
        apply({ ...s, paused: false, endsAt: Date.now() + phaseMs(s) });
      },
      interruptSession: () => {
        if (!s) return;
        const left = s.paused ? s.remainingMs : Math.max(0, s.endsAt - Date.now());
        record({ ...s, focusedMs: s.focusedMs + (s.phase === 'focus' ? phaseMs(s) - left : 0) }, false);
        apply(null);
      },
      clearCompleted: () => setCompleted(null),
    };
  }, [session, completedSession, settings, setSettings, now, apply, record]);

  return <C.Provider value={value}>{children}</C.Provider>;
}
