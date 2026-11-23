// Sunline: Breakwater - city builder.
// buildCity(scene) lays out Solmera: a 1200x1200 m grid of 5x5 blocks,
// three districts, 94 grid buildings + 5 hand-built central-block
// buildings (workshop, curved tower, 2 plaza blocks, 1 corner shop) = 99,
// 150 palms, 326+ props, a south beach and an animated sea. Buildings
// vary in height (2-12 floors), setbacks, roof props, window bands,
// awnings and balconies, so no two blocks read the same. Shared
// materials and instancing keep the whole city cheap to draw.
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

  // Buildings: four plots per block (2x2), 25 blocks, 94 grid buildings.
  // Type is chosen by district so each district reads differently:
  // Glasspoint gets the tall glass towers and the port warehouses,
  // Cobre Viejo gets pastel houses and brick shops, Mar Azul gets
  // low hotels and beachfront commercial blocks. The central block
  // (ix 2, iz 2) is the pedestrian plaza + workshop, hand-built below,
  // and the port block (ix 4, iz 0) keeps two warehouses clear of the
  // container yard.
  const counts = { tall: 0, commercial: 0, house: 0, warehouse: 0 };
  const target = CONFIG.BUILDINGS;
  let built = 0;
  // Detail spots collected per building, drawn once as instanced meshes
  // after the loop so hundreds of windows / AC units / tanks cost ~5
  // draw calls instead of hundreds.
  const windowSpots = [];
  const acSpots = [];
  const tankSpots = [];
  const antennaSpots = [];
  const awningSpots = [];
  const balconySpots = [];
  const matWindow = lambert(C.windowDark);
  const matNeon = C.neon.map((c) => new THREE.MeshBasicMaterial({ color: c }));

  // One building with all its variation: setback upper floor, roof cap,
  // one roof prop (AC / water tank / antenna), a window band, and for
  // shops and houses an awning or a balcony. Always registers a collider.
  function addBuilding(x, z, w, d, h, material, type, district, forceAwning) {
    const mesh = flatBox(w, h, d, material);
    mesh.position.x = x;
    mesh.position.z = z;
    group.add(mesh);
    // Flat roof cap, slightly wider, in a darker tone.
    const roof = flatBox(w + 1, 0.8, d + 1, matRoof);
    roof.position.x = x;
    roof.position.y = h + 0.4;
    roof.position.z = z;
    roof.castShadow = false;
    group.add(roof);
    // Tall towers get a lit crown band so the skyline reads at dusk.
    if (type === 'tall') {
      const crown = flatBox(w * 0.7, 1.2, d * 0.7, matGlassDark);
      crown.position.x = x;
      crown.position.y = h + 1.2;
      crown.position.z = z;
      crown.castShadow = false;
      group.add(crown);
    }
    // Setback upper floor on taller buildings: breaks the box silhouette.
    if ((type === 'tall' || type === 'commercial') && h >= 12 && random() < 0.65) {
      const h2 = h * 0.3;
      const upper = flatBox(w * 0.62, h2, d * 0.62,
        type === 'tall' ? matGlassDark : pick(random, matPastel));
      upper.position.x = x + w * 0.08;
      upper.position.y = h + 0.8 + h2 / 2;
      upper.position.z = z - d * 0.06;
      group.add(upper);
      const cap2 = flatBox(w * 0.62 + 0.6, 0.6, d * 0.62 + 0.6, matRoof);
      cap2.position.x = upper.position.x;
      cap2.position.y = h + 0.8 + h2 + 0.3;
      cap2.position.z = upper.position.z;
      cap2.castShadow = false;
      group.add(cap2);
    }
    // Window bands on the south, north and west faces (+z, -z, -x), plus
    // a side band on towers, so facades never read as blank slabs from
    // the spawn view (which looks south-east at north/west faces).
    windowSpots.push({ x, y: h * 0.55, z: z + d / 2 + 0.18, w: w * 0.8, h: h * 0.5, ry: 0 });
    windowSpots.push({ x, y: h * 0.55, z: z - d / 2 - 0.18, w: w * 0.8, h: h * 0.5, ry: 0 });
    windowSpots.push({ x: x - w / 2 - 0.18, y: h * 0.55, z, w: d * 0.8, h: h * 0.5, ry: Math.PI / 2 });
    if (type === 'tall') {
      windowSpots.push({ x: x + w / 2 + 0.18, y: h * 0.55, z, w: d * 0.8, h: h * 0.6, ry: Math.PI / 2 });
    }
    // One roof prop per building.
    const roll = random();
    if (roll < 0.4) acSpots.push({ x: x + w * 0.25, y: h + 1.3, z: z - d * 0.25 });
    else if (roll < 0.7) tankSpots.push({ x: x - w * 0.25, y: h + 1.8, z: z + d * 0.2 });
    else antennaSpots.push({ x: x + w * 0.2, y: h + 3.5, z: z - d * 0.2 });
    // Ground-floor awning for shops / houses, balcony for houses.
    if ((type === 'commercial' || type === 'house') && (forceAwning || random() < 0.55)) {
      awningSpots.push({ x, y: 3.4, z: z + d / 2 + 1.8, w: w * 0.85, color: pick(random, C.awning) });
    } else if (type === 'house' && random() < 0.5) {
      balconySpots.push({ x, y: Math.max(4.5, h * 0.6), z: z + d / 2 + 0.9, w: w * 0.5 });
    }
    colliders.push({
      minX: x - w / 2, maxX: x + w / 2,
      minZ: z - d / 2, maxZ: z + d / 2,
      height: h, kind: 'building', district, type,
    });
    counts[type] += 1;
  }

  for (let ix = 0; ix < 5 && built < target.total; ix += 1) {
    for (let iz = 0; iz < 5 && built < target.total; iz += 1) {
      const x0 = lines[ix] + roadWidthAt(lines[ix]) / 2 + 8;
      const x1 = lines[ix + 1] - roadWidthAt(lines[ix + 1]) / 2 - 8;
      const z0 = lines[iz] + roadWidthAt(lines[iz]) / 2 + 8;
      const z1 = lines[iz + 1] - roadWidthAt(lines[iz + 1]) / 2 - 8;
      const cx = (x0 + x1) / 2;
      const cz = (z0 + z1) / 2;
      const district = districtAt(cx, cz);
      const isCentral = ix === 2 && iz === 2;
      const isPort = ix === 4 && iz === 0;
      if (isCentral) continue;
      // Four plots per block (2x2); the port block keeps two warehouses
      // on its south row, clear of the container yard to the north.
      const plots = isPort
        ? [
          { x: cx - 45, z: cz + 55 },
          { x: cx + 45, z: cz + 55 },
        ]
        : [
          { x: x0 + (x1 - x0) * 0.25, z: z0 + (z1 - z0) * 0.25 + range(random, -6, 6) },
          { x: x0 + (x1 - x0) * 0.75, z: z0 + (z1 - z0) * 0.25 + range(random, -6, 6) },
          { x: x0 + (x1 - x0) * 0.25, z: z0 + (z1 - z0) * 0.75 + range(random, -6, 6) },
          { x: x0 + (x1 - x0) * 0.75, z: z0 + (z1 - z0) * 0.75 + range(random, -6, 6) },
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
        if (isPort) type = 'warehouse';

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
        addBuilding(plot.x, plot.z, w, d, h, material, type, district, false);
        built += 1;
      }
    }
  }

  // (Instanced building details are drawn after the hand-built central
  // block below, so the workshop and plaza buildings get them too.)

  // ---- Central block: Plaza Cobre Viejo + Bengkel Ivo (workshop) ----
  // The player spawns at (-70,-70) facing south-east, so the workshop
  // is the first big thing in frame, with its neon sign, forecourt cars
  // and the plaza fountain behind it.
  const kioskSpots = [];
  const gardenSpots = [];
  const gardenPalmSpots = [];
  const parkedSpots = [];
  const carPaint = [0xf2c230, 0x3a7fd8, 0xc83a2e, 0x3f9a4a, 0xe8e8e8, 0x7a5fc8, 0xe8542e];
  addBuilding(-12, -52, 30, 26, 11, pick(random, matBrick), 'commercial', 'cobreViejo', true);
  built += 1;
  // West-face awning on the workshop so its street side reads as a shop.
  awningSpots.push({ x: -12 - 15 - 1.8, y: 3.4, z: -52, w: 26 * 0.85, ry: Math.PI / 2, color: pick(random, C.awning) });
  // Curved glass tower: the one non-box landmark of the plaza.
  const tower = new THREE.Mesh(new THREE.CylinderGeometry(13, 14, 34, 18), matGlass);
  tower.position.set(58, 17, -58);
  tower.castShadow = true;
  tower.receiveShadow = true;
  group.add(tower);
  const towerCap = new THREE.Mesh(new THREE.CylinderGeometry(13.4, 13.4, 0.8, 18), matRoof);
  towerCap.position.set(58, 34.4, -58);
  group.add(towerCap);
  // Dark window rings + a neon crown ring so the tower reads as glass,
  // not a concrete silo.
  for (const by of [12, 20, 28]) {
    const band = new THREE.Mesh(new THREE.CylinderGeometry(13.15, 13.15, 0.7, 18), matWindow);
    band.position.set(58, by, -58);
    group.add(band);
  }
  const crownRing = new THREE.Mesh(new THREE.CylinderGeometry(13.3, 13.3, 1.4, 18), matNeon[0]);
  crownRing.position.set(58, 31.5, -58);
  group.add(crownRing);
  colliders.push({
    minX: 45, maxX: 71, minZ: -71, maxZ: -45,
    height: 34, kind: 'building', district: 'cobreViejo', type: 'tall',
  });
  counts.tall += 1;
  built += 1;
  addBuilding(62, 40, 26, 24, 18, pick(random, matPastel), 'commercial', 'cobreViejo', false);
  built += 1;
  addBuilding(-10, 62, 30, 22, 14, pick(random, matBrick), 'commercial', 'cobreViejo', false);
  built += 1;
  // Low corner shop right of the spawn view, so the foreground is built up.
  addBuilding(-72, -18, 20, 16, 8, pick(random, matPastel), 'commercial', 'cobreViejo', true);
  built += 1;
  // Neon workshop signs: a board on the north face (overlapping the
  // facade top so it reads as a sign, not a floating slab) and one on
  // the west face, plus a pole sign on the approach from the spawn.
  const shopSign = flatBox(12, 2.2, 0.5, matNeon[0]);
  shopSign.position.set(-12, 9, -65.6);
  shopSign.castShadow = false;
  group.add(shopSign);
  const shopSignWest = flatBox(0.5, 2, 6, matNeon[2]);
  shopSignWest.position.set(-27.6, 8.5, -58);
  shopSignWest.castShadow = false;
  group.add(shopSignWest);
  const signPole = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.3, 7, 6), lambert(C.lampPole));
  signPole.position.set(-40, 3.5, -66);
  signPole.castShadow = true;
  group.add(signPole);
  const poleSign = flatBox(6, 2, 0.3, matNeon[0]);
  poleSign.position.set(-40, 7.5, -66);
  poleSign.rotation.y = Math.PI / 4;
  poleSign.castShadow = false;
  group.add(poleSign);
  // Foreground props around the spawn corner so the first metres are
  // not bare sidewalk: palms, a kiosk, benches and planters. (Palms and
  // planters north/west of the spawn sit behind the camera, so the
  // visible south-east quadrant gets its own kiosk, bench and planter.)
  gardenPalmSpots.push({ x: -60, z: -85 });
  gardenPalmSpots.push({ x: -85, z: -60 });
  kioskSpots.push({ x: -55, z: -30, ry: 0.5 });
  kioskSpots.push({ x: -45, z: -35, ry: -0.6 });
  for (const bn of [{ x: -80, z: -50, ry: 0.4 }, { x: -55, z: -75, ry: -0.3 }, { x: -35, z: -55, ry: 0.9 }]) {
    const bench = flatBox(2.4, 0.5, 0.9, lambert(C.bench));
    bench.position.set(bn.x, 0.45, bn.z);
    bench.rotation.y = bn.ry;
    group.add(bench);
  }
  for (const pl of [{ x: -88, z: -40 }, { x: -88, z: -70 }, { x: -45, z: -88 }, { x: -40, z: -30 }, { x: -55, z: -45 }, { x: -52, z: -52 }]) {
    const planter = flatBox(2.2, 1, 2.2, lambert(C.grass));
    planter.position.set(pl.x, 0.5, pl.z);
    group.add(planter);
  }
  const nearBench = flatBox(2.4, 0.5, 0.9, lambert(C.bench));
  nearBench.position.set(-58, 0.45, -48);
  nearBench.rotation.y = 0.9;
  group.add(nearBench);
  // Plaza paving: a darker stone slab over the central block so the
  // ground between spawn and fountain is not one flat tan sheet,
  // plus low planters scattered across the plaza.
  const paving = new THREE.Mesh(new THREE.PlaneGeometry(170, 170), lambert(0x9a8f7a));
  paving.rotation.x = -Math.PI / 2;
  paving.position.set(0, 0.035, 0);
  paving.receiveShadow = true;
  group.add(paving);
  for (const pl of [{ x: -20, z: 10 }, { x: 40, z: -10 }, { x: 0, z: 45 }, { x: 45, z: 45 }]) {
    const planter = flatBox(3, 0.8, 3, lambert(C.grass));
    planter.position.set(pl.x, 0.4, pl.z);
    group.add(planter);
  }
  // Plaza fountain.
  const basin = new THREE.Mesh(new THREE.CylinderGeometry(7, 7.5, 1, 16), matSidewalk);
  basin.position.set(20, 0.5, 20);
  basin.receiveShadow = true;
  group.add(basin);
  const water = new THREE.Mesh(
    new THREE.CylinderGeometry(6.2, 6.2, 0.3, 16),
    new THREE.MeshBasicMaterial({ color: 0x7fd4e8 }),
  );
  water.position.set(20, 1.05, 20);
  group.add(water);
  const spout = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 1.2, 2.4, 8), matSidewalk);
  spout.position.set(20, 2, 20);
  group.add(spout);
  // Plaza kiosks and workshop forecourt parked cars.
  kioskSpots.push({ x: 55, z: -5, ry: 0.3 });
  kioskSpots.push({ x: -52, z: 25, ry: -0.4 });
  parkedSpots.push({ x: -52, z: -16, ry: Math.PI / 2, color: pick(random, carPaint) });
  parkedSpots.push({ x: -32, z: -14, ry: Math.PI / 2, color: pick(random, carPaint) });
  parkedSpots.push({ x: -14, z: -18, ry: Math.PI / 2 + 0.2, color: pick(random, carPaint) });

  // Instanced building details: window bands, AC units, water tanks,
  // antennas, awnings and balconies. Drawn here, after the hand-built
  // central block, so the workshop and plaza buildings get them too.
  const detailDummy = new THREE.Object3D();
  function instancedSpots(spots, geometry, material, scaleFn, colorFn) {
    if (spots.length === 0) return;
    const mesh = new THREE.InstancedMesh(geometry, material, spots.length);
    spots.forEach((s, i) => {
      detailDummy.position.set(s.x, s.y, s.z);
      detailDummy.rotation.set(0, s.ry || 0, 0);
      detailDummy.scale.set(1, 1, 1);
      scaleFn(detailDummy, s);
      detailDummy.updateMatrix();
      mesh.setMatrixAt(i, detailDummy.matrix);
      if (colorFn) mesh.setColorAt(i, colorFn(s));
    });
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    group.add(mesh);
  }
  instancedSpots(windowSpots, unitBox, matWindow,
    (dm, s) => dm.scale.set(s.w, s.h, 0.35));
  instancedSpots(acSpots, unitBox, lambert(0x9aa0a8),
    (dm) => dm.scale.set(2, 1, 1.5));
  instancedSpots(tankSpots, new THREE.CylinderGeometry(1.2, 1.2, 2, 8), lambert(0x7a8a96),
    (dm) => dm.scale.set(1, 1, 1));
  instancedSpots(antennaSpots, new THREE.CylinderGeometry(0.08, 0.12, 6, 5), lambert(C.lampPole),
    (dm) => dm.scale.set(1, 1, 1));
  instancedSpots(awningSpots, unitBox, lambert(0xffffff),
    (dm, s) => dm.scale.set(s.w, 0.4, 4),
    (s) => new THREE.Color(s.color));
  instancedSpots(balconySpots, unitBox, lambert(0x8a7a5e),
    (dm, s) => dm.scale.set(s.w, 0.35, 2.2));

  // ---- Fill every block centre: kiosk, pocket garden or parking ----
  for (let ix = 0; ix < 5; ix += 1) {
    for (let iz = 0; iz < 5; iz += 1) {
      if ((ix === 2 && iz === 2) || (ix === 4 && iz === 0)) continue;
      const cx = (lines[ix] + lines[ix + 1]) / 2;
      const cz = (lines[iz] + lines[iz + 1]) / 2;
      const roll = random();
      if (roll < 0.3) {
        kioskSpots.push({ x: cx, z: cz, ry: random() * Math.PI });
      } else if (roll < 0.55) {
        gardenSpots.push({ x: cx, z: cz });
        for (let g = 0; g < 3; g += 1) {
          gardenPalmSpots.push({
            x: cx + range(random, -9, 9), z: cz + range(random, -9, 9),
          });
        }
      } else {
        parkedSpots.push({ x: cx - 10, z: cz, ry: random() * Math.PI, color: pick(random, carPaint) });
        parkedSpots.push({ x: cx + 10, z: cz + 6, ry: random() * Math.PI, color: pick(random, carPaint) });
      }
    }
  }
  // Pocket gardens: green lawn slabs.
  const matGrass = lambert(C.grass);
  for (const g of gardenSpots) {
    const lawn = new THREE.Mesh(new THREE.PlaneGeometry(22, 22), matGrass);
    lawn.rotation.x = -Math.PI / 2;
    lawn.position.set(g.x, 0.05, g.z);
    lawn.receiveShadow = true;
    group.add(lawn);
  }
  // Kiosks (news / food stalls), instanced with varied paint.
  if (kioskSpots.length > 0) {
    const kioskMesh = new THREE.InstancedMesh(
      new THREE.BoxGeometry(3.4, 2.8, 2.8), lambert(0xffffff), kioskSpots.length);
    kioskSpots.forEach((s, i) => {
      detailDummy.position.set(s.x, 1.4, s.z);
      detailDummy.rotation.set(0, s.ry || 0, 0);
      detailDummy.scale.set(1, 1, 1);
      detailDummy.updateMatrix();
      kioskMesh.setMatrixAt(i, detailDummy.matrix);
      kioskMesh.setColorAt(i, new THREE.Color(pick(random, C.kiosk)));
    });
    kioskMesh.castShadow = true;
    group.add(kioskMesh);
  }
  // Parked cars: instanced body + cabin, varied paint.
  if (parkedSpots.length > 0) {
    const bodyMesh = new THREE.InstancedMesh(
      new THREE.BoxGeometry(4.4, 1, 2), lambert(0xffffff), parkedSpots.length);
    const cabinMesh = new THREE.InstancedMesh(
      new THREE.BoxGeometry(2.4, 0.75, 1.7), lambert(0x222831), parkedSpots.length);
    parkedSpots.forEach((s, i) => {
      detailDummy.position.set(s.x, 0.55, s.z);
      detailDummy.rotation.set(0, s.ry || 0, 0);
      detailDummy.scale.set(1, 1, 1);
      detailDummy.updateMatrix();
      bodyMesh.setMatrixAt(i, detailDummy.matrix);
      bodyMesh.setColorAt(i, new THREE.Color(s.color));
      detailDummy.position.y = 1.35;
      detailDummy.updateMatrix();
      cabinMesh.setMatrixAt(i, detailDummy.matrix);
      colliders.push({
        minX: s.x - 2.4, maxX: s.x + 2.4, minZ: s.z - 2.4, maxZ: s.z + 2.4,
        height: 1.8, kind: 'parkedCar', district: districtAt(s.x, s.z), type: 'parkedCar',
      });
    });
    bodyMesh.castShadow = true;
    cabinMesh.castShadow = true;
    group.add(bodyMesh);
    group.add(cabinMesh);
  }

  // ---- Roundabouts on two big intersections ----
  for (const rb of [{ x: 100, z: 100 }, { x: -300, z: 300 }]) {
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(11, 11, 0.3, 20), matAsphaltMain);
    disc.position.set(rb.x, 0.15, rb.z);
    disc.receiveShadow = true;
    group.add(disc);
    const island = new THREE.Mesh(new THREE.CylinderGeometry(3, 3.2, 0.9, 12), matGrass);
    island.position.set(rb.x, 0.45, rb.z);
    group.add(island);
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.3, 5, 6), lambert(C.palmTrunk));
    trunk.position.set(rb.x, 3.4, rb.z);
    group.add(trunk);
    const top = new THREE.Mesh(new THREE.ConeGeometry(2.2, 2.4, 6), lambert(C.palmLeaf));
    top.position.set(rb.x, 7, rb.z);
    group.add(top);
  }

  // ---- Zebra crossings at four main intersections ----
  const zebraSpots = [];
  for (const zx of [{ x: -100, z: 100 }, { x: 100, z: -100 }, { x: 100, z: 100 }, { x: -300, z: -100 }]) {
    for (let i = 0; i < 7; i += 1) {
      zebraSpots.push({ x: zx.x - 9 + i * 3, z: zx.z + 16, w: 0.9, d: 3.5 });
      zebraSpots.push({ x: zx.x + 16, z: zx.z - 9 + i * 3, w: 3.5, d: 0.9 });
    }
  }
  const zebraMesh = new THREE.InstancedMesh(unitBox, lambert(0xf2f2ee), zebraSpots.length);
  zebraSpots.forEach((s, i) => {
    detailDummy.position.set(s.x, 0.06, s.z);
    detailDummy.rotation.set(0, 0, 0);
    detailDummy.scale.set(s.w, 0.12, s.d);
    detailDummy.updateMatrix();
    zebraMesh.setMatrixAt(i, detailDummy.matrix);
  });
  group.add(zebraMesh);

  // ---- Narrow alley in Cobre Viejo: cables between poles, lamps, crates ----
  const alleyMat = lambert(0x55585e);
  const alley = new THREE.Mesh(new THREE.PlaneGeometry(6, 170), alleyMat);
  alley.rotation.x = -Math.PI / 2;
  alley.position.set(-200, 0.06, 0);
  alley.receiveShadow = true;
  group.add(alley);
  const wirePts = [];
  for (const wz of [-60, -20, 20, 60]) {
    for (const px of [-203, -197]) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, 5.5, 5), lambert(C.lampPole));
      pole.position.set(px, 2.75, wz);
      group.add(pole);
    }
    wirePts.push(-203, 5.5, wz, -200, 4.9, wz);
    wirePts.push(-200, 4.9, wz, -197, 5.5, wz);
  }
  const wireGeo = new THREE.BufferGeometry();
  wireGeo.setAttribute('position', new THREE.Float32BufferAttribute(wirePts, 3));
  group.add(new THREE.LineSegments(wireGeo, new THREE.LineBasicMaterial({ color: 0x222222 })));
  for (const lz of [-40, 0, 40]) {
    const lamp = new THREE.Mesh(
      new THREE.SphereGeometry(0.35, 8, 6),
      new THREE.MeshBasicMaterial({ color: C.lampHead }),
    );
    lamp.position.set(-200, 4.6, lz);
    group.add(lamp);
  }
  for (const crate of [{ x: -202.5, z: -45 }, { x: -197.5, z: 10 }, { x: -202.5, z: 55 }]) {
    const box = flatBox(1.6, 1.6, 1.6, lambert(0x8a6a42));
    box.position.x = crate.x;
    box.position.z = crate.z;
    group.add(box);
  }

  // ---- Neon billboards in Glasspoint (the night district) ----
  const billboardSpots = [
    { x: 180, z: -280, ry: 0 }, { x: 320, z: -180, ry: Math.PI / 2 },
    { x: 450, z: -280, ry: 0 }, { x: 180, z: 80, ry: Math.PI / 2 },
    { x: 420, z: 180, ry: 0 }, { x: 300, z: -420, ry: Math.PI / 2 },
    { x: 140, z: -420, ry: 0 }, { x: 480, z: 80, ry: Math.PI / 2 },
  ];
  billboardSpots.forEach((s, i) => {
    const poleH = 13 + (i % 3) * 3;
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.55, poleH, 6), lambert(C.lampPole));
    pole.position.set(s.x, poleH / 2, s.z);
    pole.castShadow = true;
    group.add(pole);
    const panel = flatBox(10, 4.5, 0.4, matNeon[i % matNeon.length]);
    panel.position.set(s.x, poleH + 2.5, s.z);
    panel.rotation.y = s.ry;
    panel.castShadow = false;
    group.add(panel);
  });

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

  // Palms: ~150, two instanced meshes (trunk + canopy).
  // Ring the promenade first, then line the main roads, the plaza,
  // and the pocket gardens. Height varies more than before.
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
  for (let i = 0; i < 24; i += 1) {
    palmSpots.push({ x: 300 + (random() < 0.5 ? -12 : 12), z: -560 + i * 48 + range(random, -6, 6) });
  }
  for (let i = 0; i < 24; i += 1) {
    palmSpots.push({ x: -560 + i * 48 + range(random, -6, 6), z: -100 + (random() < 0.5 ? -12 : 12) });
  }
  for (let i = 0; i < 8; i += 1) {
    const a = (i / 8) * Math.PI * 2 + 0.4;
    palmSpots.push({ x: 20 + Math.cos(a) * 34, z: 20 + Math.sin(a) * 34 });
  }
  for (const gp of gardenPalmSpots) palmSpots.push(gp);
  const trunkGeo = new THREE.CylinderGeometry(0.18, 0.3, CONFIG.NATURE.palmHeight, 6);
  const canopyGeo = new THREE.ConeGeometry(2.4, 2.6, 6);
  const trunkMesh = new THREE.InstancedMesh(trunkGeo, lambert(C.palmTrunk), palmSpots.length);
  const canopyMesh = new THREE.InstancedMesh(canopyGeo, lambert(C.palmLeaf), palmSpots.length);
  const dummy = new THREE.Object3D();
  palmSpots.forEach((spot, i) => {
    const lean = range(random, -0.08, 0.08);
    dummy.position.set(spot.x, CONFIG.NATURE.palmHeight / 2, spot.z);
    dummy.rotation.set(lean, random() * Math.PI * 2, lean);
    dummy.scale.setScalar(range(random, 0.8, 1.6));
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

  // Street lamps: 120, instanced pole + glowing head, along main roads.
  const lampSpots = [];
  for (let i = 0; i < 30; i += 1) {
    lampSpots.push({ x: -100 + 11, z: -560 + i * 38 });
    lampSpots.push({ x: 100 - 11, z: -560 + i * 38 });
  }
  for (let i = 0; i < 30; i += 1) {
    lampSpots.push({ x: -560 + i * 38, z: 100 + 11 });
    lampSpots.push({ x: -560 + i * 38, z: 100 - 11 });
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

  // Benches: promenade row, a ring around the plaza fountain, and one
  // per pocket garden.
  const benchMat = lambert(C.bench);
  const benchGeo = new THREE.BoxGeometry(2.4, 0.5, 0.9);
  const benchSpots = [];
  for (let i = 0; i < 24; i += 1) {
    benchSpots.push({ x: -560 + i * 49, z: W.beachStart - 14, ry: 0 });
  }
  for (let i = 0; i < 12; i += 1) {
    const a = (i / 12) * Math.PI * 2;
    benchSpots.push({ x: 20 + Math.cos(a) * 14, z: 20 + Math.sin(a) * 14, ry: -a });
  }
  for (const g of gardenSpots) benchSpots.push({ x: g.x + 8, z: g.z, ry: 0 });
  const benchMesh = new THREE.InstancedMesh(benchGeo, benchMat, benchSpots.length);
  benchSpots.forEach((s, i) => {
    dummy.position.set(s.x, 0.45, s.z);
    dummy.rotation.set(0, s.ry || 0, 0);
    dummy.scale.setScalar(1);
    dummy.updateMatrix();
    benchMesh.setMatrixAt(i, dummy.matrix);
  });
  benchMesh.castShadow = true;
  group.add(benchMesh);

  // Bollards: along the promenade edge and around the plaza.
  const bollardGeo = new THREE.CylinderGeometry(0.22, 0.22, 0.9, 6);
  const bollardSpots = [];
  for (let i = 0; i < 36; i += 1) {
    bollardSpots.push({ x: -570 + i * 33, z: W.beachStart - 2 });
  }
  for (let i = 0; i < 16; i += 1) {
    const a = (i / 16) * Math.PI * 2;
    bollardSpots.push({ x: 20 + Math.cos(a) * 46, z: 20 + Math.sin(a) * 46 });
  }
  const bollardMesh = new THREE.InstancedMesh(bollardGeo, lambert(C.lampPole), bollardSpots.length);
  bollardSpots.forEach((s, i) => {
    dummy.position.set(s.x, 0.45, s.z);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.setScalar(1);
    dummy.updateMatrix();
    bollardMesh.setMatrixAt(i, dummy.matrix);
  });
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
  // The player starts on the plaza corner at (-70,-70), facing
  // south-east straight at Bengkel Ivo and the plaza fountain, with
  // parked cars, kiosks and pedestrians around them.
  const spawnPoints = {
    playerStart: { x: -70, z: -70, heading: -Math.PI * 0.75, label: 'Bengkel Ivo' },
    garage: { x: -70, z: -70, heading: -Math.PI * 0.75, label: 'Bengkel Ivo' },
    sunwire: { x: -300, z: 420, heading: 0, label: 'Sunwire FM' },
    harbor: { x: 420, z: -420, heading: Math.PI, label: 'Harborcoil' },
    plaza: { x: 20, z: 20, heading: 0, label: 'Plaza Cobre Viejo' },
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
