import { requireOptionalNativeModule } from 'expo';

import { logError } from './errlog';
import type { Alarm } from './types';

type PhoneLockNative = {
  isAdmin(): boolean;
  requestAdmin(explanation: string): void;
  removeAdmin(): void;
  lockNow(): boolean;
  startLock(minutes: number): boolean;
  lockEndsAt(): number;
  pin(): void;
  unpin(): void;
  scheduleLock(code: number, atMillis: number, minutes: number): boolean;
  cancelLock(code: number): void;
  setHourly(enabled: boolean, fromHour: number, toHour: number, payload: string): void;
  showHourly(): void;
  takeHourly?(): string;
  closeHourly?(): void;
  scheduleAlarm(code: number, atMillis: number, id: string, sound: string, label: string): void;
  clearAlarms(): void;
  startRinging(id: string, sound: string, label: string): void;
  stopRinging(): void;
  ringingId(): string;
  pickRingtone(current: string): Promise<{ uri: string; title: string } | null>;
};

// Android only (modules/phone-lock); null on the web, on iOS and in Expo Go.
const native = requireOptionalNativeModule<PhoneLockNative>('PhoneLock');

export const lockAvailable = !!native;
export const MAX_LOCK_MINUTES = 180;

const safe = <T,>(run: (m: PhoneLockNative) => T, fallback: T): T => {
  try {
    return native ? run(native) : fallback;
  } catch (e) {
    logError('phone-lock', e);
    return fallback;
  }
};

export const isLockAdmin = () => safe((m) => m.isAdmin(), false);
export const requestLockAdmin = (explanation: string) => safe((m) => m.requestAdmin(explanation), undefined);
export const removeLockAdmin = () => safe((m) => m.removeAdmin(), undefined);
export const lockScreenNow = () => safe((m) => m.lockNow(), false);
export const startPhoneLock = (minutes: number) => safe((m) => m.startLock(minutes), false);
export const pinApp = () => safe((m) => m.pin(), undefined);
export const unpinApp = () => safe((m) => m.unpin(), undefined);

/* ───────── scheduled locks ───────── */
export type LockSchedule = { id: string; time: string; days: number[]; minutes: number; enabled: boolean; label?: string };
const SLOTS = 12;

// Books each enabled schedule for the coming week. Android forgets alarms on restart and the window
// is seven days, so this runs again every time the app opens.
export function syncLockSchedules(list: LockSchedule[]) {
  if (!native) return;
  safe((m) => {
    for (let code = 0; code < SLOTS * 10; code++) m.cancelLock(code);
    list.slice(0, SLOTS).forEach((s, slot) => {
      if (!s.enabled) return;
      const [hh, mm] = s.time.split(':').map(Number);
      for (let d = 0; d < 7; d++) {
        const at = new Date();
        at.setDate(at.getDate() + d);
        at.setHours(hh, mm, 0, 0);
        if (at.getTime() <= Date.now() || (s.days.length && !s.days.includes(at.getDay()))) continue;
        m.scheduleLock(slot * 10 + d, at.getTime(), Math.min(MAX_LOCK_MINUTES, s.minutes));
      }
    });
  }, undefined);
}

/* ───────── hourly question card ───────── */
export type HourlyStep = { q: string; input: boolean; choices: string[] };
export type HourlyCard = {
  title: string; lines: string[]; questions: string[]; quotes: string[]; goal?: string; tap: string;
  // the session asked inside the notification, and how the phone reaches the AI for its closing reading
  steps?: HourlyStep[]; typeLabel?: string; replyLabel?: string; voiceLabel?: string; doneTitle?: string; analyzing?: string; system?: string;
  ai?: { url: string; key: string; model: string }[];
};
export type HourlyAnswered = { date: string; time: string; answers: { q: string; a: string }[]; insight?: string };
export const hourlyCardAvailable = !!native && typeof native.setHourly === 'function';
export const setHourlyCard = (enabled: boolean, fromHour: number, toHour: number, card: HourlyCard) =>
  safe((m) => (m.setHourly(enabled, fromHour, toHour, JSON.stringify(card)), true), false);
export const showHourlyCard = () => safe((m) => (m.showHourly(), true), false);
export const takeHourlyAnswers = (): HourlyAnswered[] =>
  safe((m) => (typeof m.takeHourly === 'function' ? JSON.parse(m.takeHourly() || '[]') : []), []);
export const closeHourly = () => safe((m) => m.closeHourly?.(), undefined);

/* ───────── ringing alarm ───────── */

// The alarm rings from an Android service on the alarm stream: it keeps going with the screen locked.
export const nativeAlarmAvailable = !!native && typeof native.scheduleAlarm === 'function';
// what the service is asked to play: the phone tone's address, or the name of a built-in siren
export const alarmSoundSpec = (a: Pick<Alarm, 'sound' | 'tone'>) => a.tone?.uri ?? `alarm_${a.sound}`;

// Books every enabled alarm for the coming week (re-run whenever the app opens).
export function syncNativeAlarms(alarms: Alarm[]) {
  safe((m) => {
    m.clearAlarms();
    alarms.filter((a) => a.enabled).slice(0, 20).forEach((a, slot) => {
      const [hh, mm] = a.time.split(':').map(Number);
      for (let d = 0; d < 7; d++) {
        const at = new Date();
        at.setDate(at.getDate() + d);
        at.setHours(hh, mm, 0, 0);
        if (at.getTime() <= Date.now() || (a.days.length && !a.days.includes(at.getDay()))) continue;
        m.scheduleAlarm(slot * 10 + d, at.getTime(), a.id, alarmSoundSpec(a), a.label ?? a.time);
      }
    });
  }, undefined);
}

export const startRinging = (a: Alarm) => safe((m) => m.startRinging(a.id, alarmSoundSpec(a), a.label ?? a.time), undefined);
export const stopRinging = () => safe((m) => m.stopRinging(), undefined);
export const ringingAlarmId = () => safe((m) => m.ringingId(), '');
export const pickRingtone = async (current = '') => (native ? native.pickRingtone(current).catch((e) => (logError('ringtone', e), null)) : null);
