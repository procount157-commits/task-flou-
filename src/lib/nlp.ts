import { addDays, weekday } from './dates';
import type { Priority } from './types';

export type Parsed = { title: string; date?: string; time?: string; priority?: Priority; minutes?: number };

const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩';
const toLatin = (s: string) => s.replace(/[٠-٩]/g, (d) => String(AR_DIGITS.indexOf(d)));
const pad = (n: number) => String(n).padStart(2, '0');

// Sunday = 0, as Date.getDay()
const WEEKDAYS: [RegExp, number][] = [
  [/(?:يوم\s+)?(?:الأحد|الاحد|احد)|\bsun(?:day)?\b/i, 0],
  [/(?:يوم\s+)?(?:الإثنين|الاثنين|اثنين|الإتنين|الاتنين)|\bmon(?:day)?\b/i, 1],
  [/(?:يوم\s+)?(?:الثلاثاء|الثلاثا|التلات|تلات)|\btue(?:s|sday)?\b/i, 2],
  [/(?:يوم\s+)?(?:الأربعاء|الاربعاء|الاربع|الأربع)|\bwed(?:nesday)?\b/i, 3],
  [/(?:يوم\s+)?(?:الخميس|خميس)|\bthu(?:rs|rsday)?\b/i, 4],
  [/(?:يوم\s+)?(?:الجمعة|الجمعه|جمعة)|\bfri(?:day)?\b/i, 5],
  [/(?:يوم\s+)?(?:السبت|سبت)|\bsat(?:urday)?\b/i, 6],
];

// Words that put the hour in the afternoon or evening, or keep it in the morning.
const PM = /(?:العصر|عصرا|عصراً|المغرب|مغربا|المسا|المساء|مساء|مساءً|بالليل|الليل|ليلا|ليلاً|الظهر|ظهرا|ظهراً|بعد الظهر|\bpm\b|\bp\.m\.)/i;
const AM = /(?:الصبح|الصباح|صباحا|صباحاً|الفجر|بدري|\bam\b|\ba\.m\.)/i;
const HIGH = /(?:مهم\s*جدا|مهم\s*جداً|مهم|مهمة|عاجل|عاجلة|ضروري|ضرورية|ضروري جدا|urgent|important|asap|!!)/i;
const LOW = /(?:مش مهم|غير مهم|لو فضيت|إذا فضيت|اذا فضيت|low priority|someday)/i;

/**
 * Reads a date, a time, a duration and a priority out of a sentence and returns what is left as the title:
 * «اجتماع مع أحمد بكرة 5 العصر مهم» → title «اجتماع مع أحمد», tomorrow, 17:00, high.
 */
export function parseTask(input: string, today: string): Parsed {
  let s = ` ${toLatin(input)} `;
  const out: Parsed = { title: '' };
  const cut = (re: RegExp | string) => {
    s = s.replace(re, ' ');
  };

  // priority
  if (LOW.test(s)) {
    out.priority = 'low';
    cut(LOW);
  } else if (HIGH.test(s)) {
    out.priority = 'high';
    cut(new RegExp(HIGH.source, 'gi'));
  }

  // duration: «لمدة ساعة», «45 دقيقة», «for 2 hours»
  const dur = s.match(/(?:لمدة|مدة|for)?\s*(\d{1,3}|ساعة|ساعه|ساعتين|نص ساعة|نصف ساعة|ربع ساعة)\s*(دقيقة|دقيقه|دقائق|د\b|min(?:ute)?s?|ساعات|hours?|h\b)?/i);
  if (dur && /(لمدة|مدة|for|دقيق|دقائق|min|ساع|hour|\bh\b)/i.test(dur[0]) && !/\d{1,2}[:.]\d{2}/.test(dur[0])) {
    const word = dur[1];
    let m = 0;
    if (/^\d+$/.test(word)) m = /(ساع|hour|\bh\b)/i.test(dur[2] ?? '') ? Number(word) * 60 : /(دقيق|دقائق|min|^د$)/i.test(dur[2] ?? '') ? Number(word) : 0;
    else m = /ساعتين/.test(word) ? 120 : /نص|نصف/.test(word) ? 30 : /ربع/.test(word) ? 15 : 60;
    if (m > 0 && m <= 600) {
      out.minutes = m;
      cut(dur[0]);
    }
  }

  // date
  const rel: [RegExp, number][] = [
    [/بعد\s*بكر[ةه]|بعد\s*بكرا|بعد\s*غد[اً]?|day after tomorrow/i, 2],
    [/بكر[ةه]|بكرا|غد[اًا]?|الغد|tomorrow|tmrw/i, 1],
    [/اليوم|النهارده|النهاردة|الليلة|tonight|today/i, 0],
  ];
  for (const [re, n] of rel) {
    if (re.test(s)) {
      out.date = addDays(today, n);
      cut(re);
      break;
    }
  }
  const inDays = s.match(/(?:بعد|in)\s*(\d{1,2}|يومين|اسبوع|أسبوع|week)\s*(?:أيام|ايام|يوم|days?)?/i);
  if (!out.date && inDays) {
    const w = inDays[1];
    out.date = addDays(today, /^\d+$/.test(w) ? Number(w) : /يومين/.test(w) ? 2 : 7);
    cut(inDays[0]);
  }
  if (!out.date && /(?:الأسبوع|الاسبوع)\s*(?:الجاي|القادم|الجاية|الجايه)|next week/i.test(s)) {
    out.date = addDays(today, 7);
    cut(/(?:الأسبوع|الاسبوع)\s*(?:الجاي|القادم|الجاية|الجايه)|next week/i);
  }
  if (!out.date) {
    for (const [re, wd] of WEEKDAYS) {
      // «صلاة الجمعة» names the prayer, not a day to move the task to
      if (wd === 5 && /صلا[ةه]\s+الجمع/.test(s)) continue;
      if (re.test(s)) {
        const diff = (wd - weekday(today) + 7) % 7 || 7;
        out.date = addDays(today, diff);
        cut(re);
        break;
      }
    }
  }
  const dm = s.match(/\b(\d{1,2})[/-](\d{1,2})\b/);
  if (!out.date && dm) {
    const year = Number(today.slice(0, 4));
    const cand = `${year}-${pad(Number(dm[2]))}-${pad(Number(dm[1]))}`;
    if (Number(dm[2]) >= 1 && Number(dm[2]) <= 12 && Number(dm[1]) >= 1 && Number(dm[1]) <= 31) {
      out.date = cand < today ? `${year + 1}${cand.slice(4)}` : cand;
      cut(dm[0]);
    }
  }

  // time: «5:30», «الساعة 5», «5 العصر», «17», «9am»
  const pm = PM.test(s);
  const am = AM.test(s);
  const tm = s.match(/(?:الساعة|الساعه|ساعة|at|@)?\s*\b(\d{1,2})(?:[:.](\d{2}))?\s*(?:و\s*(نص|ربع)|(?:\s*)(am|pm|a\.m\.|p\.m\.))?(?=\s|$)/i);
  const clue = /(الساعة|الساعه|ساعة|at|@|:|\.)/i.test(tm?.[0] ?? '') || pm || am || !!tm?.[4];
  if (tm && clue && Number(tm[1]) <= 23) {
    let h = Number(tm[1]);
    let m = tm[2] ? Number(tm[2]) : tm[3] === 'نص' ? 30 : tm[3] === 'ربع' ? 15 : 0;
    const isPm = pm || /p/i.test(tm[4] ?? '');
    const isAm = am || /a/i.test(tm[4] ?? '');
    if (isPm && h < 12) h += 12;
    else if (isAm && h === 12) h = 0;
    // a bare small hour with no morning word is almost always the afternoon («5» = 17:00)
    else if (!isAm && !isPm && h >= 1 && h <= 7) h += 12;
    if (m > 59) m = 0;
    out.time = `${pad(h)}:${pad(m)}`;
    cut(tm[0]);
  }
  if (pm) cut(new RegExp(PM.source, 'gi'));
  if (am) cut(new RegExp(AM.source, 'gi'));

  out.title = s
    .replace(/\s+(?:في|يوم|على|الساعة|at|on)\s*$/i, ' ')
    .replace(/^\s*(?:ذكرني|ذكّرني|فكرني|لازم|remind me to)\s+/i, ' ')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[\s،,.-]+|[\s،,.-]+$/g, '')
    .trim();
  if (!out.title) out.title = input.trim();
  // a time given for a past day of today stays today; a time without a date means today
  if (out.time && !out.date) out.date = today;
  return out;
}
