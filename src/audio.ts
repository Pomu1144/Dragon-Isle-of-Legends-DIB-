/** Procedural WebAudio sound: no audio assets needed. */
let ctx: AudioContext | null = null;
let master: GainNode, musicBus: GainNode, sfxBus: GainNode;
let musicOn = true, sfxOn = true;

function ac() {
  if (!ctx) {
    ctx = new AudioContext();
    master = ctx.createGain();
    master.gain.value = 0.7;
    master.connect(ctx.destination);
    musicBus = ctx.createGain();
    musicBus.gain.value = 0.32;
    musicBus.connect(master);
    sfxBus = ctx.createGain();
    sfxBus.gain.value = 0.8;
    sfxBus.connect(master);
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

export function setAudio(music: boolean, sfx: boolean) {
  musicOn = music;
  sfxOn = sfx;
  if (ctx) musicBus.gain.value = music ? 0.32 : 0;
}

function tone(freq: number, dur: number, type: OscillatorType = 'sine', vol = 0.3, when = 0, slide = 0, bus?: GainNode) {
  const c = ac();
  const t = c.currentTime + when;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * slide), t + dur);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vol, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(bus ?? sfxBus);
  o.start(t);
  o.stop(t + dur + 0.05);
}

function noise(dur: number, vol = 0.3, filter = 1200, when = 0) {
  const c = ac();
  const t = c.currentTime + when;
  const buf = c.createBuffer(1, Math.ceil(c.sampleRate * dur), c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
  const s = c.createBufferSource();
  s.buffer = buf;
  const f = c.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.value = filter;
  const g = c.createGain();
  g.gain.value = vol;
  s.connect(f).connect(g).connect(sfxBus);
  s.start(t);
}

export type Sfx = 'select' | 'back' | 'hit' | 'crit' | 'magic' | 'heal' | 'buff' | 'debuff' | 'faint' | 'capture' | 'fail' | 'levelup' | 'evolve' | 'coin' | 'step' | 'encounter' | 'victory' | 'defeat' | 'spin';

export function sfx(name: Sfx) {
  if (!sfxOn) return;
  try {
    switch (name) {
      case 'select': tone(880, 0.07, 'triangle', 0.15); break;
      case 'back': tone(440, 0.08, 'triangle', 0.12); break;
      case 'step': tone(320, 0.05, 'sine', 0.08); break;
      case 'hit': noise(0.18, 0.5, 900); tone(140, 0.15, 'square', 0.15, 0, 0.5); break;
      case 'crit': noise(0.3, 0.7, 2400); tone(90, 0.3, 'sawtooth', 0.2, 0, 0.4); break;
      case 'magic': [0, 0.05, 0.1].forEach((w, i) => tone(600 + i * 300, 0.35, 'sine', 0.12, w, 2)); noise(0.3, 0.15, 4000, 0.05); break;
      case 'heal': [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.25, 'sine', 0.12, i * 0.06)); break;
      case 'buff': tone(400, 0.25, 'triangle', 0.15, 0, 2); break;
      case 'debuff': tone(500, 0.3, 'triangle', 0.15, 0, 0.4); break;
      case 'faint': tone(300, 0.6, 'sawtooth', 0.12, 0, 0.25); break;
      case 'capture': [660, 880, 1320].forEach((f, i) => tone(f, 0.2, 'square', 0.08, i * 0.12)); break;
      case 'fail': tone(220, 0.35, 'square', 0.1, 0, 0.6); break;
      case 'coin': tone(988, 0.08, 'square', 0.08); tone(1319, 0.2, 'square', 0.08, 0.08); break;
      case 'encounter': [196, 233, 277, 330].forEach((f, i) => tone(f, 0.16, 'sawtooth', 0.1, i * 0.05)); break;
      case 'levelup': [523, 659, 784, 1046, 1318].forEach((f, i) => tone(f, 0.18, 'triangle', 0.14, i * 0.07)); break;
      case 'evolve': for (let i = 0; i < 12; i++) tone(300 + i * 90, 0.2, 'sine', 0.1, i * 0.08); break;
      case 'victory': [523, 523, 523, 659, 784, 659, 784].forEach((f, i) => tone(f, 0.22, 'square', 0.09, [0, .12, .24, .36, .6, .78, .9][i])); break;
      case 'defeat': [392, 370, 349, 330].forEach((f, i) => tone(f, 0.4, 'triangle', 0.12, i * 0.3)); break;
      case 'spin': tone(1200, 0.03, 'square', 0.05); break;
    }
  } catch { /* audio unavailable */ }
}

// ---------------------------------------------------------------- music
const SCALES: Record<string, { root: number; scale: number[]; bpm: number; wave: OscillatorType; prog: number[] }> = {
  title: { root: 50, scale: [0, 2, 3, 5, 7, 8, 10], bpm: 76, wave: 'triangle', prog: [0, 5, 3, 4] },
  world: { root: 55, scale: [0, 2, 4, 5, 7, 9, 11], bpm: 96, wave: 'triangle', prog: [0, 3, 4, 0, 5, 3, 1, 4] },
  town: { root: 60, scale: [0, 2, 4, 5, 7, 9, 11], bpm: 104, wave: 'sine', prog: [0, 5, 3, 4] },
  battle: { root: 52, scale: [0, 2, 3, 5, 7, 8, 10], bpm: 148, wave: 'sawtooth', prog: [0, 0, 5, 6, 3, 4, 4, 4] },
  boss: { root: 47, scale: [0, 1, 3, 5, 7, 8, 10], bpm: 160, wave: 'sawtooth', prog: [0, 1, 0, 6, 5, 4, 1, 0] },
  dungeon: { root: 45, scale: [0, 2, 3, 5, 7, 8, 11], bpm: 84, wave: 'triangle', prog: [0, 6, 5, 4] },
};
const midi = (n: number) => 440 * 2 ** ((n - 69) / 12);
let timer: number | null = null;
let current = '';

export function music(track: keyof typeof SCALES | null) {
  if (track === current) return;
  current = track ?? '';
  if (timer) clearInterval(timer);
  timer = null;
  if (!track) return;
  try { ac(); } catch { return; }
  const s = SCALES[track];
  const step = 60 / s.bpm / 2;
  let i = 0;
  const note = (deg: number, oct = 0) => midi(s.root + s.scale[((deg % 7) + 7) % 7] + 12 * (oct + Math.floor(deg / 7)));
  const tick = () => {
    if (!musicOn || !ctx) return;
    const bar = Math.floor(i / 8);
    const chord = s.prog[bar % s.prog.length];
    const pos = i % 8;
    if (pos === 0) {
      [0, 2, 4].forEach((d) => tone(note(chord + d, 0), step * 8, 'sine', 0.05, 0, 0, musicBus));
      tone(note(chord, -1), step * 4, 'triangle', 0.12, 0, 0, musicBus);
    }
    if (pos === 4) tone(note(chord, -1), step * 4, 'triangle', 0.1, 0, 0, musicBus);
    const pattern = track === 'battle' || track === 'boss' ? [0, 2, 4, 2, 7, 4, 2, 4] : [0, 4, 2, 4, 7, 4, 2, 4];
    const mel = (Math.sin(i * 1.7 + bar) > 0.2 ? 7 : 0) + pattern[pos];
    if (track !== 'title' || pos % 2 === 0) tone(note(chord + mel, 1), step * 0.9, s.wave, track === 'battle' || track === 'boss' ? 0.035 : 0.05, 0, 0, musicBus);
    if ((track === 'battle' || track === 'boss') && pos % 2 === 0) {
      const c = ac(); const t = c.currentTime;
      const o = c.createOscillator(), g = c.createGain();
      o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(40, t + 0.12);
      g.gain.setValueAtTime(0.25, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
      o.connect(g).connect(musicBus); o.start(t); o.stop(t + 0.2);
    }
    i++;
  };
  timer = window.setInterval(tick, step * 1000);
}

export function unlockAudio() { try { ac(); } catch { /* ignore */ } }
