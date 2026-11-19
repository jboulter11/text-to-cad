import assert from 'node:assert/strict';
import test from 'node:test';
import { strToU8, zipSync } from 'three/addons/libs/fflate.module.js';

test('sliced Bambu archives select a plate and read the project color settings', async () => {
  let result;
  globalThis.self = { postMessage: message => { result = message; } };
  try {
    await import('./toolpath.worker.js');
    const name = 'plate.gcode.3mf';
    const gcode = z => strToU8(`M83\n; CHANGE_LAYER\n; Z_HEIGHT: ${z}\nG1 X3 E.4\n`);
    const file = new Blob([zipSync({
      'Metadata/plate_1.gcode': gcode(0.2),
      'Metadata/plate_2.gcode': gcode(0.3),
      'Metadata/project_settings.config': strToU8('{"filament_colour":["#057748","#0D6284"]}'),
      '3D/3dmodel.model': strToU8('model mesh is outside the toolpath reader'),
    })]);
    await self.onmessage({ data: { name, file, plate: '2' } });
    assert.deepEqual(result.plates, ['1', '2']);
    assert.equal(result.plate, '2');
    assert.equal(result.layers[0].z, 0.3);
    assert.deepEqual(result.colors, ['#057748', '#0D6284']);

    await self.onmessage({ data: { name, file: new Blob(['bad ZIP']) } });
    assert.equal(result.error, 'readError');
  } finally {
    delete globalThis.self;
  }
});
