// audio.js: all sound is synthesized with WebAudio, no audio files.
// Engine hum, tires, horn, crash, footsteps, punch, gunshot, siren, UI clicks,
// waves, plus a music loop (oscillators through a filter, intensity rises
// during a chase) and one ambient Sunwire FM radio loop. Volume is persisted
// in localStorage under sunline-audio-v1.
const VOLUME_KEY = 'sunline-audio-v1';

let ctx = null;
let master = null;
let musicGain = null;
let radioGain = null;
let sfxGain = null;
let engineOsc = null;
let engineOsc2 = null;
let engineGain = null;
let engineFilter = null;
let musicTimer = null;
let radioTimer = null;
let sirenNodes = null;
let waveTimer = null;
let volume = 0.7;
let radioOn = true;
let musicIntensity = 0;
let engineSpeed = 0;

export function getVolume() { return volume; }
export function isRadioOn() { return radioOn; }

export function initAudio() {
  try {
    volume = Math.max(0, Math.min(1, Number.parseFloat(window.localStorage.getItem(VOLUME_KEY) ?? '0.7') || 0.7));
  } catch {
    volume = 0.7;
  }
  if (ctx) return ctx;
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) return null;
  ctx = new AudioContext();
  master = ctx.createGain();
  master.gain.value = volume;
  master.connect(ctx.destination);
  sfxGain = ctx.createGain();
  sfxGain.gain.value = 0.9;
  sfxGain.connect(master);
  musicGain = ctx.createGain();
  musicGain.gain.value = 0.16;
  musicGain.connect(master);
  radioGain = ctx.createGain();
  radioGain.gain.value = radioOn ? 0.12 : 0;
  radioGain.connect(master);
  engineFilter = ctx.createBiquadFilter();
  engineFilter.type = 'lowpass';
  engineFilter.frequency.value = 320;
  engineGain = ctx.createGain();
  engineGain.gain.value = 0;
  engineOsc = ctx.createOscillator();
  engineOsc.type = 'sawtooth';
  engineOsc.frequency.value = 55;
  engineOsc2 = ctx.createOscillator();
  engineOsc2.type = 'square';
  engineOsc2.frequency.value = 28;
  const osc2Gain = ctx.createGain();
  osc2Gain.gain.value = 0.5;
  engineOsc.connect(engineFilter);
  engineOsc2.connect(osc2Gain);
  osc2Gain.connect(engineFilter);
  engineFilter.connect(engineGain);
  engineGain.connect(master);
  engineOsc.start();
  engineOsc2.start();
  startMusic();
  startRadio();
  startWaves();
  return ctx;
}

export function resumeAudio() {
  if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
}

export function setVolume(v) {
  volume = Math.max(0, Math.min(1, Number(v) || 0));
  try { window.localStorage.setItem(VOLUME_KEY, String(volume)); } catch { /* storage off */ }
  if (master && ctx) master.gain.setTargetAtTime(volume, ctx.currentTime, 0.05);
  return volume;
}

export function setRadio(on) {
  radioOn = !!on;
  if (radioGain && ctx) radioGain.gain.setTargetAtTime(radioOn ? 0.12 : 0, ctx.currentTime, 0.2);
  return radioOn;
}

export function setMusicIntensity(v) {
  musicIntensity = Math.max(0, Math.min(1, Number(v) || 0));
  if (musicGain && ctx) musicGain.gain.setTargetAtTime(0.12 + musicIntensity * 0.14, ctx.currentTime, 0.5);
}

export function setEngine(speed01, on) {
  engineSpeed = Math.max(0, Math.min(1, speed01 || 0));
  if (!ctx || !engineOsc) return;
  const t = ctx.currentTime;
  engineOsc.frequency.setTargetAtTime(50 + engineSpeed * 140, t, 0.08);
  engineOsc2.frequency.setTargetAtTime(25 + engineSpeed * 70, t, 0.08);
  engineFilter.frequency.setTargetAtTime(280 + engineSpeed * 900, t, 0.1);
  engineGain.gain.setTargetAtTime(on ? 0.05 + engineSpeed * 0.07 : 0, t, 0.1);
}

function noiseBuffer(seconds) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i += 1) data[i] = Math.random() * 2 - 1;
  return buf;
}

function blip(freq, dur, type, vol, slideTo) {
  if (!ctx) return;
  const t = ctx.currentTime;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type || 'sine';
  osc.frequency.setValueAtTime(freq, t);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(1, slideTo), t + dur);
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  osc.connect(g);
  g.connect(sfxGain);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

function noiseHit(dur, vol, filterFreq, filterType) {
  if (!ctx) return;
  const t = ctx.currentTime;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(dur + 0.05);
  const filter = ctx.createBiquadFilter();
  filter.type = filterType || 'lowpass';
  filter.frequency.value = filterFreq || 800;
  const g = ctx.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  src.connect(filter);
  filter.connect(g);
  g.connect(sfxGain);
  src.start(t);
  src.stop(t + dur + 0.05);
}

export function playSound(name, opts) {
  if (!ctx) return;
  resumeAudio();
  const o = opts || {};
  switch (name) {
    case 'click': blip(660, 0.06, 'square', 0.12); break;
    case 'confirm': blip(520, 0.08, 'sine', 0.2); setTimeout(() => blip(780, 0.1, 'sine', 0.2), 70); break;
    case 'error': blip(180, 0.18, 'sawtooth', 0.18, 120); break;
    case 'horn': blip(370, 0.35, 'square', 0.22); blip(466, 0.35, 'square', 0.18); break;
    case 'crash': noiseHit(0.35, 0.5, 500); blip(70, 0.3, 'sine', 0.4, 40); break;
    case 'tire': noiseHit(0.25, 0.16, 1400, 'bandpass'); break;
    case 'footstep': noiseHit(0.07, 0.12, 300); break;
    case 'punch': noiseHit(0.12, 0.4, 250); blip(90, 0.1, 'sine', 0.3, 50); break;
    case 'gunshot': noiseHit(0.16, 0.55, 2400, 'highpass'); blip(140, 0.1, 'square', 0.25, 60); break;
    case 'reload': blip(900, 0.05, 'square', 0.1); setTimeout(() => blip(500, 0.05, 'square', 0.1), 120); break;
    case 'pickup': blip(880, 0.08, 'sine', 0.2); setTimeout(() => blip(1320, 0.12, 'sine', 0.2), 80); break;
    case 'mission': [523, 659, 784].forEach((f, i) => setTimeout(() => blip(f, 0.16, 'triangle', 0.22), i * 110)); break;
    case 'fail': [392, 330, 262].forEach((f, i) => setTimeout(() => blip(f, 0.2, 'triangle', 0.2), i * 130)); break;
    case 'nitro': noiseHit(0.7, 0.3, 3000, 'bandpass'); blip(200, 0.7, 'sawtooth', 0.12, 900); break;
    case 'siren': startSiren(); break;
    case 'sirenStop': stopSiren(); break;
    case 'wave': noiseHit(1.2, 0.08, 400); break;
    default: blip(o.freq || 440, o.dur || 0.1, 'sine', 0.15); break;
  }
}

function startSiren() {
  if (!ctx || sirenNodes) return;
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.value = 700;
  const lfo = ctx.createOscillator();
  lfo.type = 'triangle';
  lfo.frequency.value = 0.6;
  const lfoGain = ctx.createGain();
  lfoGain.gain.value = 280;
  const g = ctx.createGain();
  g.gain.value = 0.05;
  lfo.connect(lfoGain);
  lfoGain.connect(osc.frequency);
  osc.connect(g);
  g.connect(master);
  osc.start();
  lfo.start();
  sirenNodes = { osc, lfo, g };
}

function stopSiren() {
  if (!sirenNodes || !ctx) return;
  const nodes = sirenNodes;
  sirenNodes = null;
  nodes.g.gain.setTargetAtTime(0, ctx.currentTime, 0.1);
  setTimeout(() => { try { nodes.osc.stop(); nodes.lfo.stop(); } catch { /* already stopped */ } }, 400);
}

// Music: a slow chord pad loop. Chords shift every 4 bars; a bass line and a
// soft lead note pattern ride on top. Intensity adds a faster pulse.
const CHORDS = [
  [220.0, 261.63, 329.63],
  [174.61, 220.0, 261.63],
  [196.0, 246.94, 293.66],
  [146.83, 220.0, 293.66],
];
const LEAD = [440, 523.25, 659.25, 587.33, 523.25, 440, 392, 523.25];

function startMusic() {
  if (musicTimer) return;
  let chordIndex = 0;
  let beat = 0;
  musicTimer = setInterval(() => {
    if (!ctx || ctx.state !== 'running') return;
    const chord = CHORDS[chordIndex % CHORDS.length];
    const t = ctx.currentTime;
    chord.forEach((freq) => {
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = freq;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.5, t + 0.4);
      g.gain.setValueAtTime(0.5, t + 1.4);
      g.gain.linearRampToValueAtTime(0.0001, t + 1.9);
      osc.connect(g);
      g.connect(musicGain);
      osc.start(t);
      osc.stop(t + 2);
    });
    const bass = ctx.createOscillator();
    bass.type = 'sine';
    bass.frequency.value = chord[0] / 2;
    const bg = ctx.createGain();
    bg.gain.setValueAtTime(0.5, t);
    bg.gain.linearRampToValueAtTime(0.0001, t + 1.9);
    bass.connect(bg);
    bg.connect(musicGain);
    bass.start(t);
    bass.stop(t + 2);
    if (beat % 2 === 0 || musicIntensity > 0.5) {
      const leadFreq = LEAD[(beat * 3 + chordIndex) % LEAD.length] * (musicIntensity > 0.5 ? 2 : 1);
      const lead = ctx.createOscillator();
      lead.type = 'sine';
      lead.frequency.value = leadFreq;
      const lg = ctx.createGain();
      lg.gain.setValueAtTime(0.0001, t);
      lg.gain.linearRampToValueAtTime(0.25, t + 0.05);
      lg.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
      lead.connect(lg);
      lg.connect(musicGain);
      lead.start(t);
      lead.stop(t + 0.6);
    }
    beat += 1;
    if (beat % 8 === 0) chordIndex += 1;
  }, 500);
}

// Sunwire FM: one ambient loop, a warm pad with a slow filter swell and a
// soft vinyl-like crackle, presented as the in-game radio station.
function startRadio() {
  if (radioTimer) return;
  let step = 0;
  radioTimer = setInterval(() => {
    if (!ctx || ctx.state !== 'running' || !radioOn) return;
    const t = ctx.currentTime;
    const base = 164.81 * (step % 4 === 3 ? 1.5 : 1);
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = base;
    const osc2 = ctx.createOscillator();
    osc2.type = 'sine';
    osc2.frequency.value = base * 1.5;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.35, t + 0.8);
    g.gain.linearRampToValueAtTime(0.0001, t + 3.8);
    osc.connect(g);
    osc2.connect(g);
    g.connect(radioGain);
    osc.start(t);
    osc2.start(t);
    osc.stop(t + 4);
    osc2.stop(t + 4);
    step += 1;
  }, 2000);
}

function startWaves() {
  if (waveTimer) return;
  waveTimer = setInterval(() => {
    if (!ctx || ctx.state !== 'running') return;
    noiseHit(2.2, 0.05, 350);
  }, 6000);
}

export function stopAudio() {
  if (musicTimer) { clearInterval(musicTimer); musicTimer = null; }
  if (radioTimer) { clearInterval(radioTimer); radioTimer = null; }
  if (waveTimer) { clearInterval(waveTimer); waveTimer = null; }
  stopSiren();
  if (ctx) ctx.close().catch(() => {});
  ctx = null;
}
