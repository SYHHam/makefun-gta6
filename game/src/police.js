// police.js — Sunline: Breakwater (gta6-01)
// Sistem wanted 3 tier + polisi: patroli, roadblock prediktif, helikopter.
// ES module, three.js r160 via import map ('three').
//
// State yang dibaca (dibuat malas/lazy bila belum ada):
//   state.scene            THREE.Scene (wajib untuk mesh polisi/helikopter)
//   state.player           { position: Vector3, velocity: Vector3, speed, mesh,
//                            inVehicle: bool, vehicle, underCover: bool }
//   state.wanted           number 0..3 (modul ini yang menaikkan/menurunkan)
//   state.lastSeen         Vector3 | null — posisi terakhir pemain terlihat
//   state.junctions        [Vector3] | null — persimpangan dari city.js (opsional;
//                            kalau tidak ada, roadblock diprediksi dari velocity)
//   state.roadGraph        opsional, dipakai bila ada (nodes dengan .position)
//   state.buildings        [Object3D] | null — dipakai raycast LOS (opsional)
//   state.district         string | null — nama distrik aktif (opsional)
//   state.onAudio(name) / state.onScreenShake(mag) — callback opsional
//   state.police           dibuat modul ini: { units, roadblocks, heli, ... }
//
// Dipakai pemanggil lain untuk menaikkan wanted:
//   addWanted(state, 1) saat curi di depan saksi / serang warga / tembak
//   addWanted(state, 2) saat serang polisi
// Penurunan wanted diurus updateWanted() tiap frame.
//
// Konstanta mengikuti design final §5 (3 tier, bukan 5).
import * as THREE from 'three';

export const WANTED_MAX = 3;
export const WANTED_HIDDEN_DELAY = 12; // detik tanpa terlihat sebelum decay mulai
export const WANTED_DECAY_INTERVAL = 8; // detik per -1 level setelah delay
export const POLICE_SIGHT_RANGE = 90; // meter, polisi di darat melihat pemain
export const HELI_SIGHT_RANGE = 160; // meter, helikopter melihat pemain
export const HELI_SPOTLIGHT_RANGE = 120;
export const PATROL_SPEED = 28;
export const PATROL_RAM_SPEED = 34;
export const ROADBLOCK_AHEAD_MIN = 55; // meter di depan arah gerak pemain
export const ROADBLOCK_AHEAD_MAX = 140;

const UNIT_NAMES = ['SOL-12', 'SOL-07', 'SOL-21', 'SOL-33', 'SOL-45', 'SOL-09'];
const HELI_NAME = 'AIR-1';

// Jumlah unit per tier: [patroli, roadblock, heli?]
const TIER_PLAN = {
  1: { patrol: 2, roadblocks: 0, heli: false },
  2: { patrol: 3, roadblocks: 1, heli: true },
  3: { patrol: 5, roadblocks: 3, heli: true },
};

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

function playerVel(state) {
  const p = state.player;
  if (!p) return new THREE.Vector3();
  if (p.velocity && p.velocity.isVector3) return p.velocity.clone();
  if (p.vehicle && p.vehicle.velocity && p.vehicle.velocity.isVector3) {
    return p.vehicle.velocity.clone();
  }
  return new THREE.Vector3();
}

function playerSpeed(state) {
  const p = state.player;
  if (!p) return 0;
  if (typeof p.speed === 'number') return p.speed;
  return playerVel(state).length();
}

function emitAudio(state, name) {
  if (typeof state.onAudio === 'function') state.onAudio(name);
  else if (state.audio && typeof state.audio.play === 'function') state.audio.play(name);
}

export function districtFor(state, pos) {
  if (typeof state.district === 'string' && state.district) return state.district;
  // Perkiraan kasar dari posisi sampai city.js menyediakan distrik nyata:
  // pantai selatan (Mar Azul), timur pelabuhan (Glasspoint), sisanya kota tua.
  if (pos.z > 300) return 'Mar Azul';
  if (pos.x > 300) return 'Glasspoint';
  return 'Cobre Viejo';
}

function ensurePoliceState(state) {
  if (!state.police) {
    state.police = {
      units: [], // mobil patroli aktif
      roadblocks: [], // roadblock aktif
      heli: null,
      hiddenTimer: 0, // detik sejak terakhir terlihat
      decayTimer: 0, // akumulasi menuju -1 level
      sirenOn: false,
      strobePhase: 0,
    };
  }
  if (typeof state.wanted !== 'number') state.wanted = 0;
  return state.police;
}

/** Naikkan wanted, dibatasi 0..WANTED_MAX. Dipanggil saat kejahatan terjadi. */
export function addWanted(state, amount) {
  ensurePoliceState(state);
  const before = state.wanted;
  state.wanted = THREE.MathUtils.clamp(state.wanted + amount, 0, WANTED_MAX);
  if (state.wanted > before) {
    const ps = ensurePoliceState(state);
    ps.hiddenTimer = 0;
    ps.decayTimer = 0;
    state.lastSeen = playerPos(state).clone();
  }
  return state.wanted;
}

/** LOS sederhana: raycast dari pengamat ke pemain; terhalang bila bangunan
 *  (state.buildings) memotong garis pandang sebelum mencapai pemain. Tanpa
 *  daftar bangunan, LOS dianggap ada selama dalam jarak pandang, kecuali
 *  pemain ditandai underCover. */
export function hasLineOfSight(state, from, to) {
  const dist = from.distanceTo(to);
  if (state.player && state.player.underCover) return false;
  const blockers = state.buildings || state.colliders;
  if (!blockers || !blockers.length || !state.scene) return true;
  const dir = to.clone().sub(from).normalize();
  const ray = new THREE.Raycaster(from, dir, 0.1, dist);
  const hits = ray.intersectObjects(blockers, true);
  return hits.length === 0;
}

function makePoliceCarMesh() {
  const group = new THREE.Group();
  const white = new THREE.MeshStandardMaterial({ color: 0xf2f4f6, roughness: 0.35, metalness: 0.4 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x14181f, roughness: 0.6, metalness: 0.2 });
  const blue = new THREE.MeshStandardMaterial({ color: 0x1d4ed8, roughness: 0.4, metalness: 0.3 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(4.4, 0.85, 2), white);
  body.position.y = 0.65;
  group.add(body);
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.7, 1.8), dark);
  cabin.position.set(-0.2, 1.35, 0);
  group.add(cabin);
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(4.42, 0.22, 2.02), blue);
  stripe.position.y = 0.78;
  group.add(stripe);
  // Lampu strobo: biru kiri, merah kanan, berkedip bergantian di dispatch().
  const strobeMatL = new THREE.MeshStandardMaterial({
    color: 0x2563eb, emissive: 0x2563eb, emissiveIntensity: 2,
  });
  const strobeMatR = new THREE.MeshStandardMaterial({
    color: 0xdc2626, emissive: 0xdc2626, emissiveIntensity: 0.2,
  });
  const strobeL = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.18, 0.5), strobeMatL);
  strobeL.position.set(-0.2, 1.85, -0.5);
  const strobeR = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.18, 0.5), strobeMatR);
  strobeR.position.set(-0.2, 1.85, 0.5);
  group.add(strobeL, strobeR);
  group.userData.strobeL = strobeMatL;
  group.userData.strobeR = strobeMatR;
  group.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return group;
}

function makeHeliMesh() {
  const group = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x1e3a5f, roughness: 0.4, metalness: 0.5 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(4.2, 1.6, 2.2), bodyMat);
  group.add(body);
  const tail = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.5, 0.5), bodyMat);
  tail.position.set(-3.6, 0.3, 0);
  group.add(tail);
  const rotorMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.5 });
  const rotor = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.08, 9), rotorMat);
  rotor.position.y = 1.1;
  group.add(rotor);
  group.userData.rotor = rotor;
  const spot = new THREE.SpotLight(0xfff7cc, 900, HELI_SPOTLIGHT_RANGE, 0.32, 0.45, 1.2);
  spot.position.set(0, -0.9, 0);
  const spotTarget = new THREE.Object3D();
  group.add(spotTarget);
  spot.target = spotTarget;
  group.add(spot);
  group.userData.spot = spot;
  group.userData.spotTarget = spotTarget;
  group.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return group;
}

function spawnPosNear(state, minDist, maxDist) {
  const p = playerPos(state);
  const angle = Math.random() * Math.PI * 2;
  const dist = minDist + Math.random() * (maxDist - minDist);
  // Coba letakkan di belakang arah gerak pemain supaya pengejaran terasa datang.
  const vel = playerVel(state);
  let dir = new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle));
  if (vel.lengthSq() > 1) {
    const back = vel.clone().normalize().multiplyScalar(-1);
    dir = back.multiplyScalar(0.7).add(dir.multiplyScalar(0.3)).normalize();
  }
  return new THREE.Vector3(p.x + dir.x * dist, 0, p.z + dir.z * dist);
}

function createPatrolUnit(state, name) {
  const mesh = makePoliceCarMesh();
  const pos = spawnPosNear(state, 60, 95);
  mesh.position.copy(pos);
  if (state.scene) state.scene.add(mesh);
  return {
    kind: 'patrol', name, mesh, pos: mesh.position,
    heading: Math.atan2(-(playerPos(state).z - pos.z), playerPos(state).x - pos.x),
    speed: 0, role: 'CHASE', status: 'FLANKING', canSee: false, ramTimer: 0,
  };
}

/** Roadblock PREDIKTIF: titik spawn dipilih dari persimpangan (state.junctions)
 *  yang paling dekat dengan jalur prediksi pemain (pos + velocity * t), bukan
 *  acak. Tanpa data junction, pakai titik di depan arah velocity pemain. */
export function predictRoadblockSpots(state, count) {
  const p = playerPos(state);
  const vel = playerVel(state);
  const speed = Math.max(vel.length(), 8);
  const dir = vel.lengthSq() > 1 ? vel.clone().normalize() : new THREE.Vector3(1, 0, 0);
  const spots = [];
  const junctions = state.junctions || (state.roadGraph && state.roadGraph.nodes) || null;
  if (junctions && junctions.length) {
    const scored = junctions.map((j) => {
      const jp = j.position || j.pos || j;
      const toJ = new THREE.Vector3(jp.x - p.x, 0, jp.z - p.z);
      const along = toJ.dot(dir); // seberapa jauh di depan arah gerak
      const lateral = Math.abs(toJ.x * dir.z - toJ.z * dir.x);
      // Hanya junction di depan pemain, dekat dengan jalur prediksi.
      const score = along > 20 && along < 320 ? along * 0.4 + lateral : Infinity;
      return { jp: new THREE.Vector3(jp.x, 0, jp.z), score, along };
    }).filter((s) => Number.isFinite(s.score)).sort((a, b) => a.score - b.score);
    for (const s of scored) {
      if (spots.length >= count) break;
      if (spots.every((o) => o.distanceTo(s.jp) > 40)) spots.push(s.jp);
    }
  }
  // Isi kekurangan dengan titik prediksi di depan arah velocity.
  let t = 0;
  while (spots.length < count) {
    const dist = ROADBLOCK_AHEAD_MIN + t * 45 + Math.random() * 20;
    const spot = p.clone().add(dir.clone().multiplyScalar(Math.min(dist, ROADBLOCK_AHEAD_MAX + t * 30)));
    // Geser lateral sedikit supaya tidak selalu tepat di tengah jalan.
    const side = new THREE.Vector3(-dir.z, 0, dir.x).multiplyScalar((t % 2 === 0 ? 1 : -1) * 6);
    spot.add(side);
    spots.push(spot);
    t += 1;
  }
  return spots.slice(0, count);
}

function createRoadblock(state, spot, index) {
  const group = new THREE.Group();
  const cars = [];
  for (let i = 0; i < 2; i += 1) {
    const car = makePoliceCarMesh();
    car.position.set(i === 0 ? -2.4 : 2.4, 0, 0);
    car.rotation.y = Math.PI / 2; // melintang menutup jalan
    group.add(car);
    cars.push(car);
  }
  const barrierMat = new THREE.MeshStandardMaterial({ color: 0xf59e0b, roughness: 0.6 });
  const barrier = new THREE.Mesh(new THREE.BoxGeometry(0.4, 1.0, 7.5), barrierMat);
  barrier.position.set(0, 0.5, 0);
  group.add(barrier);
  group.position.copy(spot);
  // Hadapkan melintang terhadap arah datang pemain.
  const p = playerPos(state);
  group.rotation.y = Math.atan2(p.x - spot.x, p.z - spot.z);
  if (state.scene) state.scene.add(group);
  return {
    kind: 'roadblock', name: `RB-${index + 1}`, mesh: group, cars,
    pos: group.position, status: 'ROADBLOCK', canSee: false,
  };
}

function createHeli(state) {
  const mesh = makeHeliMesh();
  const p = playerPos(state);
  mesh.position.set(p.x + 25, 55, p.z - 25);
  if (state.scene) state.scene.add(mesh);
  return {
    kind: 'heli', name: HELI_NAME, mesh, pos: mesh.position,
    status: 'SEARCHING', canSee: false, orbitAngle: 0, orbitRadius: 45,
    searchTimer: 0,
  };
}

function removeUnit(state, unit) {
  if (state.scene && unit.mesh) state.scene.remove(unit.mesh);
}

/** Buat unit polisi sesuai tier wanted saat ini (dipanggil dispatch tiap frame,
 *  tapi juga bisa dipanggil langsung, mis. untuk shot staging). */
export function spawnPolice(state) {
  const ps = ensurePoliceState(state);
  const plan = TIER_PLAN[state.wanted] || TIER_PLAN[1];
  while (ps.units.length < plan.patrol) {
    const name = UNIT_NAMES[ps.units.length % UNIT_NAMES.length];
    ps.units.push(createPatrolUnit(state, name));
  }
  while (ps.roadblocks.length < plan.roadblocks) {
    const spots = predictRoadblockSpots(state, plan.roadblocks);
    const spot = spots[ps.roadblocks.length] || spots[0];
    ps.roadblocks.push(createRoadblock(state, spot, ps.roadblocks.length));
  }
  if (plan.heli && !ps.heli) ps.heli = createHeli(state);
  if (!ps.sirenOn && (ps.units.length > 0 || ps.heli)) {
    ps.sirenOn = true;
    emitAudio(state, 'siren');
  }
  return ps;
}

/** Hapus semua unit polisi + roadblock + helikopter dari scene. */
export function clearPolice(state) {
  const ps = ensurePoliceState(state);
  for (const u of ps.units) removeUnit(state, u);
  for (const r of ps.roadblocks) removeUnit(state, r);
  if (ps.heli) removeUnit(state, ps.heli);
  ps.units = [];
  ps.roadblocks = [];
  ps.heli = null;
  ps.sirenOn = false;
  ps.hiddenTimer = 0;
  ps.decayTimer = 0;
  return ps;
}

function updatePatrolUnit(state, unit, dt, time) {
  const p = playerPos(state);
  const vel = playerVel(state);
  const toPlayer = p.clone().sub(unit.pos);
  const dist = toPlayer.length();
  // Peran: unit terdekat RAMMING (tabrak), unit kedua FLANKING (potong rute),
  // sisanya CHASE biasa. Peran dihitung ulang di dispatch().
  let target = p.clone();
  if (unit.role === 'FLANKING') {
    // Potong rute: tuju titik di depan pemain berdasarkan velocity-nya.
    const lead = THREE.MathUtils.clamp(dist / 28, 0.5, 2.5);
    target = p.clone().add(vel.clone().multiplyScalar(lead));
  } else if (unit.role === 'BOX_REAR') {
    // Mengepung dari belakang: tuju titik di belakang pemain.
    const back = vel.lengthSq() > 1 ? vel.clone().normalize().multiplyScalar(-14)
      : new THREE.Vector3(-Math.cos(unit.heading), 0, Math.sin(unit.heading)).multiplyScalar(14);
    target = p.clone().add(back);
  }
  const toTarget = target.clone().sub(unit.pos);
  const wantHeading = Math.atan2(-toTarget.z, toTarget.x);
  let dHeading = wantHeading - unit.heading;
  while (dHeading > Math.PI) dHeading -= Math.PI * 2;
  while (dHeading < -Math.PI) dHeading += Math.PI * 2;
  const turnRate = 2.6; // rad/detik, belok melebar di kecepatan tinggi
  unit.heading += THREE.MathUtils.clamp(dHeading, -turnRate * dt, turnRate * dt);
  const wantSpeed = unit.role === 'RAMMING' ? PATROL_RAM_SPEED : PATROL_SPEED;
  unit.speed = THREE.MathUtils.damp(unit.speed, wantSpeed, 1.2, dt);
  unit.pos.x += Math.cos(unit.heading) * unit.speed * dt;
  unit.pos.z += -Math.sin(unit.heading) * unit.speed * dt;
  unit.mesh.rotation.y = -unit.heading;
  // Tabrakan ringan dengan pemain: dorong, bukan teleport.
  if (dist < 4.5) {
    unit.speed *= 0.55;
    unit.ramTimer = 0.4;
  }
  if (unit.ramTimer > 0) unit.ramTimer -= dt;
  // LOS + jarak pandang.
  const eye = unit.pos.clone().add(new THREE.Vector3(0, 1.6, 0));
  unit.canSee = dist < POLICE_SIGHT_RANGE
    && hasLineOfSight(state, eye, p.clone().add(new THREE.Vector3(0, 1.2, 0)));
  unit.status = unit.role === 'RAMMING' ? 'RAMMING' : unit.role === 'FLANKING' ? 'FLANKING' : 'FLANKING';
  if (unit.role === 'CHASE') unit.status = 'FLANKING';
  // Strobe berkedip bergantian (biru/merah) ~4 Hz.
  const on = Math.sin(time * 25 + (unit.name.charCodeAt(4) || 0)) > 0;
  unit.mesh.userData.strobeL.emissiveIntensity = on ? 2.5 : 0.15;
  unit.mesh.userData.strobeR.emissiveIntensity = on ? 0.15 : 2.5;
}

function updateHeli(state, heli, dt, time) {
  const p = playerPos(state);
  const ps = ensurePoliceState(state);
  const eye = heli.pos.clone();
  const toPlayer = p.clone().sub(eye);
  const dist = toPlayer.length();
  const spot = heli.mesh.userData.spot;
  const spotTarget = heli.mesh.userData.spotTarget;
  heli.mesh.userData.rotor.rotation.y += dt * 22;
  // Raycast ke bawah: LOS heli ke pemain.
  heli.canSee = dist < HELI_SIGHT_RANGE
    && hasLineOfSight(state, eye, p.clone().add(new THREE.Vector3(0, 1.2, 0)));
  if (heli.canSee) {
    state.lastSeen = p.clone();
    ps.hiddenTimer = 0;
    heli.status = 'SPOTLIGHT';
    // Ikuti pemain dari atas, jaga jarak 30m, tinggi 45-60m.
    const want = new THREE.Vector3(p.x + 18, 55, p.z - 18);
    heli.pos.lerp(want, 1 - Math.exp(-1.5 * dt));
    spotTarget.position.copy(p.clone().sub(heli.pos));
    spot.intensity = 1100;
  } else {
    heli.status = 'SEARCHING';
    heli.searchTimer += dt;
    // Orbit search pattern mengelilingi lastSeen, radius membesar perlahan.
    const center = state.lastSeen ? state.lastSeen.clone() : p.clone();
    heli.orbitAngle += dt * 0.45;
    heli.orbitRadius = Math.min(45 + heli.searchTimer * 3, 110);
    const want = new THREE.Vector3(
      center.x + Math.cos(heli.orbitAngle) * heli.orbitRadius,
      55,
      center.z + Math.sin(heli.orbitAngle) * heli.orbitRadius,
    );
    heli.pos.lerp(want, 1 - Math.exp(-1.2 * dt));
    // Sorot menyapu area pencarian di bawah.
    const sweep = new THREE.Vector3(
      center.x + Math.cos(heli.orbitAngle * 0.7) * 20,
      0,
      center.z + Math.sin(heli.orbitAngle * 0.7) * 20,
    );
    spotTarget.position.copy(sweep.sub(heli.pos));
    spot.intensity = 700;
  }
  heli.mesh.lookAt(p.x, heli.pos.y, p.z);
}

/** Update wanted: decay saat pemain hilang dari pandangan.
 *  Terlihat = ada unit patroli/helikopter yang canSee, atau pemain dekat
 *  (<25m) dengan unit mana pun. Hilang 12 detik -> -1 tiap 8 detik. */
export function updateWanted(state, dt) {
  const ps = ensurePoliceState(state);
  if (state.wanted <= 0) {
    ps.hiddenTimer = 0;
    ps.decayTimer = 0;
    return 0;
  }
  const p = playerPos(state);
  let seen = false;
  for (const u of ps.units) {
    if (u.canSee) { seen = true; break; }
    if (u.pos.distanceTo(p) < 25) { seen = true; break; }
  }
  if (!seen && ps.heli && ps.heli.canSee) seen = true;
  if (!seen && ps.roadblocks.length) {
    for (const r of ps.roadblocks) {
      if (r.pos.distanceTo(p) < 30) { seen = true; break; }
    }
  }
  if (seen) {
    ps.hiddenTimer = 0;
    ps.decayTimer = 0;
    state.lastSeen = p.clone();
  } else {
    ps.hiddenTimer += dt;
    if (ps.hiddenTimer >= WANTED_HIDDEN_DELAY) {
      ps.decayTimer += dt;
      if (ps.decayTimer >= WANTED_DECAY_INTERVAL) {
        ps.decayTimer = 0;
        state.wanted = Math.max(0, state.wanted - 1);
        if (state.wanted === 0) clearPolice(state);
      }
    }
  }
  return state.wanted;
}

/** Per frame: jaga jumlah unit sesuai tier, gerakkan patroli/helikopter,
 *  perbarui roadblock prediktif, atur peran ram/box. */
export function dispatch(state, dt) {
  const ps = ensurePoliceState(state);
  if (!state.scene) return ps;
  if (state.wanted <= 0) {
    if (ps.units.length || ps.heli || ps.roadblocks.length) clearPolice(state);
    return ps;
  }
  const time = (state.time || 0) + dt;
  state.time = time;
  spawnPolice(state);
  const plan = TIER_PLAN[state.wanted] || TIER_PLAN[1];
  // Kurangi unit bila tier turun (mis. L3 -> L2).
  while (ps.units.length > plan.patrol) removeUnit(state, ps.units.pop());
  while (ps.roadblocks.length > plan.roadblocks) removeUnit(state, ps.roadblocks.pop());
  if (!plan.heli && ps.heli) { removeUnit(state, ps.heli); ps.heli = null; }
  // Peran ram/box: 2 unit terdekat mengepung depan-belakang (L2/L3).
  const sorted = [...ps.units].sort((a, b) =>
    a.pos.distanceTo(playerPos(state)) - b.pos.distanceTo(playerPos(state)));
  for (const u of ps.units) u.role = 'CHASE';
  if (state.wanted >= 2 && sorted.length >= 2) {
    sorted[0].role = 'RAMMING';
    sorted[1].role = 'BOX_REAR';
  } else if (sorted.length >= 1) {
    sorted[0].role = 'RAMMING';
  }
  for (const u of ps.units) updatePatrolUnit(state, u, dt, time);
  if (ps.heli) updateHeli(state, ps.heli, dt, time);
  // Roadblock prediktif diperbarui berkala: pindah ke depan jalur baru pemain.
  ps._rbTimer = (ps._rbTimer || 0) + dt;
  if (ps._rbTimer > 6 && plan.roadblocks > 0) {
    ps._rbTimer = 0;
    const spots = predictRoadblockSpots(state, plan.roadblocks);
    ps.roadblocks.forEach((r, i) => {
      if (spots[i] && r.pos.distanceTo(playerPos(state)) > 25) {
        r.pos.copy(spots[i]);
        const p = playerPos(state);
        r.mesh.rotation.y = Math.atan2(p.x - spots[i].x, p.z - spots[i].z);
      }
    });
  }
  return ps;
}

/** Panel dispatch untuk HUD: unit + jarak + status. Saat pemain hilang,
 *  kembalikan satu baris SEARCHING dengan distrik lastSeen. */
export function getDispatchPanel(state) {
  const ps = ensurePoliceState(state);
  const p = playerPos(state);
  const panel = [];
  for (const u of ps.units) {
    panel.push({
      name: u.name,
      dist: Math.round(u.pos.distanceTo(p)),
      status: u.status || 'FLANKING',
    });
  }
  for (const r of ps.roadblocks) {
    panel.push({ name: r.name, dist: Math.round(r.pos.distanceTo(p)), status: 'ROADBLOCK' });
  }
  if (ps.heli) {
    panel.push({
      name: ps.heli.name,
      dist: Math.round(ps.heli.pos.distanceTo(p)),
      status: ps.heli.status,
    });
  }
  if (state.wanted > 0 && panel.length === 0) {
    panel.push({
      name: 'DISPATCH',
      dist: state.lastSeen ? Math.round(state.lastSeen.distanceTo(p)) : 0,
      status: 'SEARCHING',
      district: districtFor(state, state.lastSeen || p),
    });
  }
  if (state.wanted > 0 && ps.hiddenTimer >= 2 && !panel.some((e) => e.status === 'SEARCHING')) {
    const anySee = ps.units.some((u) => u.canSee) || (ps.heli && ps.heli.canSee);
    if (!anySee) {
      panel.push({
        name: 'DISPATCH',
        dist: state.lastSeen ? Math.round(state.lastSeen.distanceTo(p)) : 0,
        status: 'SEARCHING',
        district: districtFor(state, state.lastSeen || p),
      });
    }
  }
  return panel;
}
