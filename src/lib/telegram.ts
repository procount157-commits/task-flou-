import { kv } from './db';

export type TelegramSettings = { token: string; chatId: string };
export const TG_DEFAULTS: TelegramSettings = { token: '', chatId: '' };
export const getTelegram = async () => ({ ...TG_DEFAULTS, ...(await kv.get<Partial<TelegramSettings>>('telegram', {})) });
export const setTelegram = (s: TelegramSettings) => kv.set('telegram', s);

const api = (token: string, method: string) => `https://api.telegram.org/bot${token}/${method}`;

export class NoTelegramError extends Error {}

// Sends a plain-text message through the user's own bot.
export async function sendTelegram(text: string, s?: TelegramSettings) {
  const tg = s ?? (await getTelegram());
  if (!tg.token || !tg.chatId) throw new NoTelegramError();
  const res = await fetch(api(tg.token, 'sendMessage'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: tg.chatId, text: text.slice(0, 4000) }) });
  if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 160)}`);
}

// Finds the chat of whoever last wrote to the bot (the user, after sending it /start).
export async function detectChatId(token: string): Promise<string | undefined> {
  const res = await fetch(api(token, 'getUpdates'));
  if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 160)}`);
  const updates: any[] = (await res.json()).result ?? [];
  const chat = updates.reverse().map((u) => u.message?.chat?.id ?? u.channel_post?.chat?.id).find((id) => id != null);
  return chat == null ? undefined : String(chat);
}
