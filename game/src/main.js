// main.js: Sunline Breakwater entry point.
// Game loop + state machine (menu, playing, paused, mission complete/fail,
// game over). Inits renderer, scene, city, player, vehicles, traffic,
// pedestrians, police, combat, missions, HUD, minimap, audio, save, input
// and camera, then updates them every frame in order and renders.
// Shot mode: ?shot=1..4 stages a reproducible scene for screenshots.
import * as THREE from 'three';
import { CONFIG } from './config.js';
import { initRenderer, createScene, renderFrame, resizeRenderer } from './render.js';
import { buildCity } from './city.js';
import { resetCamera, updateCamera } from './camera.js';
import { spawnCar, stealCar, exitCar, updateVehicle, applyUpgrade } from './vehicles.js';
import { spawnTraffic, updateTraffic } from './traffic.js';
import { spawnCrowds, updatePedestrians } from './pedestrians.js';
import { updateWanted, dispatch, addWanted, spawnPolice } from './police.js';
import { selectWeapon, tryShoot, tryPunch, updateCombat, currentWeapon } from './combat.js';
import { MISSIONS, startMission, updateMission, chooseBranch, retryMission, nextMissionId, getMission } from './missions.js';
import { updateHUD, showMenu, hideMenu, showDialog } from './hud.js';
import { drawMinimap } from './minimap.js';
import { initAudio, resumeAudio, playSound, setRadio, setVolume, setMusicIntensity, setEngine } from './audio.js';
import { loadSave, saveGame, clearSave } from './save.js';
import { createInput, ACTION_INTERACT, ACTION_PAUSE, ACTION_RADIO, ACTION_WEAPON_1, ACTION_WEAPON_2, ACTION_SHOOT, ACTION_CONFIRM, ACTION_NITRO } from './input.js';

const MAX_FRAME = 0.1;
const params = new URLSearchParams(window.location.search);
const shotParam = Number.parseInt(params.get('shot') || '', 10);
const shot = Number.isInteger(shotParam) && shotParam >= 1 && shotParam <= 4 ? shotParam : 0;

const canvas = document.getElementById('game');
const save = loadSave();

const renderer = initRenderer(canvas);
const { scene, sun, hemi } = createScene();
const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 3000);
camera.position.set(0, 8, 12);

const city = buildCity(scene);
const input = createInput(canvas);

let minimapCanvas = document.getElementById('minimap');
if (!minimapCanvas) {
  minimapCanvas = document.createElement('canvas');
  minimapCanvas.id = 'minimap';
  minimapCanvas.width = 180;
  minimapCanvas.height = 180;
  document.body.appendChild(minimapCanvas);
}

// Player mesh: simple low-poly Mara, orange jacket, dark trousers.
function buildPlayerMesh() {
  const group = new THREE.Group();
  const jacket = new THREE.Mesh(
    new THREE.BoxGeometry(0.55, 0.75, 0.32),
    new THREE.MeshLambertMaterial({ color: 0xe8722a }),
  );
  jacket.position.y = 1.05;
  jacket.castShadow = true;
  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.21, 12, 10),
    new THREE.MeshLambertMaterial({ color: 0xd9a986 }),
  );
  head.position.y = 1.62;
  head.castShadow = true;
  const legs = new THREE.Mesh(
    new THREE.BoxGeometry(0.45, 0.65, 0.28),
    new THREE.MeshLambertMaterial({ color: 0x2a2f3a }),
  );
  legs.position.y = 0.35;
  group.add(jacket, head, legs);
  return group;
}

const playerMesh = buildPlayerMesh();
scene.add(playerMesh);

const startPoint = (city.spawnPoints && city.spawnPoints.playerStart) || { x: -420, z: -420, heading: Math.PI / 2 };

const player = {
  pos: new THREE.Vector3(startPoint.x, 0, startPoint.z),
  position: null,
  vel: new THREE.Vector3(),
  velocity: null,
  mesh: playerMesh,
  heading: startPoint.heading || 0,
  facing: startPoint.heading || 0,
  speed: 0,
  health: CONFIG.PLAYER.health,
  armor: CONFIG.PLAYER.armor,
  money: save.money,
  respect: save.respect,
  weapon: 'Fists',
  ammo: null,
  onFoot: true,
  inVehicle: false,
  inCar: false,
  car: null,
  vehicle: null,
  aiming: false,
  armed: false,
};
player.position = player.pos;
player.velocity = player.vel;

const state = {
  player,
  vehicle: null,
  wanted: 0,
  lastSeen: null,
  time: 0,
  mission: null,
  missionComplete: null,
  missionFailed: null,
  scene,
  camera,
  world: city,
  roadGraph: city.roadGraph,
  junctions: city.roadGraph ? city.roadGraph.nodes : [],
  garage: save.garage || [],
  activeCarId: save.activeCar,
  upgrades: save.upgrades || {},
  checkpoint: save.checkpoint,
  save,
  enemies: [],
  traffic: [],
  pedestrians: null,
  radioOn: save.settings ? save.settings.radio !== false : true,
  onAudio: (name) => playSound(name),
  onCrime: (amount) => addWanted(state, amount || 1),
  onScreenShake: () => {},
  onParticles: () => {},
  district: 'Cobre Viejo',
};
state.district = 'Cobre Viejo';
if (city.spawnPoints && city.spawnPoints.garage) state.world.garage = city.spawnPoints.garage;

// Parked cars the player can steal, spread across the three districts.
const PARKED_SPOTS = [
  { model: 'solara', x: -380, z: -380 },
  { model: 'brisa', x: -100, z: 100 },
  { model: 'cinderback', x: 300, z: -100 },
  { model: 'dockrunner', x: 420, z: -300 },
  { model: 'velvet', x: 100, z: 420 },
  { model: 'brisa', x: -300, z: 300 },
  { model: 'solara', x: 200, z: 200 },
];
const parkedCars = PARKED_SPOTS.map((s) => spawnCar(s.model, { x: s.x, z: s.z, heading: Math.random() * Math.PI * 2 }, scene));
for (const car of parkedCars) car.parked = true;
state.parkedCars = parkedCars;

// The player's own starter car from the garage, or a fresh Solara S.
let playerCar = null;
if (save.garage && save.garage.length > 0) {
  const saved = save.garage.find((c) => c.id === save.activeCar) || save.garage[0];
  playerCar = spawnCar(saved.model || 'solara', { x: startPoint.x + 6, z: startPoint.z, heading: startPoint.heading }, scene);
  if (saved.upgrades) {
    for (const type of ['turbo', 'armor', 'nitro']) {
      if (saved.upgrades[type]) applyUpgrade(playerCar, type, saved.upgrades[type]);
    }
  }
  playerCar.id = saved.id;
} else {
  playerCar = spawnCar('solara', { x: startPoint.x + 6, z: startPoint.z, heading: startPoint.heading }, scene);
  playerCar.id = 'garage-solara';
}
playerCar.parked = true;
parkedCars.push(playerCar);
state.garage = [{ id: playerCar.id, model: playerCar.model, upgrades: { ...playerCar.upgrades } }];

spawnTraffic(state, 25);
state.pedestrians = spawnCrowds(null, scene);

let screen = 'menu';
let sirenOn = false;
let stepTimer = 0;
let branchButtons = null;
let shotReadyFrames = 0;

function syncPlayer() {
  player.position = player.pos;
  player.velocity = player.vel;
  player.onFoot = !player.inCar;
  player.inVehicle = !!player.inCar;
  player.vehicle = player.car;
  state.vehicle = player.car;
  player.facing = player.heading;
  const w = currentWeapon(state);
  if (w) {
    player.weapon = w.name;
    player.ammo = state.combat ? state.combat.mag : null;
  }
}

function nearestCar(maxDist) {
  let best = null;
  let bestD = maxDist;
  for (const car of parkedCars) {
    if (car.occupied) continue;
    const d = Math.hypot(car.mesh.position.x - player.pos.x, car.mesh.position.z - player.pos.z);
    if (d < bestD) { bestD = d; best = car; }
  }
  return best;
}

function tryEnterCar() {
  const car = nearestCar(2.5);
  if (!car) return false;
  if (stealCar(player, car)) {
    if (car.parked) {
      addWanted(state, 1);
      playSound('horn');
      showDialog('Mara', 'Mobil ini sekarang milikku. Polisi mungkin melihat.', 4);
    }
    playSound('confirm');
    return true;
  }
  return false;
}

function tryExitCar() {
  if (!player.car) return false;
  exitCar(player, player.car);
  playSound('click');
  return true;
}

function buyNextUpgrade() {
  const car = player.car;
  if (!car) { showDialog('Ivo', 'Bawa mobil ke bengkel dulu, baru kita pasang upgrade.', 4); return; }
  const nearWorkshop = Math.hypot(player.pos.x - startPoint.x, player.pos.z - startPoint.z) < 30;
  if (!nearWorkshop) { showDialog('Ivo', 'Upgrade hanya di bengkel. Bawa mobilmu ke sini.', 4); return; }
  const order = ['turbo', 'armor', 'nitro'];
  let best = null;
  for (const type of order) {
    const tier = (car.upgrades[type] || 0) + 1;
    if (tier > 3) continue;
    const cost = CONFIG.UPGRADES[type].cost[tier];
    if (player.money >= cost && (!best || cost < best.cost)) best = { type, tier, cost };
  }
  if (!best) { showDialog('Ivo', 'Semua upgrade sudah tier 3, atau uangmu belum cukup.', 4); return; }
  player.money -= best.cost;
  applyUpgrade(car, best.type, best.tier);
  const entry = state.garage.find((c) => c.id === car.id);
  if (entry) entry.upgrades = { ...car.upgrades };
  playSound('mission');
  showDialog('Ivo', CONFIG.UPGRADES[best.type].name + ' tier ' + best.tier + ' terpasang. S₡' + best.cost + '. Rasakan bedanya.', 5);
  saveGame(state);
}

function showBranchChoice() {
  if (branchButtons) return;
  const def = getMission(state.mission.id);
  if (!def || !def.branches) return;
  branchButtons = document.createElement('div');
  branchButtons.id = 'branch-choice';
  branchButtons.style.cssText = 'position:fixed;left:50%;bottom:140px;transform:translateX(-50%);display:flex;gap:12px;z-index:40;';
  for (const b of def.branches) {
    const btn = document.createElement('button');
    btn.textContent = b.label;
    btn.style.cssText = 'padding:12px 18px;font-size:15px;background:#1d2733;color:#fff;border:1px solid #f2c230;border-radius:8px;cursor:pointer;';
    btn.onclick = () => {
      chooseBranch(state, b.id);
      playSound('confirm');
      hideBranchChoice();
    };
    branchButtons.appendChild(btn);
  }
  document.body.appendChild(branchButtons);
}

function hideBranchChoice() {
  if (branchButtons) { branchButtons.remove(); branchButtons = null; }
}

function startPlaying() {
  hideMenu();
  screen = 'playing';
  initAudio();
  resumeAudio();
  setVolume(save.settings ? save.settings.volume : 0.7);
  setRadio(state.radioOn);
}

function openStartMenu() {
  screen = 'menu';
  const hasSave = save.missionsCompleted.length > 0 || save.money > 200;
  showMenu('start', { hasSave }, {
    onStart: () => startPlaying(),
    onNewGame: () => {
      clearSave();
      Object.assign(save, { money: 200, respect: 0, missionsCompleted: [], missionProgress: {} });
      player.money = 200;
      player.respect = 0;
      startPlaying();
    },
    onHelp: () => showMenu('help', {}, { onBack: () => openStartMenu() }),
  });
}

function openPauseMenu() {
  screen = 'paused';
  saveGame(state);
  showMenu('pause', {}, {
    onResume: () => startPlaying(),
    onRestartMission: () => {
      if (state.mission) retryMission(state);
      startPlaying();
    },
    onQuit: () => { saveGame(state); openStartMenu(); },
  });
}

function handleMissionEnd() {
  if (state.missionComplete) {
    const done = state.missionComplete;
    state.missionComplete = null;
    screen = 'complete';
    playSound('mission');
    saveGame(state);
    const next = done.next ? getMission(done.next) : null;
    showMenu('complete', { title: done.title, reward: done.reward, respect: done.respect, next: next ? next.title : null }, {
      onContinue: () => startPlaying(),
    });
    return true;
  }
  if (state.missionFailed) {
    const failed = state.missionFailed;
    state.missionFailed = null;
    screen = 'fail';
    playSound('fail');
    showMenu('fail', { reason: failed.reason }, {
      onRetry: () => { retryMission(state); startPlaying(); },
      onQuit: () => { saveGame(state); openStartMenu(); },
    });
    return true;
  }
  return false;
}

function updatePlayerOnFoot(dt) {
  const speed = input.keys.sprint ? CONFIG.PLAYER.runSpeed : CONFIG.PLAYER.walkSpeed;
  const fwd = (input.keys.forward ? 1 : 0) - (input.keys.back ? 1 : 0);
  const strafe = (input.keys.right ? 1 : 0) - (input.keys.left ? 1 : 0);
  const sin = Math.sin(player.heading);
  const cos = Math.cos(player.heading);
  const mx = (-sin * fwd + cos * strafe) * speed;
  const mz = (-cos * fwd - sin * strafe) * speed;
  player.vel.set(mx, 0, mz);
  player.speed = Math.hypot(mx, mz);
  player.pos.x = Math.max(-590, Math.min(590, player.pos.x + mx * dt));
  player.pos.z = Math.max(-590, Math.min(590, player.pos.z + mz * dt));
  if (player.speed > 0.5) {
    player.heading = Math.atan2(-mx, -mz);
    stepTimer -= dt;
    if (stepTimer <= 0) { playSound('footstep'); stepTimer = 0.35; }
  }
  playerMesh.position.copy(player.pos);
  playerMesh.rotation.y = player.heading;
  playerMesh.visible = true;
}

function updatePlayerInCar(dt) {
  const car = player.car;
  if (!car) return;
  const ctl = {
    throttle: input.throttle(),
    steer: input.steer(),
    brake: !!input.keys.brake,
    boost: !!input.keys.sprint,
  };
  const before = car.speed;
  updateVehicle(car, ctl, dt);
  if (Math.abs(car.speed - before) > 12 && Math.abs(car.speed) > 5) playSound('tire');
  if (input.consume(ACTION_NITRO) && car.upgrades && car.upgrades.nitro > 0 && car.boostLeft > 0) playSound('nitro');
  player.pos.copy(car.mesh.position);
  player.heading = car.heading;
  player.speed = Math.abs(car.speed);
  player.vel.set(Math.sin(car.heading) * car.speed, 0, Math.cos(car.heading) * car.speed);
  setEngine(Math.abs(car.speed) / Math.max(1, car.maxSpeed), true);
}

function applyShot(n) {
  const sp = city.spawnPoints || {};
  if (n === 1) {
    // Cover: police chase, mission 3 stage 2, wanted 2, fast on the coast road.
    playerCar.mesh.position.set(0, 0, 460);
    playerCar.heading = Math.PI / 2;
    playerCar.speed = 30;
    player.pos.set(0, 0, 460);
    state.wanted = 2;
    startMission(state, 'm3');
    state.mission.stage = 1;
    state.mission.target = { x: 300, z: -200, radius: 25 };
    enterCarSafe();
    spawnPolice(state);
  } else if (n === 2) {
    // Driving: Solara S through Glasspoint toward the beach, wanted 0.
    playerCar.mesh.position.set(420, 0, -380);
    playerCar.heading = Math.PI;
    playerCar.speed = 18;
    player.pos.set(420, 0, -380);
    state.wanted = 0;
    enterCarSafe();
  } else if (n === 3) {
    // Combat: Mara aiming a pistol on a Cobre Viejo sidewalk, 1 police behind.
    player.pos.set(-380, 0, 80);
    player.heading = Math.PI / 2;
    selectWeapon(state, 1);
    state.wanted = 1;
    spawnPolice(state);
  } else if (n === 4) {
    // Story: Mara and Nadia outside Sunwire FM, mission 2 stage 1.
    const studio = (sp.sunwire) || { x: -300, z: 420 };
    player.pos.set(studio.x, 0, studio.z);
    player.heading = Math.PI;
    startMission(state, 'm2');
    showDialog('Nadia', 'Rekaman itu bukti terakhir kita, Mara. Ambil di Cobre Viejo, bawa kembali ke studio.', 8);
  }
  syncPlayer();
  resetCamera(camera, { x: player.pos.x, y: 0, z: player.pos.z, heading: player.heading, speed: player.speed || 0 });
  screen = 'playing';
  hideMenu();
}

function enterCarSafe() {
  const car = playerCar;
  if (!player.inCar) {
    player.pos.copy(car.mesh.position);
    if (stealCar(player, car)) {
      car.parked = false;
    } else {
      // Fallback when the steal range check disagrees: seat the player directly.
      car.occupied = true;
      car.driver = player;
      player.inCar = true;
      player.car = car;
    }
    syncPlayer();
  }
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - last) / 1000 || 0.016, MAX_FRAME);
  last = now;

  // Global one-shot actions.
  if (input.consume(ACTION_PAUSE)) {
    if (screen === 'playing') openPauseMenu();
    else if (screen === 'paused') startPlaying();
  }
  if (input.consume(ACTION_RADIO)) {
    state.radioOn = !state.radioOn;
    setRadio(state.radioOn);
    playSound('click');
  }
  if (screen === 'menu') {
    if (input.consume(ACTION_CONFIRM)) startPlaying();
    state.time += dt;
    if (city.update) city.update(dt, state.time);
    updateCamera(camera, { x: player.pos.x, y: 0, z: player.pos.z, heading: player.heading, speed: 0 }, 'foot', dt);
    renderFrame(renderer, scene, camera);
    return;
  }
  if (screen !== 'playing') {
    renderFrame(renderer, scene, camera);
    return;
  }

  state.time += dt;
  if (city.update) city.update(dt, state.time);

  // Interact: enter/exit car, start a mission at the workshop, buy upgrades.
  if (input.consume(ACTION_INTERACT)) {
    if (player.inCar) tryExitCar();
    else if (!tryEnterCar()) {
      const nearWorkshop = Math.hypot(player.pos.x - startPoint.x, player.pos.z - startPoint.z) < 25;
      if (nearWorkshop && (!state.mission || !state.mission.active)) {
        const next = nextMissionId(state);
        if (next) {
          if (startMission(state, next)) { playSound('mission'); }
          else if (state.mission && state.mission.blocked) showDialog('Ivo', state.mission.reason, 6);
        } else {
          showDialog('Ivo', 'Semua misi selesai. Solmera milikmu, Mara.', 5);
        }
      }
    }
  }
  if (input.consume('upgrade')) buyNextUpgrade();

  // Weapons.
  if (input.consume(ACTION_WEAPON_1)) selectWeapon(state, 0);
  if (input.consume(ACTION_WEAPON_2)) selectWeapon(state, 1);
  player.aiming = !!input.mouse.rightDown && !player.inCar;
  if (!player.inCar && input.consume(ACTION_SHOOT)) {
    const w = currentWeapon(state);
    if (w && w.id === 'pistol') tryShoot(state);
    else tryPunch(state);
  }

  // Movement.
  if (player.inCar) updatePlayerInCar(dt);
  else {
    updatePlayerOnFoot(dt);
    setEngine(0, false);
  }
  syncPlayer();

  // World systems.
  updateTraffic(state, dt);
  updatePedestrians(state, dt);
  updateWanted(state, dt);
  dispatch(state, dt);
  updateCombat(state, dt);
  updateMission(state, dt);
  syncPlayer();

  // Siren follows wanted level.
  if (state.wanted > 0 && !sirenOn) { playSound('siren'); sirenOn = true; }
  if (state.wanted === 0 && sirenOn) { playSound('sirenStop'); sirenOn = false; }
  setMusicIntensity(state.wanted / 3);

  // Branch choice UI.
  if (state.mission && state.mission.branchPending && !state.mission.branchChosen) showBranchChoice();
  else hideBranchChoice();

  // Mission end menus.
  if (handleMissionEnd()) {
    renderFrame(renderer, scene, camera);
    return;
  }
  if (player.health <= 0 && (!state.mission || !state.mission.active)) {
    screen = 'gameover';
    playSound('fail');
    showMenu('gameover', {}, {
      onRetry: () => {
        player.health = 100;
        player.pos.set(startPoint.x, 0, startPoint.z);
        startPlaying();
      },
      onQuit: () => { saveGame(state); openStartMenu(); },
    });
  }

  // District label for the dispatch panel.
  if (player.pos.z > 300) state.district = 'Mar Azul';
  else if (player.pos.x > 100) state.district = 'Glasspoint';
  else state.district = 'Cobre Viejo';

  // HUD + minimap + camera + render.
  updateHUD(state, dt);
  drawMinimap(minimapCanvas, state);
  const mode = player.inCar ? 'drive' : (player.aiming ? 'aim' : 'foot');
  updateCamera(camera, { x: player.pos.x, y: 0, z: player.pos.z, heading: player.heading, speed: player.speed || 0, aiming: player.aiming }, mode, dt);
  renderFrame(renderer, scene, camera);

  if (shot) {
    shotReadyFrames += 1;
    if (shotReadyFrames >= 3) window.__shotReady = true;
  }
}

let last = performance.now();

// U buys the next upgrade at the workshop; input.js queues only listed
// actions, so listen for the key here and route it through the same path.
window.addEventListener('keydown', (event) => {
  if (event.code === 'KeyU' && !event.repeat && screen === 'playing') buyNextUpgrade();
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  if (resizeRenderer) resizeRenderer(renderer, camera);
});

// Leaving the tab pauses a running game.
document.addEventListener('visibilitychange', () => {
  if (document.hidden && screen === 'playing') openPauseMenu();
});

// First gesture unlocks audio (browsers block AudioContext before input).
window.addEventListener('pointerdown', () => { initAudio(); resumeAudio(); }, { once: true });
window.addEventListener('keydown', () => { initAudio(); resumeAudio(); }, { once: true });

syncPlayer();
if (shot) {
  applyShot(shot);
} else {
  openStartMenu();
}

// Debug/testing handle: lets a play-test (and the player, from devtools)
// inspect the live game without touching the code.
window.__game = {
  state,
  player,
  scene,
  startMission: (id) => startMission(state, id),
  get screen() { return screen; },
  get shotReady() { return !!window.__shotReady; },
};
requestAnimationFrame(frame);
