import assert from 'node:assert/strict';
import test from 'node:test';
import { parseToolpaths, toolColor } from './parse.js';

test('Bambu markers keep both filament colors on the layer through lifts and tool changes', () => {
  const result = parseToolpaths(`
G90
M83
G1 X0 Y0 E5
;VT1 H-1
; CHANGE_LAYER
; Z_HEIGHT: 0.2
G1 Z.2
; FEATURE: Outer wall
G1 X2 E.2
G1 Z.6
M621 S0A B
G1 Z.2
G1 X3 E.2
G1 E-.5
G1 X4 E-.2
; CHANGE_LAYER
; Z_HEIGHT: 0.36
G1 Z.36
G1 Y3 E.2
; MACHINE_END_GCODE_START
G1 X9 E5
`, ['#057748', '#0d6284']);
  assert.deepEqual(result.layers.map(layer => layer.z), [0.2, 0.36]);
  assert.deepEqual([...result.layers[0].paths], [0, 0, 2, 0, 1, 2, 0, 3, 0, 0]);
  assert.deepEqual([...result.layers[1].paths], [4, 0, 4, 3, 0]);
  assert.deepEqual(result.bounds, [0, 0, 4, 3]);
  assert.equal(toolColor(result.colors, 1), '#0d6284');
});

test('plain G-code uses deposition Z and recognizes absolute extrusion and arcs', () => {
  const result = parseToolpaths(`
G90
M82
G1 X1 Y1 Z.2
G1 X2 E1
G1 X3 E.8
G92 E0
G1 Z.4
G3 X4 Y1 I.5 J0 E1
`);
  assert.equal(result.layers.length, 2);
  assert.deepEqual([...result.layers[0].paths], [1, 1, 2, 1, 0]);
  assert.ok(result.layers[1].paths.length > 10);
  assert.deepEqual([...result.layers[1].paths.slice(-3)], [4, 1, 0]);
  assert.throws(() => parseToolpaths('G1 X10 Y10\nG1 E-2'), /noExtrusion/);
});

test('seams mark near-closed outer wall loops, excluding infill, travel, and open wall fragments', () => {
  const gcode = `M83
;LAYER_CHANGE
G1 Z0.2
;TYPE:External perimeter
G1 X3 E0.1
G1 Y3 E0.1
G1 X0 E0.1
G1 Y0.06 E0.1
G0 X10 Y10
G1 X15 E0.1
;TYPE:Internal infill
G1 X10 E0.1
;LAYER_CHANGE
G1 Z0.4
; FEATURE: Outer wall
G1 X17 E0.1
G1 Y12 E0.1
G1 X10 E0.1
G1 Y10 E0.1`;
  assert.deepEqual(parseToolpaths(gcode).layers.map(layer => [...layer.seams]), [[0, 0], [10, 10]]);
});
