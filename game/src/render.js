// Sunline: Breakwater - Three.js setup and frame rendering.
// initRenderer(canvas) builds the WebGL renderer, createScene() builds
// the scene with late afternoon sun, warm ambient light and pale blue
// fog, renderFrame() paints one frame. No network, no assets: the
// scene is lit and coloured in code only.

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
  renderer.toneMappingExposure = 1.05;
  return renderer;
}

// Build the scene: pale blue sky and fog, a low warm sun from the
// south west, and a hemisphere light so shadows never go black.
export function createScene() {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(CONFIG.COLORS.sky);
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
