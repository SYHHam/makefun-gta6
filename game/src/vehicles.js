// vehicles.js - Sunline: Breakwater
// Five stealable car models, arcade driving physics, entering/exiting and
// the signature upgrade system (Turbo / Armor / Nitro, 3 tiers each).
// A car is a three.js mesh plus data { model, speed, maxSpeed, condition, upgrades }.
// No network, no CDN: three.js comes from the vendored import map ("three").
//
// Expected state shape (set up by main.js / W4):
//   state.player: { position: THREE.Vector3, mesh, inCar, car, armed }
//   state.scene: THREE.Scene
//   state.vehicles: array of cars created by spawnCar
// Input for updateVehicle: { throttle: -1..1, steer: -1..1, brake: bool, boost: bool }
//   (W4 input.js may instead pass { forward, reverse, left, right, boost }; both are read.)

import * as THREE from 'three';

export const STEAL_RANGE = 2.5;
export const WORLD_HALF = 600;

const KMH_TO_MS = 1 / 3.6;

// Top speeds are the design numbers in km/h; maxSpeed below is m/s.
export const CAR_MODELS = {
  solara: {
    key: 'solara', name: 'Solara S', kind: 'coupe', color: 0xf2c230,
    topSpeedKmh: 150, accel: 16, brake: 34, grip: 1.0, durability: 100,
    length: 4.4, width: 1.9, height: 0.62, cabinLength: 2.0,
  },
  brisa: {
    key: 'brisa', name: 'Brisa LX', kind: 'sedan', color: 0x2f6fd0,
    topSpeedKmh: 125, accel: 13, brake: 30, grip: 1.05, durability: 110,
    length: 4.7, width: 1.9, height: 0.66, cabinLength: 2.4,
  },
  cinderback: {
    key: 'cinderback', name: 'Cinderback', kind: 'muscle', color: 0xc22e2e,
    topSpeedKmh: 175, accel: 19, brake: 30, grip: 0.88, durability: 95,
    length: 4.8, width: 2.0, height: 0.68, cabinLength: 2.2,
  },
  dockrunner: {
    key: 'dockrunner', name: 'Dockrunner', kind: 'pickup', color: 0x3f8f4f,
    topSpeedKmh: 115, accel: 12, brake: 28, grip: 1.0, durability: 140,
    length: 5.0, width: 2.0, height: 0.78, cabinLength: 2.2,
  },
  velvet: {
    key: 'velvet', name: 'Velvet Nine', kind: 'sedan', color: 0xe8e4da,
    topSpeedKmh: 160, accel: 15, brake: 32, grip: 1.02, durability: 105,
    length: 4.9, width: 1.95, height: 0.64, cabinLength: 2.5,
  },
};

export const UPGRADE_TYPES = ['turbo', 'armor', 'nitro'];
export const UPGRADE_MAX_TIER = 3;

// Per-tier handling deltas. Turbo adds top speed, Armor adds max condition
// and a little mass (slightly slower accel), Nitro adds boost power.
const UPGRADE_EFFECTS = {
  turbo: { topSpeedKmh: 12, accel: 1.2 },
  armor: { durability: 40, accel: -0.4 },
  nitro: { boostAccel: 14, boostSeconds: 0.9 },
};

function modelDef(model) {
  const def = CAR_MODELS[model];
  if (!def) throw new Error(`Unknown car model: ${model}`);
  return def;
}

function box(w, h, d, color, x = 0, y = 0, z = 0) {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    new THREE.MeshStandardMaterial({ color, roughness: 0.45, metalness: 0.35 }),
  );
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  return mesh;
}

function makeWheel(radius, width) {
  const wheel = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius, width, 14),
    new THREE.MeshStandardMaterial({ color: 0x14161a, roughness: 0.9 }),
  );
  wheel.rotation.z = Math.PI / 2;
  wheel.castShadow = true;
  return wheel;
}

/**
 * Build the low-poly mesh for one model. Body, cabin, wheels, lights and
 * trim are plain BoxGeometry/CylinderGeometry with the model's paint colour.
 * Upgrade parts (spoiler, hood intake, stripes) are added later by
 * applyUpgrade and kept under mesh.userData.upgradeParts.
 */
export function buildCarMesh(model) {
  const def = modelDef(model);
  const group = new THREE.Group();
  group.name = `car-${def.key}`;

  const { length: L, width: W, height: H } = def;
  const bodyY = 0.55;

  const body = box(L, H, W, def.color, 0, bodyY, 0);
  group.add(body);

  // Cabin: coupe and muscle sit it back, sedans centre it, pickup has a cab + bed.
  const cabinColor = 0x1a2028;
  if (def.kind === 'pickup') {
    const cab = box(def.cabinLength, 0.62, W * 0.92, cabinColor, -0.3, bodyY + H / 2 + 0.28, 0);
    group.add(cab);
    const bedWall = box(1.5, 0.3, W * 0.96, def.color, 1.55, bodyY + H / 2 + 0.12, 0);
    group.add(bedWall);
  } else {
    const cabinX = def.kind === 'coupe' ? -0.25 : def.kind === 'muscle' ? -0.2 : 0;
    const cabin = box(def.cabinLength, 0.58, W * 0.86, cabinColor, cabinX, bodyY + H / 2 + 0.26, 0);
    group.add(cabin);
  }

  // Muscle hood scoop, pickup bed rails: small model flavour, no extra cost.
  if (def.kind === 'muscle') {
    group.add(box(0.9, 0.16, 0.7, 0x8f1d1d, 1.3, bodyY + H / 2 + 0.06, 0));
  }

  // Wheels.
  const wheelR = def.kind === 'pickup' ? 0.42 : 0.36;
  const wheelX = L / 2 - 0.85;
  const wheelZ = W / 2 - 0.05;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const wheel = makeWheel(wheelR, 0.28);
      wheel.position.set(sx * wheelX, wheelR, sz * wheelZ);
      group.add(wheel);
    }
  }

  // Headlights (front is +X) and taillights.
  const headMat = new THREE.MeshStandardMaterial({ color: 0xfff2b0, emissive: 0x554400 });
  for (const sz of [-1, 1]) {
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.14, 0.4), headMat);
    head.position.set(L / 2 + 0.01, bodyY + 0.08, sz * (W / 2 - 0.45));
    group.add(head);
    const tail = new THREE.Mesh(
      new THREE.BoxGeometry(0.08, 0.14, 0.4),
      new THREE.MeshStandardMaterial({ color: 0xaa1111, emissive: 0x330000 }),
    );
    tail.position.set(-L / 2 - 0.01, bodyY + 0.08, sz * (W / 2 - 0.45));
    group.add(tail);
  }

  // Bumpers.
  group.add(box(0.18, 0.22, W * 0.98, 0x22262c, L / 2 - 0.05, 0.32, 0));
  group.add(box(0.18, 0.22, W * 0.98, 0x22262c, -L / 2 + 0.05, 0.32, 0));

  group.userData.modelKey = def.key;
  group.userData.upgradeParts = {};
  return group;
}

/** Remove a previously fitted visible upgrade part from the mesh. */
function clearUpgradePart(mesh, partName) {
  const parts = mesh.userData.upgradeParts;
  if (!parts || !parts[partName]) return;
  mesh.remove(parts[partName]);
  delete parts[partName];
}

/**
 * Fit an upgrade onto a car. type is turbo / armor / nitro, tier 1..3.
 * Each tier is visible on the model and changes the handling:
 *  - turbo: rear spoiler grows per tier, +top speed and +accel.
 *  - armor: dark side skirts + front bull bar per tier, +max condition.
 *  - nitro: hood intake + racing stripes per tier, +boost power and duration.
 * Returns true when applied, false for a bad type/tier.
 */
export function applyUpgrade(car, type, tier) {
  if (!car || !UPGRADE_TYPES.includes(type)) return false;
  const t = Math.max(1, Math.min(UPGRADE_MAX_TIER, Math.floor(tier) || 1));
  const def = modelDef(car.model);
  car.upgrades = car.upgrades || { turbo: 0, armor: 0, nitro: 0 };
  car.upgrades[type] = t;

  const mesh = car.mesh;
  const { length: L, width: W, height: H } = def;
  const bodyY = 0.55;

  if (type === 'turbo') {
    clearUpgradePart(mesh, 'spoiler');
    const spoiler = new THREE.Group();
    const wing = box(0.5 + 0.18 * t, 0.07, W * 0.92, 0x1c1f24, 0, 0.42 + 0.06 * t, 0);
    spoiler.add(wing);
    for (const sz of [-1, 1]) {
      spoiler.add(box(0.1, 0.42 + 0.06 * t, 0.1, 0x1c1f24, 0, 0.2, sz * (W / 2 - 0.25)));
    }
    spoiler.position.set(-L / 2 + 0.35, bodyY + H / 2, 0);
    mesh.add(spoiler);
    mesh.userData.upgradeParts.spoiler = spoiler;
    car.maxSpeed = (def.topSpeedKmh + UPGRADE_EFFECTS.turbo.topSpeedKmh * t) * KMH_TO_MS;
    car.accel = def.accel + UPGRADE_EFFECTS.turbo.accel * t
      + (car.upgrades.armor ? UPGRADE_EFFECTS.armor.accel * car.upgrades.armor : 0);
  }

  if (type === 'armor') {
    clearUpgradePart(mesh, 'armor');
    const armor = new THREE.Group();
    for (const sz of [-1, 1]) {
      armor.add(box(L * 0.9, 0.16, 0.1, 0x2a2e35, 0, 0.3, sz * (W / 2 + 0.02)));
    }
    // Bull bar grows with tier: tier 2 adds a centre bar, tier 3 a full guard.
    armor.add(box(0.12, 0.34, W * 0.7, 0x2a2e35, L / 2 + 0.06, 0.5, 0));
    if (t >= 2) armor.add(box(0.1, 0.5, 0.14, 0x2a2e35, L / 2 + 0.08, 0.55, 0));
    if (t >= 3) {
      armor.add(box(0.1, 0.2, W * 0.5, 0x2a2e35, L / 2 + 0.08, 0.85, 0));
    }
    mesh.add(armor);
    mesh.userData.upgradeParts.armor = armor;
    car.maxCondition = def.durability + UPGRADE_EFFECTS.armor.durability * t;
    car.condition = Math.min(car.maxCondition, (car.condition ?? def.durability) + UPGRADE_EFFECTS.armor.durability * t);
    car.accel = def.accel + (car.upgrades.turbo ? UPGRADE_EFFECTS.turbo.accel * car.upgrades.turbo : 0)
      + UPGRADE_EFFECTS.armor.accel * t;
  }

  if (type === 'nitro') {
    clearUpgradePart(mesh, 'nitro');
    const nitro = new THREE.Group();
    nitro.add(box(0.7, 0.12 + 0.05 * t, 0.6, 0x14161a, 1.2, bodyY + H / 2 + 0.08, 0));
    // Racing stripes along the bonnet and roof, wider per tier.
    const stripeW = 0.14 + 0.08 * t;
    nitro.add(box(L * 0.98, 0.02, stripeW, 0x111318, 0, bodyY + H / 2 + 0.02, 0));
    mesh.add(nitro);
    mesh.userData.upgradeParts.nitro = nitro;
    car.boostAccel = UPGRADE_EFFECTS.nitro.boostAccel * t;
    car.boostSeconds = UPGRADE_EFFECTS.nitro.boostSeconds * t;
  }

  return true;
}

function playerPosition(player) {
  if (!player) return null;
  if (player.position) return player.position;
  if (player.mesh && player.mesh.position) return player.mesh.position;
  if (typeof player.x === 'number' && typeof player.z === 'number') {
    return new THREE.Vector3(player.x, 0, player.z);
  }
  return null;
}

function distanceToCar(player, car) {
  const p = playerPosition(player);
  if (!p || !car.mesh) return Infinity;
  const dx = p.x - car.mesh.position.x;
  const dz = p.z - car.mesh.position.z;
  return Math.hypot(dx, dz);
}

/**
 * Create a car at pos ({x, z} or THREE.Vector3, y optional). When a scene
 * is passed the mesh is added to it. Returns the car record; the caller
 * (main.js) should push it into state.vehicles.
 */
export function spawnCar(model, pos, scene = null) {
  const def = modelDef(model);
  const mesh = buildCarMesh(model);
  const x = pos?.x ?? 0;
  const z = pos?.z ?? 0;
  const y = pos?.y ?? 0;
  mesh.position.set(x, y, z);
  if (typeof pos?.heading === 'number') mesh.rotation.y = pos.heading;
  if (scene) scene.add(mesh);

  const car = {
    model: def.key,
    name: def.name,
    mesh,
    speed: 0,
    maxSpeed: def.topSpeedKmh * KMH_TO_MS,
    topSpeedKmh: def.topSpeedKmh,
    accel: def.accel,
    brake: def.brake,
    grip: def.grip,
    condition: def.durability,
    maxCondition: def.durability,
    upgrades: { turbo: 0, armor: 0, nitro: 0 },
    boostAccel: 0,
    boostSeconds: 0,
    boostLeft: 0,
    heading: mesh.rotation.y,
    steering: 0,
    knockX: 0,
    knockZ: 0,
    hitTimer: 0,
    occupied: false,
    driver: null,
  };
  return car;
}

/**
 * Steal a car: player within STEAL_RANGE (2.5 m) of it. Returns true when
 * the player got in, false when too far away or the car is already taken.
 * The E key itself is read by input.js / main.js; this is the check + enter.
 */
export function stealCar(player, car) {
  if (!player || !car || car.occupied) return false;
  if (distanceToCar(player, car) > STEAL_RANGE) return false;
  return enterCar(player, car);
}

export function enterCar(player, car) {
  if (!player || !car) return false;
  car.occupied = true;
  car.driver = player;
  player.inCar = true;
  player.car = car;
  if (player.mesh) player.mesh.visible = false;
  // Sit the player record on the car so HUD / camera can follow one object.
  if (player.position && car.mesh) player.position.copy(car.mesh.position);
  return true;
}

export function exitCar(player, car) {
  const target = car || player?.car;
  if (!player || !target) return false;
  target.occupied = false;
  target.driver = null;
  target.speed = 0;
  player.inCar = false;
  player.car = null;
  if (player.mesh) {
    player.mesh.visible = true;
    // Step out on the driver's side (left, -Z in car space).
    const side = new THREE.Vector3(0, 0, -1).applyAxisAngle(
      new THREE.Vector3(0, 1, 0), target.mesh.rotation.y,
    );
    player.mesh.position.set(
      target.mesh.position.x + side.x * 2.2,
      0,
      target.mesh.position.z + side.z * 2.2,
    );
    if (player.position) player.position.copy(player.mesh.position);
  }
  return true;
}

/**
 * Collision response: cut speed and shove the car briefly along `normal`
 * (a {x, z} unit vector pointing away from the impact). Called by the
 * world / police / traffic collision checks; updateVehicle decays the shove.
 */
export function collideCar(car, normal, strength = 1) {
  if (!car) return;
  const s = Math.max(0, Math.min(1.5, strength));
  car.speed *= Math.max(0.25, 1 - 0.45 * s);
  car.knockX += (normal?.x ?? 0) * 6 * s;
  car.knockZ += (normal?.z ?? 0) * 6 * s;
  car.hitTimer = 0.45;
  car.condition = Math.max(0, car.condition - 6 * s);
}

function readInput(input) {
  if (!input) return { throttle: 0, steer: 0, brake: false, boost: false };
  if (typeof input.throttle === 'number' || typeof input.steer === 'number') {
    return {
      throttle: input.throttle ?? 0,
      steer: input.steer ?? 0,
      brake: !!input.brake,
      boost: !!input.boost,
    };
  }
  // WASD-style object from input.js: { forward, reverse, left, right, boost }.
  return {
    throttle: (input.forward ? 1 : 0) - (input.reverse ? 1 : 0),
    steer: (input.left ? 1 : 0) - (input.right ? 1 : 0),
    brake: !!input.brake,
    boost: !!input.boost,
  };
}

/**
 * One arcade physics step for a driven car. Responsive accel/brake, steering
 * that widens (less yaw per metre) at high speed, drag, Nitro boost, and
 * decay of the collision shove from collideCar. The mesh follows the car.
 */
export function updateVehicle(car, input, dt) {
  if (!car || !car.mesh) return;
  const step = Math.min(dt, 0.05);
  const ctl = readInput(input);
  const def = modelDef(car.model);

  // Nitro boost: hold boost while fitted; drains boostLeft, refills slowly.
  let accelNow = car.accel;
  if (ctl.boost && car.upgrades?.nitro > 0 && car.boostLeft > 0) {
    accelNow += car.boostAccel;
    car.boostLeft = Math.max(0, car.boostLeft - step);
  } else if (car.upgrades?.nitro > 0) {
    car.boostLeft = Math.min(car.boostSeconds, car.boostLeft + step * 0.35);
  }

  if (ctl.throttle > 0) {
    car.speed += accelNow * ctl.throttle * step;
  } else if (ctl.throttle < 0) {
    // Reverse, or brake hard when moving forward.
    if (car.speed > 0.5) car.speed -= car.brake * step;
    else car.speed += accelNow * 0.55 * ctl.throttle * step;
  } else if (ctl.brake) {
    car.speed -= car.brake * step;
  }
  // Drag + rolling resistance; reverse is capped low.
  car.speed -= car.speed * 0.55 * step;
  if (car.speed > 0.2) car.speed -= 1.2 * step;
  else if (car.speed < -0.2) car.speed += 1.2 * step;
  const reverseMax = -car.maxSpeed * 0.35;
  car.speed = Math.max(reverseMax, Math.min(car.maxSpeed, car.speed));
  if (Math.abs(car.speed) < 0.05 && ctl.throttle === 0) car.speed = 0;

  // Steering: smooth toward the target, weaker at speed so turns widen.
  const speedFactor = Math.min(1, Math.abs(car.speed) / car.maxSpeed);
  const steerAuthority = (1.9 - 1.15 * speedFactor) * car.grip;
  const targetSteer = ctl.steer * steerAuthority;
  car.steering += (targetSteer - car.steering) * Math.min(1, step * 8);
  // Yaw rate falls off at high speed: the same wheel angle turns less.
  const yawRate = car.steering * (car.speed / Math.max(4, def.length)) * (1 - 0.45 * speedFactor);
  car.heading += yawRate * step * (car.speed >= 0 ? 1 : -1);
  car.mesh.rotation.y = car.heading;

  // Move forward along the heading, plus the decaying collision shove.
  const forwardX = Math.sin(car.heading);
  const forwardZ = Math.cos(car.heading);
  car.mesh.position.x += forwardX * car.speed * step + car.knockX * step;
  car.mesh.position.z += forwardZ * car.speed * step + car.knockZ * step;
  car.knockX *= Math.max(0, 1 - step * 6);
  car.knockZ *= Math.max(0, 1 - step * 6);
  if (car.hitTimer > 0) car.hitTimer -= step;

  // Keep the car inside the 1200x1200 city; soft wall, no teleport.
  const m = car.mesh.position;
  m.x = Math.max(-WORLD_HALF, Math.min(WORLD_HALF, m.x));
  m.z = Math.max(-WORLD_HALF, Math.min(WORLD_HALF, m.z));

  // Body roll: lean into the turn a touch, pitch under accel/brake.
  car.mesh.rotation.z = -car.steering * 0.03 * Math.min(1, Math.abs(car.speed) / 10);
}
