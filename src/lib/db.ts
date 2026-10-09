import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';

import type { Base, EntityMap, EntityName } from './types';

// Every entity is one AsyncStorage key holding a JSON array, mirrored in memory so screens read synchronously.
const cache: Partial<Record<EntityName, any[]>> = {};
const pending: Partial<Record<EntityName, Promise<void>>> = {};
const listeners: Partial<Record<EntityName, Set<() => void>>> = {};
const EMPTY: any[] = [];
let currentUserId = 'local';

export const setCurrentUser = (id: string) => {
  currentUserId = id;
};

const key = (name: EntityName) => `db:${name}`;
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 10);

function emit(name: EntityName) {
  listeners[name]?.forEach((l) => l());
}

function ensure(name: EntityName): Promise<void> {
  if (!pending[name]) {
    pending[name] = AsyncStorage.getItem(key(name))
      .then((raw) => {
        cache[name] = raw ? JSON.parse(raw) : [];
      })
      .catch(() => {
        cache[name] = [];
      })
      .then(() => emit(name));
  }
  return pending[name]!;
}

function commit(name: EntityName, next: any[]) {
  cache[name] = next;
  emit(name);
  return AsyncStorage.setItem(key(name), JSON.stringify(next));
}

type Data<K extends EntityName> = Omit<EntityMap[K], keyof Base>;

// Reads every store in the background so the first visit to a screen finds its data already in memory.
export const preload = (names: EntityName[]) => Promise.all(names.map(ensure));

export const db = {
  async list<K extends EntityName>(name: K): Promise<EntityMap[K][]> {
    await ensure(name);
    return cache[name] as EntityMap[K][];
  },
  async create<K extends EntityName>(name: K, data: Data<K>): Promise<EntityMap[K]> {
    await ensure(name);
    const now = new Date().toISOString();
    const rec = { ...data, id: uid(), created_date: now, updated_date: now, created_by_id: currentUserId } as unknown as EntityMap[K];
    await commit(name, [...cache[name]!, rec]);
    return rec;
  },
  async bulkCreate<K extends EntityName>(name: K, rows: Data<K>[]): Promise<EntityMap[K][]> {
    await ensure(name);
    const now = new Date().toISOString();
    const recs = rows.map((data) => ({ ...data, id: uid(), created_date: now, updated_date: now, created_by_id: currentUserId }) as unknown as EntityMap[K]);
    await commit(name, [...cache[name]!, ...recs]);
    return recs;
  },
  async update<K extends EntityName>(name: K, id: string, patch: Partial<Data<K>>): Promise<void> {
    await ensure(name);
    const now = new Date().toISOString();
    await commit(name, cache[name]!.map((r) => (r.id === id ? { ...r, ...patch, updated_date: now } : r)));
  },
  async remove<K extends EntityName>(name: K, id: string): Promise<void> {
    await ensure(name);
    await commit(name, cache[name]!.filter((r) => r.id !== id));
  },
  // Puts records back exactly as they were (same ids), replacing any newer copy: the undo of a delete or edit.
  async restore<K extends EntityName>(name: K, recs: EntityMap[K][]): Promise<void> {
    await ensure(name);
    const ids = new Set(recs.map((r) => r.id));
    await commit(name, [...cache[name]!.filter((r) => !ids.has(r.id)), ...recs]);
  },
  async removeWhere<K extends EntityName>(name: K, pred: (r: EntityMap[K]) => boolean): Promise<void> {
    await ensure(name);
    await commit(name, cache[name]!.filter((r) => !pred(r)));
  },
};

export function useEntity<K extends EntityName>(name: K) {
  const items = useSyncExternalStore(
    (cb) => {
      (listeners[name] ??= new Set()).add(cb);
      return () => listeners[name]!.delete(cb);
    },
    () => (cache[name] ?? EMPTY) as EntityMap[K][],
  );
  const [loading, setLoading] = useState(cache[name] === undefined);
  useEffect(() => {
    let live = true;
    ensure(name).then(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [name]);
  return {
    items,
    loading,
    create: (data: Data<K>) => db.create(name, data),
    update: (id: string, patch: Partial<Data<K>>) => db.update(name, id, patch),
    remove: (id: string) => db.remove(name, id),
  };
}

// Small persisted key/value cells (points, settings, …) with the same subscribe-and-read shape.
const kvCache: Record<string, any> = {};
const kvLoaded: Record<string, Promise<void>> = {};
const kvListeners: Record<string, Set<() => void>> = {};

function kvEnsure(k: string) {
  return (kvLoaded[k] ??= AsyncStorage.getItem(`kv:${k}`)
    .then((raw) => {
      if (raw != null) kvCache[k] = JSON.parse(raw);
    })
    .catch(() => {})
    .then(() => kvListeners[k]?.forEach((l) => l())));
}

export const kv = {
  async get<T>(k: string, fallback: T): Promise<T> {
    await kvEnsure(k);
    return k in kvCache ? kvCache[k] : fallback;
  },
  async set<T>(k: string, value: T) {
    await kvEnsure(k);
    kvCache[k] = value;
    kvListeners[k]?.forEach((l) => l());
    await AsyncStorage.setItem(`kv:${k}`, JSON.stringify(value));
  },
};

export function useKV<T>(k: string, fallback: T): [T, (v: T) => Promise<void>] {
  // the snapshot must be referentially stable, so the first fallback is the one kept
  const first = useRef(fallback).current;
  const value = useSyncExternalStore(
    (cb) => {
      (kvListeners[k] ??= new Set()).add(cb);
      return () => kvListeners[k].delete(cb);
    },
    () => (k in kvCache ? (kvCache[k] as T) : first),
  );
  useEffect(() => {
    kvEnsure(k);
  }, [k]);
  return [value, (v: T) => kv.set(k, v)];
}
