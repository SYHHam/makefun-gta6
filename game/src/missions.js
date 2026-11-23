// missions.js: data and runner for the six Sunline Breakwater missions.
// Each mission has 3 stages. A stage fails if the player goes down or stays
// out of the mission area too long; the mission restarts from its checkpoint.
// Rewards pay out on completion. M4 and M6 branch. M6 requires an upgraded car.
// Coordinates are world meters: x east, z south, world spans -600..600,
// beach south past z 480, Glasspoint port north-east, Cobre Viejo west,
// Mar Azul promenade south, Sunwire FM studio central.
export const WORKSHOP = { x: -400, z: -300 };
export const STUDIO = { x: 40, z: -40 };
export const GLASSPOINT = { x: 420, z: -380 };
export const COBRE_VIEJO = { x: -420, z: 120 };
export const MAR_AZUL = { x: 60, z: 430 };
export const PLAZA = { x: -380, z: 80 };
export const CONTAINER_YARD = { x: 460, z: -260 };

export const MISSIONS = [
  {
    id: 'm1',
    title: 'Bengkel Terakhir',
    giver: 'Ivo',
    reward: 800,
    respect: 100,
    intro: { speaker: 'Ivo', text: 'Mara, bengkel ini tinggal satu tagihan lagi dari disita. Ambil kunci di meja, bawa mobil itu ke Glasspoint, antar suku cadangnya sebelum jam habis.', seconds: 7 },
    stages: [
      { id: 'm1s1', title: 'Ambil kunci bengkel', objective: 'Ambil kunci di bengkel Ivo', kind: 'goto', target: { x: -400, z: -300, radius: 6 } },
      { id: 'm1s2', title: 'Kemudikan ke Glasspoint', objective: 'Kemudikan mobil ke Glasspoint', kind: 'drive', target: { x: 420, z: -380, radius: 14 }, requiresVehicle: true },
      { id: 'm1s3', title: 'Antar suku cadang', objective: 'Antar suku cadang sebelum timer habis', kind: 'deliver', target: { x: 460, z: -340, radius: 10 }, timerSeconds: 120 },
    ],
  },
  {
    id: 'm2',
    title: 'Frekuensi Bocor',
    giver: 'Nadia',
    reward: 1100,
    respect: 140,
    intro: { speaker: 'Nadia', text: 'Seseorang membocorkan rekaman pelabuhan. Temui aku di studio, lalu ambil rekaman aslinya di Cobre Viejo. Jangan sampai barang itu hilang di jalan.', seconds: 7 },
    stages: [
      { id: 'm2s1', title: 'Temui Nadia', objective: 'Temui Nadia di studio Sunwire FM', kind: 'goto', target: { x: 40, z: -40, radius: 8 } },
      { id: 'm2s2', title: 'Ambil rekaman', objective: 'Ambil rekaman di Cobre Viejo', kind: 'pickup', target: { x: -420, z: 120, radius: 8 } },
      { id: 'm2s3', title: 'Bawa ke studio', objective: 'Bawa rekaman kembali ke studio tanpa kehilangan barang', kind: 'deliver', target: { x: 40, z: -40, radius: 10 }, carryItem: 'recording' },
    ],
  },
  {
    id: 'm3',
    title: 'Jalur Kontainer',
    giver: 'Taz',
    reward: 1500,
    respect: 180,
    intro: { speaker: 'Taz', text: 'Ada truk kontainer lewat Glasspoint bawa paketku. Jemput aku dulu, lalu ikuti truk itu. Paketnya jatuh di jalan, ambil sebelum orang lain.', seconds: 7 },
    stages: [
      { id: 'm3s1', title: 'Jemput Taz', objective: 'Jemput Taz di pelabuhan', kind: 'goto', target: { x: 460, z: -260, radius: 10 } },
      { id: 'm3s2', title: 'Ikuti truk', objective: 'Ikuti truk bertanda, jangan sampai kehilangan jejak', kind: 'follow', target: { x: 300, z: -200, radius: 25 }, timerSeconds: 150 },
      { id: 'm3s3', title: 'Ambil paket', objective: 'Ambil paket yang tertinggal di jalan', kind: 'pickup', target: { x: 180, z: -120, radius: 8 } },
    ],
  },
  {
    id: 'm4',
    title: 'Lampu Padam',
    giver: 'Nadia',
    reward: 1900,
    respect: 220,
    branching: true,
    intro: { speaker: 'Nadia', text: 'Kita pasang pemancar di atap Glasspoint malam ini. Pilih caramu: langsung naik, cepat tapi polisi langsung curiga. Atau tarik perhatian mereka dulu ke arah lain, lebih lambat tapi lebih aman.', seconds: 8 },
    branches: [
      { id: 'A', label: 'Langsung (cepat, wanted +2)', wanted: 2, text: 'Langsung saja. Cepat naik, cepat turun.' },
      { id: 'B', label: 'Tarik perhatian dulu (lambat, wanted +1)', wanted: 1, text: 'Aku bikin gaduh di ujung pelabuhan dulu, baru kau naik.' },
    ],
    stages: [
      { id: 'm4s1', title: 'Ambil pemancar', objective: 'Ambil pemancar dari Nadia', kind: 'pickup', target: { x: 40, z: -40, radius: 8 }, branchChoice: true },
      { id: 'm4s2', title: 'Pasang di atap Glasspoint', objective: 'Pasang pemancar di atap Glasspoint', kind: 'install', target: { x: 420, z: -380, radius: 10 } },
      { id: 'm4s3', title: 'Kabur', objective: 'Kabur dari Glasspoint tanpa tertangkap', kind: 'escape', target: { x: -100, z: 200, radius: 30 }, timerSeconds: 120 },
    ],
  },
  {
    id: 'm5',
    title: 'Jalan Pulang',
    giver: 'Ivo',
    reward: 2300,
    respect: 260,
    intro: { speaker: 'Ivo', text: 'Mobil bengkel harus sampai ke Cobre Viejo malam ini, dan aku ikut di dalamnya. Akan ada yang mengejar kita. Lindungi mobil itu, Mara.', seconds: 7 },
    stages: [
      { id: 'm5s1', title: 'Ambil mobil bengkel', objective: 'Ambil mobil bengkel di workshop', kind: 'drive', target: { x: -400, z: -300, radius: 10 }, requiresVehicle: true },
      { id: 'm5s2', title: 'Antar Ivo', objective: 'Antar Ivo ke Cobre Viejo', kind: 'drive', target: { x: -380, z: 80, radius: 14 }, requiresVehicle: true, escort: true },
      { id: 'm5s3', title: 'Lindungi kendaraan', objective: 'Lindungi kendaraan sampai Ivo turun dengan selamat', kind: 'protect', target: { x: -380, z: 80, radius: 20 }, timerSeconds: 90 },
    ],
  },
  {
    id: 'm6',
    title: 'Garis Pantai',
    giver: 'Kru',
    reward: 3500,
    respect: 400,
    branching: true,
    requiresUpgrade: true,
    intro: { speaker: 'Nadia', text: 'Ini dia, Mara. Bukti terakhir. Temui kru di Mar Azul, bawa bukti ke plaza Cobre Viejo, lewati pengejaran, serahkan padaku. Mobilmu harus sudah di-upgrade, kalau tidak kau tidak akan lolos.', seconds: 8 },
    branches: [
      { id: 'north', label: 'Pelabuhan utara', text: 'Lewat pelabuhan utara, jalan lebar tapi patroli padat.' },
      { id: 'tunnel', label: 'Terowongan', text: 'Lewat terowongan, sempit tapi sepi.' },
    ],
    stages: [
      { id: 'm6s1', title: 'Temui kru Mar Azul', objective: 'Temui kru di Mar Azul, pilih jalur: pelabuhan utara atau terowongan', kind: 'goto', target: { x: 60, z: 430, radius: 12 }, branchChoice: true },
      { id: 'm6s2', title: 'Bawa bukti ke plaza', objective: 'Bawa bukti ke plaza Cobre Viejo', kind: 'drive', target: { x: -380, z: 80, radius: 14 }, requiresVehicle: true, chase: true },
      { id: 'm6s3', title: 'Serahkan ke Nadia', objective: 'Lewati pengejaran, serahkan bukti ke Nadia', kind: 'deliver', target: { x: -380, z: 80, radius: 10 }, chase: true },
    ],
  },
];

export function getMission(id) {
  return MISSIONS.find((m) => m.id === id) || null;
}

export function missionByIndex(index) {
  return MISSIONS[index] || null;
}

export function nextMissionId(state) {
  const done = (state.save && state.save.missionsCompleted) || [];
  for (const m of MISSIONS) if (!done.includes(m.id)) return m.id;
  return null;
}

export function hasUpgradedCar(state) {
  const v = state.vehicle;
  if (v && v.upgrades && (v.upgrades.turbo || v.upgrades.armor || v.upgrades.nitro)) return true;
  const garage = state.garage || [];
  return garage.some((c) => c.upgrades && (c.upgrades.turbo || c.upgrades.armor || c.upgrades.nitro));
}

function setCheckpoint(state) {
  const m = state.mission;
  if (!m) return;
  state.checkpoint = {
    missionId: m.id,
    stage: m.stage,
    x: (state.player && state.player.pos) ? state.player.pos.x : 0,
    z: (state.player && state.player.pos) ? state.player.pos.z : 0,
    health: state.player ? state.player.health : 100,
  };
}

export function startMission(state, id) {
  const def = getMission(id);
  if (!def) return false;
  if (def.requiresUpgrade && !hasUpgradedCar(state)) {
    state.mission = { id, active: false, blocked: true, title: def.title, reason: 'Misi ini wajib memakai mobil yang sudah di-upgrade. Pasang Turbo, Armor, atau Nitro di bengkel dulu.' };
    return false;
  }
  state.mission = {
    id: def.id,
    title: def.title,
    giver: def.giver,
    reward: def.reward,
    respect: def.respect,
    stages: def.stages,
    branch: null,
    branchChosen: false,
    stage: 0,
    active: true,
    status: 'active',
    stageTime: 0,
    outOfAreaTime: 0,
    target: def.stages[0].target,
    dialog: def.intro ? { speaker: def.intro.speaker, text: def.intro.text, seconds: def.intro.seconds, key: id + '-intro' } : null,
    carrying: null,
    chaseActive: false,
  };
  setCheckpoint(state);
  return true;
}

export function chooseBranch(state, branchId) {
  const m = state.mission;
  if (!m || !m.active) return false;
  const def = getMission(m.id);
  if (!def || !def.branches) return false;
  const branch = def.branches.find((b) => b.id === branchId);
  if (!branch) return false;
  m.branch = branchId;
  m.branchChosen = true;
  if (branch.wanted && typeof state.wanted === 'number') {
    state.wanted = Math.min(3, state.wanted + branch.wanted);
  }
  if (m.id === 'm6') {
    m.target = branchId === 'north' ? { x: 300, z: -300, radius: 20 } : { x: -200, z: 300, radius: 20 };
  }
  m.dialog = { speaker: def.giver, text: branch.text, seconds: 5, key: m.id + '-branch-' + branchId };
  advanceStage(state);
  return true;
}

function advanceStage(state) {
  const m = state.mission;
  m.stage += 1;
  m.stageTime = 0;
  m.outOfAreaTime = 0;
  if (m.stage >= m.stages.length) {
    completeMission(state);
    return;
  }
  const stage = m.stages[m.stage];
  m.target = stage.target;
  setCheckpoint(state);
  m.dialog = { speaker: m.giver, text: stage.title + ': ' + stage.objective, seconds: 5, key: m.id + '-stage-' + m.stage };
}

function completeMission(state) {
  const m = state.mission;
  m.active = false;
  m.status = 'complete';
  if (state.player) {
    state.player.money = (state.player.money || 0) + (m.reward || 0);
    state.player.respect = (state.player.respect || 0) + (m.respect || 0);
  }
  if (state.save) {
    if (!state.save.missionsCompleted.includes(m.id)) state.save.missionsCompleted.push(m.id);
    state.save.missionProgress[m.id] = { stage: m.stages.length, status: 'complete' };
  }
  m.dialog = { speaker: m.giver, text: 'Selesai. S₡' + m.reward + ' dan ' + m.respect + ' respect untukmu, Mara.', seconds: 6, key: m.id + '-done' };
  state.missionComplete = { id: m.id, title: m.title, reward: m.reward, respect: m.respect, next: nextMissionId(state) };
}

function failMission(state, reason) {
  const m = state.mission;
  m.active = false;
  m.status = 'failed';
  m.failReason = reason;
  state.missionFailed = { id: m.id, title: m.title, reason };
}

function restartFromCheckpoint(state) {
  const m = state.mission;
  const cp = state.checkpoint;
  if (!cp || cp.missionId !== m.id) {
    startMission(state, m.id);
    return;
  }
  m.stage = cp.stage;
  m.stageTime = 0;
  m.outOfAreaTime = 0;
  m.active = true;
  m.status = 'active';
  const stage = m.stages[m.stage];
  m.target = stage.target;
  if (state.player && state.player.pos) {
    state.player.pos.x = cp.x;
    state.player.pos.z = cp.z;
    state.player.health = Math.max(50, cp.health || 100);
    if (state.player.vel && typeof state.player.vel.set === 'function') state.player.vel.set(0, 0, 0);
    if (state.player.velocity && typeof state.player.velocity.set === 'function') state.player.velocity.set(0, 0, 0);
  }
  m.dialog = { speaker: m.giver, text: 'Ulangi dari checkpoint. ' + stage.objective, seconds: 5, key: m.id + '-retry-' + m.stage + '-' + Date.now() };
}

export function retryMission(state) {
  if (!state.mission) return false;
  state.missionFailed = null;
  restartFromCheckpoint(state);
  return true;
}

function distanceToTarget(state) {
  const m = state.mission;
  if (!m || !m.target || !state.player || !state.player.pos) return Infinity;
  const dx = state.player.pos.x - m.target.x;
  const dz = state.player.pos.z - m.target.z;
  return Math.hypot(dx, dz);
}

export function updateMission(state, dt) {
  const m = state.mission;
  if (!m || !m.active) return;
  const p = state.player;
  if (!p) return;

  // Fail if the player goes down.
  if (p.health <= 0) {
    failMission(state, 'Mara tumbang di tengah misi.');
    return;
  }

  const stage = m.stages[m.stage];
  if (!stage) return;
  m.stageTime += dt;

  // Stage timer.
  if (stage.timerSeconds && m.stageTime > stage.timerSeconds) {
    failMission(state, 'Waktu habis: ' + stage.title + '.');
    return;
  }

  // Out of area: further than 250m from the target for too long.
  const dist = distanceToTarget(state);
  if (dist > 250) {
    m.outOfAreaTime += dt;
    if (m.outOfAreaTime > 20) {
      failMission(state, 'Mara keluar dari area misi terlalu lama.');
      return;
    }
  } else {
    m.outOfAreaTime = 0;
  }

  // Branch choice stage waits for the player to pick (UI sets mission.branchPending).
  if (stage.branchChoice && !m.branchChosen) {
    if (!m.branchPending) m.branchPending = true;
    return;
  }

  // Chase stages raise wanted while active.
  if (stage.chase && !m.chaseActive) {
    m.chaseActive = true;
    state.wanted = Math.max(state.wanted || 0, 2);
  }

  // Follow stage: the truck moves; keep the stage alive by staying near it.
  if (stage.kind === 'follow') {
    const truck = state.missionTruck;
    if (truck && truck.pos) {
      m.target = { x: truck.pos.x, z: truck.pos.z, radius: 25 };
      if (Math.hypot(p.pos.x - truck.pos.x, p.pos.z - truck.pos.z) < 30) {
        m.followTime = (m.followTime || 0) + dt;
        if (m.followTime > 20) advanceStage(state);
      } else {
        m.followTime = Math.max(0, (m.followTime || 0) - dt);
      }
      return;
    }
  }

  // Protect stage: vehicle condition must stay above 20.
  if (stage.kind === 'protect') {
    if (state.vehicle && (state.vehicle.condition ?? 100) <= 20) {
      failMission(state, 'Mobil bengkel rusak parah.');
      return;
    }
    if (m.stageTime > (stage.timerSeconds || 90)) { advanceStage(state); return; }
  }

  // Arrival completes most stages.
  const radius = (m.target && m.target.radius) || 10;
  if (dist <= radius) {
    if (stage.requiresVehicle && p.onFoot) {
      m.dialog = { speaker: m.giver, text: 'Misi ini butuh mobil. Cari mobil dulu.', seconds: 4, key: m.id + '-needcar-' + m.stage };
      return;
    }
    if (stage.kind === 'pickup' || stage.carryItem) m.carrying = stage.carryItem || stage.id;
    if (stage.kind === 'install') {
      m.dialog = { speaker: 'Nadia', text: 'Pemancar terpasang. Sinyal naik. Sekarang kabur.', seconds: 5, key: m.id + '-installed' };
    }
    advanceStage(state);
  }
}

export function getObjective(state) {
  const m = state.mission;
  if (!m || !m.active) return { title: 'Free roam', stage: 0, next: 'Visit the workshop to start a mission' };
  const stage = m.stages[m.stage];
  return {
    title: m.title,
    stage: m.stage + 1,
    next: stage ? stage.objective : '',
    giver: m.giver,
    branch: m.branch,
  };
}
