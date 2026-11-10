// Durable outbox for external writes (Google Calendar, Notion). Pure logic; storage is injected.

export type Provider = 'google' | 'notion';
export type OpType = 'upsert' | 'delete';
export type OpStatus = 'pending' | 'running' | 'failed' | 'dead';
export interface Op {
  id: string;
  provider: Provider;
  type: OpType;
  entity: 'task';
  entityId: string;
  /** Snapshot needed to perform a delete after the task row is gone. */
  payload?: Record<string, unknown>;
  attempts: number;
  status: OpStatus;
  nextAt: number; // epoch ms
  createdAt: number;
  lastError?: string;
}
export interface Store {
  load(): Promise<Op[]>;
  save(ops: Op[]): Promise<void>;
}
/** Thrown by handlers for errors that will never succeed on retry (400, 403 without scope…). */
export class PermanentError extends Error {}
/** Thrown by handlers when the user must act (not connected / token revoked). Op stays queued, no attempt is counted. */
export class NeedsAuthError extends Error {}

export const MAX_ATTEMPTS = 8;
/** 30 s, 1 m, 2 m, 4 m … capped at 6 h, with ±20 % jitter derived from the op id (deterministic in tests). */
export function backoff(attempt: number, id = '') {
  const base = Math.min(30_000 * 2 ** Math.max(0, attempt - 1), 6 * 3600_000);
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return Math.round(base * (0.8 + ((h % 1000) / 1000) * 0.4));
}

/**
 * Adds an op, coalescing with what is already queued for the same (provider, entityId):
 * upsert after upsert → one upsert; delete after upsert → delete; upsert after delete → upsert.
 * This is what makes "edit 5 times offline" produce exactly one remote write.
 */
export function enqueue(ops: Op[], op: Omit<Op, 'attempts' | 'status' | 'nextAt' | 'createdAt'>, now: number): Op[] {
  const rest = ops.filter((o) => !(o.provider === op.provider && o.entityId === op.entityId && o.status !== 'running'));
  const prev = ops.find((o) => o.provider === op.provider && o.entityId === op.entityId && o.status !== 'running');
  const payload = { ...(prev?.payload ?? {}), ...(op.payload ?? {}) };
  return [...rest, { ...op, payload, attempts: 0, status: 'pending', nextAt: now, createdAt: prev?.createdAt ?? now }];
}

export type Handler = (op: Op) => Promise<void>;
export type RunReport = { done: number; failed: number; dead: number; waitingAuth: number; remaining: number; errors: string[] };

/** Runs every due op once. Successful ops are removed; failures are rescheduled; never throws. */
export async function drain(store: Store, handlers: Partial<Record<Provider, Handler>>, now: () => number): Promise<RunReport> {
  const report: RunReport = { done: 0, failed: 0, dead: 0, waitingAuth: 0, remaining: 0, errors: [] };
  let ops = await store.load();
  const due = ops.filter((o) => (o.status === 'pending' || o.status === 'failed') && o.nextAt <= now()).sort((a, b) => a.createdAt - b.createdAt);
  const blocked = new Set<Provider>();
  for (const op of due) {
    const handle = handlers[op.provider];
    if (!handle || blocked.has(op.provider)) continue;
    try {
      await handle(op);
      // an edit made while this op was in flight was queued under a new id, so it survives this filter
      ops = (await store.load()).filter((o) => o.id !== op.id);
      report.done++;
    } catch (e) {
      const msg = (e as Error)?.message ?? String(e);
      ops = await store.load();
      if (e instanceof NeedsAuthError) {
        blocked.add(op.provider);
        report.waitingAuth++;
        continue;
      }
      const attempts = op.attempts + 1;
      const dead = e instanceof PermanentError || attempts >= MAX_ATTEMPTS;
      ops = ops.map((o) => (o.id === op.id ? { ...o, attempts, status: dead ? 'dead' : 'failed', lastError: msg.slice(0, 300), nextAt: now() + backoff(attempts, o.id) } : o));
      report.errors.push(msg);
      if (dead) report.dead++;
      else report.failed++;
    }
    await store.save(ops);
  }
  report.remaining = ops.filter((o) => o.status !== 'dead').length;
  return report;
}

export const pendingCount = (ops: Op[], provider?: Provider) => ops.filter((o) => o.status !== 'dead' && (!provider || o.provider === provider)).length;
export const retryDead = (ops: Op[], now: number) => ops.map((o) => (o.status === 'dead' ? { ...o, status: 'pending' as const, attempts: 0, nextAt: now } : o));

/** In-memory store for tests. */
export const memoryStore = (init: Op[] = []): Store & { ops: Op[] } => {
  const s = { ops: init, load: async () => s.ops, save: async (o: Op[]) => void (s.ops = o) };
  return s;
};
