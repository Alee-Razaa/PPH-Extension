// Generates src/sounds/*.wav with Node built-ins only (SPEC 15.2, R14).
// 8-bit mono 22,050 Hz PCM. Soft sine tones with a touch of overtone, exponential decay, 5 ms edge fades.
// Usage: npm run sounds
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'sounds');
const RATE = 22_050;
const FADE_S = 0.005;

const E5 = 659.25, A5 = 880, E6 = 1318.51;

// Each note: [frequency Hz, start s, length s, peak 0..1, decay per second]
const SOUNDS = {
  'chime.wav': { length: 0.62, notes: [[E5, 0, 0.3, 0.55, 5], [A5, 0.22, 0.4, 0.6, 4.5]] },
  'ping.wav': { length: 0.3, notes: [[A5, 0, 0.3, 0.6, 9]] },
  'alarm.wav': { length: 1.2, notes: [[A5, 0, 0.18, 0.75, 3], [A5, 0.26, 0.18, 0.75, 3], [E6, 0.52, 0.6, 0.7, 2.5]] }
};

function render({ length, notes }) {
  const samples = new Float64Array(Math.round(length * RATE));
  for (const [freq, start, dur, peak, decay] of notes) {
    const from = Math.round(start * RATE);
    const count = Math.min(Math.round(dur * RATE), samples.length - from);
    for (let i = 0; i < count; i++) {
      const t = i / RATE;
      const edge = Math.min(1, t / FADE_S, (dur - t) / FADE_S);
      const tone = Math.sin(2 * Math.PI * freq * t) + 0.18 * Math.sin(4 * Math.PI * freq * t);
      samples[from + i] += (tone / 1.18) * peak * Math.exp(-decay * t) * Math.max(0, edge);
    }
  }
  return samples;
}

function encodeWav(samples) {
  const data = Buffer.alloc(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    data[i] = Math.round(128 + s * 127);
  }
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16);          // PCM chunk size
  header.writeUInt16LE(1, 20);           // PCM
  header.writeUInt16LE(1, 22);           // mono
  header.writeUInt32LE(RATE, 24);
  header.writeUInt32LE(RATE, 28);        // byte rate = rate * channels * 1 byte
  header.writeUInt16LE(1, 32);           // block align
  header.writeUInt16LE(8, 34);           // bits per sample
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

mkdirSync(OUT_DIR, { recursive: true });
for (const [file, spec] of Object.entries(SOUNDS)) {
  const wav = encodeWav(render(spec));
  writeFileSync(join(OUT_DIR, file), wav);
  console.log(`wrote src/sounds/${file} (${spec.length}s, ${wav.length} bytes)`);
}
