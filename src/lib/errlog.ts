import { kv } from './db';

export type LoggedError = { at: string; where: string; message: string };
const recent: LoggedError[] = [];

// Failures that used to be swallowed are kept here so the Check screen can show what actually went wrong.
export function logError(where: string, e: unknown) {
  const message = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
  recent.unshift({ at: new Date().toISOString().slice(0, 19).replace('T', ' '), where, message: message.slice(0, 300) });
  recent.length = Math.min(recent.length, 30);
  kv.set('errlog', [...recent]).catch(() => {});
}

export const getErrors = async () => (recent.length ? recent : await kv.get<LoggedError[]>('errlog', []));
export const clearErrors = () => {
  recent.length = 0;
  return kv.set('errlog', []);
};

// Uncaught JS errors land in the same log before the default handler runs.
export function installGlobalErrorLog() {
  const g = globalThis as any;
  const previous = g.ErrorUtils?.getGlobalHandler?.();
  g.ErrorUtils?.setGlobalHandler?.((error: unknown, isFatal?: boolean) => {
    logError(isFatal ? 'fatal' : 'uncaught', error);
    previous?.(error, isFatal);
  });
}
