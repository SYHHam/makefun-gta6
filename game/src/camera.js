// Sunline: Breakwater - third-person camera.
// updateCamera(camera, target, mode, dt) follows the player on foot
// and in a car, with a smooth lagged follow, a closer zoom while
// aiming, and a speed based pull-back while driving. The camera never
// rolls and never goes below the street.
// target: { x, y, z, heading, speed, aiming } where heading is the
// facing angle in radians. Two conventions meet here: on foot heading 0
// faces north (-z), so forward is (-sin h, -cos h) and the camera sits
// behind at +sin/+cos. In a car main.js passes car.heading, whose
// travel direction is the opposite: forward is (+sin h, +cos h),
// because updateVehicle moves along (sin h, cos h) and the car mesh
// faces +Z. So in 'drive' mode the behind/look vectors flip; without
// the flip the camera would sit in front of the car looking back at
// its nose instead of behind it looking forward past its tail.
// mode: 'foot', 'drive' or 'aim'.

import * as THREE from 'three';
import { CONFIG } from './config.js';

const smoothedPos = new THREE.Vector3(0, 8, 12);
const smoothedLook = new THREE.Vector3(0, 1.5, 0);
const desiredPos = new THREE.Vector3();
const desiredLook = new THREE.Vector3();
let initialised = false;

// Put the camera straight behind the target, used on spawn and cutscenes.
export function resetCamera(camera, target) {
  const heading = target.heading || 0;
  const backX = Math.sin(heading);
  const backZ = Math.cos(heading);
  smoothedPos.set(target.x + backX * 8, target.y + 4, target.z + backZ * 8);
  smoothedLook.set(target.x, target.y + 1.5, target.z);
  camera.position.copy(smoothedPos);
  camera.lookAt(smoothedLook);
  initialised = true;
}

export function updateCamera(camera, target, mode, dt) {
  const cam = CONFIG.CAMERA;
  const heading = target.heading || 0;
  const speed = target.speed || 0;
  const aiming = mode === 'aim' || target.aiming === true;

  let distance = cam.footDistance;
  let height = cam.footHeight;
  if (mode === 'drive') {
    // Pull back a little as speed rises so fast driving stays readable.
    const pull = Math.min(speed / 45, 1) * 3;
    distance = cam.driveDistance + pull;
    height = cam.driveHeight + pull * 0.4;
  } else if (aiming) {
    distance = cam.aimDistance;
    height = cam.aimHeight;
  }

  // Behind the target. On foot heading 0 faces north (-z), so the
  // camera sits at +sin/+cos of the heading, looking forward past the
  // target. In drive mode the heading is a car heading (forward is
  // +sin/+cos), so the sign flips: the camera sits at -sin/-cos,
  // behind the car, and looks forward along its travel direction.
  const driveSign = mode === 'drive' ? -1 : 1;
  const backX = driveSign * Math.sin(heading);
  const backZ = driveSign * Math.cos(heading);
  desiredPos.set(
    target.x + backX * distance,
    target.y + height,
    target.z + backZ * distance,
  );
  // Keep the camera above the street even on steep camera moves.
  if (desiredPos.y < 1.2) desiredPos.y = 1.2;

  // Look slightly ahead of the target, further ahead the faster it moves.
  const lookAhead = mode === 'drive' ? 4 + speed * 0.25 : 3;
  desiredLook.set(
    target.x - backX * lookAhead,
    target.y + 1.6,
    target.z - backZ * lookAhead,
  );

  if (!initialised) {
    smoothedPos.copy(desiredPos);
    smoothedLook.copy(desiredLook);
    initialised = true;
  }

  // Frame rate independent smoothing: fast enough to feel responsive,
  // slow enough to hide bumps and sharp turns.
  const posK = 1 - Math.exp(-cam.followLerp * dt);
  const lookK = 1 - Math.exp(-cam.lookLerp * dt);
  smoothedPos.lerp(desiredPos, posK);
  smoothedLook.lerp(desiredLook, lookK);

  camera.position.copy(smoothedPos);
  camera.lookAt(smoothedLook);
}

// Heading from a movement direction, for targets that only have velocity.
export function headingFromVelocity(vx, vz, fallback) {
  if (Math.abs(vx) < 0.01 && Math.abs(vz) < 0.01) return fallback || 0;
  // Heading 0 faces north (-z) and forward is (-sin h, -cos h), so
  // heading = atan2(-vx, -vz) puts the camera behind the movement.
  return Math.atan2(-vx, -vz);
}
