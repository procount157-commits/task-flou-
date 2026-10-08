// Stripe Payment Links (dashboard.stripe.com → Payment links). Empty until the owner creates them.
export const STRIPE_LINKS = { monthly: '', yearly: '' };
export const PRICES = { monthly: 19, yearly: 190 };

export const APK_URL = 'https://github.com/procount157-commits/task-flou-/releases/download/latest/hayati.apk';

export const INVITE_LINK = 'hayati://join';

// Keys come from EXPO_PUBLIC_* variables at build time (.env.local on this machine, repository secrets in CI),
// so they are never written into the source. Both can be replaced from the Settings screen.
export const AI_DEFAULTS = {
  baseUrl: 'https://api.groq.com/openai/v1',
  apiKey: process.env.EXPO_PUBLIC_GROQ_KEY ?? '',
  model: 'openai/gpt-oss-120b',
  sttModel: 'whisper-large-v3',
  // tried when the first service fails or is rate limited
  fallbackUrl: 'https://openrouter.ai/api/v1',
  fallbackKey: process.env.EXPO_PUBLIC_OPENROUTER_KEY ?? '',
  fallbackModel: 'google/gemma-4-31b-it:free',
};
