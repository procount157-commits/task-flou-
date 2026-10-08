import { requireOptionalNativeModule } from 'expo';

type PhoneLockNative = {
  isAdmin(): boolean;
  requestAdmin(explanation: string): void;
  removeAdmin(): void;
  lockNow(): boolean;
  startLock(minutes: number): boolean;
  lockEndsAt(): number;
  pin(): void;
  unpin(): void;
};

// Android only (modules/phone-lock); null on the web, on iOS and in Expo Go.
const native = requireOptionalNativeModule<PhoneLockNative>('PhoneLock');

export const lockAvailable = !!native;
export const MAX_LOCK_MINUTES = 180;

const safe = <T,>(run: (m: PhoneLockNative) => T, fallback: T): T => {
  try {
    return native ? run(native) : fallback;
  } catch {
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
