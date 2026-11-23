// save.js: Sunline Breakwater save data in localStorage.
// Key sunline-save-v1. Stores money, respect, mission progress, garage,
// active car, checkpoint and upgrades. Invalid data falls back to a fresh save.
export const SAVE_KEY = 'sunline-save-v1';

export const RESPECT_RANKS = [
  { name: 'Pendatang', min: 0 },
  { name: 'Orang Bengkel', min: 250 },
  { name: 'Pengemudi Kota', min: 700 },
  { name: 'Nama Pelabuhan', min: 1400 },
  { name: 'Legenda Solmera', min: 2400 },
];

export function respectRank(respect) {
  let rank = RESPECT_RANKS[0];
  for (const r of RESPECT_RANKS) if (respect >= r.min) rank = r;
  return rank.name;
}

export function newSave() {
  return {
    version: 1,
    money: 200,
    respect: 0,
    missionsCompleted: [],
    missionProgress: {},
    garage: [],
    activeCar: null,
    checkpoint: null,
    upgrades: {},
    settings: { volume: 0.7, radio: true },
    playTimeSeconds: 0,
  };
}

function isFiniteNumber(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

function validSave(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
  if (data.version !== 1) return false;
  if (!isFiniteNumber(data.money) || data.money < 0 || data.money > 99999999) return false;
  if (!isFiniteNumber(data.respect) || data.respect < 0 || data.respect > 99999) return false;
  if (!Array.isArray(data.missionsCompleted)) return false;
  if (!data.missionsCompleted.every((m) => typeof m === 'string' && /^m[1-6]$/.test(m))) return false;
  if (!data.missionProgress || typeof data.missionProgress !== 'object') return false;
  if (!Array.isArray(data.garage)) return false;
  if (!data.garage.every((c) => c && typeof c === 'object' && typeof c.model === 'string' && typeof c.id === 'string')) return false;
  if (data.activeCar !== null && typeof data.activeCar !== 'string') return false;
  if (data.checkpoint !== null && (typeof data.checkpoint !== 'object' || !isFiniteNumber(data.checkpoint.x) || !isFiniteNumber(data.checkpoint.z))) return false;
  if (!data.upgrades || typeof data.upgrades !== 'object') return false;
  if (!data.settings || typeof data.settings !== 'object' || !isFiniteNumber(data.settings.volume)) return false;
  return true;
}

export function loadSave() {
  let raw = null;
  try {
    raw = window.localStorage.getItem(SAVE_KEY);
  } catch {
    return newSave();
  }
  if (!raw) return newSave();
  let parsed = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return newSave();
  }
  if (!validSave(parsed)) return newSave();
  const save = newSave();
  Object.assign(save, parsed);
  save.settings = { ...newSave().settings, ...parsed.settings };
  save.volume = Math.max(0, Math.min(1, save.settings.volume));
  return save;
}

export function saveGame(state) {
  const save = state && state.save ? state.save : loadSave();
  if (state) {
    if (state.player) {
      if (isFiniteNumber(state.player.money)) save.money = Math.max(0, Math.floor(state.player.money));
      if (isFiniteNumber(state.player.respect)) save.respect = Math.max(0, Math.floor(state.player.respect));
    }
    if (state.mission && state.mission.id) {
      save.missionProgress[state.mission.id] = {
        stage: state.mission.stage || 0,
        status: state.mission.status || 'active',
      };
      if (state.mission.status === 'complete' && !save.missionsCompleted.includes(state.mission.id)) {
        save.missionsCompleted.push(state.mission.id);
      }
    }
    if (Array.isArray(state.garage)) save.garage = state.garage;
    if (state.activeCarId !== undefined) save.activeCar = state.activeCarId;
    if (state.vehicle && state.vehicle.id) save.activeCar = state.vehicle.id;
    if (state.checkpoint) save.checkpoint = { x: state.checkpoint.x, z: state.checkpoint.z, missionId: state.checkpoint.missionId || null, stage: state.checkpoint.stage || 0 };
    if (state.upgrades) save.upgrades = state.upgrades;
    if (isFiniteNumber(state.time)) save.playTimeSeconds = Math.floor(state.time);
  }
  try {
    window.localStorage.setItem(SAVE_KEY, JSON.stringify(save));
  } catch {
    // Storage unavailable (private mode): the session keeps playing unsaved.
  }
  if (state) state.save = save;
  return save;
}

export function clearSave() {
  try {
    window.localStorage.removeItem(SAVE_KEY);
  } catch {
    // Nothing to clear.
  }
  return newSave();
}
