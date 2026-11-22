const layerMarker = /^;\s*(?:CHANGE_LAYER|LAYER_CHANGE|LAYER:\d+)\b/im;
const axisWords = /([XYZEFIJR])([+-]?(?:\d+(?:\.\d*)?|\.\d+))/gi;
const fallback = ['#45966d', '#318fbc', '#bd733a', '#a964b5'];
const maxSegments = 2_000_000;

export function toolColor(colors, tool) {
  return /^#[0-9a-f]{6}$/i.test(colors[tool]) ? colors[tool] : fallback[tool % fallback.length];
}

/** Extrusion moves grouped by slicer layer, or by deposition height in unmarked files. */
export function parseToolpaths(text, colors = []) {
  const marked = layerMarker.test(text);
  const layers = [];
  const axes = { X: 0, Y: 0, Z: 0, E: 0 };
  let relative = false, relativeE = null, unit = 1, tool = 0, skipFeature = false;
  let layer = null, count = 0;
  const bounds = [Infinity, Infinity, -Infinity, -Infinity];

  let outerWall = false;
  let wall = null;

  function finishWall() {
    // Slicers can leave a small seam gap between the first and last bead.
    if (wall && wall.length > 2 && Math.hypot(wall.x - wall.endX, wall.y - wall.endY) <= 0.8) {
      wall.layer.seams.push(wall.x, wall.y);
    }
    wall = null;
  }

  function add(x, y, nextX, nextY) {
    if (x === nextX && y === nextY) return;
    if (++count > maxSegments) throw new Error('tooComplex');
    if (outerWall) {
      wall ??= { layer, x, y, endX: x, endY: y, length: 0 };
      wall.endX = nextX;
      wall.endY = nextY;
      wall.length += Math.hypot(nextX - x, nextY - y);
    }
    bounds[0] = Math.min(bounds[0], x, nextX);
    bounds[1] = Math.min(bounds[1], y, nextY);
    bounds[2] = Math.max(bounds[2], x, nextX);
    bounds[3] = Math.max(bounds[3], y, nextY);
    layer.paths.push(x, y, nextX, nextY, tool);
  }

  for (const [raw] of text.matchAll(/[^\r\n]+/g)) {
    const line = raw.trim();
    if (line.startsWith(';')) {
      if (line === '; MACHINE_END_GCODE_START') break;
      if (layerMarker.test(line)) {
        finishWall();
        outerWall = false;
        layer = { z: null, paths: [], seams: [] };
        layers.push(layer);
        skipFeature = false;
      }
      const height = /^;\s*(?:Z_HEIGHT:|Z:)\s*([\d.]+)/i.exec(line);
      if (layer && height) layer.z = Number(height[1]);
      const filament = /^;\s*VT(\d+)\b/.exec(line);
      if (filament) tool = Number(filament[1]);
      const feature = /^;\s*(?:FEATURE|TYPE):\s*(.*)/.exec(line);
      if (feature) {
        finishWall();
        outerWall = /^(Outer wall|External perimeter|WALL-OUTER)$/i.test(feature[1]);
        skipFeature = feature[1] === 'Custom' || feature[1] === 'Wipe';
      }
      const colorLine = /^;\s*filament_colou?r\s*=\s*(.*)/i.exec(line);
      if (colorLine && !colors.length) colors = colorLine[1].split(';').map(value => value.trim());
      continue;
    }

    const code = line.split(';', 1)[0].trim();
    const selected = /^(?:T(\d+)\b|M621\s+S(\d+)A\b)/i.exec(code);
    if (selected) {
      finishWall();
      const candidate = Number(selected[1] ?? selected[2]);
      if (candidate < 255) tool = candidate;
      continue;
    }
    const command = /^[GM]\d+\b/i.exec(code)?.[0].toUpperCase();
    if (!command) continue;
    if (command === 'M82' || command === 'M83') {
      relativeE = command === 'M83';
      continue;
    }
    if (command === 'G90' || command === 'G91') {
      relative = command === 'G91';
      continue;
    }
    if (command === 'G20' || command === 'G21') {
      unit = command === 'G20' ? 25.4 : 1;
      continue;
    }
    if (!['G0', 'G1', 'G2', 'G3', 'G92'].includes(command)) continue;
    const values = Object.fromEntries([...code.matchAll(axisWords)].map(([, axis, value]) => [axis.toUpperCase(), Number(value) * unit]));
    if (command === 'G92') {
      for (const axis of ['X', 'Y', 'Z', 'E']) if (axis in values) axes[axis] = values[axis];
      continue;
    }
    const { X: x, Y: y } = axes;
    const e = values.E == null ? 0 : (relativeE ?? relative) ? values.E : values.E - axes.E;
    for (const axis of ['X', 'Y', 'Z']) if (axis in values) axes[axis] = values[axis] + (relative ? axes[axis] : 0);
    if ('E' in values && !(relativeE ?? relative)) axes.E = values.E;
    if (e <= 0 && (axes.X !== x || axes.Y !== y || e < 0)) finishWall();
    if (e <= 0 || skipFeature || (marked && !layer)) continue;
    if (!layer || (!marked && Math.abs(layer.z - axes.Z) > 0.001)) {
      finishWall();
      layer = { z: axes.Z, paths: [], seams: [] };
      layers.push(layer);
    }
    layer.z ??= axes.Z;

    if (command === 'G2' || command === 'G3') {
      const arc = arcGeometry(x, y, axes.X, axes.Y, values, command === 'G2');
      if (!arc) continue;
      const { cx, cy, radius, angle, sweep } = arc;
      const steps = Math.min(192, Math.max(2, Math.ceil(Math.abs(sweep) * Math.max(radius / 0.6, 7))));
      let previousX = x, previousY = y;
      for (let i = 1; i <= steps; i++) {
        const nextX = i === steps ? axes.X : cx + radius * Math.cos(angle + sweep * i / steps);
        const nextY = i === steps ? axes.Y : cy + radius * Math.sin(angle + sweep * i / steps);
        add(previousX, previousY, nextX, nextY);
        previousX = nextX; previousY = nextY;
      }
    } else {
      add(x, y, axes.X, axes.Y);
    }
  }
  finishWall();
  if (!count) throw new Error('noExtrusion');
  const rendered = layers.filter(entry => entry.paths.length).map(entry => ({
    z: entry.z, paths: Float32Array.from(entry.paths), seams: Float32Array.from(entry.seams),
  }));
  return { layers: rendered, bounds, colors };
}

function arcGeometry(x, y, endX, endY, values, clockwise) {
  let cx = x + (values.I ?? 0), cy = y + (values.J ?? 0);
  if (values.R != null) {
    const dx = endX - x, dy = endY - y;
    const distance = Math.hypot(dx, dy);
    const height = Math.sqrt(Math.max(0, values.R ** 2 - distance ** 2 / 4));
    if (!distance) return null;
    const side = (clockwise ? -1 : 1) * Math.sign(values.R);
    cx = (x + endX) / 2 - dy / distance * height * side;
    cy = (y + endY) / 2 + dx / distance * height * side;
  }
  const radius = Math.hypot(x - cx, y - cy);
  if (!radius) return null;
  const angle = Math.atan2(y - cy, x - cx);
  let sweep = Math.atan2(endY - cy, endX - cx) - angle;
  if (clockwise && sweep >= 0) sweep -= 2 * Math.PI;
  if (!clockwise && sweep <= 0) sweep += 2 * Math.PI;
  return { cx, cy, radius, angle, sweep };
}
