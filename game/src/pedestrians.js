// pedestrians.js - Sunline: Breakwater
// Crowd clusters in the active districts, per the design: 8-12 clusters,
// 6-8 NPCs per cluster, loitering with a simple walk animation. NPCs walk
// 1.2-1.6 m/s between sidewalk waypoints inside their cluster, pause now
// and then, and flee when hit by a car, when a shot is fired nearby, or
// when the player comes close while armed. There is no global waypoint
// system for all pedestrians (cut in the design); movement stays local
// to each cluster.
//
// Expected state shape (set up by main.js / W4):
//   state.player: { position: THREE.Vector3, mesh, armed }
//   state.scene: THREE.Scene
//   state.vehicles: cars from vehicles.js (for collision flee checks)
//   state.pedestrians: array created by spawnCrowds
//   state.lastGunshot: { x, z, time } | null, set by combat.js
//   state.time: seconds since start

import * as THREE from 'three';

export const CLUSTER_COUNT_MIN = 16;
export const CLUSTER_COUNT_MAX = 20;
export const CLUSTER_SIZE_MIN = 10;
export const CLUSTER_SIZE_MAX = 14;
export const CLUSTER_RADIUS = 16;
export const PED_WALK_MIN = 1.2;
export const PED_WALK_MAX = 1.6;
export const PED_FLEE_SPEED = 3.2;
export const PED_FLEE_RANGE = 26;
export const PED_FLEE_TIME = 4;

// District centres on the 1200x1200 map (south beach, old town, harbour).
// The plaza district guarantees a crowd right around the spawn.
export const DISTRICTS = {
  marAzul: { name: 'Mar Azul', x: 0, z: 480, radius: 220 },
  cobreViejo: { name: 'Cobre Viejo', x: -320, z: -80, radius: 240 },
  glasspoint: { name: 'Glasspoint', x: 330, z: -300, radius: 230 },
  plaza: { name: 'Plaza Cobre Viejo', x: -40, z: -40, radius: 130 },
};

const SKIN_TONES = [0xc68e6a, 0x8d5a3b, 0xe0ac8a, 0x6b4226, 0xd9a077];
const SHIRT_COLORS = [
  0xe74c3c, 0x3498db, 0xf1c40f, 0x2ecc71, 0x9b59b6,
  0xfd7e14, 0x1abc9c, 0xecf0f1, 0x34495e, 0xff6b9d,
];
const PANTS_COLORS = [0x2c3e50, 0x5d6d7e, 0x7b6d5a, 0x1a1a1a, 0x3a5a7a];

function rand(min, max) {
  return min + Math.random() * (max - min);
}

function pick(list) {
  return list[Math.floor(Math.random() * list.length)];
}

function makePedMesh() {
  const group = new THREE.Group();
  const skin = pick(SKIN_TONES);
  const shirt = pick(SHIRT_COLORS);
  const pants = pick(PANTS_COLORS);

  const body = new THREE.Mesh(
    new THREE.BoxGeometry(0.5, 0.75, 0.3),
    new THREE.MeshStandardMaterial({ color: shirt, roughness: 0.85 }),
  );
  body.position.y = 0.95;
  body.castShadow = true;
  group.add(body);

  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.19, 10, 8),
    new THREE.MeshStandardMaterial({ color: skin, roughness: 0.7 }),
  );
  head.position.y = 1.55;
  head.castShadow = true;
  group.add(head);

  const legs = new THREE.Group();
  for (const side of [-1, 1]) {
    const leg = new THREE.Mesh(
      new THREE.BoxGeometry(0.18, 0.55, 0.2),
      new THREE.MeshStandardMaterial({ color: pants, roughness: 0.9 }),
    );
    leg.position.set(side * 0.13, 0.28, 0);
    legs.add(leg);
  }
  group.add(legs);

  const arms = new THREE.Group();
  for (const side of [-1, 1]) {
    const arm = new THREE.Mesh(
      new THREE.BoxGeometry(0.13, 0.55, 0.15),
      new THREE.MeshStandardMaterial({ color: shirt, roughness: 0.85 }),
    );
    arm.position.set(side * 0.32, 0.95, 0);
    arms.add(arm);
  }
  group.add(arms);

  group.userData.legs = legs;
  group.userData.arms = arms;
  return group;
}

function randomPointInCluster(cluster) {
  const angle = Math.random() * Math.PI * 2;
  const r = Math.sqrt(Math.random()) * CLUSTER_RADIUS;
  return {
    x: cluster.x + Math.cos(angle) * r,
    z: cluster.z + Math.sin(angle) * r,
  };
}

function makePed(cluster, scene) {
  const mesh = makePedMesh();
  const start = randomPointInCluster(cluster);
  mesh.position.set(start.x, 0, start.z);
  mesh.rotation.y = Math.random() * Math.PI * 2;
  if (scene) scene.add(mesh);
  const waypoint = randomPointInCluster(cluster);
  return {
    mesh,
    cluster,
    waypoint,
    state: 'walk',
    speed: rand(PED_WALK_MIN, PED_WALK_MAX),
    idleTimer: rand(0, 3),
    fleeTimer: 0,
    fleeX: 0,
    fleeZ: 0,
    walkPhase: Math.random() * Math.PI * 2,
  };
}

/**
 * Spawn crowd clusters across the given districts (defaults to the three
 * design districts). 8-12 clusters in total, 6-8 NPCs each. The clusters
 * are stored on state.pedestrians as { clusters, npcs } and returned.
 * Call again with a new district list to respawn for a different area.
 */
export function spawnCrowds(districts, scene = null) {
  const list = Array.isArray(districts) && districts.length > 0
    ? districts
    : Object.values(DISTRICTS);
  const clusterCount = Math.floor(rand(CLUSTER_COUNT_MIN, CLUSTER_COUNT_MAX + 1));
  const clusters = [];
  const npcs = [];
  for (let i = 0; i < clusterCount; i += 1) {
    const district = list[i % list.length];
    const angle = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random()) * district.radius * 0.7;
    const cluster = {
      district: district.name || `district-${i}`,
      x: district.x + Math.cos(angle) * r,
      z: district.z + Math.sin(angle) * r,
    };
    clusters.push(cluster);
    const size = Math.floor(rand(CLUSTER_SIZE_MIN, CLUSTER_SIZE_MAX + 1));
    for (let j = 0; j < size; j += 1) npcs.push(makePed(cluster, scene));
  }
  return { clusters, npcs };
}

export function clearCrowds(state) {
  if (!state || !state.pedestrians) return;
  for (const ped of state.pedestrians.npcs || []) {
    if (state.scene && ped.mesh) state.scene.remove(ped.mesh);
  }
  state.pedestrians = { clusters: [], npcs: [] };
}

function playerPos(state) {
  const p = state.player;
  if (!p) return null;
  if (p.position) return { x: p.position.x, z: p.position.z, armed: !!p.armed };
  if (p.mesh) return { x: p.mesh.position.x, z: p.mesh.position.z, armed: !!p.armed };
  return { x: p.x ?? 0, z: p.z ?? 0, armed: !!p.armed };
}

function startFlee(ped, fromX, fromZ) {
  const dx = ped.mesh.position.x - fromX;
  const dz = ped.mesh.position.z - fromZ;
  const len = Math.hypot(dx, dz) || 1;
  ped.fleeX = dx / len;
  ped.fleeZ = dz / len;
  ped.state = 'flee';
  ped.fleeTimer = PED_FLEE_TIME;
}

/**
 * One pedestrian step: walk between waypoints inside the cluster, idle
 * pauses, and fleeing from cars that touch them, from gunshots, and from
 * an armed player who gets close. Fleeing NPCs run away at 3.2 m/s for a
 * few seconds, then settle back into the cluster.
 */
export function updatePedestrians(state, dt) {
  if (!state || !state.pedestrians) return;
  const step = Math.min(dt, 0.05);
  const npcs = state.pedestrians.npcs || [];
  const player = playerPos(state);
  const now = state.time ?? 0;

  for (const ped of npcs) {
    const m = ped.mesh;
    const px = m.position.x;
    const pz = m.position.z;

    // Flee triggers, checked before movement so the reaction is immediate.
    if (ped.state !== 'flee') {
      // Car collision: any vehicle within 2 m.
      const vehicles = state.vehicles || [];
      for (const car of vehicles) {
        if (!car.mesh) continue;
        if (Math.hypot(car.mesh.position.x - px, car.mesh.position.z - pz) < 2) {
          startFlee(ped, car.mesh.position.x, car.mesh.position.z);
          break;
        }
      }
      // Gunshot nearby (set by combat.js as { x, z, time }).
      if (ped.state !== 'flee' && state.lastGunshot) {
        const shot = state.lastGunshot;
        const age = now - (shot.time ?? 0);
        if (age < 2 && Math.hypot(shot.x - px, shot.z - pz) < PED_FLEE_RANGE) {
          startFlee(ped, shot.x, shot.z);
        }
      }
      // Armed player close by.
      if (ped.state !== 'flee' && player && player.armed) {
        if (Math.hypot(player.x - px, player.z - pz) < 12) {
          startFlee(ped, player.x, player.z);
        }
      }
    }

    if (ped.state === 'flee') {
      ped.fleeTimer -= step;
      m.position.x += ped.fleeX * PED_FLEE_SPEED * step;
      m.position.z += ped.fleeZ * PED_FLEE_SPEED * step;
      m.rotation.y = Math.atan2(ped.fleeX, ped.fleeZ);
      ped.walkPhase += step * 14;
      if (ped.fleeTimer <= 0) {
        ped.state = 'idle';
        ped.idleTimer = rand(1, 3);
        // Drift the cluster centre with the crowd so they do not all
        // walk back across the map after a scare.
        ped.cluster.x = m.position.x;
        ped.cluster.z = m.position.z;
        ped.waypoint = randomPointInCluster(ped.cluster);
      }
    } else if (ped.state === 'idle') {
      ped.idleTimer -= step;
      ped.walkPhase += step * 2;
      if (ped.idleTimer <= 0) {
        ped.state = 'walk';
        ped.waypoint = randomPointInCluster(ped.cluster);
      }
    } else {
      // Walk toward the waypoint at 1.2-1.6 m/s.
      const dx = ped.waypoint.x - px;
      const dz = ped.waypoint.z - pz;
      const dist = Math.hypot(dx, dz);
      if (dist < 0.6) {
        ped.state = 'idle';
        ped.idleTimer = rand(2, 7);
      } else {
        const nx = dx / dist;
        const nz = dz / dist;
        m.position.x += nx * ped.speed * step;
        m.position.z += nz * ped.speed * step;
        const targetHeading = Math.atan2(nx, nz);
        let dh = targetHeading - m.rotation.y;
        while (dh > Math.PI) dh -= Math.PI * 2;
        while (dh < -Math.PI) dh += Math.PI * 2;
        m.rotation.y += dh * Math.min(1, step * 8);
        ped.walkPhase += step * 8;
      }
    }

    // Simple walk animation: swing legs and arms with the walk phase.
    const swing = ped.state === 'walk' || ped.state === 'flee'
      ? Math.sin(ped.walkPhase) * 0.5
      : Math.sin(ped.walkPhase) * 0.05;
    const legs = m.userData.legs;
    const arms = m.userData.arms;
    if (legs && legs.children.length === 2) {
      legs.children[0].rotation.x = swing;
      legs.children[1].rotation.x = -swing;
    }
    if (arms && arms.children.length === 2) {
      arms.children[0].rotation.x = -swing * 0.7;
      arms.children[1].rotation.x = swing * 0.7;
    }
  }
}
