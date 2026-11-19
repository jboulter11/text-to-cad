import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@cad/ui/primitives/button';
import { Slider } from '@cad/ui/primitives/slider';
import { toolColor } from './parse.js';
import { ToolpathViewport, type Layer } from './ToolpathViewport';

type Source = { name: string; file: File } | { name: string; path: string };
type Preview = { plate: string; plates: string[]; layers: Layer[]; bounds: number[]; colors: string[]; lineWidth: number };
type Translate = (key: string, params?: Record<string, unknown>) => string;

export function linkedToolpath(search: string): Source | null {
  const path = new URLSearchParams(search).get('toolpath');
  if (!path || !/^(?:\/|[a-z]:[\\/]).*\.gcode(?:\.3mf)?$/i.test(path)) return null;
  return { name: path.split(/[\\/]/).pop() || path, path };
}

export function ToolpathView({ initialSource, open, close, t, onLocalFile }: {
  initialSource: Source | null; open: boolean; close?: () => void; t: Translate; onLocalFile: () => void;
}) {
  const [source, setSource] = useState(initialSource);
  const [requestedPlate, setRequestedPlate] = useState<string>();
  const [result, setResult] = useState<Preview | { error: string }>();
  const [selectedLayer, setSelectedLayer] = useState<number>();
  const [view, setView] = useState<{side: 'top' | 'bottom'}>({ side: 'top' });
  const [cumulative, setCumulative] = useState(true);
  const [colorByHeight, setColorByHeight] = useState(false);
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
  const index = selectedLayer ?? ((preview?.layers.length ?? 1) - 1);
  const layer = preview?.layers[index];
  const cameraState = useMemo(() => ({ current: null }), [preview]);
  const layerTools = useMemo(() => !colorByHeight ? preview?.layers.map(layer => {
    const tools = new Set<number>();
    for (let i = 4; i < layer.paths.length; i += 5) tools.add(layer.paths[i]);
    return tools;
  }) : undefined, [preview, colorByHeight]);
  const tools = cumulative ? new Set(layerTools?.slice(0, index + 1).flatMap(tools => [...tools])) : layerTools?.[index];

  if (!open) return null;
  return <section aria-label={t('menu.toolpath')} className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto bg-canvas p-3 sm:p-4">
    <div className="flex shrink-0 items-center justify-between gap-3">
      <h2 className="min-w-0 truncate text-sm font-medium">{source?.name ?? t('menu.toolpath')}</h2>
      {close && <Button variant="outline" size="sm" onClick={close}>{t('toolpath.close')}</Button>}
    </div>
    {!source && !result && <p className="text-sm text-muted-foreground">{t('toolpath.formats')}</p>}
    <input ref={picker} type="file" accept=".gcode,.gcode.3mf" hidden onChange={event => {
      const file = event.target.files?.[0];
      if (!file) return;
      onLocalFile();
      setSelectedLayer(undefined);
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
          setSelectedLayer(undefined);
          setResult(undefined);
          setRequestedPlate(event.target.value);
        }}>
          {preview.plates.map(plate => <option key={plate}>{plate}</option>)}
        </select>
      </label>}
      <ToolpathViewport layers={preview.layers} bounds={preview.bounds} colors={preview.colors}
        index={index} cumulative={cumulative} colorByHeight={colorByHeight} lineWidth={preview.lineWidth} view={view} cameraState={cameraState}
        label={t('toolpath.canvas')} unavailable={t('toolpath.webgl')} />
      <div className="flex shrink-0 items-center gap-3">
        <Slider className="flex-1" defaultValue={undefined} origin={undefined} min={0} max={Math.max(1, preview.layers.length - 1)} value={[index]}
          disabled={preview.layers.length < 2} onValueChange={([value]: number[]) => setSelectedLayer(value)}
          thumbProps={{ 'aria-label': t('toolpath.layer'), 'aria-valuetext': t('toolpath.layerHeight', { layer: index + 1, total: preview.layers.length, z: layer.z.toFixed(2) }) }} />
        <output className="shrink-0 tabular-nums">{t('toolpath.layerHeight', { layer: index + 1, total: preview.layers.length, z: layer.z.toFixed(2) })}</output>
      </div>
      {!colorByHeight && <div className="flex shrink-0 flex-wrap gap-3" aria-label={t('toolpath.filaments')}>
        {[...(tools ?? [])].sort((a,b) => a - b).map(tool => <span key={tool} className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm border border-current/30" aria-hidden="true" style={{ backgroundColor: toolColor(preview.colors, tool) }} />
          {t('toolpath.filament', { number: tool + 1 })}
        </span>)}
      </div>}
    </>}
    <div className="flex shrink-0 flex-wrap gap-2">
      <Button variant="outline" onClick={() => picker.current?.click()}>{t('toolpath.open')}</Button>
      {preview && <>
        <Button variant="outline" onClick={() => setView({ side: 'top' })}>{t('toolpath.resetView')}</Button>
        <Button variant="outline" onClick={() => setView({ side: 'bottom' })}>{t('toolpath.underside')}</Button>
        <Button variant={colorByHeight ? 'default' : 'outline'} aria-pressed={colorByHeight}
          onClick={() => setColorByHeight(value => !value)}>{t('toolpath.heightColors')}</Button>
        <Button variant={cumulative ? 'default' : 'outline'} aria-pressed={cumulative}
          onClick={() => setCumulative(value => !value)}>{t('toolpath.earlierLayers')}</Button>
      </>}
    </div>
  </section>;
}
