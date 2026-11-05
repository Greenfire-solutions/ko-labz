// Synthesised UI sound: no files, everything built from oscillators.
let ctx = null, master = null, drone = null;
let enabled = true;

function ac() {
  if (!ctx) {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain(); master.gain.value = 0.6; master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

function tone(freq, dur = 0.12, type = 'sine', vol = 0.05, when = 0, glide = 0) {
  if (!enabled) return;
  const c = ac(), t = c.currentTime + when;
  const o = c.createOscillator(), g = c.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t);
  if (glide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * glide), t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + 0.02);
}

function noise(dur = 0.6, vol = 0.05, from = 400, to = 4000) {
  if (!enabled) return;
  const c = ac(), t = c.currentTime;
  const buf = c.createBuffer(1, c.sampleRate * dur, c.sampleRate);
  const d = buf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  const src = c.createBufferSource(); src.buffer = buf;
  const f = c.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 2;
  f.frequency.setValueAtTime(from, t); f.frequency.exponentialRampToValueAtTime(to, t + dur);
  const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + dur * 0.4); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f); f.connect(g); g.connect(master); src.start(t);
}

let lastHover = 0;
export const sfx = {
  hover() { const n = performance.now(); if (n - lastHover < 70) return; lastHover = n; tone(1500, 0.03, 'sine', 0.012); },
  select() { tone(880, 0.08, 'sine', 0.05); tone(1320, 0.1, 'sine', 0.03, 0.05); },
  back() { tone(440, 0.1, 'sine', 0.04, 0, 0.6); },
  open() { tone(660, 0.07, 'triangle', 0.04); tone(990, 0.09, 'triangle', 0.03, 0.06); },
  error() { tone(180, 0.18, 'square', 0.03); tone(140, 0.22, 'square', 0.03, 0.1); },
  offer() { [520, 780, 1040].forEach((f, i) => tone(f, 0.18, 'triangle', 0.05, i * 0.06)); },
  success() { [440, 554.37, 659.25, 880].forEach((f, i) => tone(f, 0.45, 'triangle', 0.07, i * 0.09)); },
  ring() { [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(f, 0.7, 'sine', 0.06, i * 0.11)); noise(0.8, 0.02, 2000, 6000); },
  complete() {
    [261.63, 329.63, 392, 523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(f, 1.4, 'triangle', 0.06, i * 0.12));
    noise(2.2, 0.05, 200, 8000);
  },
  turn() { tone(330, 0.12, 'sine', 0.04); tone(495, 0.16, 'sine', 0.04, 0.08); },
  warp() { noise(0.9, 0.06, 300, 5000); tone(110, 0.9, 'sawtooth', 0.02, 0, 4); },
  badge() { [987.77, 1318.5, 1975.5].forEach((f, i) => tone(f, 0.3, 'sine', 0.04, i * 0.07)); }
};

export function setSound(on) {
  enabled = on;
  if (!on && drone) stopDrone();
}
export function soundOn() { return enabled; }

export function startDrone() {
  if (!enabled || drone) return;
  const c = ac(), g = c.createGain(); g.gain.value = 0.0001; g.connect(master);
  const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 420; lp.connect(g);
  const oscs = [55, 82.41, 110.3].map((f, i) => { const o = c.createOscillator(); o.type = i === 2 ? 'triangle' : 'sawtooth'; o.frequency.value = f; o.detune.value = (i - 1) * 6; o.connect(lp); o.start(); return o; });
  const lfo = c.createOscillator(), lg = c.createGain(); lfo.frequency.value = 0.07; lg.gain.value = 180; lfo.connect(lg); lg.connect(lp.frequency); lfo.start();
  g.gain.exponentialRampToValueAtTime(0.022, c.currentTime + 3);
  drone = { g, oscs: [...oscs, lfo] };
}
export function stopDrone() {
  if (!drone) return;
  const c = ac(), d = drone; drone = null;
  d.g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + 1);
  setTimeout(() => d.oscs.forEach(o => o.stop()), 1100);
}
export function droneOn() { return !!drone; }
