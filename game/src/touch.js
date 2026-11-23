// touch.js: automatic touch-device detection + virtual touch controls
// for Sunline Breakwater. Desktop (keyboard/mouse) is untouched: when
// isTouchDevice() is false this module creates no DOM at all and the
// keyboard/mouse path in input.js keeps working exactly as before.
//
// Touch controls are positioned relative to measured HUD panels and use safe-area offsets.
// Joystick drives input.keys and input.analog; action handlers stay shared with keyboard input.
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
  ACTION_WEAPON_1,
  ACTION_WEAPON_2,
  ACTION_SHOOT,
  ACTION_NITRO,
} from './input.js';

let JOYSTICK_RADIUS = 60;
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
    `<span data-touch-sub style="font-size:10px;font-weight:600;color:#ffd97a;line-height:1.1;">${sub || ''}</span>`;
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
  let layoutTimer = null;
  let pauseBtn = null;
  let actionButtons = [];
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
    const sub = nitroBtn.querySelector('[data-touch-sub]');
    if (sub) sub.textContent = inCar ? 'nitro' : '';
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

    // --- Analog joystick, bottom-left ---
    const base = document.createElement('div');
    base.dataset.touch = 'joystick';
    base.setAttribute('aria-label', 'Joystick analog');
    base.style.cssText =
      'position:fixed;left:calc(16px + env(safe-area-inset-left));bottom:calc(16px + env(safe-area-inset-bottom));width:124px;height:124px;border-radius:50%;' +
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
    const stickEnd = (e) => { if (e.pointerId === stickPointerId) resetStick(); };
    base.addEventListener('pointerup', stickEnd);
    base.addEventListener('pointercancel', stickEnd);
    root.appendChild(base);

    const sprintBtn = makeButton({ id: 'sprint', label: 'LARI', sub: '', size: 60, left: 154, bottom: 48 });
    sprintBtn.style.left = 'calc(154px + env(safe-area-inset-left))';
    sprintBtn.style.bottom = 'calc(48px + env(safe-area-inset-bottom))';
    sprintBtn.addEventListener('pointerdown', (e) => {
      input.keys.sprint = true; pressFeedback(sprintBtn, true); e.preventDefault();
    });
    const sprintEnd = () => { input.keys.sprint = false; pressFeedback(sprintBtn, false); };
    sprintBtn.addEventListener('pointerup', sprintEnd);
    sprintBtn.addEventListener('pointercancel', sprintEnd);
    sprintBtn.addEventListener('pointerleave', sprintEnd);
    root.appendChild(sprintBtn);

    const interactBtn = makeButton({ id: 'interact', label: 'MASUK', sub: '', size: 76, right: 16, bottom: 12, fontSize: 13 });
    interactBtn.style.right = 'calc(16px + env(safe-area-inset-right))';
    interactBtn.addEventListener('pointerdown', (e) => {
      input.queueAction(ACTION_INTERACT); pressFeedback(interactBtn, true);
      setTimeout(() => pressFeedback(interactBtn, false), 150); e.preventDefault();
    });
    root.appendChild(interactBtn);

    const shootBtn = makeButton({ id: 'shoot', label: 'TEMBAK', sub: 'bidik', size: 68, right: 104, bottom: 12, fontSize: 12 });
    shootBtn.style.right = 'calc(104px + env(safe-area-inset-right))';
    shootBtn.addEventListener('pointerdown', (e) => {
      input.mouse.rightDown = true;
      input.queueAction(ACTION_SHOOT);
      pressFeedback(shootBtn, true);
      clearInterval(shootTimer);
      shootTimer = setInterval(() => input.queueAction(ACTION_SHOOT), 400);
      e.preventDefault();
    });
    const shootEnd = () => {
      input.mouse.rightDown = false; pressFeedback(shootBtn, false);
      clearInterval(shootTimer); shootTimer = null;
    };
    shootBtn.addEventListener('pointerup', shootEnd);
    shootBtn.addEventListener('pointercancel', shootEnd);
    shootBtn.addEventListener('pointerleave', shootEnd);
    root.appendChild(shootBtn);

    nitroBtn = makeButton({ id: 'nitro-weapon', label: 'SENJATA', sub: '', size: 64, right: 16, bottom: 100, fontSize: 10 });
    nitroBtn.style.right = 'calc(16px + env(safe-area-inset-right))';
    nitroBtn.addEventListener('pointerdown', (e) => {
      if (isInCar()) input.queueAction(ACTION_NITRO);
      else { weaponToggle = 1 - weaponToggle; input.queueAction(weaponToggle ? ACTION_WEAPON_2 : ACTION_WEAPON_1); }
      pressFeedback(nitroBtn, true);
      setTimeout(() => { pressFeedback(nitroBtn, false); refreshNitroLabel(); }, 150);
      e.preventDefault();
    });
    root.appendChild(nitroBtn);

    pauseBtn = makeButton({ id: 'pause', label: 'II', sub: '', size: 48, right: 16, top: 100, fontSize: 15 });
    pauseBtn.style.right = 'calc(16px + env(safe-area-inset-right))';
    pauseBtn.addEventListener('pointerdown', (e) => { input.queueAction(ACTION_PAUSE); e.preventDefault(); });
    root.appendChild(pauseBtn);
    actionButtons = [interactBtn, shootBtn, nitroBtn, sprintBtn, pauseBtn];

    // Measured layout, recomputed on resize + every 500ms (speed/stats
    // panels change height between on-foot and in-car). Short viewports
    // (height < 500, e.g. a phone in landscape at 800x360) get compact
    // controls and a SINGLE-ROW action cluster: stacking SENJATA above
    // MASUK collides with the stats panel when the viewport is short,
    // and a pause button below the stats collides with MASUK. In
    // landscape the pause button therefore sits top-centre, a band that
    // is free at every landscape width (mission left, stats right);
    // in portrait there is vertical room, so pause stays below stats.
    function updateMeasuredLayout() {
      if (!root) return;
      const speed = document.getElementById('speed-panel');
      const stats = document.getElementById('stats-panel');
      const h = window.innerHeight;
      const w = window.innerWidth;
      const short = h < 500;
      const landscape = w > h;
      const joySize = short ? 100 : 124;
      const knobSize = short ? 44 : 54;
      const sprintSize = short ? 52 : 60;
      const masukSize = short ? 64 : 76;
      const shootSize = short ? 60 : 68;
      const nitroSize = short ? 56 : 64;
      const pauseSize = short ? 44 : 48;
      const gap = 12;
      JOYSTICK_RADIUS = short ? 50 : 60;
      base.style.width = joySize + 'px';
      base.style.height = joySize + 'px';
      knob.style.width = knobSize + 'px';
      knob.style.height = knobSize + 'px';
      sprintBtn.style.width = sprintSize + 'px';
      sprintBtn.style.height = sprintSize + 'px';
      sprintBtn.style.left = `calc(${16 + joySize + gap}px + env(safe-area-inset-left))`;
      sprintBtn.style.bottom = `calc(${16 + Math.round((joySize - sprintSize) / 2)}px + env(safe-area-inset-bottom))`;
      const speedRect = speed ? speed.getBoundingClientRect() : { top: h - 90 };
      const clusterBottom = Math.max(12, h - speedRect.top + gap);
      interactBtn.style.width = masukSize + 'px';
      interactBtn.style.height = masukSize + 'px';
      shootBtn.style.width = shootSize + 'px';
      shootBtn.style.height = shootSize + 'px';
      nitroBtn.style.width = nitroSize + 'px';
      nitroBtn.style.height = nitroSize + 'px';
      interactBtn.style.bottom = `calc(${clusterBottom}px + env(safe-area-inset-bottom))`;
      shootBtn.style.bottom = `calc(${clusterBottom}px + env(safe-area-inset-bottom))`;
      nitroBtn.style.bottom = `calc(${clusterBottom}px + env(safe-area-inset-bottom))`;
      interactBtn.style.right = 'calc(16px + env(safe-area-inset-right))';
      shootBtn.style.right = `calc(${16 + masukSize + gap}px + env(safe-area-inset-right))`;
      nitroBtn.style.right = `calc(${16 + masukSize + gap + shootSize + gap}px + env(safe-area-inset-right))`;
      pauseBtn.style.width = pauseSize + 'px';
      pauseBtn.style.height = pauseSize + 'px';
      if (landscape) {
        pauseBtn.style.top = 'calc(12px + env(safe-area-inset-top))';
        pauseBtn.style.right = 'auto';
        pauseBtn.style.left = '50%';
        pauseBtn.style.transform = 'translateX(-50%)';
      } else {
        const statsRect = stats ? stats.getBoundingClientRect() : { bottom: 100 };
        pauseBtn.style.top = `calc(${Math.round(statsRect.bottom) + gap}px + env(safe-area-inset-top))`;
        pauseBtn.style.left = 'auto';
        pauseBtn.style.right = 'calc(16px + env(safe-area-inset-right))';
        pauseBtn.style.transform = 'none';
      }
    }
    updateMeasuredLayout();
    window.addEventListener('resize', updateMeasuredLayout);
    window.addEventListener('orientationchange', updateMeasuredLayout);
    root.__updateMeasuredLayout = updateMeasuredLayout;

    document.body.appendChild(root);
    refreshNitroLabel();
    refreshVisibility();
    refreshTimer = setInterval(() => { refreshNitroLabel(); refreshVisibility(); updateMeasuredLayout(); }, 500);

    // Hide the WASD hint on touch devices.
    const hint = document.getElementById('hint');
    if (hint) {
      hintPrevDisplay = hint.style.display;
      hint.style.display = 'none';
    }

    dialogStyle = document.createElement('style');
    dialogStyle.id = 'touch-dialog-style';
    dialogStyle.textContent =
      'body.touch-on #dialog { top: 300px !important; bottom: auto !important; }' +
      // Short landscape: shift the dialog right of the joystick/LARI
      // (LARI ends x=180) and narrow it so it clears the speed panel
      // (starts x~621), and raise it to top:260px so a 2-line dialog
      // (up to ~100px tall) still fits inside a 360px viewport.
      'body.touch-on.touch-short #dialog { left: 46.5% !important; width: min(360px, 48vw) !important; top: 260px !important; }';
    document.head.appendChild(dialogStyle);
    document.body.classList.add('touch-on');
    document.body.classList.toggle('touch-landscape', window.innerWidth > window.innerHeight);
    document.body.classList.toggle('touch-portrait', window.innerWidth <= window.innerHeight);
    document.body.classList.toggle('touch-short', window.innerHeight < 500);
  }

  function teardown() {
    clearInterval(refreshTimer);
    refreshTimer = null;
    clearInterval(shootTimer);
    shootTimer = null;
    resetStick();
    input.keys.sprint = false;
    input.mouse.rightDown = false;
    if (root) {
      window.removeEventListener('resize', root.__updateMeasuredLayout);
      window.removeEventListener('orientationchange', root.__updateMeasuredLayout);
      root.remove(); root = null;
    }
    actionButtons = [];
    pauseBtn = null;
    knob = null;
    nitroBtn = null;
    if (dialogStyle) { dialogStyle.remove(); dialogStyle = null; }
    document.body.classList.remove('touch-on', 'touch-landscape', 'touch-portrait', 'touch-short');
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
  const onViewportChange = () => {
    if (active) {
      document.body.classList.toggle('touch-landscape', window.innerWidth > window.innerHeight);
      document.body.classList.toggle('touch-portrait', window.innerWidth <= window.innerHeight);
      document.body.classList.toggle('touch-short', window.innerHeight < 500);
    }
    apply();
  };
  window.addEventListener('resize', onViewportChange);
  window.addEventListener('orientationchange', onViewportChange);

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
      window.removeEventListener('resize', onViewportChange);
      window.removeEventListener('orientationchange', onViewportChange);
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
