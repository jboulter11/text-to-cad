import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@cad/ui/primitives/button';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@cad/ui/primitives/dialog';
import { Slider } from '@cad/ui/primitives/slider';
import { toolColor } from './parse.js';
import { ToolpathViewport, type Layer } from './ToolpathViewport';

type Source = { name: string; file: File } | { name: string; path: string };
type Preview = { plate: string; plates: string[]; layers: Layer[]; bounds: number[]; colors: string[] };
type Translate = (key: string, params?: Record<string, unknown>) => string;

export function linkedToolpath(search: string): Source | null {
  const path = new URLSearchParams(search).get('toolpath');
  if (!path || !/^(?:\/|[a-z]:[\\/]).*\.gcode\.3mf$/i.test(path)) return null;
  return { name: path.split(/[\\/]/).pop() || path, path };
}

export function ToolpathDialog({ initialSource, open, hasModel, close, t }: {
  initialSource: Source | null; open: boolean; hasModel: boolean; close: () => void; t: Translate;
}) {
  const [source, setSource] = useState(initialSource);
  const [requestedPlate, setRequestedPlate] = useState<string>();
  const [result, setResult] = useState<Preview | { error: string }>();
  const [index, setIndex] = useState(0);
  const [view, setView] = useState<{side: 'top' | 'bottom'}>({ side: 'top' });
  const [cumulative, setCumulative] = useState(false);
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
  const cameraState = useMemo(() => ({ current: null }), [preview]);
  const tools = new Set<number>();
  if (layer) for (let i = 4; i < layer.paths.length; i += 5) tools.add(layer.paths[i]);

  return <Dialog open={open} onOpenChange={open => { if (!open) close(); }}>
    <DialogContent className="max-h-[calc(100svh-2rem)] max-w-[min(68rem,calc(100%-2rem))] overflow-y-auto">
      <DialogHeader>
        <DialogTitle>{t('menu.toolpath')}</DialogTitle>
        <DialogDescription>{source?.name ?? t('toolpath.formats')}</DialogDescription>
      </DialogHeader>
      <input ref={picker} type="file" accept=".gcode,.gcode.3mf" hidden onChange={event => {
        const file = event.target.files?.[0];
        if (!file) return;
        setIndex(0);
        setRequestedPlate(undefined);
        setView({ side: 'top' });
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
        <ToolpathViewport layers={preview.layers} bounds={preview.bounds} colors={preview.colors}
          index={index} cumulative={cumulative} view={view} cameraState={cameraState}
          label={t('toolpath.canvas')} unavailable={t('toolpath.webgl')} />
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
        {preview && <>
          <Button variant="outline" onClick={() => setView({ side: 'top' })}>{t('toolpath.resetView')}</Button>
          <Button variant="outline" onClick={() => setView({ side: 'bottom' })}>{t('toolpath.underside')}</Button>
          <Button variant={cumulative ? 'default' : 'outline'} aria-pressed={cumulative}
            onClick={() => setCumulative(value => !value)}>{t('toolpath.earlierLayers')}</Button>
        </>}
        <DialogClose asChild><Button variant="outline" className="ml-auto">{t(hasModel ? 'toolpath.model' : 'toolpath.close')}</Button></DialogClose>
      </div>
    </DialogContent>
  </Dialog>;
}
