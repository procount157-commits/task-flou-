// Synthesises the looping ambient beds and the success chime as 16-bit mono WAV files.
const fs = require('fs');
const SR = 22050;
function wav(name, samples) {
  const n = samples.length, b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(SR, 24); b.writeUInt32LE(SR * 2, 28);
  b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  let peak = 0; for (const s of samples) peak = Math.max(peak, Math.abs(s));
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.round((samples[i] / (peak || 1)) * 0.8 * 32767), 44 + i * 2);
  fs.writeFileSync(`assets/sounds/${name}.wav`, b);
}
let seed = 7; const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1;
const white = (n) => Array.from({ length: n }, rnd);
const lowpass = (x, a) => { let y = 0; return x.map((v) => (y += a * (v - y))); };
const highpass = (x, a) => { const l = lowpass(x, a); return x.map((v, i) => v - l[i]); };
// crossfade the tail into the head so the loop has no click
const loop = (x) => { const f = SR / 2, n = x.length - f, o = x.slice(0, n); for (let i = 0; i < f; i++) { const k = i / f; o[i] = x[i] * k + x[n + i] * (1 - k); } return o; };
const N = SR * 8 + SR / 2, T = (i) => i / SR;
wav('white', loop(white(N)));
wav('rain', loop(highpass(lowpass(white(N), 0.6), 0.08).map((v, i) => v * (0.8 + 0.2 * Math.sin(T(i) * 1.7)) + (rnd() > 0.996 ? rnd() * 2 : 0))));
wav('thunder', loop(lowpass(lowpass(white(N), 0.02), 0.02).map((v, i) => v * (0.25 + Math.pow(Math.max(0, Math.sin(T(i) * Math.PI / 4)), 6) * 3))));
wav('wind', loop(lowpass(white(N), 0.05).map((v, i) => v * (0.5 + 0.5 * Math.sin(T(i) * 0.9) * Math.sin(T(i) * 0.37)))));
wav('waves', loop(lowpass(white(N), 0.15).map((v, i) => v * Math.pow(0.5 + 0.5 * Math.sin(T(i) * Math.PI / 4 - 1.5), 2))));
wav('fan', loop(lowpass(white(N), 0.03).map((v, i) => v + 0.02 * Math.sin(T(i) * 2 * Math.PI * 110) + 0.01 * Math.sin(T(i) * 2 * Math.PI * 220))));
wav('forest', loop(lowpass(white(N), 0.04).map((v, i) => { const t = T(i) % 2; const chirp = t < 0.12 ? Math.sin(2 * Math.PI * (2600 + 900 * Math.sin(t * 90)) * t) * Math.sin(Math.PI * t / 0.12) * 0.05 : 0; return v * 0.6 + chirp; })));
wav('fire', loop(lowpass(white(N), 0.03).map((v) => v + (rnd() > 0.992 ? rnd() * 0.25 : 0))));
const chime = []; [523.25, 659.25, 783.99, 1046.5].forEach((f, k) => { for (let i = 0; i < SR * 0.9; i++) { const idx = Math.floor(k * SR * 0.11) + i; chime[idx] = (chime[idx] || 0) + Math.sin(2 * Math.PI * f * T(i)) * Math.exp(-T(i) * 5); } });
wav('success', Array.from(chime, (v) => v || 0));

// Alarm sirens: loud, harsh and long enough to be hard to sleep through.
const AL = SR * 24;
const sq = (ph) => (Math.sin(ph) > 0 ? 1 : -1) * 0.6 + Math.sin(ph) * 0.4;
let ph = 0;
// two-tone ambulance: 0.55 s high, 0.55 s low
wav('alarm_ambulance', Array.from({ length: AL }, (_, i) => { ph += (2 * Math.PI * (Math.floor(T(i) / 0.55) % 2 ? 660 : 880)) / SR; return sq(ph); }));
ph = 0;
// referee whistle: a shrill tone with fast trill, in bursts
wav('alarm_whistle', Array.from({ length: AL }, (_, i) => { ph += (2 * Math.PI * (2900 + 180 * Math.sin(T(i) * 2 * Math.PI * 38))) / SR; return (T(i) % 0.9 < 0.65 ? 1 : 0) * Math.sin(ph); }));
ph = 0;
// air-raid wail: a slow rise and fall between 450 and 1500 Hz
wav('alarm_wail', Array.from({ length: AL }, (_, i) => { ph += (2 * Math.PI * (975 + 525 * Math.sin(T(i) * 2 * Math.PI / 3.2 - 1.57))) / SR; return sq(ph); }));

// More alarms.
ph = 0;
// police yelp: a fast sweep up and down
wav('alarm_police', Array.from({ length: AL }, (_, i) => { ph += (2 * Math.PI * (700 + 600 * Math.abs(((T(i) * 3.2) % 2) - 1))) / SR; return sq(ph); }));
ph = 0;
// klaxon: the old "a-oo-ga" two-step horn
wav('alarm_klaxon', Array.from({ length: AL }, (_, i) => { const t = T(i) % 1.4; ph += (2 * Math.PI * (t < 0.25 ? 330 + t * 600 : t < 0.9 ? 300 : 0)) / SR; return t < 0.9 ? sq(ph) * (0.7 + 0.3 * Math.sin(T(i) * 2 * Math.PI * 28)) : 0; }));
// digital clock: four sharp beeps, a pause, again
wav('alarm_beeper', Array.from({ length: AL }, (_, i) => { const t = T(i) % 1; return t < 0.6 && (t % 0.15) < 0.08 ? Math.sin(2 * Math.PI * 2050 * T(i)) : 0; }));
// buzzer: a harsh low rasp in long pulses
wav('alarm_buzzer', Array.from({ length: AL }, (_, i) => (T(i) % 1.1 < 0.8 ? (Math.sin(2 * Math.PI * 160 * T(i)) > 0 ? 1 : -1) * 0.7 + Math.sin(2 * Math.PI * 320 * T(i)) * 0.3 : 0)));
// school bell: a hammer striking 22 times a second
wav('alarm_bell', Array.from({ length: AL }, (_, i) => { const s = T(i) % (1 / 22); return (T(i) % 3 < 2.4 ? 1 : 0) * Math.exp(-s * 70) * (Math.sin(2 * Math.PI * 1480 * T(i)) + 0.6 * Math.sin(2 * Math.PI * 2960 * T(i)) + 0.4 * Math.sin(2 * Math.PI * 4170 * T(i))); }));
// nuclear-plant style alert: three rising tones, repeated
wav('alarm_alert', Array.from({ length: AL }, (_, i) => { const t = T(i) % 1.5; const f = t < 0.35 ? 880 : t < 0.7 ? 1175 : t < 1.05 ? 1568 : 0; return f ? Math.sin(2 * Math.PI * f * T(i)) * 0.6 + (Math.sin(2 * Math.PI * f * 2 * T(i)) > 0 ? 0.4 : -0.4) : 0; }));
