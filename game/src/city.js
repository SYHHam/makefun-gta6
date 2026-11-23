// Sunline: Breakwater - city builder.
// buildCity(scene) lays out Solmera: a 1200x1200 m grid of 5x5 blocks,
// three districts, 50 buildings, 72 palms, about 180 props, a south
// beach and an animated sea. Everything is flat low-poly boxes and
// shared materials, with instancing for palms, lamps and containers,
// so the whole city is a few dozen draw calls, not hundreds.
// Returns { colliders, roadGraph, districts, spawnPoints, update, sea }.

import * as THREE from 'three';
import { CONFIG } from './config.js';

// Deterministic random so the city is identical on every load.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function random() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick(random, list) {
  return list[Math.floor(random() * list.length)];
}

function range(random, min, max) {
  return min + random() * (max - min);
}

function lambert(color) {
  return new THREE.MeshLambertMaterial({ color });
}

function districtAt(x, z) {
  const d = CONFIG.DISTRICTS;
  if (z >= d.marAzul.bounds.minZ) return 'marAzul';
  if (x >= d.glasspoint.bounds.minX) return 'glasspoint';
  return 'cobreViejo';
}

function roadWidthAt(line) {
  return (line === -100 || line === 100)
    ? CONFIG.WORLD.mainRoadWidth
    : CONFIG.WORLD.localRoadWidth;
}

export function buildCity(scene) {
  const random = mulberry32(CONFIG.GAME.seed);
  const W = CONFIG.WORLD;
  const C = CONFIG.COLORS;
  const lines = W.roadLines;
  const colliders = [];
  const group = new THREE.Group();
  group.name = 'city';
  scene.add(group);

  const unitBox = new THREE.BoxGeometry(1, 1, 1);
  const flatBox = (w, h, d, material) => {
    const mesh = new THREE.Mesh(unitBox, material);
    mesh.scale.set(w, h, d);
    mesh.position.y = h / 2;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  };

  // Shared materials, one per look, reused by every building.
  const matGround = lambert(C.ground);
  const matAsphaltMain = lambert(C.asphaltMain);
  const matAsphaltLocal = lambert(C.asphaltLocal);
  const matSidewalk = lambert(C.sidewalk);
  const matSand = lambert(C.sand);
  const matRoof = lambert(C.roof);
  const matGlass = new THREE.MeshLambertMaterial({ color: C.buildingGlass });
  const matGlassDark = new THREE.MeshLambertMaterial({ color: C.buildingGlassDark });
  const matPastel = C.buildingPastel.map((c) => lambert(c));
  const matBrick = C.buildingBrick.map((c) => lambert(c));
  const matWarehouse = C.warehouse.map((c) => lambert(c));
  const matLine = new THREE.MeshBasicMaterial({ color: C.roadLine });

  // Ground slab for the whole city.
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(W.size, W.size), matGround);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  group.add(ground);

  // Roads: one dark plane per centreline, main roads wider and darker.
  // Centre dashes: thin bright strips, skipped at intersections.
  for (const line of lines) {
    const width = roadWidthAt(line);
    const mat = width === W.mainRoadWidth ? matAsphaltMain : matAsphaltLocal;
    const vertical = new THREE.Mesh(new THREE.PlaneGeometry(width, W.size), mat);
    vertical.rotation.x = -Math.PI / 2;
    vertical.position.set(line, 0.02, 0);
    vertical.receiveShadow = true;
    group.add(vertical);
    const horizontal = new THREE.Mesh(new THREE.PlaneGeometry(W.size, width), mat);
    horizontal.rotation.x = -Math.PI / 2;
    horizontal.position.set(0, 0.02, line);
    horizontal.receiveShadow = true;
    group.add(horizontal);
    if (width === W.mainRoadWidth) {
      for (let t = -550; t < 550; t += 50) {
        const onCross = lines.some((l) => Math.abs(t - l) < 16);
        if (onCross) continue;
        const dashV = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 14), matLine);
        dashV.rotation.x = -Math.PI / 2;
        dashV.position.set(line, 0.04, t);
        group.add(dashV);
        const dashH = new THREE.Mesh(new THREE.PlaneGeometry(14, 0.6), matLine);
        dashH.rotation.x = -Math.PI / 2;
        dashH.position.set(t, 0.04, line);
        group.add(dashH);
      }
    }
  }

  // Sidewalks: one light slab per block, inset from the road edge.
  for (let ix = 0; ix < 5; ix += 1) {
    for (let iz = 0; iz < 5; iz += 1) {
      const x0 = lines[ix] + roadWidthAt(lines[ix]) / 2;
      const x1 = lines[ix + 1] - roadWidthAt(lines[ix + 1]) / 2;
      const z0 = lines[iz] + roadWidthAt(lines[iz]) / 2;
      const z1 = lines[iz + 1] - roadWidthAt(lines[iz + 1]) / 2;
      const slab = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, z1 - z0), matSidewalk);
      slab.rotation.x = -Math.PI / 2;
      slab.position.set((x0 + x1) / 2, 0.03, (z0 + z1) / 2);
      slab.receiveShadow = true;
      group.add(slab);
    }
  }

  // Buildings: two plots per block, 25 blocks, 50 buildings total.
  // Type is chosen by district so each district reads differently:
  // Glasspoint gets the tall glass towers and the port warehouses,
  // Cobre Viejo gets pastel houses and brick shops, Mar Azul gets
  // low hotels and beachfront commercial blocks.
  const counts = { tall: 0, commercial: 0, house: 0, warehouse: 0 };
  const target = CONFIG.BUILDINGS;
  let built = 0;
  for (let ix = 0; ix < 5 && built < target.total; ix += 1) {
    for (let iz = 0; iz < 5 && built < target.total; iz += 1) {
      const x0 = lines[ix] + roadWidthAt(lines[ix]) / 2 + 8;
      const x1 = lines[ix + 1] - roadWidthAt(lines[ix + 1]) / 2 - 8;
      const z0 = lines[iz] + roadWidthAt(lines[iz]) / 2 + 8;
      const z1 = lines[iz + 1] - roadWidthAt(lines[iz + 1]) / 2 - 8;
      const cx = (x0 + x1) / 2;
      const cz = (z0 + z1) / 2;
      const district = districtAt(cx, cz);
      // Two plots per block: west and east halves.
      const plots = [
        { x: x0 + (x1 - x0) * 0.28, z: cz + range(random, -18, 18) },
        { x: x0 + (x1 - x0) * 0.72, z: cz + range(random, -18, 18) },
      ];
      for (const plot of plots) {
        if (built >= target.total) break;
        let type = 'house';
        if (district === 'glasspoint' && counts.tall < target.tall) type = 'tall';
        else if (district === 'glasspoint' && counts.warehouse < target.warehouse) type = 'warehouse';
        else if (counts.commercial < target.commercial && random() < 0.45) type = 'commercial';
        else if (counts.house >= target.house) type = 'commercial';
        if (type === 'tall' && counts.tall >= target.tall) type = 'commercial';
        if (type === 'commercial' && counts.commercial >= target.commercial) type = 'house';
        if (type === 'warehouse' && counts.warehouse >= target.warehouse) type = 'commercial';
        if (type === 'house' && counts.house >= target.house) type = 'commercial';

        let w = 26;
        let d = 22;
        let h = 9;
        let material = pick(random, matPastel);
        if (type === 'tall') {
          w = range(random, 24, 32);
          d = range(random, 24, 32);
          h = range(random, target.tallHeight.min, target.tallHeight.max);
          material = random() < 0.6 ? matGlass : matGlassDark;
        } else if (type === 'commercial') {
          w = range(random, 26, 38);
          d = range(random, 22, 30);
          h = range(random, target.commercialHeight.min, target.commercialHeight.max);
          material = district === 'cobreViejo' ? pick(random, matBrick) : pick(random, matPastel);
        } else if (type === 'warehouse') {
          w = range(random, 44, 58);
          d = range(random, 26, 32);
          h = range(random, target.warehouseHeight.min, target.warehouseHeight.max);
          material = pick(random, matWarehouse);
        } else {
          w = range(random, 16, 24);
          d = range(random, 14, 20);
          h = range(random, target.houseHeight.min, target.houseHeight.max);
          material = district === 'cobreViejo' ? pick(random, matPastel) : pick(random, matBrick);
        }
        const mesh = flatBox(w, h, d, material);
        mesh.position.x = plot.x;
        mesh.position.z = plot.z;
        group.add(mesh);
        // Flat roof cap, slightly wider, in a darker tone.
        const roof = flatBox(w + 1, 0.8, d + 1, matRoof);
        roof.position.x = plot.x;
        roof.position.y = h + 0.4;
        roof.position.z = plot.z;
        roof.castShadow = false;
        group.add(roof);
        // Tall towers get a lit crown band so the skyline reads at dusk.
        if (type === 'tall') {
          const crown = flatBox(w * 0.7, 1.2, d * 0.7, matGlassDark);
          crown.position.x = plot.x;
          crown.position.y = h + 1.2;
          crown.position.z = plot.z;
          crown.castShadow = false;
          group.add(crown);
        }
        colliders.push({
          minX: plot.x - w / 2, maxX: plot.x + w / 2,
          minZ: plot.z - d / 2, maxZ: plot.z + d / 2,
          height: h, kind: 'building', district, type,
        });
        counts[type] += 1;
        built += 1;
      }
    }
  }

  // Beach: sand strip along the whole south edge, plus a promenade.
  const sand = new THREE.Mesh(new THREE.PlaneGeometry(W.size, W.seaStart - W.beachStart), matSand);
  sand.rotation.x = -Math.PI / 2;
  sand.position.set(0, 0.05, (W.beachStart + W.seaStart) / 2);
  sand.receiveShadow = true;
  group.add(sand);
  const promenade = new THREE.Mesh(new THREE.PlaneGeometry(W.size, 14), matSidewalk);
  promenade.rotation.x = -Math.PI / 2;
  promenade.position.set(0, 0.04, W.beachStart - 7);
  promenade.receiveShadow = true;
  group.add(promenade);

  // Sea: big plane south of the beach with a procedural wave texture.
  // update() scrolls the texture so the water moves.
  const waveCanvas = document.createElement('canvas');
  waveCanvas.width = 128;
  waveCanvas.height = 128;
  const waveCtx = waveCanvas.getContext('2d');
  waveCtx.fillStyle = '#2e7f9e';
  waveCtx.fillRect(0, 0, 128, 128);
  waveCtx.strokeStyle = 'rgba(255,255,255,0.35)';
  waveCtx.lineWidth = 2;
  for (let i = 0; i < 10; i += 1) {
    waveCtx.beginPath();
    const y = 8 + i * 13;
    for (let x = 0; x <= 128; x += 8) {
      const yy = y + Math.sin((x / 128) * Math.PI * 2 + i) * 3;
      if (x === 0) waveCtx.moveTo(x, yy);
      else waveCtx.lineTo(x, yy);
    }
    waveCtx.stroke();
  }
  const waveTex = new THREE.CanvasTexture(waveCanvas);
  waveTex.wrapS = THREE.RepeatWrapping;
  waveTex.wrapT = THREE.RepeatWrapping;
  waveTex.repeat.set(24, 10);
  const seaMat = new THREE.MeshLambertMaterial({ map: waveTex, color: 0x9fd4e8 });
  const sea = new THREE.Mesh(new THREE.PlaneGeometry(2400, W.seaLength), seaMat);
  sea.rotation.x = -Math.PI / 2;
  sea.position.set(0, 0.01, W.seaStart + W.seaLength / 2);
  group.add(sea);

  // Palms: 72, two instanced meshes (trunk + canopy).
  // Ring the promenade first, then line the two main roads.
  const palmSpots = [];
  for (let i = 0; i < 24; i += 1) {
    palmSpots.push({ x: -560 + i * 49 + range(random, -8, 8), z: W.beachStart - 22 + range(random, -3, 3) });
  }
  for (let i = 0; i < 24; i += 1) {
    palmSpots.push({ x: -100 + (random() < 0.5 ? -12 : 12), z: -560 + i * 48 + range(random, -6, 6) });
  }
  for (let i = 0; i < 24; i += 1) {
    palmSpots.push({ x: -560 + i * 48 + range(random, -6, 6), z: 100 + (random() < 0.5 ? -12 : 12) });
  }
  const trunkGeo = new THREE.CylinderGeometry(0.18, 0.3, CONFIG.NATURE.palmHeight, 6);
  const canopyGeo = new THREE.ConeGeometry(2.4, 2.6, 6);
  const trunkMesh = new THREE.InstancedMesh(trunkGeo, lambert(C.palmTrunk), palmSpots.length);
  const canopyMesh = new THREE.InstancedMesh(canopyGeo, lambert(C.palmLeaf), palmSpots.length);
  const dummy = new THREE.Object3D();
  palmSpots.forEach((spot, i) => {
    const lean = range(random, -0.08, 0.08);
    dummy.position.set(spot.x, CONFIG.NATURE.palmHeight / 2, spot.z);
    dummy.rotation.set(lean, random() * Math.PI * 2, lean);
    dummy.scale.setScalar(range(random, 0.9, 1.25));
    dummy.updateMatrix();
    trunkMesh.setMatrixAt(i, dummy.matrix);
    dummy.position.y = CONFIG.NATURE.palmHeight + 1;
    dummy.updateMatrix();
    canopyMesh.setMatrixAt(i, dummy.matrix);
  });
  trunkMesh.castShadow = true;
  canopyMesh.castShadow = true;
  group.add(trunkMesh);
  group.add(canopyMesh);

  // Street lamps: 60, instanced pole + glowing head, along main roads.
  const lampSpots = [];
  for (let i = 0; i < 30; i += 1) {
    lampSpots.push({ x: -100 + 11, z: -560 + i * 38 });
    lampSpots.push({ x: 100 - 11, z: -560 + i * 38 });
  }
  const poleGeo = new THREE.CylinderGeometry(0.09, 0.12, 5.5, 5);
  const headGeo = new THREE.SphereGeometry(0.35, 8, 6);
  const poleMesh = new THREE.InstancedMesh(poleGeo, lambert(C.lampPole), lampSpots.length);
  const headMesh = new THREE.InstancedMesh(headGeo, new THREE.MeshBasicMaterial({ color: C.lampHead }), lampSpots.length);
  lampSpots.forEach((spot, i) => {
    dummy.position.set(spot.x, 2.75, spot.z);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.setScalar(1);
    dummy.updateMatrix();
    poleMesh.setMatrixAt(i, dummy.matrix);
    dummy.position.y = 5.6;
    dummy.updateMatrix();
    headMesh.setMatrixAt(i, dummy.matrix);
  });
  group.add(poleMesh);
  group.add(headMesh);

  // Benches: 24 along the promenade, simple box seats.
  const benchMat = lambert(C.bench);
  const benchGeo = new THREE.BoxGeometry(2.4, 0.5, 0.9);
  const benchMesh = new THREE.InstancedMesh(benchGeo, benchMat, CONFIG.PROPS.benches);
  for (let i = 0; i < CONFIG.PROPS.benches; i += 1) {
    dummy.position.set(-560 + i * 49, 0.45, W.beachStart - 14);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.setScalar(1);
    dummy.updateMatrix();
    benchMesh.setMatrixAt(i, dummy.matrix);
  }
  benchMesh.castShadow = true;
  group.add(benchMesh);

  // Bollards: 36 along the promenade edge, keep cars off the sand.
  const bollardGeo = new THREE.CylinderGeometry(0.22, 0.22, 0.9, 6);
  const bollardMesh = new THREE.InstancedMesh(bollardGeo, lambert(C.lampPole), CONFIG.PROPS.bollards);
  for (let i = 0; i < CONFIG.PROPS.bollards; i += 1) {
    dummy.position.set(-570 + i * 33, 0.45, W.beachStart - 2);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.setScalar(1);
    dummy.updateMatrix();
    bollardMesh.setMatrixAt(i, dummy.matrix);
  }
  group.add(bollardMesh);

  // Port containers: 40 stacked boxes in the north east yard.
  const containerGeo = new THREE.BoxGeometry(12, 2.6, 2.6);
  const containerMesh = new THREE.InstancedMesh(containerGeo, lambert(0xffffff), CONFIG.PROPS.containers);
  const containerMats = C.container.map((c) => new THREE.Color(c));
  for (let i = 0; i < CONFIG.PROPS.containers; i += 1) {
    const col = i % 5;
    const row = Math.floor(i / 5) % 4;
    const stack = Math.floor(i / 20);
    const x = 330 + col * 52;
    const z = -540 + row * 44;
    dummy.position.set(x, 1.3 + stack * 2.7, z);
    dummy.rotation.set(0, (i % 2 === 0 ? 0 : Math.PI / 2), 0);
    dummy.scale.setScalar(1);
    dummy.updateMatrix();
    containerMesh.setMatrixAt(i, dummy.matrix);
    containerMesh.setColorAt(i, containerMats[i % containerMats.length]);
    colliders.push({
      minX: x - 6, maxX: x + 6, minZ: z - 6, maxZ: z + 6,
      height: 2.6 + stack * 2.7, kind: 'container', district: 'glasspoint', type: 'container',
    });
  }
  containerMesh.castShadow = true;
  containerMesh.receiveShadow = true;
  group.add(containerMesh);

  // Road signs: 20 small posts with a bright board, at main intersections.
  const signGeo = new THREE.BoxGeometry(1.6, 1.1, 0.1);
  const signMesh = new THREE.InstancedMesh(signGeo, lambert(0xd8d8d8), CONFIG.PROPS.signs);
  const signPoleGeo = new THREE.CylinderGeometry(0.07, 0.07, 2.6, 5);
  const signPoleMesh = new THREE.InstancedMesh(signPoleGeo, lambert(C.lampPole), CONFIG.PROPS.signs);
  for (let i = 0; i < CONFIG.PROPS.signs; i += 1) {
    const line = lines[i % lines.length];
    const other = lines[Math.floor(i / lines.length) % lines.length];
    const x = line + 13;
    const z = other + 13;
    dummy.position.set(x, 2.9, z);
    dummy.rotation.set(0, Math.PI / 4, 0);
    dummy.scale.setScalar(1);
    dummy.updateMatrix();
    signMesh.setMatrixAt(i, dummy.matrix);
    dummy.position.y = 1.3;
    dummy.updateMatrix();
    signPoleMesh.setMatrixAt(i, dummy.matrix);
  }
  group.add(signMesh);
  group.add(signPoleMesh);

  // Road graph: nodes at every intersection, edges along every road.
  const roadGraph = { nodes: [], edges: [] };
  const nodeId = (ix, iz) => iz * lines.length + ix;
  for (let ix = 0; ix < lines.length; ix += 1) {
    for (let iz = 0; iz < lines.length; iz += 1) {
      roadGraph.nodes.push({ id: nodeId(ix, iz), x: lines[ix], z: lines[iz] });
    }
  }
  for (let ix = 0; ix < lines.length; ix += 1) {
    for (let iz = 0; iz < lines.length; iz += 1) {
      if (ix + 1 < lines.length) {
        roadGraph.edges.push({
          a: nodeId(ix, iz), b: nodeId(ix + 1, iz),
          main: roadWidthAt(lines[ix]) === W.mainRoadWidth || roadWidthAt(lines[ix + 1]) === W.mainRoadWidth,
        });
      }
      if (iz + 1 < lines.length) {
        roadGraph.edges.push({
          a: nodeId(ix, iz), b: nodeId(ix, iz + 1),
          main: roadWidthAt(lines[iz]) === W.mainRoadWidth || roadWidthAt(lines[iz + 1]) === W.mainRoadWidth,
        });
      }
    }
  }

  const districts = {
    marAzul: { ...CONFIG.DISTRICTS.marAzul.bounds, name: 'Mar Azul' },
    cobreViejo: { ...CONFIG.DISTRICTS.cobreViejo.bounds, name: 'Cobre Viejo' },
    glasspoint: { ...CONFIG.DISTRICTS.glasspoint.bounds, name: 'Glasspoint' },
  };

  // Named spawn points used by missions.js and main.js.
  const spawnPoints = {
    playerStart: { x: -420, z: -420, heading: Math.PI / 2, label: 'Bengkel Ivo' },
    garage: { x: -420, z: -420, heading: Math.PI / 2, label: 'Bengkel Ivo' },
    sunwire: { x: -300, z: 420, heading: 0, label: 'Sunwire FM' },
    harbor: { x: 420, z: -420, heading: Math.PI, label: 'Harborcoil' },
    plaza: { x: 0, z: 0, heading: 0, label: 'Plaza Cobre Viejo' },
    beachMeet: { x: 200, z: 480, heading: Math.PI, label: 'Mar Azul' },
    portGate: { x: 420, z: -300, heading: Math.PI / 2, label: 'Port Gate' },
  };

  // Sea animation: scroll the wave texture slowly, plus a gentle swell.
  function update(dt, time) {
    waveTex.offset.x = (time * 0.008) % 1;
    waveTex.offset.y = (time * 0.004) % 1;
    sea.position.y = 0.01 + Math.sin(time * 0.5) * 0.15;
  }

  return { colliders, roadGraph, districts, spawnPoints, update, sea, group, counts };
}
