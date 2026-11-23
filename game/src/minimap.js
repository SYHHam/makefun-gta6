// minimap.js: round 180px minimap, 300m across, rotating with the player.
// Draws roads, the beach, the player arrow, police dots, the mission
// objective, the workshop and the search boundary. Pure canvas 2D, no assets.
export const MINIMAP_SIZE = 180;
export const MINIMAP_RANGE_M = 300;

const ROAD_COLOR = '#3a3f4a';
const ROAD_EDGE = '#565d6d';
const BEACH_COLOR = '#d9c48f';
const SEA_COLOR = '#2f7fa8';
const BLOCK_COLOR = '#23262e';
const PLAYER_COLOR = '#ffd23f';
const POLICE_COLOR = '#3f8cff';
const TARGET_COLOR = '#ff4d6d';
const GARAGE_COLOR = '#4ade80';
const SEARCH_COLOR = 'rgba(255, 77, 109, 0.85)';

function worldToMap(wx, wz, state, cx, cy, scale, heading) {
  const dx = wx - state.player.pos.x;
  const dz = wz - state.player.pos.z;
  const cos = Math.cos(heading);
  const sin = Math.sin(heading);
  const rx = dx * cos - dz * sin;
  const rz = dx * sin + dz * cos;
  return { x: cx + rx * scale, y: cy + rz * scale };
}

export function drawMinimap(canvas, state) {
  if (!canvas || !state || !state.player || !state.player.pos) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const size = canvas.width || MINIMAP_SIZE;
  const cx = size / 2;
  const cy = size / 2;
  const radius = size / 2;
  const scale = size / MINIMAP_RANGE_M;
  const heading = state.player.heading || 0;

  ctx.clearRect(0, 0, size, size);
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.clip();

  // Base: city blocks.
  ctx.fillStyle = BLOCK_COLOR;
  ctx.fillRect(0, 0, size, size);

  // Sea and beach along the south edge (world z > 480 is beach, z > 540 sea).
  const sea = worldToMap(state.player.pos.x, 540, state, cx, cy, scale, heading);
  const beach = worldToMap(state.player.pos.x, 480, state, cx, cy, scale, heading);
  ctx.fillStyle = SEA_COLOR;
  ctx.fillRect(0, Math.min(sea.y, size), size, size);
  ctx.fillStyle = BEACH_COLOR;
  ctx.fillRect(0, Math.min(beach.y, size), size, Math.max(0, sea.y - beach.y));

  // Roads: main grid every 200m, local streets every 100m, 1200m world.
  ctx.strokeStyle = ROAD_COLOR;
  ctx.lineCap = 'round';
  for (let g = -600; g <= 600; g += 100) {
    const isMain = g % 200 === 0;
    ctx.lineWidth = isMain ? 9 : 5;
    const a = worldToMap(g, -600, state, cx, cy, scale, heading);
    const b = worldToMap(g, 600, state, cx, cy, scale, heading);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    const c = worldToMap(-600, g, state, cx, cy, scale, heading);
    const d = worldToMap(600, g, state, cx, cy, scale, heading);
    ctx.beginPath();
    ctx.moveTo(c.x, c.y);
    ctx.lineTo(d.x, d.y);
    ctx.stroke();
    if (isMain) {
      ctx.strokeStyle = ROAD_EDGE;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(c.x, c.y);
      ctx.lineTo(d.x, d.y);
      ctx.stroke();
      ctx.strokeStyle = ROAD_COLOR;
    }
  }

  // Search boundary: circle around lastSeen while wanted.
  if (state.wanted > 0 && state.lastSeen) {
    const p = worldToMap(state.lastSeen.x, state.lastSeen.z, state, cx, cy, scale, heading);
    ctx.strokeStyle = SEARCH_COLOR;
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.arc(p.x, p.y, 90 * scale, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Workshop (garage) marker.
  const garage = (state.world && state.world.garage) || { x: -400, z: -300 };
  const gp = worldToMap(garage.x, garage.z, state, cx, cy, scale, heading);
  ctx.fillStyle = GARAGE_COLOR;
  ctx.font = 'bold 13px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('G', gp.x, gp.y);

  // Mission objective marker.
  const target = missionTarget(state);
  if (target) {
    const tp = worldToMap(target.x, target.z, state, cx, cy, scale, heading);
    const pulse = 5 + Math.sin((state.time || 0) * 4) * 1.5;
    ctx.strokeStyle = TARGET_COLOR;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(tp.x, tp.y, pulse + 3, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = TARGET_COLOR;
    ctx.beginPath();
    ctx.arc(tp.x, tp.y, 3.5, 0, Math.PI * 2);
    ctx.fill();
  }

  // Police dots. state.police is the police state object {units: [...]}
  // from police.js (or a plain array in older callers).
  const policeUnits = Array.isArray(state.police)
    ? state.police
    : (state.police && Array.isArray(state.police.units) ? state.police.units : []);
  for (const unit of policeUnits) {
    if (!unit || !unit.pos) continue;
    const p = worldToMap(unit.pos.x, unit.pos.z, state, cx, cy, scale, heading);
    ctx.beginPath();
    ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
    ctx.fill();
  }

  // Player arrow, pointing up (map rotates with the player).
  ctx.fillStyle = PLAYER_COLOR;
  ctx.strokeStyle = '#1a1a1a';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(cx, cy - 9);
  ctx.lineTo(cx + 6, cy + 6);
  ctx.lineTo(cx, cy + 2.5);
  ctx.lineTo(cx - 6, cy + 6);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.restore();
  // Rim.
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(cx, cy, radius - 1, 0, Math.PI * 2);
  ctx.stroke();
}

function missionTarget(state) {
  const m = state.mission;
  if (!m || !m.active) return null;
  if (m.target) return m.target;
  const stage = (m.stages && m.stages[m.stage]) || null;
  if (stage && stage.target) return stage.target;
  return null;
}
