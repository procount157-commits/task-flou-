// Versioned migrations with a backup taken before the first change. Pure; storage injected.

export interface KVStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
}
export type Migration = { version: number; name: string; run: (read: (k: string) => Promise<any[]>, write: (k: string, rows: any[]) => Promise<void>) => Promise<void> };

export const VERSION_KEY = 'meta:schema_version';
export const BACKUP_PREFIX = 'backup:v';

/**
 * Runs every migration newer than the stored version, in order. Before the first one, every key in
 * `keys` is copied to `backup:v<from>:<key>` so nothing can be lost. Stops (and keeps the version)
 * at the first failure, so the next launch retries from the same point.
 */
export async function runMigrations(store: KVStore, keys: string[], migrations: Migration[]): Promise<{ from: number; to: number; ran: string[]; error?: string }> {
  const from = Number((await store.get(VERSION_KEY)) ?? '1') || 1;
  const todo = migrations.filter((m) => m.version > from).sort((a, b) => a.version - b.version);
  if (!todo.length) return { from, to: from, ran: [] };
  for (const k of keys) {
    const v = await store.get(k);
    if (v != null && (await store.get(`${BACKUP_PREFIX}${from}:${k}`)) == null) await store.set(`${BACKUP_PREFIX}${from}:${k}`, v);
  }
  const read = async (k: string) => {
    const v = await store.get(k);
    try {
      return v ? JSON.parse(v) : [];
    } catch {
      return [];
    }
  };
  const write = (k: string, rows: any[]) => store.set(k, JSON.stringify(rows));
  const ran: string[] = [];
  let to = from;
  for (const m of todo) {
    try {
      await m.run(read, write);
      to = m.version;
      ran.push(m.name);
      await store.set(VERSION_KEY, String(to));
    } catch (e) {
      return { from, to, ran, error: `${m.name}: ${(e as Error).message}` };
    }
  }
  return { from, to, ran };
}

export const memoryKV = (init: Record<string, string> = {}): KVStore & { data: Record<string, string> } => {
  const s = { data: { ...init }, get: async (k: string) => s.data[k] ?? null, set: async (k: string, v: string) => void (s.data[k] = v) };
  return s;
};
