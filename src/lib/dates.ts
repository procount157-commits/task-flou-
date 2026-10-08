export const pad = (n: number) => String(n).padStart(2, '0');
export const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const today = () => ymd(new Date());
export const parse = (s: string) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
};
export const addDays = (s: string, n: number) => {
  const d = parse(s);
  d.setDate(d.getDate() + n);
  return ymd(d);
};
export const weekday = (s: string) => parse(s).getDay();
export const lastDays = (n: number, end = today()) => Array.from({ length: n }, (_, i) => addDays(end, i - n + 1));
export const isDate = (s?: string) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(parse(s).getTime());
export const isTime = (s?: string) => !!s && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
export const monthKey = (s: string) => s.slice(0, 7);
export const nowTime = () => {
  const d = new Date();
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
export const fmtClock = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(s / 3600);
  return (h ? `${h}:` : '') + `${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
};
export const lastMonths = (n: number) => {
  const d = new Date();
  return Array.from({ length: n }, (_, i) => {
    const x = new Date(d.getFullYear(), d.getMonth() - (n - 1 - i), 1);
    return `${x.getFullYear()}-${pad(x.getMonth() + 1)}`;
  });
};
export const ageFrom = (birth?: string) => {
  if (!isDate(birth)) return 0;
  const b = parse(birth!);
  const n = new Date();
  let a = n.getFullYear() - b.getFullYear();
  if (n.getMonth() < b.getMonth() || (n.getMonth() === b.getMonth() && n.getDate() < b.getDate())) a--;
  return Math.max(0, a);
};
export const shiftMonth = (m: string, n: number) => {
  const d = new Date(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 1 + n, 1);
  return isNaN(d.getTime()) ? monthKey(today()) : `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
};
// "Today" / "Tomorrow" / "Yesterday" where they apply, otherwise a short localized date.
export const fmtDate = (s: string | undefined, lang: string, words: { today: string; tomorrow: string; yesterday: string }, long = false) => {
  if (!isDate(s)) return '';
  const t = today();
  if (s === t) return words.today;
  if (s === addDays(t, 1)) return words.tomorrow;
  if (s === addDays(t, -1)) return words.yesterday;
  const d = parse(s!);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString(lang === 'ar' ? 'ar-EG-u-nu-latn' : 'en-GB', { weekday: long ? 'long' : 'short', day: 'numeric', month: 'short', year: sameYear ? undefined : 'numeric' });
};
