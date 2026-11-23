// combat.js — Sunline: Breakwater (gta6-01)
// Combat: fists + pistol SAJA (SMG dicoret design final §6).
// ES module, three.js r160 via import map ('three').
//
// State yang dibaca (dibuat malas/lazy bila belum ada):
//   state.player           { position: Vector3, velocity: Vector3, speed, mesh,
//                            inVehicle: bool, vehicle, aimDirection: Vector3,
//                            facing: number (radian), health }
//   state.camera           THREE.Camera | { direction } — arah bidik (opsional)
//   state.enemies          [target] — musuh misi / warga bermusuhan; tiap target:
//                            { position: Vector3, mesh, health, alive, speed,
//                              hitsTaken, seekingCover, coverTarget, flinchTimer }
//                            Target juga boleh datang dari state.hostiles.
//   state.coverPoints      [Vector3] — titik cover dari missions.js (opsional)
//   state.combat           dibuat modul ini: { weaponIndex, cooldown,
//                            reloadTimer, mag, reserve, lastReason, spread }
//   state.onAudio(name) / state.onScreenShake(mag) / state.onParticles(pos, color)
//                            — callback feedback (opsional, dicek semua bentuk)
//   state.wanted           dinaikkan +1 tiap tembakan yang kena warga/polisi
//                            lewat addWanted di police.js — di sini hanya lewat
//                            callback state.onCrime(amount) bila disediakan.
//
// Aturan design final §6:
//   Fists:  2 m, 12 dmg, cooldown 0,55 dtk
//   Pistol: 12/mag, cadangan 60, 28 dmg, cooldown 0,32 dtk
//   Tombol 1-2 ganti senjata. Aim soft-lock 15 derajat ke target terdekat.
//   Sebaran naik saat bergerak. Tidak ada tembakan dari dalam kendaraan.
//   Musuh misi pakai cover sederhana (pindah posisi setelah 2 tembakan kena).
import * as THREE from 'three';

export const weapons = [
  {
    id: 'fists',
    name: 'Fists',
    slot: 1,
    range: 2,
    damage: 12,
    cooldown: 0.55,
    spreadBase: 0.06, // radian, busur pukulan lebar
    auto: false,
  },
  {
    id: 'pistol',
    name: 'Pistol',
    slot: 2,
    range: 60,
    damage: 28,
    cooldown: 0.32,
    magSize: 12,
    reserveMax: 60,
    spreadBase: 0.02,
    spreadMove: 0.05, // sebaran tambahan saat bergerak penuh
    reloadTime: 1.2,
    auto: false,
  },
];

export const SOFT_LOCK_ANGLE = THREE.MathUtils.degToRad(15);
const FISTS_ARC = THREE.MathUtils.degToRad(45);
const RELOAD_TIME = 1.2;

function playerPos(state) {
  const p = state.player;
  if (!p) return new THREE.Vector3();
  // Selalu kembalikan clone: pemanggil bebas menggeser hasilnya (mis. +1.4
  // ketinggian dada) tanpa mengubah posisi pemain yang sebenarnya.
  if (p.position && p.position.isVector3) return p.position.clone();
  if (p.mesh && p.mesh.position) return p.mesh.position.clone();
  if (typeof p.x === 'number') return new THREE.Vector3(p.x, p.y || 0, p.z || 0);
  return new THREE.Vector3();
}

function playerSpeed(state) {
  const p = state.player;
  if (!p) return 0;
  if (typeof p.speed === 'number') return p.speed;
  if (p.velocity && p.velocity.isVector3) return p.velocity.length();
  return 0;
}

function inVehicle(state) {
  const p = state.player;
  return !!(p && (p.inVehicle || p.vehicle));
}

function ensureCombat(state) {
  if (!state.combat) {
    state.combat = {
      weaponIndex: 1, // mulai dengan pistol (slot 2); 0 = fists
      cooldown: 0,
      reloadTimer: 0,
      reloading: false,
      mag: weapons[1].magSize,
      reserve: weapons[1].reserveMax,
      spread: 0,
      lastReason: '',
    };
  }
  return state.combat;
}

function emit(state, kind, ...args) {
  // Dukung beberapa bentuk callback supaya main.js bebas memilih satu.
  if (kind === 'audio' && typeof state.onAudio === 'function') state.onAudio(args[0]);
  else if (kind === 'audio' && state.audio && typeof state.audio.play === 'function') state.audio.play(args[0]);
  else if (kind === 'shake' && typeof state.onScreenShake === 'function') state.onScreenShake(args[0]);
  else if (kind === 'shake' && typeof state.onShake === 'function') state.onShake(args[0]);
  else if (kind === 'shake' && state.camera && typeof state.camera.shake === 'function') state.camera.shake(args[0]);
  else if (kind === 'particles' && typeof state.onParticles === 'function') state.onParticles(args[0], args[1]);
  else if (kind === 'particles' && state.effects && typeof state.effects.spawnParticles === 'function') {
    state.effects.spawnParticles(args[0], args[1]);
  }
}

function getTargets(state) {
  const list = [];
  for (const key of ['enemies', 'hostiles', 'missionEnemies']) {
    const arr = state[key];
    if (Array.isArray(arr)) list.push(...arr);
  }
  return list.filter((t) => t && t.alive !== false && (t.health === undefined || t.health > 0));
}

function targetPos(t) {
  if (t.position && t.position.isVector3) return t.position;
  if (t.mesh && t.mesh.position) return t.mesh.position;
  if (typeof t.x === 'number') return new THREE.Vector3(t.x, t.y || 0, t.z || 0);
  return new THREE.Vector3();
}

function targetMesh(t) {
  if (t.mesh) return t.mesh;
  if (t.object) return t.object;
  return null;
}

/** Arah bidik: aimDirection pemain > arah kamera > hadap mesh pemain. */
export function getAimDirection(state) {
  const p = state.player;
  if (p && p.aimDirection && p.aimDirection.isVector3 && p.aimDirection.lengthSq() > 0.01) {
    return p.aimDirection.clone().normalize();
  }
  if (state.camera && typeof state.camera.getWorldDirection === 'function') {
    return state.camera.getWorldDirection(new THREE.Vector3());
  }
  if (p && typeof p.facing === 'number') {
    return new THREE.Vector3(Math.cos(p.facing), 0, -Math.sin(p.facing));
  }
  if (p && p.mesh) {
    const dir = new THREE.Vector3(0, 0, 1).applyQuaternion(p.mesh.quaternion);
    dir.y = 0;
    return dir.normalize();
  }
  return new THREE.Vector3(0, 0, 1);
}

/** Target terdekat di dalam kerucut soft-lock 15 derajat dari arah bidik. */
export function softLockTarget(state, maxAngle = SOFT_LOCK_ANGLE) {
  const origin = playerPos(state);
  origin.y += 1.4; // dari ketinggian dada
  const aim = getAimDirection(state);
  let best = null;
  let bestScore = Infinity;
  for (const t of getTargets(state)) {
    const tp = targetPos(t).clone();
    tp.y += 1.2;
    const to = tp.clone().sub(origin);
    const dist = to.length();
    if (dist > weapons[ensureCombat(state).weaponIndex].range) continue;
    const angle = aim.angleTo(to.clone().normalize());
    if (angle > maxAngle) continue;
    const score = angle * 10 + dist * 0.01; // utamakan sudut, lalu jarak
    if (score < bestScore) { bestScore = score; best = t; }
  }
  return best;
}

/** Sebaran saat ini (radian): naik dengan kecepatan gerak pemain. */
export function currentSpread(state) {
  const c = ensureCombat(state);
  const w = weapons[c.weaponIndex];
  const moveFactor = THREE.MathUtils.clamp(playerSpeed(state) / 8, 0, 1);
  return w.spreadBase + (w.spreadMove || 0) * moveFactor;
}

function applyHit(state, target, damage, hitPoint) {
  target.health = (target.health === undefined ? 100 : target.health) - damage;
  target.hitsTaken = (target.hitsTaken || 0) + 1;
  target.flinchTimer = 0.25;
  target.flinch = true;
  if (target.mesh) {
    // Flinch: sentakan kecil ke belakang dari arah pemain.
    const away = targetPos(target).clone().sub(playerPos(state)).setY(0).normalize();
    target.mesh.position.add(away.multiplyScalar(0.12));
  }
  emit(state, 'particles', hitPoint.clone(), 0xffd166);
  emit(state, 'audio', 'hit');
  if (target.health <= 0) {
    target.alive = false;
    if (target.mesh && target.mesh.visible !== undefined) target.mesh.visible = false;
    emit(state, 'audio', 'down');
  }
  // Cover sederhana: setelah 2 tembakan kena, musuh pindah posisi.
  if (target.alive !== false && target.hitsTaken >= 2 && !target.seekingCover) {
    target.seekingCover = true;
    target.hitsTaken = 0;
    target.coverTarget = pickCoverPoint(state, target);
  }
  return target.health;
}

function pickCoverPoint(state, target) {
  const tp = targetPos(target);
  const pp = playerPos(state);
  const away = tp.clone().sub(pp).setY(0).normalize();
  const side = new THREE.Vector3(-away.z, 0, away.x);
  const points = state.coverPoints || [];
  if (points.length) {
    let best = null;
    let bestDist = Infinity;
    for (const cp of points) {
      const c = cp.position || cp;
      const d = c.distanceTo(tp);
      // Cover yang menjauh dari pemain dan tidak terlalu jauh.
      if (d < bestDist && d > 2 && d < 25 && c.clone().sub(pp).length() > tp.distanceTo(pp)) {
        bestDist = d;
        best = c.clone();
      }
    }
    if (best) return best;
  }
  // Fallback: lari menyamping + menjauh 10-14 m dari pemain.
  const dir = away.multiplyScalar(11).add(side.multiplyScalar(Math.random() > 0.5 ? 6 : -6));
  return tp.clone().add(dir);
}

/** Ganti senjata: idx 0 = fists (tombol 1), 1 = pistol (tombol 2). */
export function selectWeapon(state, idx) {
  const c = ensureCombat(state);
  if (idx !== 0 && idx !== 1) { c.lastReason = 'invalid_slot'; return false; }
  if (c.weaponIndex === idx) return true;
  c.weaponIndex = idx;
  c.cooldown = Math.max(c.cooldown, 0.15); // jeda singkat saat ganti senjata
  c.reloading = false;
  c.reloadTimer = 0;
  emit(state, 'audio', 'weapon_switch');
  return true;
}

export function currentWeapon(state) {
  return weapons[ensureCombat(state).weaponIndex];
}

/** Isi ulang pistol dari cadangan. Dipanggil otomatis saat mag kosong. */
export function reloadWeapon(state) {
  const c = ensureCombat(state);
  const w = weapons[c.weaponIndex];
  if (w.id !== 'pistol') { c.lastReason = 'no_reload'; return false; }
  if (c.reloading || c.mag >= w.magSize || c.reserve <= 0) return false;
  c.reloading = true;
  c.reloadTimer = w.reloadTime || RELOAD_TIME;
  emit(state, 'audio', 'reload');
  return true;
}

/** Tembak pistol. Return false bila cooldown / reload / mag kosong / di kendaraan. */
export function tryShoot(state) {
  const c = ensureCombat(state);
  const w = weapons[c.weaponIndex];
  if (inVehicle(state)) { c.lastReason = 'in_vehicle'; return false; }
  if (w.id !== 'pistol') { c.lastReason = 'not_pistol'; return false; }
  if (c.cooldown > 0 || c.reloading) { c.lastReason = 'cooldown'; return false; }
  if (c.mag <= 0) {
    c.lastReason = 'empty';
    emit(state, 'audio', 'dryfire');
    if (c.reserve > 0) reloadWeapon(state);
    return false;
  }
  c.cooldown = w.cooldown;
  c.mag -= 1;
  const origin = playerPos(state);
  origin.y += 1.4;
  let aim = getAimDirection(state);
  // Sebaran: putar arah bidik acak dalam kerucut spread.
  const spread = currentSpread(state);
  aim = aim.clone()
    .add(new THREE.Vector3(
      (Math.random() - 0.5) * 2 * spread,
      (Math.random() - 0.5) * 2 * spread * 0.6,
      (Math.random() - 0.5) * 2 * spread,
    )).normalize();
  emit(state, 'audio', 'shot');
  emit(state, 'shake', 0.25);
  // Raycast sederhana ke mesh musuh; fallback ke tes sudut soft-lock.
  let hitTarget = null;
  let hitPoint = null;
  const targets = getTargets(state);
  const meshes = [];
  const meshToTarget = new Map();
  for (const t of targets) {
    const m = targetMesh(t);
    if (m) { meshes.push(m); meshToTarget.set(m.uuid, t); }
  }
  if (meshes.length) {
    const ray = new THREE.Raycaster(origin, aim, 0.1, w.range);
    const hits = ray.intersectObjects(meshes, true);
    if (hits.length) {
      let obj = hits[0].object;
      while (obj && !meshToTarget.has(obj.uuid)) obj = obj.parent;
      if (obj) { hitTarget = meshToTarget.get(obj.uuid); hitPoint = hits[0].point.clone(); }
    }
  }
  if (!hitTarget) {
    // Fallback: target dalam kerucut spread di sekitar arah bidik.
    const locked = softLockTarget(state, Math.max(SOFT_LOCK_ANGLE, spread * 3));
    if (locked) {
      hitTarget = locked;
      hitPoint = targetPos(locked).clone().add(new THREE.Vector3(0, 1.2, 0));
    }
  }
  if (hitTarget) {
    applyHit(state, hitTarget, w.damage, hitPoint);
    if (typeof state.onCrime === 'function' && hitTarget.isPolice) state.onCrime(2);
    else if (typeof state.onCrime === 'function' && hitTarget.isCivilian) state.onCrime(1);
  } else if (c.mag === 0 && c.reserve > 0) {
    reloadWeapon(state);
  }
  return true;
}

/** Pukul dengan tangan kosong. Return false bila cooldown / di luar jangkauan. */
export function tryPunch(state) {
  const c = ensureCombat(state);
  if (inVehicle(state)) { c.lastReason = 'in_vehicle'; return false; }
  if (c.cooldown > 0 || c.reloading) { c.lastReason = 'cooldown'; return false; }
  const w = weapons[0];
  const origin = playerPos(state);
  const aim = getAimDirection(state);
  let best = null;
  let bestDist = Infinity;
  for (const t of getTargets(state)) {
    const tp = targetPos(t);
    const to = tp.clone().sub(origin);
    const dist = to.length();
    if (dist > w.range) continue;
    const angle = aim.angleTo(to.clone().setY(0).normalize());
    if (angle > FISTS_ARC) continue;
    if (dist < bestDist) { bestDist = dist; best = t; }
  }
  c.cooldown = w.cooldown;
  emit(state, 'audio', 'punch');
  emit(state, 'shake', 0.12);
  if (best) {
    const hitPoint = targetPos(best).clone().add(new THREE.Vector3(0, 1.1, 0));
    applyHit(state, best, w.damage, hitPoint);
    if (typeof state.onCrime === 'function' && best.isPolice) state.onCrime(2);
    else if (typeof state.onCrime === 'function' && best.isCivilian) state.onCrime(1);
    return true;
  }
  c.lastReason = 'no_target';
  return true; // pukulan tetap keluar (animasi), hanya tidak kena
}

/** Per frame: cooldown, reload, flinch, dan gerakan musuh menuju cover. */
export function updateCombat(state, dt) {
  const c = ensureCombat(state);
  if (c.cooldown > 0) c.cooldown = Math.max(0, c.cooldown - dt);
  if (c.reloading) {
    c.reloadTimer -= dt;
    if (c.reloadTimer <= 0) {
      const w = weapons[c.weaponIndex];
      const need = w.magSize - c.mag;
      const take = Math.min(need, c.reserve);
      c.mag += take;
      c.reserve -= take;
      c.reloading = false;
      c.reloadTimer = 0;
    }
  }
  // Sebaran meluruh saat pemain diam.
  c.spread = THREE.MathUtils.damp(c.spread, currentSpread(state), 6, dt);
  for (const t of getTargets(state)) {
    if (t.flinchTimer > 0) {
      t.flinchTimer -= dt;
      if (t.flinchTimer <= 0) t.flinch = false;
    }
    if (t.seekingCover && t.coverTarget) {
      const tp = targetPos(t);
      const to = t.coverTarget.clone().sub(tp).setY(0);
      const dist = to.length();
      const speed = t.speed || 4;
      if (dist < 0.6) {
        t.seekingCover = false;
        t.inCover = true;
        t.coverTimer = 3; // diam di cover 3 detik
      } else {
        const step = to.normalize().multiplyScalar(Math.min(speed * dt, dist));
        if (t.mesh) t.mesh.position.add(step);
        else if (t.position && t.position.isVector3) t.position.add(step);
      }
    } else if (t.inCover && t.coverTimer !== undefined) {
      t.coverTimer -= dt;
      if (t.coverTimer <= 0) { t.inCover = false; t.coverTimer = 0; }
    }
  }
}
