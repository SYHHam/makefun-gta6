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
import { initTouch } from './touch.js';

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

// Player mesh: low-poly Mara, orange jacket, dark trousers.
// 16 meshes: torso, collar, belt, holster, head, hair, 2 arms
// (upper + forearm + hand each) and 2 legs (leg + shoe each).
// Model faces local -Z (camera convention: heading 0 faces -z, forward
// is (-sin h, -cos h)); feet at y 0, head top ~1.82 m.
// Arm/leg pivots are Groups stored in userData so the frame loop can
// pose them (walk swing, aim, recoil, driving).
function buildPlayerMesh() {
  const group = new THREE.Group();
  const lambert = (color) => new THREE.MeshLambertMaterial({ color });
  const jacket = lambert(0xe8722a);
  const jacketDark = lambert(0xc2571a);
  const skin = lambert(0xd9a986);
  const trousers = lambert(0x2a2f3a);
  const hairMat = lambert(0x3a2a1e);
  const dark = lambert(0x241a12);
  const shoeMat = lambert(0x1c1c22);
  function box(w, h, d, material, x, y, z) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
    m.position.set(x, y, z);
    m.castShadow = true;
    return m;
  }

  // Torso + details: collar, belt, pistol holster on the right hip.
  const torso = box(0.55, 0.72, 0.32, jacket, 0, 1.06, 0);
  const collar = box(0.42, 0.09, 0.36, jacketDark, 0, 1.40, 0);
  const belt = box(0.56, 0.07, 0.33, dark, 0, 0.71, 0);
  const holster = box(0.09, 0.20, 0.16, dark, 0.29, 0.60, 0.06);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.20, 12, 10), skin);
  head.position.y = 1.60;
  head.castShadow = true;
  const hair = new THREE.Mesh(new THREE.SphereGeometry(0.21, 12, 10), hairMat);
  hair.scale.set(1, 0.72, 1);
  hair.position.set(0, 1.67, 0.03);
  hair.castShadow = true;
  group.add(torso, collar, belt, holster, head, hair);

  // Arms: shoulder pivot Group, upper arm, elbow pivot Group with
  // forearm + skin hand. Hands hang at hip level when relaxed.
  function makeArm(side) {
    const shoulder = new THREE.Group();
    shoulder.position.set(side * 0.335, 1.38, 0);
    shoulder.add(box(0.13, 0.34, 0.13, jacket, 0, -0.17, 0));
    const elbow = new THREE.Group();
    elbow.position.set(0, -0.34, 0);
    elbow.add(box(0.12, 0.30, 0.12, jacket, 0, -0.15, 0));
    elbow.add(box(0.11, 0.13, 0.11, skin, 0, -0.35, 0));
    shoulder.add(elbow);
    group.add(shoulder);
    return { shoulder, elbow };
  }
  const armL = makeArm(-1);
  const armR = makeArm(1);

  // Legs: hip pivot Group, trouser leg, shoe with the toe forward (-Z).
  function makeLeg(side) {
    const hip = new THREE.Group();
    hip.position.set(side * 0.13, 0.72, 0);
    hip.add(box(0.17, 0.62, 0.18, trousers, 0, -0.31, 0));
    hip.add(box(0.18, 0.09, 0.30, shoeMat, 0, -0.665, -0.05));
    group.add(hip);
    return hip;
  }
  const legL = makeLeg(-1);
  const legR = makeLeg(1);

  group.userData.armL = armL.shoulder;
  group.userData.armR = armR.shoulder;
  group.userData.elbowL = armL.elbow;
  group.userData.elbowR = armR.elbow;
  group.userData.legL = legL;
  group.userData.legR = legR;
  group.userData.walkPhase = 0;
  group.userData.swingAmp = 0;
  group.userData.aimBlend = 0;
  group.userData.recoil = 0;
  group.userData.punch = 0;
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
// Every spot sits 6 m off a road centreline (roadLines -500/-300/-100/
// 100/300/500 in config.js), i.e. on the road edge / sidewalk, never
// inside a block. heading is parallel to the road: PI/2 on vertical
// roads (car's long axis lies along Z), 0 on horizontal roads.
const PARKED_SPOTS = [
  // Cobre Viejo (x <= 100, z <= 300).
  { model: 'solara', x: -506, z: -380, heading: Math.PI / 2 },
  { model: 'brisa', x: -294, z: -180, heading: Math.PI / 2 },
  { model: 'cinderback', x: -106, z: 120, heading: Math.PI / 2 },
  { model: 'dockrunner', x: -380, z: -506, heading: 0 },
  { model: 'velvet', x: -180, z: -294, heading: 0 },
  { model: 'brisa', x: 94, z: -420, heading: Math.PI / 2 },
  { model: 'solara', x: -420, z: 94, heading: 0 },
  // Glasspoint (x > 100, z <= 300).
  { model: 'solara', x: 106, z: -380, heading: Math.PI / 2 },
  { model: 'brisa', x: 294, z: -100, heading: Math.PI / 2 },
  { model: 'cinderback', x: 506, z: 200, heading: Math.PI / 2 },
  { model: 'dockrunner', x: 300, z: -106, heading: 0 },
  { model: 'velvet', x: 420, z: 294, heading: 0 },
  { model: 'brisa', x: 180, z: -506, heading: 0 },
  { model: 'solara', x: 506, z: -420, heading: Math.PI / 2 },
  // Mar Azul (z > 300, beach band).
  { model: 'velvet', x: -380, z: 506, heading: 0 },
  { model: 'brisa', x: -100, z: 494, heading: 0 },
  { model: 'solara', x: 100, z: 506, heading: 0 },
  { model: 'cinderback', x: 380, z: 494, heading: 0 },
  { model: 'dockrunner', x: -506, z: 420, heading: Math.PI / 2 },
  { model: 'brisa', x: 294, z: 420, heading: Math.PI / 2 },
  { model: 'velvet', x: 506, z: 460, heading: Math.PI / 2 },
];
const parkedCars = PARKED_SPOTS.map((s) => spawnCar(s.model, { x: s.x, z: s.z, heading: s.heading ?? Math.random() * Math.PI * 2 }, scene));
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
  showMenu('pause', { radioOn: state.radioOn }, {
    onResume: () => startPlaying(),
    onRadioToggle: () => {
      state.radioOn = !state.radioOn;
      setRadio(state.radioOn);
      openPauseMenu();
    },
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
  updateOnFootPose(dt);
}

// Arm + leg pose for Mara on foot (W2). Walk/run: arms swing opposite
// to the legs (sine of distance travelled), elbows slightly bent; idle:
// arms hang relaxed. Aiming: both arms rise forward to hold the pistol,
// left hand supporting, right hand on the grip; recoil kicks the arms
// up briefly after a shot, a punch swings the right arm forward.
function updateOnFootPose(dt) {
  const ud = playerMesh.userData;
  const moving = player.speed > 0.5;
  if (moving) ud.walkPhase += dt * player.speed * 1.9;
  const targetAmp = moving ? Math.min(0.55, 0.22 + player.speed * 0.04) : 0;
  ud.swingAmp = THREE.MathUtils.lerp(ud.swingAmp, targetAmp, Math.min(1, dt * 8));
  ud.aimBlend = THREE.MathUtils.lerp(ud.aimBlend, player.aiming ? 1 : 0, Math.min(1, dt * 10));
  ud.recoil = Math.max(0, ud.recoil - dt * 5);
  ud.punch = Math.max(0, ud.punch - dt * 3.5);
  const s = Math.sin(ud.walkPhase);
  const amp = ud.swingAmp;
  const ab = ud.aimBlend;
  const kick = ud.recoil * 0.25;
  const punchSwing = ud.punch * 1.1;

  const armLxWalk = s * amp;
  const armRxWalk = -s * amp + punchSwing;
  const elbowLxWalk = 0.22 + 0.25 * amp * Math.max(0, s);
  const elbowRxWalk = Math.max(0.05, 0.22 + 0.25 * amp * Math.max(0, -s) - ud.punch * 0.2);
  const legLxWalk = -s * amp * 0.85;
  const legRxWalk = s * amp * 0.85;

  ud.armL.rotation.x = THREE.MathUtils.lerp(armLxWalk, 1.25 + kick, ab);
  ud.armL.rotation.z = THREE.MathUtils.lerp(0.16, 0.22, ab);
  ud.armR.rotation.x = THREE.MathUtils.lerp(armRxWalk, 1.25 + kick, ab);
  ud.armR.rotation.z = THREE.MathUtils.lerp(-0.16, -0.22, ab);
  ud.elbowL.rotation.x = THREE.MathUtils.lerp(elbowLxWalk, 0.15, ab);
  ud.elbowR.rotation.x = THREE.MathUtils.lerp(elbowRxWalk, 0.15, ab);
  ud.legL.rotation.x = THREE.MathUtils.lerp(legLxWalk, 0.18, ab);
  ud.legR.rotation.x = THREE.MathUtils.lerp(legRxWalk, -0.18, ab);
}

const UP_AXIS = new THREE.Vector3(0, 1, 0);
const seatOffset = new THREE.Vector3();

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

  // Driver pose (W2): Mara stays visible, seated in the driver seat
  // with both hands forward on the wheel. Car-local +Z is the travel
  // direction (mesh.rotation.y = heading maps +Z to (sin h, cos h)),
  // so the driver sits at local (-0.4, 0.05, -0.35) on the driver
  // (-Z) side and the mesh turns heading + PI so the model, which
  // faces local -Z, faces the direction of travel. Hips/torso stay
  // inside the cabin, only the head clears the roofline; no limb
  // sticks out of the car. Hands track the steering a touch.
  const ud = playerMesh.userData;
  seatOffset.set(-0.4, 0.05, -0.35).applyAxisAngle(UP_AXIS, car.heading);
  playerMesh.position.set(
    car.mesh.position.x + seatOffset.x,
    car.mesh.position.y + seatOffset.y,
    car.mesh.position.z + seatOffset.z,
  );
  playerMesh.rotation.y = car.heading + Math.PI;
  playerMesh.visible = true;
  const steer = car.steering || 0;
  ud.armL.rotation.set(0.95 - steer * 0.1, 0, 0.22);
  ud.armR.rotation.set(0.95 + steer * 0.1, 0, -0.22);
  ud.elbowL.rotation.x = 0.5;
  ud.elbowR.rotation.x = 0.5;
  ud.legL.rotation.x = 1.25;
  ud.legR.rotation.x = 1.25;
  ud.aimBlend = 0;
  ud.recoil = 0;
  ud.punch = 0;
}

function applyShot(n) {
  const sp = city.spawnPoints || {};
  if (n === 1) {
    // Cover: police chase, mission 3 stage 2, wanted 2, fast down the
    // Glasspoint main road (x=100) heading north. Same open framing as
    // shot 2 (road stretching ahead, buildings both sides, traffic,
    // palms) so no single facade fills the frame; the chase HUD
    // (wanted 2, dispatch, mission dialog) carries the chase story.
    playerCar.mesh.position.set(100, 0, -200);
    playerCar.heading = 0;
    playerCar.speed = 30;
    player.pos.set(100, 0, -200);
    state.wanted = 2;
    startMission(state, 'm3');
    state.mission.stage = 1;
    state.mission.target = { x: 300, z: -200, radius: 25 };
    enterCarSafe();
    spawnPolice(state);
  } else if (n === 2) {
    // Driving: Solara S down the Glasspoint main road (x=100) toward
    // the beach, wanted 0. On the road, not inside a block, so the
    // street, buildings, palms and traffic are all in frame.
    playerCar.mesh.position.set(100, 0, -200);
    playerCar.heading = 0;
    playerCar.speed = 18;
    player.pos.set(100, 0, -200);
    state.wanted = 0;
    enterCarSafe();
  } else if (n === 3) {
    // Combat: Mara aiming a pistol on the Cobre Viejo sidewalk beside
    // the x=-300 road, facing east toward the road, 1 police behind.
    // rightDown held so the aim pose (both arms forward) shows.
    player.pos.set(-312, 0, 80);
    player.heading = -Math.PI / 2;
    selectWeapon(state, 1);
    input.mouse.rightDown = true;
    state.wanted = 1;
    spawnPolice(state);
  } else if (n === 4) {
    // Story: Mara at the plaza fountain facing the workshop, mission 2
    // stage 1, with the neon workshop, palms and pedestrians in frame.
    player.pos.set(20, 0, 55);
    player.heading = 0.3;
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
    if (w && w.id === 'pistol') {
      if (tryShoot(state)) playerMesh.userData.recoil = 1;
    } else if (tryPunch(state)) {
      playerMesh.userData.punch = 1;
    }
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
initTouch(input, { onCameraDrag: (dx) => { player.heading += dx * 0.005; }, isInCar: () => player.inCar });
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
