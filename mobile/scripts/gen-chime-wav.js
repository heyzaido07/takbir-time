// Generate a small "two-note chime" notification sound at build time.
// Output: mobile/android/app/src/main/res/raw/prayer_chime.wav
//
// Why generated rather than committed binary: a small synth-WAV is
// readable, license-free, easy to tweak (just edit the constants
// below), and doesn't bloat the repo with media we'd need to license
// or trace provenance for. The file is regenerated as part of the
// mobile build flow (see mobile/scripts/build-web.sh).
//
// Format: 16-bit PCM mono, 44.1 kHz. Two short tones (E5 → C5) with a
// soft ADSR envelope, ~750 ms total. Reads as a clean "ding-dong"
// notification chime, suitable for prayer reminders without being
// intrusive.

const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', 'android', 'app', 'src', 'main', 'res', 'raw', 'prayer_chime.wav');

const SAMPLE_RATE = 44100;
const NOTES = [
  { freqHz: 659.25, durSec: 0.30, gapSec: 0.06 }, // E5
  { freqHz: 523.25, durSec: 0.40, gapSec: 0.00 }, // C5
];

function envelope(t, dur) {
  // Linear attack 5ms, exponential release ~half the note. Floors at
  // 0 to avoid negative samples.
  const attack = 0.005;
  if (t < attack) return t / attack;
  const releaseStart = dur * 0.55;
  if (t > releaseStart) {
    const r = (t - releaseStart) / (dur - releaseStart);
    return Math.max(0, Math.exp(-3 * r));
  }
  return 1;
}

const samples = [];
for (const n of NOTES) {
  const totalSamples = Math.floor((n.durSec + n.gapSec) * SAMPLE_RATE);
  const noteSamples = Math.floor(n.durSec * SAMPLE_RATE);
  for (let i = 0; i < totalSamples; i++) {
    if (i < noteSamples) {
      const t = i / SAMPLE_RATE;
      const env = envelope(t, n.durSec);
      const wave = Math.sin(2 * Math.PI * n.freqHz * t);
      // 0.55 amplitude is roughly -5 dBFS — loud enough to register on
      // a notification stream without clipping.
      samples.push(Math.round(wave * env * 0.55 * 32767));
    } else {
      samples.push(0);
    }
  }
}

// Build WAV (RIFF/WAVE, 16-bit PCM mono).
const numSamples = samples.length;
const dataSize = numSamples * 2;
const buf = Buffer.alloc(44 + dataSize);
let off = 0;
buf.write('RIFF', off); off += 4;
buf.writeUInt32LE(36 + dataSize, off); off += 4;
buf.write('WAVE', off); off += 4;
buf.write('fmt ', off); off += 4;
buf.writeUInt32LE(16, off); off += 4;             // fmt chunk size
buf.writeUInt16LE(1, off); off += 2;              // PCM
buf.writeUInt16LE(1, off); off += 2;              // mono
buf.writeUInt32LE(SAMPLE_RATE, off); off += 4;
buf.writeUInt32LE(SAMPLE_RATE * 2, off); off += 4; // byte rate
buf.writeUInt16LE(2, off); off += 2;              // block align
buf.writeUInt16LE(16, off); off += 2;             // bits per sample
buf.write('data', off); off += 4;
buf.writeUInt32LE(dataSize, off); off += 4;
for (const s of samples) {
  buf.writeInt16LE(s, off); off += 2;
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, buf);
console.log(`Wrote ${OUT} (${(buf.length / 1024).toFixed(1)} KB, ${(numSamples / SAMPLE_RATE).toFixed(2)} s)`);
