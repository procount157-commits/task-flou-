import * as DocumentPicker from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import * as Linking from 'expo-linking';
import * as Speech from 'expo-speech';
import { Platform } from 'react-native';

import { AI_DEFAULTS } from './config';
import { kv } from './db';
import { logError } from './errlog';

export type AISettings = typeof AI_DEFAULTS;
// A blank field saved from Settings must not hide the value built into the app, or one press of Save
// on a key-free build would switch the AI off for good.
export const getAI = async (): Promise<AISettings> => {
  const saved = await kv.get<Partial<AISettings>>('ai', {});
  const out = { ...AI_DEFAULTS };
  for (const k of Object.keys(out) as (keyof AISettings)[]) if (typeof saved[k] === 'string' && saved[k]!.trim()) out[k] = saved[k]!.trim();
  return out;
};
export const setAI = (s: AISettings) => kv.set('ai', s);

export class NoKeyError extends Error {
  constructor() {
    super('NO_KEY');
  }
}

type Msg = { role: 'system' | 'user' | 'assistant'; content: string };

async function chat(baseUrl: string, apiKey: string, model: string, messages: Msg[], temperature: number) {
  const res = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model, temperature, messages }),
  });
  if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 200)}`);
  const text = String((await res.json()).choices?.[0]?.message?.content ?? '').trim();
  if (!text) throw new Error('empty AI reply');
  return text;
}

type Route = { url: string; key: string; model: string };

// Every distinct way to reach a model, in order: the saved service, the built-in one, then the fallbacks.
// A saved key that has expired or been mistyped therefore never shuts the AI off while a built-in key works.
function routes(ai: AISettings, kind: 'main' | 'fallback'): Route[] {
  const list: Route[] = kind === 'main'
    ? [{ url: ai.baseUrl, key: ai.apiKey, model: ai.model }, { url: AI_DEFAULTS.baseUrl, key: AI_DEFAULTS.apiKey, model: AI_DEFAULTS.model }]
    : [{ url: ai.fallbackUrl, key: ai.fallbackKey, model: ai.fallbackModel }, { url: AI_DEFAULTS.fallbackUrl, key: AI_DEFAULTS.fallbackKey, model: AI_DEFAULTS.fallbackModel }];
  return list.filter((r, i) => r.key && list.findIndex((o) => o.key === r.key && o.url === r.url) === i);
}

// The same routes for native code that calls the AI on its own (the hourly notification).
export const aiRoutes = async () => {
  const ai = await getAI();
  return [...routes(ai, 'main'), ...routes(ai, 'fallback')];
};

// Chat completion against OpenAI-compatible endpoints: the main service first, the fallback if it fails.
export async function InvokeLLM(input: Msg[] | string, temperature = 0.6): Promise<string> {
  const ai = await getAI();
  const messages: Msg[] = typeof input === 'string' ? [{ role: 'user', content: input }] : input;
  const all = [...routes(ai, 'main'), ...routes(ai, 'fallback')];
  if (!all.length) throw new NoKeyError();
  let first: unknown;
  for (const r of all) {
    try {
      return await chat(r.url, r.key, r.model, messages, temperature);
    } catch (e) {
      first ??= e;
      logError('ai', e);
    }
  }
  throw first;
}

// Asks for a JSON array of short strings and tolerates prose or code fences around it.
export async function llmList(prompt: string, lang: string): Promise<string[]> {
  const text = await InvokeLLM(
    `${prompt}\nReply ONLY with a JSON array of 3 to 5 short strings written in ${lang === 'ar' ? 'Arabic' : 'English'}. No other text.`,
    0.5,
  );
  const m = text.match(/\[[\s\S]*\]/);
  if (!m) throw new Error('bad AI reply');
  const arr = JSON.parse(m[0]);
  return (Array.isArray(arr) ? arr : []).map((x) => (typeof x === 'string' ? x : x?.title ?? x?.step ?? JSON.stringify(x))).map((s) => String(s).trim()).filter(Boolean).slice(0, 5);
}

// Splits a session of `total` minutes into concrete timed blocks, e.g. an hour of study into 10-minute steps.
export async function timeboxTask(title: string, total: number, notes: string | undefined, lang: string): Promise<{ minutes: number; step: string }[]> {
  const text = await InvokeLLM(
    `Plan a ${total}-minute work session for this task: "${title}"${notes ? ` (notes: ${notes})` : ''}. ` +
      'Split it into consecutive timed blocks of 5 to 15 minutes. Each block is one concrete physical action that starts with a verb, ' +
      'at most 9 words (for studying, e.g. open the book and sit at the desk, read section 1, summarise in your own words, test yourself). ' +
      `The minutes must add up to exactly ${total}. Reply ONLY with a JSON array like [{"minutes": 10, "step": "..."}], text in ${lang === 'ar' ? 'Arabic' : 'English'}.`,
    0.5,
  );
  const m = text.match(/\[[\s\S]*\]/);
  if (!m) throw new Error('bad AI reply');
  const raw = (JSON.parse(m[0]) as any[])
    .map((x) => ({ minutes: Math.max(1, Math.round(Number(x?.minutes) || 0)), step: String(x?.step ?? x?.title ?? '').trim() }))
    .filter((x) => x.step)
    .slice(0, 16);
  if (!raw.length) throw new Error('bad AI reply');
  // the model's arithmetic is not trusted: the last block absorbs any difference
  const sum = raw.reduce((a, x) => a + x.minutes, 0);
  raw[raw.length - 1].minutes = Math.max(1, raw[raw.length - 1].minutes + total - sum);
  return raw;
}

export const splitTask = (title: string, lang: string) => llmList(`Break this task into concrete, ordered steps: "${title}".`, lang);

export const splitGoal = (title: string, description: string | undefined, from: string, to: string, lang: string) =>
  llmList(`A person has this ${from} goal: "${title}"${description ? ` (${description})` : ''}. Propose sub-goals for the ${to} horizon that lead to it.`, lang);

export const suggestGifts = async (recipient: string, occasion: string, min: number, max: number, lang: string) => {
  const text = await InvokeLLM(
    `Suggest exactly 5 gift ideas for "${recipient}" for the occasion "${occasion}" with a budget between ${min} and ${max} SAR. Reply ONLY with a JSON array of 5 short strings in ${lang === 'ar' ? 'Arabic' : 'English'}.`,
  );
  const m = text.match(/\[[\s\S]*\]/);
  if (!m) throw new Error('bad AI reply');
  return (JSON.parse(m[0]) as unknown[]).map(String).slice(0, 5);
};

// A multipart/form-data body from text fields and one file, as bytes.
function multipart(fields: [string, string][], file: { field: string; name: string; type: string; data: Uint8Array }) {
  const boundary = `----hayati${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`;
  const enc = new TextEncoder();
  const head = fields.map(([k, v]) => `--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`).join('') +
    `--${boundary}\r\nContent-Disposition: form-data; name="${file.field}"; filename="${file.name}"\r\nContent-Type: ${file.type}\r\n\r\n`;
  const a = enc.encode(head);
  const b = enc.encode(`\r\n--${boundary}--\r\n`);
  const body = new Uint8Array(a.length + file.data.length + b.length);
  body.set(a, 0);
  body.set(file.data, a.length);
  body.set(b, a.length + file.data.length);
  return { body, type: `multipart/form-data; boundary=${boundary}` };
}

export async function TranscribeAudio(uri: string, lang: string): Promise<string> {
  const ai = await getAI();
  // only the main service (Groq) transcribes; the fallback has no speech model
  const all = routes(ai, 'main');
  if (!all.length) throw new NoKeyError();
  // the request body is built by hand: the phone's fetch rejects React Native's {uri} form parts
  const raw = (uri.split('?')[0].split('.').pop() ?? '').toLowerCase();
  const ext = ['m4a', 'mp4', 'aac', 'webm', 'mp3', 'wav', 'ogg', '3gp'].includes(raw) ? raw : Platform.OS === 'web' ? 'webm' : 'm4a';
  const audio = Platform.OS === 'web' ? new Uint8Array(await (await fetch(uri)).arrayBuffer()) : await new File(uri).bytes();
  let first: unknown;
  for (const r of all) {
    const { body, type } = multipart([['model', ai.sttModel], ['language', lang]], { field: 'file', name: `audio.${ext}`, type: `audio/${ext === 'webm' ? 'webm' : 'm4a'}`, data: audio });
    try {
      const res = await fetch(`${r.url.replace(/\/$/, '')}/audio/transcriptions`, { method: 'POST', headers: { Authorization: `Bearer ${r.key}`, 'Content-Type': type }, body });
      if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 200)}`);
      return String((await res.json()).text ?? '').trim();
    } catch (e) {
      first ??= e;
      logError('transcribe', e);
    }
  }
  throw first;
}

// "Upload" = keep a permanent copy in the app's document folder and return its URI.
export async function UploadFile(uri: string, name?: string): Promise<string> {
  if (Platform.OS === 'web' || /^https?:/.test(uri)) return uri;
  const ext = (name ?? uri).split('.').pop()?.split('?')[0] || 'bin';
  const dest = new File(Paths.document, `${Date.now().toString(36)}.${ext}`);
  new File(uri).copy(dest);
  return dest.uri;
}

export async function pickImage(): Promise<string | undefined> {
  const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images', 'videos'], quality: 0.7 });
  if (r.canceled || !r.assets?.[0]) return undefined;
  return UploadFile(r.assets[0].uri, r.assets[0].fileName ?? undefined);
}

export async function pickDocument(type: string | string[] = '*/*'): Promise<{ uri: string; name: string } | undefined> {
  const r = await DocumentPicker.getDocumentAsync({ type, copyToCacheDirectory: true });
  if (r.canceled || !r.assets?.[0]) return undefined;
  return { uri: r.assets[0].uri, name: r.assets[0].name };
}

export async function pickAttachment(): Promise<string | undefined> {
  const d = await pickDocument();
  return d && UploadFile(d.uri, d.name);
}

// Opens the device mail app with the message filled in; there is no server to send it silently.
export function SendEmail(o: { to: string; subject: string; body: string }) {
  return Linking.openURL(`mailto:${encodeURIComponent(o.to)}?subject=${encodeURIComponent(o.subject)}&body=${encodeURIComponent(o.body)}`);
}

// Pollinations renders an image straight from the URL, no key needed.
export const GenerateImage = (prompt: string) =>
  `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=768&height=512&nologo=true&seed=${Math.floor(Math.random() * 1e6)}`;

export function GenerateSpeech(text: string, lang: string) {
  Speech.stop();
  Speech.speak(text, { language: lang === 'ar' ? 'ar-SA' : 'en-US' });
}

// Reads the first sheet of an .xlsx/.xls/.csv file into rows keyed by lower-cased header.
export async function ExtractDataFromUploadedFile(uri: string): Promise<Record<string, any>[]> {
  const buf = Platform.OS === 'web' ? await (await fetch(uri)).arrayBuffer() : await new File(uri).arrayBuffer();
  const XLSX = await import('xlsx');
  const wb = XLSX.read(new Uint8Array(buf), { type: 'array', cellDates: true });
  const rows = XLSX.utils.sheet_to_json<Record<string, any>>(wb.Sheets[wb.SheetNames[0]], { defval: '', raw: false, dateNF: 'yyyy-mm-dd' });
  return rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k.trim().toLowerCase(), typeof v === 'string' ? v.trim() : v])));
}

// First non-empty value among header aliases (English or Arabic).
export const col = (row: Record<string, any>, ...names: string[]) => {
  for (const n of names) if (row[n] !== undefined && row[n] !== '') return String(row[n]);
  return '';
};

export const suggestTasks = (goals: string[], existing: string[], lang: string) =>
  llmList(
    `Suggest 5 small, concrete tasks a person can do today.${goals.length ? ` Their goals: ${goals.slice(0, 8).join('; ')}.` : ''}${existing.length ? ` Do not repeat these: ${existing.slice(0, 12).join('; ')}.` : ''} Each task at most 6 words.`,
    lang,
  );
