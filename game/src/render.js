// Sunline: Breakwater - Three.js setup and frame rendering.
// initRenderer(canvas) builds the WebGL renderer, createScene() builds
// the scene with golden-hour sun, warm hazy sky, a visible sun disc and
// drifting low-poly clouds, renderFrame() paints one frame. No network,
// no assets: the scene is lit and coloured in code only.

import * as THREE from 'three';
import { CONFIG } from './config.js';

// Create the renderer on the game's canvas. Pixel ratio is capped so
// low end laptops hold 60 fps, shadows stay soft and cheap.
export function initRenderer(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  const ratio = Math.min(window.devicePixelRatio || 1, CONFIG.RENDER.maxPixelRatio);
  renderer.setPixelRatio(ratio);
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.22;
  return renderer;
}

// Build the scene: warm peach sky and fog, a low orange golden-hour
// sun from the west, a visible sun disc, simple flat clouds, and a
// hemisphere light so shadows never go black. Still bright and readable.
export function createScene() {
  const scene = new THREE.Scene();
  // Golden-hour sky gradient: deep orange overhead fading to pale peach
  // at the horizon, so the sky has depth instead of one flat wash.
  const skyCanvas = document.createElement('canvas');
  skyCanvas.width = 4;
  skyCanvas.height = 256;
  const skyCtx = skyCanvas.getContext('2d');
  const skyGrad = skyCtx.createLinearGradient(0, 0, 0, 256);
  skyGrad.addColorStop(0, '#e87f3d');
  skyGrad.addColorStop(0.45, '#ffab66');
  skyGrad.addColorStop(0.75, '#ffc98f');
  skyGrad.addColorStop(1, '#ffe3b8');
  skyCtx.fillStyle = skyGrad;
  skyCtx.fillRect(0, 0, 4, 256);
  const skyTex = new THREE.CanvasTexture(skyCanvas);
  skyTex.colorSpace = THREE.SRGBColorSpace;
  scene.background = skyTex;
  scene.fog = new THREE.Fog(CONFIG.COLORS.fog, CONFIG.RENDER.fogNear, CONFIG.RENDER.fogFar);

  const sunPos = CONFIG.RENDER.sunPosition;
  const sun = new THREE.DirectionalLight(CONFIG.COLORS.sun, CONFIG.RENDER.sunIntensity);
  sun.position.set(sunPos[0], sunPos[1], sunPos[2]);
  sun.castShadow = true;
  sun.shadow.mapSize.set(CONFIG.RENDER.shadowMapSize, CONFIG.RENDER.shadowMapSize);
  const extent = CONFIG.RENDER.shadowCameraExtent;
  sun.shadow.camera.left = -extent;
  sun.shadow.camera.right = extent;
  sun.shadow.camera.top = extent;
  sun.shadow.camera.bottom = -extent;
  sun.shadow.camera.near = 50;
  sun.shadow.camera.far = 1600;
  sun.shadow.bias = -0.0004;
  scene.add(sun);

  const hemi = new THREE.HemisphereLight(
    CONFIG.RENDER.hemiSky,
    CONFIG.RENDER.hemiGround,
    CONFIG.RENDER.hemiIntensity,
  );
  scene.add(hemi);

  // Visible sun disc low in the west, in line with the directional light.
  const sunDisc = new THREE.Mesh(
    new THREE.CircleGeometry(55, 24),
    new THREE.MeshBasicMaterial({ color: CONFIG.COLORS.sunDisc, fog: false }),
  );
  sunDisc.position.set(-950, 260, 480);
  sunDisc.lookAt(0, 40, 0);
  scene.add(sunDisc);
  const sunGlow = new THREE.Mesh(
    new THREE.CircleGeometry(90, 24),
    new THREE.MeshBasicMaterial({
      color: 0xffb45e, fog: false, transparent: true, opacity: 0.35,
    }),
  );
  sunGlow.position.set(-960, 260, 485);
  sunGlow.lookAt(0, 40, 0);
  scene.add(sunGlow);

  // Simple flat clouds, warmed by the low sun so they sit in the same
  // golden hour as the rest of the scene instead of reading as white slabs.
  const cloudMat = new THREE.MeshLambertMaterial({ color: 0xffe7c2 });
  const cloudSpots = [
    { x: -500, y: 230, z: -350, w: 120, d: 34 },
    { x: -100, y: 260, z: -500, w: 150, d: 40 },
    { x: 300, y: 210, z: -250, w: 100, d: 30 },
    { x: 500, y: 250, z: 150, w: 140, d: 36 },
    { x: -350, y: 220, z: 250, w: 110, d: 30 },
    { x: 50, y: 270, z: 450, w: 160, d: 42 },
    { x: -550, y: 240, z: 50, w: 90, d: 28 },
    { x: 150, y: 200, z: -450, w: 90, d: 26 },
  ];
  for (const c of cloudSpots) {
    const cloud = new THREE.Mesh(new THREE.BoxGeometry(c.w, 8, c.d), cloudMat);
    cloud.position.set(c.x, c.y, c.z);
    cloud.castShadow = false;
    cloud.receiveShadow = false;
    scene.add(cloud);
    const puff = new THREE.Mesh(new THREE.BoxGeometry(c.w * 0.5, 7, c.d * 0.8), cloudMat);
    puff.position.set(c.x + c.w * 0.15, c.y + 6, c.z);
    puff.castShadow = false;
    scene.add(puff);
  }

  return { scene, sun, hemi };
}

// Paint one frame. Nothing is allocated here per frame.
export function renderFrame(renderer, scene, camera) {
  renderer.render(scene, camera);
}

// Keep the canvas and camera matched to the window. Call on resize.
export function resizeRenderer(renderer, camera) {
  const width = window.innerWidth;
  const height = window.innerHeight;
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}
