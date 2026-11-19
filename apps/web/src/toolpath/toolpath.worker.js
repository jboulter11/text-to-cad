import { unzipSync } from 'three/addons/libs/fflate.module.js';
import { parseToolpaths } from './parse.js';

const byteLimit = 64 * 1024 * 1024;
const plateName = /^Metadata\/plate_(\d+)\.gcode$/i;

self.onmessage = async ({ data }) => {
  try {
    const file = data.file ?? await fetchArchive(data.path);
    if (file.size > byteLimit) throw new Error('tooLarge');
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (!data.name.toLowerCase().endsWith('.gcode.3mf')) {
      sendPlate('1', new TextDecoder().decode(bytes), []);
      return;
    }
    let size = 0;
    const files = unzipSync(bytes, { filter: entry => {
      if (!plateName.test(entry.name) && entry.name !== 'Metadata/project_settings.config') return false;
      size += entry.originalSize;
      if (size > byteLimit) throw new Error('tooLarge');
      return true;
    } });
    const plates = Object.keys(files).map(name => plateName.exec(name)?.[1]).filter(Boolean)
      .sort((a,b) => Number(a) - Number(b));
    if (!plates.length) throw new Error('noExtrusion');
    let colors = [];
    const settings = files['Metadata/project_settings.config'];
    if (settings) {
      const config = JSON.parse(new TextDecoder().decode(settings));
      if (Array.isArray(config.filament_colour)) colors = config.filament_colour;
    }
    const selected = plates.includes(data.plate) ? data.plate : plates[0];
    const member = Object.keys(files).find(name => plateName.exec(name)?.[1] === selected);
    sendPlate(selected, new TextDecoder().decode(files[member]), colors, plates);
  } catch (error) {
    const known = ['tooLarge', 'tooComplex', 'noExtrusion', 'readError'];
    self.postMessage({ error: known.includes(error.message) ? error.message : 'readError' });
  }
};

function sendPlate(plate, text, colors, plates = ['1']) {
  const result = parseToolpaths(text, colors);
  self.postMessage({ plate, plates, ...result }, result.layers.map(layer => layer.paths.buffer));
}

async function fetchArchive(path) {
  const params = new URLSearchParams({ path });
  const response = await fetch('/api/v1/local/files?' + params);
  if (!response.ok) throw new Error('readError');
  if (Number(response.headers.get('content-length')) > byteLimit) throw new Error('tooLarge');
  const chunks = [];
  let received = 0;
  const reader = response.body.getReader();
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > byteLimit) {
        await reader.cancel();
        throw new Error('tooLarge');
      }
      chunks.push(value);
    }
    return new Blob(chunks);
  } finally {
    reader.releaseLock();
  }
}
