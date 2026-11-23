// touch.js: automatic touch-device detection + virtual touch controls
// for Sunline Breakwater. Desktop (keyboard/mouse) is untouched: when
// isTouchDevice() is false this module creates no DOM at all and the
// keyboard/mouse path in input.js keeps working exactly as before.
//
// Touch layout (all DOM + inline styles are built here in JS, so
// index.html and style.css are never touched):
//   - virtual analog joystick, bottom-left ABOVE the minimap (the
//     minimap stays bottom-left; moving it to top-left would collide
//     with the mission panel, and mid-left would collide with the
//     dispatch panel on wide screens). Joystick drives input.keys
//     (booleans, so on-foot movement works unchanged) and input.analog
//     (proportional -1..1, used by input.steer()/throttle() in a car).
//   - SPRINT hold button next to the joystick.
//   - action buttons bottom-right ABOVE the speed panel: INTERACT,
//     SHOOT (hold to aim, tap/repeat to fire), NITRO in a car /
//     WEAPON on foot, plus small PAUSE and RADIO buttons top-right
//     below the stats panel.
//   - camera drag: a touch drag that starts on the canvas on the right
//     half of the screen rotates the view. It accumulates
//     input.mouse.dx/dy (the same channel takeMouseDelta() reads) and
//     calls opts.onCameraDrag(dx, dy); main.js wires that to the
//     player heading, which is what updateCamera() follows, so no
//     camera code had to change. While driving the car heading wins
//     each frame, so the drag only orbits on foot / while aiming.
//   - the WASD hint (#hint) is hidden while touch is active.
import {
  ACTION_INTERACT,
  ACTION_PAUSE,
  ACTION_RADIO,
  ACTION_WEAPON_1,
  ACTION_WEAPON_2,
  ACTION_SHOOT,
  ACTION_NITRO,
} from './input.js';

const JOYSTICK_RADIUS = 60;
const DEAD_ZONE = 0.22;

/** True when this device has a coarse (touch) pointer. */
export function isTouchDevice() {
  if (typeof window === 'undefined') return false;
  return (
    'ontouchstart' in window ||
    (typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0) ||
    (typeof window.matchMedia === 'function' &&
      window.matchMedia('(pointer: coarse)').matches)
  );
}

const BTN_BASE =
  'position:fixed;z-index:8;pointer-events:auto;display:flex;flex-direction:column;' +
  'align-items:center;justify-content:center;border-radius:50%;border:2px solid rgba(255,255,255,0.55);' +
  'background:rgba(10,16,26,0.55);color:#fff;font-weight:800;cursor:pointer;' +
  'touch-action:none;user-select:none;-webkit-user-select:none;-webkit-tap-highlight-color:transparent;' +
  'font-family:system-ui,-apple-system,"Segoe UI",sans-serif;';

function makeButton({ id, label, sub, size, right, bottom, top, left, fontSize }) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.dataset.touch = id;
  btn.setAttribute('aria-label', label);
  btn.style.cssText =
    BTN_BASE +
    `width:${size}px;height:${size}px;` +
    (right != null ? `right:${right}px;` : '') +
    (bottom != null ? `bottom:${bottom}px;` : '') +
    (top != null ? `top:${top}px;` : '') +
    (left != null ? `left:${left}px;` : '') +
    `font-size:${fontSize || 13}px;`;
  btn.innerHTML =
    `<span style="font-size:${fontSize || 13}px;line-height:1.1;">${label}</span>` +
    (sub ? `<span style="font-size:10px;font-weight:600;color:#ffd97a;line-height:1.1;">${sub}</span>` : '');
  return btn;
}

function pressFeedback(el, on) {
  el.style.background = on ? 'rgba(242,194,48,0.75)' : 'rgba(10,16,26,0.55)';
  el.style.color = on ? '#1a1405' : '#fff';
}

/**
 * Build touch controls for the given input object (from createInput).
 * opts: { onCameraDrag(dx, dy), isInCar() } — both optional.
 * Returns { isTouch, destroy() }. No-op (no DOM) on non-touch devices.
 */
export function initTouch(input, opts = {}) {
  const onCameraDrag = typeof opts.onCameraDrag === 'function' ? opts.onCameraDrag : () => {};
  const isInCar = typeof opts.isInCar === 'function' ? opts.isInCar : () => false;

  let root = null;
  let knob = null;
  let nitroBtn = null;
  let active = false;
  let stickPointerId = null;
  let camPointerId = null;
  let camLast = { x: 0, y: 0 };
  let shootTimer = null;
  let weaponToggle = 0;
  let hintPrevDisplay = '';
  let dialogStyle = null;
  let refreshTimer = null;
  let firstTouchHandler = null;

  function setStick(x, y) {
    // x/y are -1..1, already clamped to the stick radius.
    input.analog.x = x;
    input.analog.y = y;
    input.touchMove.x = x;
    input.touchMove.y = y;
    input.keys.forward = y < -DEAD_ZONE;
    input.keys.back = y > DEAD_ZONE;
    input.keys.left = x < -DEAD_ZONE;
    input.keys.right = x > DEAD_ZONE;
    if (knob) {
      knob.style.transform = `translate(calc(-50% + ${x * JOYSTICK_RADIUS * 0.7}px), calc(-50% + ${y * JOYSTICK_RADIUS * 0.7}px))`;
    }
  }

  function resetStick() {
    stickPointerId = null;
    setStick(0, 0);
  }

  function refreshNitroLabel() {
    if (!nitroBtn) return;
    const inCar = isInCar();
    nitroBtn.dataset.mode = inCar ? 'nitro' : 'weapon';
    nitroBtn.querySelector('span').textContent = inCar ? 'NITRO' : 'SENJATA';
    nitroBtn.setAttribute('aria-label', inCar ? 'Nitro' : 'Ganti senjata');
  }

  // Touch controls are only useful while playing. Menu / pause / end
  // screens have their own buttons, and the touch UI would otherwise
  // show through their translucent overlays (they sit under z-index 10).
  function refreshVisibility() {
    if (!root) return;
    const screen = window.__game ? window.__game.screen : null;
    root.style.visibility = screen && screen !== 'playing' ? 'hidden' : 'visible';
  }

  function build() {
    root = document.createElement('div');
    root.dataset.touch = 'root';
    root.style.cssText =
      'position:fixed;inset:0;z-index:8;pointer-events:none;';

    // --- Analog joystick, bottom-left above the minimap ---
    const base = document.createElement('div');
    base.dataset.touch = 'joystick';
    base.setAttribute('aria-label', 'Joystick analog');
    base.style.cssText =
      'position:fixed;left:18px;bottom:158px;width:124px;height:124px;border-radius:50%;' +
      'border:2px solid rgba(255,255,255,0.45);background:rgba(10,16,26,0.4);' +
      'pointer-events:auto;touch-action:none;';
    knob = document.createElement('div');
    knob.dataset.touch = 'joystick-knob';
    knob.style.cssText =
      'position:absolute;left:50%;top:50%;width:54px;height:54px;border-radius:50%;' +
      'background:rgba(242,194,48,0.85);border:2px solid rgba(255,255,255,0.7);' +
      'transform:translate(-50%,-50%);pointer-events:none;';
    base.appendChild(knob);

    const stickMove = (e) => {
      if (e.pointerId !== stickPointerId) return;
      const rect = base.getBoundingClientRect();
      let dx = (e.clientX - (rect.left + rect.width / 2)) / JOYSTICK_RADIUS;
      let dy = (e.clientY - (rect.top + rect.height / 2)) / JOYSTICK_RADIUS;
      const len = Math.hypot(dx, dy);
      if (len > 1) { dx /= len; dy /= len; }
      setStick(dx, dy);
      e.preventDefault();
    };
    base.addEventListener('pointerdown', (e) => {
      stickPointerId = e.pointerId;
      try { base.setPointerCapture(e.pointerId); } catch { /* older browsers */ }
      stickMove(e);
      e.preventDefault();
    });
    base.addEventListener('pointermove', stickMove);
    const stickEnd = (e) => {
      if (e.pointerId === stickPointerId) resetStick();
    };
    base.addEventListener('pointerup', stickEnd);
    base.addEventListener('pointercancel', stickEnd);
    root.appendChild(base);

    // --- SPRINT (hold), next to the joystick ---
    const sprintBtn = makeButton({
      id: 'sprint', label: 'LARI', sub: 'tahan', size: 60, left: 158, bottom: 176,
    });
    sprintBtn.addEventListener('pointerdown', (e) => {
      input.keys.sprint = true;
      pressFeedback(sprintBtn, true);
      e.preventDefault();
    });
    const sprintEnd = () => { input.keys.sprint = false; pressFeedback(sprintBtn, false); };
    sprintBtn.addEventListener('pointerup', sprintEnd);
    sprintBtn.addEventListener('pointercancel', sprintEnd);
    sprintBtn.addEventListener('pointerleave', sprintEnd);
    root.appendChild(sprintBtn);

    // --- Action buttons, bottom-right above the speed panel ---
    const interactBtn = makeButton({
      id: 'interact', label: 'MASUK', sub: 'mobil (E)', size: 68, right: 16, bottom: 168, fontSize: 14,
    });
    interactBtn.addEventListener('pointerdown', (e) => {
      input.queueAction(ACTION_INTERACT);
      pressFeedback(interactBtn, true);
      setTimeout(() => pressFeedback(interactBtn, false), 150);
      e.preventDefault();
    });
    root.appendChild(interactBtn);

    const shootBtn = makeButton({
      id: 'shoot', label: 'TEMBAK', sub: 'tahan = bidik', size: 68, right: 96, bottom: 168, fontSize: 14,
    });
    shootBtn.addEventListener('pointerdown', (e) => {
      input.mouse.rightDown = true; // aim while held
      input.queueAction(ACTION_SHOOT);
      pressFeedback(shootBtn, true);
      clearInterval(shootTimer);
      shootTimer = setInterval(() => input.queueAction(ACTION_SHOOT), 400);
      e.preventDefault();
    });
    const shootEnd = () => {
      input.mouse.rightDown = false;
      pressFeedback(shootBtn, false);
      clearInterval(shootTimer);
      shootTimer = null;
    };
    shootBtn.addEventListener('pointerup', shootEnd);
    shootBtn.addEventListener('pointercancel', shootEnd);
    shootBtn.addEventListener('pointerleave', shootEnd);
    root.appendChild(shootBtn);

    nitroBtn = makeButton({
      id: 'nitro-weapon', label: 'SENJATA', sub: 'di mobil: nitro', size: 64, right: 16, bottom: 248, fontSize: 11,
    });
    nitroBtn.addEventListener('pointerdown', (e) => {
      if (isInCar()) input.queueAction(ACTION_NITRO);
      else {
        weaponToggle = 1 - weaponToggle;
        input.queueAction(weaponToggle ? ACTION_WEAPON_2 : ACTION_WEAPON_1);
      }
      pressFeedback(nitroBtn, true);
      setTimeout(() => { pressFeedback(nitroBtn, false); refreshNitroLabel(); }, 150);
      e.preventDefault();
    });
    root.appendChild(nitroBtn);

    // --- Small PAUSE / RADIO buttons, top-right below the stats panel ---
    const pauseBtn = makeButton({
      id: 'pause', label: 'II', sub: 'pause', size: 48, right: 16, top: 182, fontSize: 15,
    });
    pauseBtn.addEventListener('pointerdown', (e) => {
      input.queueAction(ACTION_PAUSE);
      e.preventDefault();
    });
    root.appendChild(pauseBtn);

    const radioBtn = makeButton({
      id: 'radio', label: 'RADIO', sub: '', size: 48, right: 76, top: 182, fontSize: 11,
    });
    radioBtn.addEventListener('pointerdown', (e) => {
      input.queueAction(ACTION_RADIO);
      e.preventDefault();
    });
    root.appendChild(radioBtn);

    document.body.appendChild(root);
    refreshNitroLabel();
    refreshVisibility();
    refreshTimer = setInterval(() => { refreshNitroLabel(); refreshVisibility(); }, 500);

    // Hide the WASD hint on touch devices.
    const hint = document.getElementById('hint');
    if (hint) {
      hintPrevDisplay = hint.style.display;
      hint.style.display = 'none';
    }

    // Move the story dialog into the free middle band on touch devices:
    // the bottom is full of the stick + action buttons and the top holds
    // the mission/stats panels + RADIO/pause, so the dialog sits at
    // top:260px where nothing else lives. Removed again in teardown().
    dialogStyle = document.createElement('style');
    dialogStyle.id = 'touch-dialog-style';
    dialogStyle.textContent = 'body.touch-on #dialog { top: 260px !important; bottom: auto !important; }';
    document.head.appendChild(dialogStyle);
    document.body.classList.add('touch-on');
  }

  function teardown() {
    clearInterval(refreshTimer);
    refreshTimer = null;
    clearInterval(shootTimer);
    shootTimer = null;
    resetStick();
    input.keys.sprint = false;
    input.mouse.rightDown = false;
    if (root) { root.remove(); root = null; }
    knob = null;
    nitroBtn = null;
    if (dialogStyle) { dialogStyle.remove(); dialogStyle = null; }
    document.body.classList.remove('touch-on');
    const hint = document.getElementById('hint');
    if (hint) hint.style.display = hintPrevDisplay;
  }

  function apply() {
    const touch = isTouchDevice();
    if (touch && !active) { active = true; build(); }
    else if (!touch && active) { active = false; teardown(); }
    return active;
  }

  // --- Camera drag: touch drag starting on the canvas, right half ---
  const canvas = document.getElementById('game');
  function onCamDown(e) {
    if (e.pointerType !== 'touch' || camPointerId !== null) return;
    if (e.clientX < window.innerWidth * 0.4) return; // left side is the stick
    camPointerId = e.pointerId;
    camLast = { x: e.clientX, y: e.clientY };
  }
  function onCamMove(e) {
    if (e.pointerId !== camPointerId) return;
    const dx = e.clientX - camLast.x;
    const dy = e.clientY - camLast.y;
    camLast = { x: e.clientX, y: e.clientY };
    input.mouse.dx += dx;
    input.mouse.dy += dy;
    onCameraDrag(dx, dy);
    e.preventDefault();
  }
  function onCamEnd(e) {
    if (e.pointerId === camPointerId) camPointerId = null;
  }
  if (canvas) {
    canvas.addEventListener('pointerdown', onCamDown);
    canvas.addEventListener('pointermove', onCamMove);
    canvas.addEventListener('pointerup', onCamEnd);
    canvas.addEventListener('pointercancel', onCamEnd);
  }

  // Re-detect on resize / orientation change (e.g. docked keyboard, fold).
  window.addEventListener('resize', apply);
  window.addEventListener('orientationchange', apply);

  // Some devices report no touch capability until the first real touch.
  firstTouchHandler = (e) => {
    if (e.pointerType === 'touch') apply();
  };
  window.addEventListener('pointerdown', firstTouchHandler);

  apply();

  const api = {
    get isTouch() { return active; },
    isTouchDevice,
    refresh: apply,
    destroy() {
      window.removeEventListener('resize', apply);
      window.removeEventListener('orientationchange', apply);
      if (firstTouchHandler) window.removeEventListener('pointerdown', firstTouchHandler);
      if (canvas) {
        canvas.removeEventListener('pointerdown', onCamDown);
        canvas.removeEventListener('pointermove', onCamMove);
        canvas.removeEventListener('pointerup', onCamEnd);
        canvas.removeEventListener('pointercancel', onCamEnd);
      }
      if (active) teardown();
      active = false;
    },
  };
  window.__touch = api;
  return api;
}
