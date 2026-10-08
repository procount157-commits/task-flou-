# حياتي — Hayati

A personal life-management app (React Native + Expo + TypeScript). Tasks with points and sub-tasks, habits with streaks, a seven-level goal pyramid, journal, pomodoro, finance, learning, content, brainstorm, Kolb sessions, analytics and an AI coach. Arabic by default with an instant English switch. All data lives on the device in AsyncStorage.

## Run

```bash
npm install
npx expo start
```

## Android APK

Every push to `main` builds an APK in GitHub Actions and publishes it under the `latest` release. That build carries no AI keys: add one in **Settings → Artificial intelligence**.

To get a build with the keys already inside, run the workflow by hand with `with_keys` ticked. It reads the `GROQ_KEY` and `OPENROUTER_KEY` repository secrets and uploads the APK as a one-day workflow artifact instead of a public release.

Locally the same keys come from `.env.local` (git-ignored):

```
EXPO_PUBLIC_GROQ_KEY=...
EXPO_PUBLIC_OPENROUTER_KEY=...
```

## Layout

- `src/app` — routes (Expo Router drawer); each file re-exports a screen
- `src/screens` — the screens
- `src/ctx` — language/theme, auth/profile and pomodoro contexts
- `src/lib` — entities, the AsyncStorage store, i18n, Google Calendar/ICS export, AI and file integrations, notifications
- `src/ui` — shared components (form sheet, charts, drag and drop, celebration, voice input)
- `tools/gen-sounds.js` — regenerates the ambient and success sounds in `assets/sounds`

## What needs a service

| Feature | How it works |
| --- | --- |
| AI split, coach, gift ideas, voice transcription | Any OpenAI-compatible API (Groq by default, OpenRouter as fallback) |
| Email reminders and invitations | Opens the device mail app with the message filled in |
| Image generation | Pollinations image URL, no key |
| Text to speech | The device's own voices |
| Stripe | Payment links set in `src/lib/config.ts`; empty until created |
