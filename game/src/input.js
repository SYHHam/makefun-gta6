// input.js: keyboard + mouse input for Sunline Breakwater.
// WASD/arrows drive and walk, mouse aims/shoots, E interacts, 1-2 switch
// weapons, Esc/P pauses, R toggles the radio. One-shot actions are queued
// and consumed once, so a press between frames is never lost or double counted.
export const ACTION_INTERACT = 'interact';
export const ACTION_PAUSE = 'pause';
export const ACTION_RADIO = 'radio';
export const ACTION_WEAPON_1 = 'weapon1';
export const ACTION_WEAPON_2 = 'weapon2';
export const ACTION_SHOOT = 'shoot';
export const ACTION_PUNCH = 'punch';
export const ACTION_HORN = 'horn';
export const ACTION_CONFIRM = 'confirm';
export const ACTION_NITRO = 'nitro';

const DRIVE_KEYS = {
  KeyW: 'forward', ArrowUp: 'forward',
  KeyS: 'back', ArrowDown: 'back',
  KeyA: 'left', ArrowLeft: 'left',
  KeyD: 'right', ArrowRight: 'right',
  ShiftLeft: 'sprint', ShiftRight: 'sprint',
  Space: 'brake',
};

export function createInput(canvas) {
  const keys = {};
  const mouse = { x: 0, y: 0, down: false, rightDown: false, dx: 0, dy: 0 };
  const queue = new Set();
  let locked = false;

  function onKeyDown(event) {
    if (event.repeat) {
      if (DRIVE_KEYS[event.code]) keys[DRIVE_KEYS[event.code]] = true;
      return;
    }
    const mapped = DRIVE_KEYS[event.code];
    if (mapped) keys[mapped] = true;
    if (event.code === 'KeyE') queue.add(ACTION_INTERACT);
    if (event.code === 'Escape' || event.code === 'KeyP') queue.add(ACTION_PAUSE);
    if (event.code === 'KeyR') queue.add(ACTION_RADIO);
    if (event.code === 'Digit1') queue.add(ACTION_WEAPON_1);
    if (event.code === 'Digit2') queue.add(ACTION_WEAPON_2);
    if (event.code === 'KeyH') queue.add(ACTION_HORN);
    if (event.code === 'KeyN') queue.add(ACTION_NITRO);
    if (event.code === 'Enter' || event.code === 'Space') queue.add(ACTION_CONFIRM);
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(event.code)) {
      event.preventDefault();
    }
  }

  function onKeyUp(event) {
    const mapped = DRIVE_KEYS[event.code];
    if (mapped) keys[mapped] = false;
  }

  function onMouseMove(event) {
    mouse.x = event.clientX;
    mouse.y = event.clientY;
    mouse.dx += event.movementX || 0;
    mouse.dy += event.movementY || 0;
  }

  function onMouseDown(event) {
    if (event.button === 0) {
      mouse.down = true;
      queue.add(ACTION_SHOOT);
    }
    if (event.button === 2) mouse.rightDown = true;
  }

  function onMouseUp(event) {
    if (event.button === 0) mouse.down = false;
    if (event.button === 2) mouse.rightDown = false;
  }

  function onBlur() {
    for (const k of Object.keys(keys)) keys[k] = false;
    mouse.down = false;
    mouse.rightDown = false;
  }

  function onContextMenu(event) {
    if (canvas && event.target === canvas) event.preventDefault();
  }

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('blur', onBlur);
  window.addEventListener('contextmenu', onContextMenu);
  if (canvas) {
    canvas.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mouseup', onMouseUp);
    canvas.addEventListener('click', () => {
      if (!locked && canvas.requestPointerLock) {
        try { canvas.requestPointerLock(); locked = true; } catch { /* pointer lock optional */ }
      }
    });
    document.addEventListener('pointerlockchange', () => {
      locked = document.pointerLockElement === canvas;
    });
  }

  return {
    keys,
    mouse,
    get locked() { return locked; },
    /** True while the named drive key is held. */
    held(name) { return !!keys[name]; },
    /** Steering -1..1 from A/D or arrows. */
    steer() { return (keys.right ? 1 : 0) - (keys.left ? 1 : 0); },
    /** Throttle -1..1 from W/S or arrows. */
    throttle() { return (keys.forward ? 1 : 0) - (keys.back ? 1 : 0); },
    /** True once if the action was queued since the last consume call. */
    consume(action) {
      if (queue.has(action)) { queue.delete(action); return true; }
      return false;
    },
    /** True if the action is queued, without consuming it. */
    peek(action) { return queue.has(action); },
    /** Mouse movement since the last call, then resets the delta. */
    takeMouseDelta() {
      const d = { dx: mouse.dx, dy: mouse.dy };
      mouse.dx = 0;
      mouse.dy = 0;
      return d;
    },
    destroy() {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('contextmenu', onContextMenu);
      if (canvas) canvas.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mouseup', onMouseUp);
    },
  };
}
