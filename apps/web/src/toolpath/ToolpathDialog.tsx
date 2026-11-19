import { useEffect, useRef, useState } from 'react';
import { Button } from '@cad/ui/primitives/button';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@cad/ui/primitives/dialog';
import { Slider } from '@cad/ui/primitives/slider';
import { toolColor } from './parse.js';

type Source = { name: string; file: File } | { name: string; path: string };
type Layer = { z: number; paths: Float32Array };
type Preview = { plate: string; plates: string[]; layers: Layer[]; bounds: number[]; colors: string[] };
type Translate = (key: string, params?: Record<string, unknown>) => string;

export function linkedToolpath(search: string): Source | null {
  const path = new URLSearchParams(search).get('toolpath');
  if (!path || !/^(?:\/|[a-z]:[\\/]).*\.gcode\.3mf$/i.test(path)) return null;
  return { name: path.split(/[\\/]/).pop() || path, path };
}

export function ToolpathDialog({ initialSource, close, t }: {
  initialSource: Source | null; close: () => void; t: Translate;
}) {
  const [source, setSource] = useState(initialSource);
  const [requestedPlate, setRequestedPlate] = useState<string>();
  const [result, setResult] = useState<Preview | { error: string }>();
  const [index, setIndex] = useState(0);
  const [underside, setUnderside] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);
  const picker = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!source) return;
    const worker = new Worker(new URL('./toolpath.worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = ({ data }) => setResult(data);
    worker.onerror = () => setResult({ error: 'readError' });
    worker.postMessage({ ...source, plate: requestedPlate });
    return () => worker.terminate();
  }, [source, requestedPlate]);

  const preview = result && !('error' in result) ? result : null;
  const layer = preview?.layers[index];
  useEffect(() => {
    if (!canvas.current || !preview || !layer) return;
    const surface = canvas.current;
    const draw = () => {
      const { width, height } = surface.getBoundingClientRect();
      const pixelRatio = Math.min(devicePixelRatio, 2);
      surface.width = Math.round(width * pixelRatio);
      surface.height = Math.round(height * pixelRatio);
      const context = surface.getContext('2d');
      if (!context) return;
      const [left, bottom, right, top] = preview.bounds;
      const scale = 0.9 * Math.min(surface.width / Math.max(1, right - left), surface.height / Math.max(1, top - bottom));
      const xScale = underside ? -scale : scale;
      context.setTransform(xScale, 0, 0, -scale,
        (surface.width - xScale * (left + right)) / 2, (surface.height + scale * (top + bottom)) / 2);
      context.lineWidth = Math.max(0.38, pixelRatio / scale);
      context.lineCap = 'round';
      const paths = layer.paths;
      let tool = -1;
      context.beginPath();
      for (let i = 0; i < paths.length; i += 5) {
        if (paths[i + 4] !== tool) {
          context.stroke();
          context.beginPath();
          tool = paths[i + 4];
          context.strokeStyle = toolColor(preview.colors, tool);
        }
        context.moveTo(paths[i], paths[i + 1]);
        context.lineTo(paths[i + 2], paths[i + 3]);
      }
      context.stroke();
    };
    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(surface);
    return () => observer.disconnect();
  }, [preview, layer, underside]);

  const tools = new Set<number>();
  if (layer) for (let i = 4; i < layer.paths.length; i += 5) tools.add(layer.paths[i]);

  return <Dialog open onOpenChange={open => { if (!open) close(); }}>
    <DialogContent className="max-h-[calc(100svh-2rem)] max-w-[min(40rem,calc(100%-2rem))] overflow-y-auto">
      <DialogHeader>
        <DialogTitle>{t('menu.toolpath')}</DialogTitle>
        <DialogDescription>{source?.name ?? t('toolpath.formats')}</DialogDescription>
      </DialogHeader>
      <input ref={picker} type="file" accept=".gcode,.gcode.3mf" hidden onChange={event => {
        const file = event.target.files?.[0];
        if (!file) return;
        setIndex(0);
        setRequestedPlate(undefined);
        setUnderside(false);
        if (!/\.(?:gcode|gcode\.3mf)$/i.test(file.name)) {
          setSource(null);
          setResult({ error: 'readError' });
        } else {
          setResult(undefined);
          setSource({ name: file.name, file });
        }
        event.target.value = '';
      }} />
      {source && !result && <p role="status">{t('toolpath.loading')}</p>}
      {result && 'error' in result && <p role="alert">{t('toolpath.' + result.error)}</p>}
      {preview && layer && <>
        {preview.plates.length > 1 && <label className="flex items-center gap-2">{t('toolpath.plate')}
          <select className="rounded-md border bg-background px-2 py-1" value={preview.plate} onChange={event => {
            setIndex(0);
            setResult(undefined);
            setRequestedPlate(event.target.value);
          }}>
            {preview.plates.map(plate => <option key={plate}>{plate}</option>)}
          </select>
        </label>}
        <canvas ref={canvas} className="h-[min(54svh,28rem)] w-full rounded-md border bg-background" aria-label={t('toolpath.canvas')} />
        <div className="flex items-center gap-3">
          <Slider className="flex-1" defaultValue={undefined} origin={undefined} min={0} max={Math.max(1, preview.layers.length - 1)} value={[index]}
            disabled={preview.layers.length < 2} onValueChange={([value]: number[]) => setIndex(value)}
            thumbProps={{ 'aria-label': t('toolpath.layer'), 'aria-valuetext': t('toolpath.layerHeight', { layer: index + 1, total: preview.layers.length, z: layer.z.toFixed(2) }) }} />
          <output className="shrink-0 tabular-nums">{t('toolpath.layerHeight', { layer: index + 1, total: preview.layers.length, z: layer.z.toFixed(2) })}</output>
        </div>
        <div className="flex flex-wrap gap-3" aria-label={t('toolpath.filaments')}>
          {[...tools].sort((a,b) => a - b).map(tool => <span key={tool} className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-sm border border-current/30" aria-hidden="true" style={{ backgroundColor: toolColor(preview.colors, tool) }} />
            {t('toolpath.filament', { number: tool + 1 })}
          </span>)}
        </div>
      </>}
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={() => picker.current?.click()}>{t('toolpath.open')}</Button>
        {preview && <Button variant={underside ? 'default' : 'outline'} aria-pressed={underside}
          onClick={() => setUnderside(value => !value)}>{t('toolpath.underside')}</Button>}
        <DialogClose asChild><Button variant="outline" className="ml-auto">{t('toolpath.close')}</Button></DialogClose>
      </div>
    </DialogContent>
  </Dialog>;
}
