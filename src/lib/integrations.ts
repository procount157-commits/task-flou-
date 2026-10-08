import * as DocumentPicker from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import * as Linking from 'expo-linking';
import * as Speech from 'expo-speech';
import { Platform } from 'react-native';
import * as XLSX from 'xlsx';

import { AI_DEFAULTS } from './config';
import { kv } from './db';

export type AISettings = typeof AI_DEFAULTS;
export const getAI = async () => ({ ...AI_DEFAULTS, ...(await kv.get<Partial<AISettings>>('ai', {})) });
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

// Chat completion against OpenAI-compatible endpoints: the main service first, the fallback if it fails.
export async function InvokeLLM(input: Msg[] | string, temperature = 0.6): Promise<string> {
  const ai = await getAI();
  const messages: Msg[] = typeof input === 'string' ? [{ role: 'user', content: input }] : input;
  if (!ai.apiKey && !ai.fallbackKey) throw new NoKeyError();
  let first: unknown;
  if (ai.apiKey) {
    try {
      return await chat(ai.baseUrl, ai.apiKey, ai.model, messages, temperature);
    } catch (e) {
      first = e;
    }
  }
  if (ai.fallbackKey) return chat(ai.fallbackUrl, ai.fallbackKey, ai.fallbackModel, messages, temperature);
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

export async function TranscribeAudio(uri: string, lang: string): Promise<string> {
  const ai = await getAI();
  if (!ai.apiKey) throw new NoKeyError();
  const form = new FormData();
  if (Platform.OS === 'web') form.append('file', await (await fetch(uri)).blob(), 'audio.webm');
  else form.append('file', { uri, name: `audio.${uri.split('.').pop() || 'm4a'}`, type: 'audio/m4a' } as any);
  form.append('model', ai.sttModel);
  form.append('language', lang);
  const res = await fetch(`${ai.baseUrl.replace(/\/$/, '')}/audio/transcriptions`, { method: 'POST', headers: { Authorization: `Bearer ${ai.apiKey}` }, body: form });
  if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 200)}`);
  return String((await res.json()).text ?? '').trim();
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
  const wb = XLSX.read(new Uint8Array(buf), { type: 'array', cellDates: true });
  const rows = XLSX.utils.sheet_to_json<Record<string, any>>(wb.Sheets[wb.SheetNames[0]], { defval: '', raw: false, dateNF: 'yyyy-mm-dd' });
  return rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k.trim().toLowerCase(), typeof v === 'string' ? v.trim() : v])));
}

// First non-empty value among header aliases (English or Arabic).
export const col = (row: Record<string, any>, ...names: string[]) => {
  for (const n of names) if (row[n] !== undefined && row[n] !== '') return String(row[n]);
  return '';
};
