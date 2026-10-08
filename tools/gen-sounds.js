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
