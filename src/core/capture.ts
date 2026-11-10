// Quick capture: one sentence (Arabic or English) → a structured task draft. Pure, deterministic, offline.
import { parseTask } from '../lib/nlp';

export type Recurrence = { freq: 'daily' | 'weekly' | 'monthly'; days?: number[]; rule: string };
export type CaptureDraft = {
  title: string;
  description?: string;
  date?: string; // scheduled day
  time?: string;
  end_time?: string;
  minutes?: number;
  priority?: 'low' | 'medium' | 'high';
  due_date?: string; // deadline (not a calendar event)
  recurrence?: Recurrence;
  reminder_minutes?: number[];
  tags: string[];
  project?: string;
  goal_id?: string;
  effort?: 1 | 2 | 3 | 4 | 5;
  inbox: boolean; // nothing schedules it → goes to the Inbox, never to the calendar
  understood: string[]; // which parts were recognised (for the UI chips)
};

const toLatin = (s: string) => s.replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
const pad = (n: number) => String(n).padStart(2, '0');
const BYDAY = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
const DAY_WORDS: [RegExp, number][] = [
  [/(?:الأحد|الاحد|احد|sun(?:day)?s?)/i, 0], [/(?:الإثنين|الاثنين|اثنين|mon(?:day)?s?)/i, 1], [/(?:الثلاثاء|ثلاثاء|tue(?:sday)?s?)/i, 2],
  [/(?:الأربعاء|الاربعاء|اربعاء|wed(?:nesday)?s?)/i, 3], [/(?:الخميس|خميس|thu(?:rsday)?s?)/i, 4], [/(?:الجمعة|الجمعه|جمعة|fri(?:day)?s?)/i, 5], [/(?:السبت|سبت|sat(?:urday)?s?)/i, 6],
];

function hourOf(raw: string, pmHint: boolean, amHint: boolean) {
  const m = raw.match(/(\d{1,2})(?:[:.](\d{2}))?/);
  if (!m) return undefined;
  let h = Number(m[1]);
  const min = m[2] ? Number(m[2]) : 0;
  if (h > 23 || min > 59) return undefined;
  if (pmHint && h < 12) h += 12;
  else if (!amHint && !pmHint && h >= 1 && h <= 7) h += 12;
  return `${pad(h)}:${pad(min)}`;
}

export function capture(input: string, today: string, goals: { id: string; title: string }[] = []): CaptureDraft {
  let s = ` ${toLatin(input)} `;
  const out: CaptureDraft = { title: '', tags: [], inbox: false, understood: [] };
  const cut = (x: string | RegExp) => (s = s.replace(x, ' '));

  // description: «title :: details» or «title — details»
  const desc = s.match(/\s(?:::|—|\|)\s(.+)$/);
  if (desc) {
    out.description = desc[1].trim();
    cut(desc[0]);
    out.understood.push('description');
  }
  // tags «#tag» and project «+project» / «@project»
  for (const m of s.matchAll(/#([\p{L}\p{N}_-]+)/gu)) out.tags.push(m[1]);
  if (out.tags.length) {
    cut(/#[\p{L}\p{N}_-]+/gu);
    out.understood.push('tags');
  }
  const proj = s.match(/(?:^|\s)[+@]([\p{L}\p{N}_-]+)/u) || s.match(/(?:ضمن\s+)?مشروع\s+([\p{L}\p{N}_-]+)|project\s+([\w-]+)/iu);
  if (proj) {
    out.project = (proj[1] || proj[2]).trim();
    cut(proj[0]);
    out.understood.push('project');
  }
  // explicit inbox
  if (/(?:^|\s)(?:لاحقا|لاحقاً|بدون موعد|في الوارد|inbox|someday|later)(?=\s|$)/i.test(s)) {
    out.inbox = true;
    cut(/(?:لاحقا|لاحقاً|بدون موعد|في الوارد|inbox|someday|later)/i);
  }
  // reminder «ذكرني قبل 15 دقيقة», «remind me 10 min before», «تذكير قبل ساعة»
  const rem = s.match(/(?:ذكرني|ذكّرني|نبهني|تذكير|remind(?:\s+me)?)\s*(?:قبل(?:ها)?\s*)?(\d{1,3}|ساعة|ساعه|ربع ساعة|نص ساعة)\s*(دقيقة|دقيقه|دقائق|د|min(?:ute)?s?|ساعات|hours?|h)?\s*(?:before|قبل(?:ها)?)?/i);
  if (rem && /قبل|before|\d/.test(rem[0])) {
    const w = rem[1];
    const n = /^\d+$/.test(w) ? Number(w) * (/(ساع|hour|^h$)/i.test(rem[2] ?? '') ? 60 : 1) : /ربع/.test(w) ? 15 : /نص/.test(w) ? 30 : 60;
    if (n > 0 && n <= 7 * 24 * 60) {
      out.reminder_minutes = [n];
      cut(rem[0]);
      out.understood.push('reminder');
    }
  }
  // recurrence
  const daily = /(?:كل\s*يوم|يوميا|يومياً|every\s*day|daily)/i;
  const weekly = /(?:كل\s*(?:أسبوع|اسبوع)|أسبوعيا|اسبوعيا|أسبوعياً|weekly|every\s*week)/i;
  const monthly = /(?:كل\s*شهر|شهريا|شهرياً|monthly|every\s*month)/i;
  const everyDay = s.match(/(?:كل|every)\s+((?:(?:يوم\s+)?\S+)(?:\s*(?:و|,|،|and)\s*(?:يوم\s+)?\S+)*)/i);
  if (daily.test(s)) {
    out.recurrence = { freq: 'daily', rule: 'RRULE:FREQ=DAILY' };
    cut(daily);
  } else if (everyDay && DAY_WORDS.some(([re]) => re.test(everyDay[1]))) {
    const days = DAY_WORDS.filter(([re]) => re.test(everyDay[1])).map(([, d]) => d);
    out.recurrence = { freq: 'weekly', days, rule: `RRULE:FREQ=WEEKLY;BYDAY=${days.map((d) => BYDAY[d]).join(',')}` };
    cut(everyDay[0]);
  } else if (weekly.test(s)) {
    out.recurrence = { freq: 'weekly', rule: 'RRULE:FREQ=WEEKLY' };
    cut(weekly);
  } else if (monthly.test(s)) {
    out.recurrence = { freq: 'monthly', rule: 'RRULE:FREQ=MONTHLY' };
    cut(monthly);
  }
  if (out.recurrence) out.understood.push('recurrence');

  // deadline «قبل الخميس», «بحلول 20/11», «آخر موعد بكرة», «by friday», «due tomorrow»
  const dl = s.match(/(?:قبل|بحلول|موعد التسليم|آخر موعد|اخر موعد|ديدلاين|deadline|due|by)\s+((?:يوم\s+)?(?:\S+)(?:\s+(?:الجاي|القادم|next))?)/i);
  if (dl) {
    const d = parseTask(dl[1], today).date;
    if (d && !/^\d{1,3}$/.test(dl[1])) {
      out.due_date = d;
      cut(dl[0]);
      out.understood.push('deadline');
    }
  }

  // time range «من 3 إلى 5 العصر», «3-5pm», «from 9 to 11», «9:00-10:30»
  const pmHint = /(?:العصر|المغرب|المساء|مساء|بالليل|الليل|الظهر|بعد الظهر|pm)/i.test(s);
  const amHint = /(?:الصبح|الصباح|صباحا|صباحاً|الفجر|am)/i.test(s);
  const range = s.match(/(?:من|from)?\s*(?:الساعة\s*)?(\d{1,2}(?:[:.]\d{2})?)\s*(?:-|–|إلى|الى|لـ|لين|حتى|to|till|until)\s*(?:الساعة\s*)?(\d{1,2}(?:[:.]\d{2})?)(?:\s*(am|pm))?/i);
  if (range) {
    const a = hourOf(range[1], pmHint || /pm/i.test(range[3] ?? ''), amHint || /am/i.test(range[3] ?? ''));
    let b = hourOf(range[2], pmHint || /pm/i.test(range[3] ?? ''), amHint || /am/i.test(range[3] ?? ''));
    if (a && b && b <= a && Number(b.slice(0, 2)) < 12) b = `${pad(Number(b.slice(0, 2)) + 12)}${b.slice(2)}`;
    if (a && b && b > a) {
      out.time = a;
      out.end_time = b;
      const [ah, am] = a.split(':').map(Number);
      const [bh, bm] = b.split(':').map(Number);
      out.minutes = bh * 60 + bm - (ah * 60 + am);
      cut(range[0]);
      out.understood.push('range');
    }
  }
  // explicit duration «لمدة 45 دقيقة», «for 2 hours» (before the base parser, which can take the hour for a duration)
  const dur = s.match(/(?:لمدة|مدة|for)\s*(\d{1,3}|ساعة|ساعه|ساعتين|نص ساعة|نصف ساعة|ربع ساعة)\s*(دقيقة|دقيقه|دقائق|د|min(?:ute)?s?|ساعات|ساعة|hours?|h)?(?=\s|$)/i);
  if (dur && !out.minutes) {
    const w = dur[1];
    const n = /^\d+$/.test(w) ? Number(w) * (/(ساع|hour|^h$)/i.test(dur[2] ?? '') ? 60 : 1) : /ساعتين/.test(w) ? 120 : /نص|نصف/.test(w) ? 30 : /ربع/.test(w) ? 15 : 60;
    if (n > 0 && n <= 600) {
      out.minutes = n;
      cut(dur[0]);
      out.understood.push('duration');
    }
  }
  // effort
  if (/(?:سهلة|سهل|بسيطة|quick|easy)(?=\s|$)/i.test(s)) {
    out.effort = 1;
    cut(/(?:سهلة|سهل|بسيطة|quick|easy)/i);
  } else if (/(?:صعبة|صعب|ثقيلة|hard|heavy)(?=\s|$)/i.test(s)) {
    out.effort = 5;
    cut(/(?:صعبة|صعب|ثقيلة|hard|heavy)/i);
  }

  // the rest (date / time / duration / priority / title) is the existing parser
  const base = parseTask(s, today);
  out.title = base.title;
  out.priority = base.priority;
  if (base.priority) out.understood.push('priority');
  if (!out.minutes && base.minutes) {
    out.minutes = base.minutes;
    out.understood.push('duration');
  }
  if (!out.time && base.time) out.time = base.time;
  if (out.time && !out.understood.includes('range')) out.understood.push('time');
  // parseTask fills today when only a time was given — keep that, but not for a bare inbox task
  out.date = out.inbox ? undefined : base.date;
  if (out.time && !out.date && !out.inbox) out.date = today;
  if (out.date) out.understood.push('date');
  if (out.inbox) {
    out.time = undefined;
    out.end_time = undefined;
  }
  // a recurring task with no start day starts today
  if (out.recurrence && !out.date && !out.inbox) out.date = today;
  if (!out.date && !out.time) out.inbox = true;

  // goal: a goal whose title (or a long word of it) appears in the sentence
  const low = input.toLowerCase();
  const stem = (w: string) => w.toLowerCase().replace(/^(?:وال|بال|لل|ال|ل)/, '');
  const g = goals
    .map((x) => ({ x, hit: low.includes(x.title.toLowerCase()) ? 2 : x.title.split(/\s+/).filter((w) => stem(w).length >= 3 && low.includes(stem(w))).length ? 1 : 0 }))
    .filter((y) => y.hit)
    .sort((a, b) => b.hit - a.hit)[0];
  if (g) {
    out.goal_id = g.x.id;
    out.understood.push('goal');
  }
  out.title = out.title.replace(/\s{2,}/g, ' ').replace(/^[\s،,.:-]+|[\s،,.:-]+$/g, '').trim() || input.trim();
  return out;
}
