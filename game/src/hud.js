// hud.js: DOM HUD for Sunline Breakwater.
// Binds to the HUD and menu elements already in index.html (which style.css
// styles): mission panel top left, POLICE DISPATCH mid left, money/wanted/
// health/armor top right, dialog bottom center, minimap bottom left, speed
// bottom right, Sunwire FM bar. Menus reuse the page's own overlays:
// #menu (start/help), #pause-menu, #help-menu (full controls), #mission-
// complete, #mission-fail, #game-over. No DOM is built here; the ids below
// must match index.html. The only gameplay hint is one short line shown
// for the first 5 seconds of play, then faded; all instructions live in
// the Help screen instead.
let dispatchPanelFn = null;
let dispatchPanelTried = false;
async function loadDispatchPanel() {
  if (dispatchPanelTried) return dispatchPanelFn;
  dispatchPanelTried = true;
  try {
    const mod = await import('./police.js');
    if (mod && typeof mod.getDispatchPanel === 'function') dispatchPanelFn = mod.getDispatchPanel;
  } catch { dispatchPanelFn = null; }
  return dispatchPanelFn;
}
loadDispatchPanel();

function fallbackDispatchPanel(state) {
  const units = policeUnits(state).map((u, i) => ({
    name: (u && u.name) || 'Unit ' + (i + 1),
    dist: u && u.pos && state.player && state.player.position
      ? Math.round(u.pos.distanceTo(state.player.position)) : null,
    status: (u && (u.status || u.mode)) || 'Pursuit',
  }));
  return units;
}

function policeUnits(state) {
  if (!state) return [];
  if (Array.isArray(state.police)) return state.police;
  if (state.police && Array.isArray(state.police.units)) return state.police.units;
  return [];
}

export const CHARACTERS = {
  Mara: { name: 'Mara Velez', initial: 'M', color: '#e8a33d' },
  Ivo: { name: 'Ivo Serrat', initial: 'I', color: '#7a5c3e' },
  Nadia: { name: 'Nadia Solis', initial: 'N', color: '#c94f6d' },
  Taz: { name: 'Tomas "Taz" Roldan', initial: 'T', color: '#3f7d5a' },
  Dispatch: { name: 'Police Dispatch', initial: 'P', color: '#3f6fb5' },
  Radio: { name: 'Sunwire FM', initial: 'S', color: '#8a5fc0' },
};

let els = null;
let dialogTimer = 0;
let lastDialogKey = '';
let origMenuTitleHTML = '';
let origMenuSubText = '';
let hintTimer = 0;
let hintFadeTimeout = 0;
let introHintShown = false;
let pauseCallbacks = null;

function buildDOM() {
  if (els) return els;
  const q = (id) => document.getElementById(id);
  const menuTitleEl = q('menu') ? q('menu').querySelector('h1') : null;
  const menuSubEl = q('menu') ? q('menu').querySelector('.menu-sub') : null;
  if (menuTitleEl && !origMenuTitleHTML) origMenuTitleHTML = menuTitleEl.innerHTML;
  if (menuSubEl && !origMenuSubText) origMenuSubText = menuSubEl.textContent;
  els = {
    root: q('hud'),
    mission: q('mission-panel'),
    missionTitle: q('mission-title'),
    missionStage: q('mission-stage'),
    missionNext: q('mission-objective'),
    dispatch: q('dispatch-panel'),
    dispatchStatus: q('dispatch-status'),
    dispatchBody: q('dispatch-units'),
    money: q('money'),
    wanted: q('wanted-stars'),
    health: q('health-bar'),
    armor: q('armor-bar'),
    ammo: q('ammo'),
    dialog: q('dialog'),
    portrait: q('dialog-portrait'),
    dialogName: q('dialog-name'),
    dialogText: q('dialog-text'),
    speed: q('speed-value'),
    speedUnit: q('speed-unit'),
    carName: q('vehicle-name'),
    carCondition: q('vehicle-condition'),
    carUpgrades: q('vehicle-upgrades'),
    radioShow: q('radio-show'),
    reticle: q('reticle'),
    hint: q('hint'),
    menuStart: q('menu'),
    menuTitle: menuTitleEl,
    menuSub: menuSubEl,
    btnContinue: q('btn-continue'),
    btnNewGame: q('btn-new-game'),
    btnHelp: q('btn-help'),
    btnSettings: q('btn-settings'),
    settingsPanel: q('settings-panel'),
    menuHelp: q('help-menu'),
    btnBackHelp: q('btn-back-help'),
    menuPause: q('pause-menu'),
    btnResume: q('btn-resume'),
    btnHelpPause: q('btn-help-pause'),
    btnRestartMission: q('btn-restart-mission'),
    btnQuitMenu: q('btn-quit-menu'),
    menuComplete: q('mission-complete'),
    completeReward: q('complete-reward'),
    btnNextMission: q('btn-next-mission'),
    menuFail: q('mission-fail'),
    failReason: q('fail-reason'),
    btnRetryMission: q('btn-retry-mission'),
    menuGameOver: q('game-over'),
    btnRetryGameover: q('btn-retry-gameover'),
    btnMenuGameover: q('btn-menu-gameover'),
  };
  return els;
}

function moneyText(v) {
  return 'S₡' + Math.floor(v || 0).toLocaleString('en-US');
}

function stars(wanted) {
  let out = '';
  for (let i = 0; i < 3; i += 1) out += i < wanted ? '★' : '☆';
  return out;
}

function pct(value, max) {
  return Math.max(0, Math.min(100, Math.round(((value ?? max) / max) * 100)));
}

export function showDialog(speaker, text, seconds) {
  const e = buildDOM();
  const who = CHARACTERS[speaker] || { name: speaker, initial: (speaker || '?')[0], color: '#666' };
  e.dialogName.textContent = who.name;
  e.dialogText.textContent = text;
  e.portrait.textContent = who.initial;
  e.portrait.style.background = who.color;
  e.dialog.classList.remove('hidden');
  dialogTimer = seconds || 6;
  lastDialogKey = speaker + ':' + text;
  return lastDialogKey;
}

export function hideDialog() {
  const e = buildDOM();
  e.dialog.classList.add('hidden');
  dialogTimer = 0;
}

// One short contextual hint: shown for a few seconds, then faded out.
// Never a permanent strip of instructions; the full controls live in Help.
export function showHint(text, seconds) {
  const e = buildDOM();
  if (!e.hint) return;
  if (hintFadeTimeout) { clearTimeout(hintFadeTimeout); hintFadeTimeout = 0; }
  e.hint.textContent = text;
  e.hint.classList.remove('hidden');
  e.hint.classList.remove('hint-fade');
  hintTimer = seconds || 5;
}

export function hideHint() {
  const e = buildDOM();
  if (!e.hint) return;
  hintTimer = 0;
  e.hint.classList.add('hint-fade');
  if (hintFadeTimeout) clearTimeout(hintFadeTimeout);
  hintFadeTimeout = setTimeout(() => {
    e.hint.classList.add('hidden');
    e.hint.classList.remove('hint-fade');
    hintFadeTimeout = 0;
  }, 650);
}

export function updateHUD(state, dt) {
  const e = buildDOM();
  const p = state.player || {};
  const m = state.mission || {};

  // HUD root becomes visible once the game is actually playing.
  e.root.classList.remove('hidden');

  // Mission, top left.
  if (m.active && m.title) {
    e.missionTitle.textContent = m.title;
    e.missionStage.textContent = 'Stage ' + ((m.stage || 0) + 1) + ' of ' + (m.stages ? m.stages.length : 3) + (m.branch ? '  ·  ' + m.branch : '');
    const next = (m.stages && m.stages[m.stage] && m.stages[m.stage].objective) || m.next || '';
    e.missionNext.textContent = 'NEXT: ' + next;
  } else {
    e.missionTitle.textContent = 'Solmera';
    e.missionStage.textContent = 'Free roam';
    e.missionNext.textContent = 'NEXT: visit the workshop to start a mission';
  }

  // Dispatch panel, mid left. police.js getDispatchPanel returns an array
  // of {name, dist, status, district?} rows; the fallback builds the same shape.
  let panel = null;
  if (Array.isArray(state.dispatchPanel)) panel = state.dispatchPanel;
  else if (dispatchPanelFn) { try { panel = dispatchPanelFn(state); } catch { panel = null; } }
  if (!Array.isArray(panel)) panel = fallbackDispatchPanel(state);
  if (panel && panel.length && state.wanted > 0) {
    e.dispatch.classList.remove('hidden');
    e.dispatchStatus.textContent = 'WANTED LEVEL ' + state.wanted;
    const lines = [];
    for (const row of panel) {
      lines.push((row.name || 'Unit') + '  ' + (row.dist != null ? row.dist + 'm' : '') + '  ' + (row.status || '') + (row.district ? '  ' + row.district : ''));
    }
    e.dispatchBody.innerHTML = lines.map((l) => '<div>' + l + '</div>').join('');
  } else {
    e.dispatch.classList.add('hidden');
  }

  // Stats, top right.
  e.money.textContent = moneyText(p.money);
  e.wanted.textContent = stars(state.wanted || 0);
  e.health.style.width = pct(p.health ?? 100, 100) + '%';
  e.armor.style.width = pct(p.armor ?? 0, 100) + '%';
  e.ammo.textContent = p.weapon ? (p.weapon + (p.ammo != null ? ' ' + p.ammo + ' / 60' : '')) : 'Fists';

  // Vehicle, bottom right.
  const v = state.vehicle;
  if (v && !p.onFoot) {
    const kmh = Math.round(Math.abs(v.speed || 0) * 3.6);
    e.speed.textContent = String(kmh);
    e.speedUnit.textContent = 'km/h';
    e.carName.textContent = v.name || v.model || 'Car';
    e.carCondition.textContent = 'Kondisi ' + Math.round(v.condition ?? 100) + '%';
    const ups = [];
    if (v.upgrades) {
      if (v.upgrades.turbo) ups.push('Turbo T' + v.upgrades.turbo);
      if (v.upgrades.armor) ups.push('Armor T' + v.upgrades.armor);
      if (v.upgrades.nitro) ups.push('Nitro T' + v.upgrades.nitro);
    }
    e.carUpgrades.textContent = ups.length ? ups.join('  ·  ') : 'No upgrades';
  } else {
    e.speed.textContent = '0';
    e.speedUnit.textContent = '';
    e.carName.textContent = 'On foot';
    e.carCondition.textContent = p.weapon ? 'Weapon: ' + p.weapon : 'Fists';
    e.carUpgrades.textContent = 'Press E near a car to steal it';
  }

  // Radio, bottom.
  const shows = ['Sunwire FM  ·  Solmera Sunset Mix', 'Sunwire FM  ·  Harbor Nights', 'Sunwire FM  ·  Palm Drive'];
  const showIndex = Math.floor((state.time || 0) / 90) % shows.length;
  e.radioShow.textContent = (state.radioOn === false ? 'Radio off (R to turn on)  ·  ' : '') + shows[showIndex];

  // Reticle while aiming on foot (right mouse).
  if (p.onFoot && p.aiming) e.reticle.classList.remove('hidden');
  else e.reticle.classList.add('hidden');

  // One short hint for the first 5 seconds of play, then it fades and
  // never comes back. Full instructions live in the Help screen.
  if (!introHintShown) {
    introHintShown = true;
    showHint('WASD bergerak · E masuk mobil · Esc pause', 5);
  }
  if (hintTimer > 0 && dt) {
    hintTimer -= dt;
    if (hintTimer <= 0) hideHint();
  }

  // Dialog countdown.
  if (dialogTimer > 0 && dt) {
    dialogTimer -= dt;
    if (dialogTimer <= 0) hideDialog();
  }

  // Mission dialog lines queued by the mission runner.
  if (m.dialog && m.dialog.key !== lastDialogKey) {
    showDialog(m.dialog.speaker, m.dialog.text, m.dialog.seconds || 6);
  }
  return e;
}

function hideAllMenus() {
  const e = buildDOM();
  for (const key of ['menuStart', 'menuPause', 'menuHelp', 'menuComplete', 'menuFail', 'menuGameOver']) {
    if (e[key]) e[key].classList.add('hidden');
  }
  if (e.settingsPanel) e.settingsPanel.classList.add('hidden');
  // Full-screen menus cover the game, so the HUD hides under them.
  if (e.root) e.root.classList.add('hidden');
}

function wireButton(btn, label, handler) {
  if (!btn) return;
  btn.style.display = handler ? '' : 'none';
  if (label) btn.textContent = label;
  btn.onclick = handler || null;
}

export function showMenu(kind, data, callbacks) {
  const e = buildDOM();
  const cb = callbacks || {};
  const d = data || {};
  hideAllMenus();
  if (kind === 'start') {
    e.menuTitle.innerHTML = origMenuTitleHTML;
    e.menuSub.textContent = origMenuSubText;
    wireButton(e.btnContinue, d.hasSave ? 'Continue' : 'New Game', cb.onStart || null);
    wireButton(e.btnNewGame, 'New Game', d.hasSave ? cb.onNewGame || null : null);
    wireButton(e.btnHelp, 'How to Play', cb.onHelp || null);
    wireButton(e.btnSettings, 'Settings', () => {
      if (e.settingsPanel) e.settingsPanel.classList.toggle('hidden');
    });
    e.menuStart.classList.remove('hidden');
  } else if (kind === 'pause') {
    pauseCallbacks = cb;
    wireButton(e.btnResume, 'Resume', cb.onResume || null);
    wireButton(e.btnHelpPause, 'Controls', () => {
      showMenu('help', {}, { onBack: () => showMenu('pause', {}, pauseCallbacks || {}) });
    });
    wireButton(e.btnRestartMission, 'Restart Mission', cb.onRestartMission || null);
    wireButton(e.btnQuitMenu, 'Quit to Menu', cb.onQuit || null);
    e.menuPause.classList.remove('hidden');
  } else if (kind === 'complete') {
    e.completeReward.textContent = (d.title || 'Mission') + '  ·  +' + moneyText(d.reward || 0) + '  ·  +' + (d.respect || 0) + ' respect' + (d.next ? '  ·  Next: ' + d.next : '');
    wireButton(e.btnNextMission, 'Next Mission', cb.onContinue || null);
    e.menuComplete.classList.remove('hidden');
  } else if (kind === 'fail') {
    e.failReason.textContent = d.reason || 'Mara went down. The mission restarts from the last checkpoint.';
    wireButton(e.btnRetryMission, 'Retry from Checkpoint', cb.onRetry || null);
    e.menuFail.classList.remove('hidden');
  } else if (kind === 'gameover') {
    wireButton(e.btnRetryGameover, 'Retry from Checkpoint', cb.onRetry || null);
    wireButton(e.btnMenuGameover, 'Quit to Menu', cb.onQuit || null);
    e.menuGameOver.classList.remove('hidden');
  } else if (kind === 'help') {
    // Full controls screen in its own overlay (#help-menu in index.html).
    // Back returns via cb.onBack: to the title screen from the start menu,
    // to the pause menu from pause (wired above). Without a back handler
    // the button stays hidden rather than stranding the player.
    wireButton(e.btnBackHelp, 'Back', cb.onBack || null);
    e.menuHelp.classList.remove('hidden');
  }
  return e;
}

export function hideMenu() {
  hideAllMenus();
}

export function getHUD() {
  return buildDOM();
}
