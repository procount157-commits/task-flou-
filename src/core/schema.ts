// Tiny runtime validator for AI output. Every AI JSON answer goes through one of these before it touches data.

export type Result<T> = { ok: true; value: T } | { ok: false; errors: string[] };
type V<T> = (x: unknown, path: string, errs: string[]) => T | undefined;

export const str = (o: { min?: number; max?: number; optional?: boolean } = {}): V<string> => (x, p, e) => {
  if (x == null || x === '') {
    if (!o.optional) e.push(`${p}: required`);
    return undefined;
  }
  if (typeof x !== 'string') return void e.push(`${p}: expected string`);
  const v = x.trim();
  if (o.min && v.length < o.min) return void e.push(`${p}: too short`);
  return o.max ? v.slice(0, o.max) : v;
};
export const num = (o: { min?: number; max?: number; int?: boolean; optional?: boolean } = {}): V<number> => (x, p, e) => {
  if (x == null || x === '') {
    if (!o.optional) e.push(`${p}: required`);
    return undefined;
  }
  const n = typeof x === 'string' ? Number(x) : x;
  if (typeof n !== 'number' || !Number.isFinite(n)) return void e.push(`${p}: expected number`);
  if ((o.min != null && n < o.min) || (o.max != null && n > o.max)) return void e.push(`${p}: out of range`);
  return o.int ? Math.round(n) : n;
};
export const oneOf = <T extends string>(vals: readonly T[], optional = true): V<T> => (x, p, e) => {
  if (x == null || x === '') {
    if (!optional) e.push(`${p}: required`);
    return undefined;
  }
  const v = String(x).toLowerCase() as T;
  if (!vals.includes(v)) return void e.push(`${p}: must be one of ${vals.join('|')}`);
  return v;
};
export const pattern = (re: RegExp, optional = true): V<string> => (x, p, e) => {
  if (x == null || x === '') {
    if (!optional) e.push(`${p}: required`);
    return undefined;
  }
  if (typeof x !== 'string' || !re.test(x)) return void e.push(`${p}: bad format`);
  return x;
};
export const arr = <T>(item: V<T>, o: { min?: number; max?: number; optional?: boolean } = {}): V<T[]> => (x, p, e) => {
  if (x == null) {
    if (!o.optional) e.push(`${p}: required`);
    return o.optional ? [] : undefined;
  }
  if (!Array.isArray(x)) return void e.push(`${p}: expected array`);
  const list = (o.max ? x.slice(0, o.max) : x).map((v, i) => item(v, `${p}[${i}]`, e)).filter((v): v is T => v !== undefined);
  if (o.min && list.length < o.min) e.push(`${p}: needs at least ${o.min}`);
  return list;
};
export const obj = <S extends Record<string, V<any>>>(shape: S): V<{ [K in keyof S]: ReturnType<S[K]> }> => (x, p, e) => {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return void e.push(`${p}: expected object`);
  const out: any = {};
  for (const k of Object.keys(shape)) {
    const v = shape[k]((x as any)[k], p ? `${p}.${k}` : k, e);
    if (v !== undefined) out[k] = v;
  }
  return out;
};

export function validate<T>(schema: V<T>, x: unknown): Result<T> {
  const errors: string[] = [];
  const value = schema(x, '', errors);
  return errors.length || value === undefined ? { ok: false, errors: errors.length ? errors : ['empty'] } : { ok: true, value };
}

/** Pulls the first JSON object/array out of a model reply (models wrap JSON in prose or ``` fences). */
export function extractJSON(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1] : text;
  const start = body.search(/[[{]/);
  if (start < 0) throw new Error('no JSON in reply');
  const open = body[start];
  const close = open === '{' ? '}' : ']';
  let depth = 0;
  let inStr = false;
  for (let i = start; i < body.length; i++) {
    const ch = body[i];
    if (inStr) {
      if (ch === '\\') i++;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === open) depth++;
    else if (ch === close && --depth === 0) return JSON.parse(body.slice(start, i + 1));
  }
  throw new Error('unterminated JSON in reply');
}

/** Parses + validates; returns errors instead of throwing so callers can show them and offer "regenerate". */
export function parseAI<T>(schema: V<T>, text: string): Result<T> {
  let raw: unknown;
  try {
    raw = extractJSON(text);
  } catch (e) {
    return { ok: false, errors: [(e as Error).message] };
  }
  return validate(schema, raw);
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

// ── schemas used by the app ───────────────────────────────────────────────
export const BreakdownSchema = obj({
  steps: arr(obj({ title: str({ min: 2, max: 140 }), minutes: num({ min: 1, max: 480, int: true, optional: true }) }), { min: 1, max: 20 }),
});
export type Breakdown = { steps: { title: string; minutes?: number }[] };

export const SmartTaskSchema = obj({
  title: str({ min: 1, max: 200 }),
  date: pattern(DATE),
  time: pattern(TIME),
  due_date: pattern(DATE),
  minutes: num({ min: 5, max: 600, int: true, optional: true }),
  priority: oneOf(['low', 'medium', 'high'] as const),
  goal: str({ optional: true, max: 200 }),
  steps: arr(str({ min: 2, max: 140 }), { optional: true, max: 12 }),
});

export const GoalPlanSchema = obj({
  summary: str({ optional: true, max: 600 }),
  milestones: arr(obj({ title: str({ min: 2, max: 160 }), in_days: num({ min: 0, max: 3650, int: true }), measure: str({ optional: true, max: 160 }) }), { optional: true, max: 12 }),
  tasks: arr(
    obj({
      title: str({ min: 2, max: 160 }),
      in_days: num({ min: 0, max: 3650, int: true }),
      time: pattern(TIME),
      minutes: num({ min: 5, max: 480, int: true, optional: true }),
      priority: oneOf(['low', 'medium', 'high'] as const),
      milestone: num({ min: 0, max: 20, int: true, optional: true }),
      steps: arr(str({ min: 2, max: 140 }), { optional: true, max: 8 }),
    }),
    { min: 1, max: 60 },
  ),
});

export const DayPlanSchema = obj({
  blocks: arr(obj({ id: str(), time: pattern(TIME, false), minutes: num({ min: 5, max: 480, int: true }) }), { max: 40 }),
  note: str({ optional: true, max: 400 }),
});

/** Strips a validated value of the leading/trailing garbage models add to titles. */
export const cleanTitle = (s: string) => s.replace(/^[\s\-*•\d.)]+/, '').replace(/\s+/g, ' ').trim();
