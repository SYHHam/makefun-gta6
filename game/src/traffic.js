// traffic.js - Sunline: Breakwater
// Ambient traffic on a directed lane graph: nodes at intersections, edges
// along the roads, right-hand lanes. Cars keep a 7 m gap, stop at red
// lights, turn at intersections 20% of the time, and recover when blocked
// for more than 4 seconds. They never chase the player; they spawn and
// despawn outside the player's view based on proximity.
//
// The graph comes from city.js when W1 provides state.roadGraph
// ({ nodes: [{id, x, z}], edges: [{a, b, main}] one-way }); it is
// normalized by graphFor into { nodes, edges: [{from, to}], byId }
// before use. Otherwise a default graph for the 1200x1200, 5x5-block
// city from the design is built here.
// Traffic lights are a simple per-intersection cycle kept in state.

import * as THREE from 'three';
import { buildCarMesh, CAR_MODELS } from './vehicles.js';

export const TRAFFIC_TARGET_COUNT = 40;
export const TRAFFIC_GAP = 7;
export const TRAFFIC_SPAWN_MIN = 120;
export const TRAFFIC_SPAWN_MAX = 230;
export const TRAFFIC_DESPAWN = 260;
export const TRAFFIC_TURN_CHANCE = 0.2;
export const TRAFFIC_BLOCKED_RECOVERY = 4;
export const TRAFFIC_SPEED_MIN = 8;
export const TRAFFIC_SPEED_MAX = 13;
export const LANE_OFFSET = 3;

const WORLD_HALF = 600;
const ROAD_AXES = [-500, -300, -100, 100, 300, 500];

const TRAFFIC_MODELS = ['brisa', 'velvet', 'dockrunner', 'solara', 'cinderback'];

function rand(min, max) {
  return min + Math.random() * (max - min);
}

function pick(list) {
  return list[Math.floor(Math.random() * list.length)];
}

/**
 * Default lane graph for the design city: 6 roads each way at 200 m spacing
 * across the 1200 m map, nodes at every intersection, directed edges both
 * ways along each road. Nodes carry { id, x, z }; edges { from, to }.
 */
export function buildDefaultRoadGraph() {
  const nodes = [];
  const nodeId = new Map();
  for (const x of ROAD_AXES) {
    for (const z of ROAD_AXES) {
      const id = nodes.length;
      nodeId.set(`${x},${z}`, id);
      nodes.push({ id, x, z });
    }
  }
  const edges = [];
  const at = (x, z) => nodeId.get(`${x},${z}`);
  for (const z of ROAD_AXES) {
    for (let i = 0; i < ROAD_AXES.length - 1; i += 1) {
      edges.push({ from: at(ROAD_AXES[i], z), to: at(ROAD_AXES[i + 1], z) });
      edges.push({ from: at(ROAD_AXES[i + 1], z), to: at(ROAD_AXES[i], z) });
    }
  }
  for (const x of ROAD_AXES) {
    for (let i = 0; i < ROAD_AXES.length - 1; i += 1) {
      edges.push({ from: at(x, ROAD_AXES[i]), to: at(x, ROAD_AXES[i + 1]) });
      edges.push({ from: at(x, ROAD_AXES[i + 1]), to: at(x, ROAD_AXES[i]) });
    }
  }
  return { nodes, edges };
}

function graphFor(state) {
  const raw = state.roadGraph;
  if (raw && Array.isArray(raw.nodes) && raw.nodes.length > 0) {
    if (state._normGraphRaw !== raw) {
      state._normGraphRaw = raw;
      state._normGraph = normalizeGraph(raw);
    }
    return state._normGraph;
  }
  if (!state._defaultRoadGraph) {
    state._defaultRoadGraph = normalizeGraph(buildDefaultRoadGraph());
  }
  return state._defaultRoadGraph;
}

// Normalize a road graph into { nodes, edges, byId } where edges are always
// { from, to, main } and node lookup is by id, never by array index.
// city.js emits edges as { a, b, main }, one-way, and its node ids
// (iz*N + ix) do NOT equal the array index (nodes are pushed ix-major),
// so graph.nodes[edge.from] was undefined and edgeDirection threw.
// The reverse edge is added when missing so traffic can flow both ways,
// like the default graph above.
function normalizeGraph(raw) {
  const byId = new Map();
  for (const n of raw.nodes) byId.set(n.id, n);
  const edges = [];
  const seen = new Set();
  for (const e of raw.edges || []) {
    const from = e.from ?? e.a;
    const to = e.to ?? e.b;
    if (from == null || to == null) continue;
    if (!byId.has(from) || !byId.has(to)) continue;
    const key = from + '>' + to;
    if (seen.has(key)) continue;
    seen.add(key);
    edges.push({ from, to, main: !!e.main });
  }
  const reverse = [];
  for (const e of edges) {
    const key = e.to + '>' + e.from;
    if (!seen.has(key)) {
      seen.add(key);
      reverse.push({ from: e.to, to: e.from, main: e.main });
    }
  }
  edges.push(...reverse);
  return { nodes: raw.nodes, edges, byId };
}

function nodeOf(graph, id) {
  if (graph.byId) return graph.byId.get(id);
  return graph.nodes[id];
}

function outgoing(graph, nodeId) {
  const out = [];
  for (const e of graph.edges) if (e.from === nodeId) out.push(e);
  return out;
}

function edgeDirection(graph, edge) {
  const a = nodeOf(graph, edge.from);
  const b = nodeOf(graph, edge.to);
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const len = Math.hypot(dx, dz) || 1;
  return { dx: dx / len, dz: dz / len, len };
}

// Right-hand lane: shift the centre line to the right of the travel direction.
function lanePoint(graph, edge, t, side) {
  const a = nodeOf(graph, edge.from);
  const b = nodeOf(graph, edge.to);
  const dir = edgeDirection(graph, edge);
  const offset = (side ?? 1) * LANE_OFFSET;
  // Right of direction (dx, dz) is (-dz, dx) in x/z plane with y-up heading.
  return {
    x: a.x + dir.dx * dir.len * t + (-dir.dz) * offset,
    z: a.z + dir.dz * dir.len * t + dir.dx * offset,
  };
}

function playerPos(state) {
  const p = state.player;
  if (!p) return { x: 0, z: 0 };
  if (p.position) return { x: p.position.x, z: p.position.z };
  if (p.mesh) return { x: p.mesh.position.x, z: p.mesh.position.z };
  return { x: p.x ?? 0, z: p.z ?? 0 };
}

// Traffic light for a node: two phases alternate on a 14 s cycle so that
// crossing roads get green in turn. Deterministic from state time.
function lightIsRed(state, nodeId) {
  const t = (state.time ?? 0) + nodeId * 3.7;
  const phase = Math.floor(t / 7) % 2;
  return phase === 0;
}

function makeTrafficCar(state, graph, edge, t) {
  const model = pick(TRAFFIC_MODELS);
  const mesh = buildCarMesh(model);
  const point = lanePoint(graph, edge, t, 1);
  mesh.position.set(point.x, 0, point.z);
  const dir = edgeDirection(graph, edge);
  mesh.rotation.y = Math.atan2(dir.dx, dir.dz);
  if (state.scene) state.scene.add(mesh);
  return {
    model,
    mesh,
    edge,
    t,
    speed: rand(TRAFFIC_SPEED_MIN, TRAFFIC_SPEED_MAX),
    cruiseSpeed: rand(TRAFFIC_SPEED_MIN, TRAFFIC_SPEED_MAX),
    blockedTimer: 0,
    stopped: false,
    isTraffic: true,
  };
}

/**
 * Fill state.traffic up to TRAFFIC_TARGET_COUNT cars on edges near (but out
 * of sight of) the player. Safe to call every frame; only tops up.
 */
export function spawnTraffic(state, count = TRAFFIC_TARGET_COUNT) {
  if (!state) return [];
  const graph = graphFor(state);
  state.traffic = state.traffic || [];
  const player = playerPos(state);
  let guard = 0;
  while (state.traffic.length < count && guard < count * 40) {
    guard += 1;
    const edge = pick(graph.edges);
    const t = Math.random();
    const point = lanePoint(graph, edge, t, 1);
    const d = Math.hypot(point.x - player.x, point.z - player.z);
    if (d < TRAFFIC_SPAWN_MIN || d > TRAFFIC_SPAWN_MAX) continue;
    // Do not spawn on top of another traffic car.
    let crowded = false;
    for (const other of state.traffic) {
      if (Math.hypot(other.mesh.position.x - point.x, other.mesh.position.z - point.z) < 20) {
        crowded = true;
        break;
      }
    }
    if (crowded) continue;
    state.traffic.push(makeTrafficCar(state, graph, edge, t));
  }
  return state.traffic;
}

export function clearTraffic(state) {
  if (!state || !state.traffic) return;
  for (const car of state.traffic) {
    if (state.scene && car.mesh) state.scene.remove(car.mesh);
  }
  state.traffic = [];
}

function chooseNextEdge(graph, car, currentEdge) {
  const node = nodeOf(graph, currentEdge.to);
  const outs = outgoing(graph, node.id);
  if (outs.length === 0) return null;
  // Prefer going straight (same direction) unless the 20% turn rolls.
  const dir = edgeDirection(graph, currentEdge);
  const straight = outs.filter((e) => {
    const d = edgeDirection(graph, e);
    return Math.abs(d.dx - dir.dx) < 0.01 && Math.abs(d.dz - dir.dz) < 0.01;
  });
  if (straight.length > 0 && Math.random() > TRAFFIC_TURN_CHANCE) return straight[0];
  const turn = outs.filter((e) => !straight.includes(e));
  return pick(turn.length > 0 ? turn : outs);
}

/**
 * One traffic step. Moves every car along its edge, enforces the 7 m gap
 * to the car ahead, stops at red lights near an intersection, picks a new
 * edge at intersections (20% turn), recovers a car blocked for over 4 s
 * by nudging it onto the next edge, and despawns / respawns cars around
 * the player so about 25 stay live near them.
 */
export function updateTraffic(state, dt) {
  if (!state) return;
  const step = Math.min(dt, 0.05);
  const graph = graphFor(state);
  state.traffic = state.traffic || [];
  state.time = (state.time ?? 0) + step;
  const player = playerPos(state);

  // Top up and cull first so the list stays near the target count.
  spawnTraffic(state, TRAFFIC_TARGET_COUNT);
  for (let i = state.traffic.length - 1; i >= 0; i -= 1) {
    const car = state.traffic[i];
    const d = Math.hypot(car.mesh.position.x - player.x, car.mesh.position.z - player.z);
    if (d > TRAFFIC_DESPAWN) {
      if (state.scene) state.scene.remove(car.mesh);
      state.traffic.splice(i, 1);
    }
  }

  for (const car of state.traffic) {
    const dir = edgeDirection(graph, car.edge);
    const edgeLen = dir.len;

    // Car ahead on the same edge: keep a 7 m gap.
    let gap = Infinity;
    for (const other of state.traffic) {
      if (other === car) continue;
      if (other.edge !== car.edge) continue;
      const ahead = (other.t - car.t) * edgeLen;
      if (ahead > 0 && ahead < gap) gap = ahead;
    }
    // The player's own car also counts as an obstacle on the same edge.
    if (state.player && state.player.car && state.player.car.mesh) {
      const pc = state.player.car.mesh.position;
      const relX = pc.x - car.mesh.position.x;
      const relZ = pc.z - car.mesh.position.z;
      const along = relX * dir.dx + relZ * dir.dz;
      const side = Math.abs(relX * -dir.dz + relZ * dir.dx);
      if (along > 0 && along < gap && side < 6) gap = along;
    }

    // Red light: stop before the intersection when close to its end.
    const distToNode = (1 - car.t) * edgeLen;
    const atRedLight = distToNode < 14 && lightIsRed(state, car.edge.to);
    const blockedByGap = gap < TRAFFIC_GAP;

    let targetSpeed = car.cruiseSpeed;
    if (atRedLight || blockedByGap) targetSpeed = 0;

    const accel = targetSpeed > car.speed ? 6 : 14;
    car.speed += Math.max(-accel * step, Math.min(accel * step, targetSpeed - car.speed));
    if (car.speed < 0.05 && targetSpeed === 0) car.speed = 0;

    // Blocked recovery: stuck over 4 s with somewhere to go.
    if (car.speed < 0.1 && (atRedLight || blockedByGap)) {
      car.blockedTimer += step;
    } else {
      car.blockedTimer = 0;
    }
    if (car.blockedTimer > TRAFFIC_BLOCKED_RECOVERY && !atRedLight) {
      // Hop onto the next edge from the target node instead of waiting.
      const next = chooseNextEdge(graph, car, car.edge);
      if (next) {
        car.edge = next;
        car.t = 0;
        car.blockedTimer = 0;
        car.speed = car.cruiseSpeed * 0.5;
      } else {
        car.blockedTimer = 0;
      }
    }

    // Advance along the edge.
    car.t += (car.speed * step) / edgeLen;
    if (car.t >= 1) {
      const next = chooseNextEdge(graph, car, car.edge);
      if (next) {
        car.edge = next;
        car.t = 0;
      } else {
        // Dead end (should not happen on the grid): turn around.
        const back = graph.edges.find((e) => e.from === car.edge.to && e.to === car.edge.from);
        car.edge = back || car.edge;
        car.t = 0;
      }
    }

    const point = lanePoint(graph, car.edge, car.t, 1);
    car.mesh.position.x = point.x;
    car.mesh.position.z = point.z;
    const d2 = edgeDirection(graph, car.edge);
    const targetHeading = Math.atan2(d2.dx, d2.dz);
    let dh = targetHeading - car.mesh.rotation.y;
    while (dh > Math.PI) dh -= Math.PI * 2;
    while (dh < -Math.PI) dh += Math.PI * 2;
    car.mesh.rotation.y += dh * Math.min(1, step * 6);
  }
}
