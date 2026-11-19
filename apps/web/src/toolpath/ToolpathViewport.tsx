import { useEffect, useRef, useState } from 'react';
import {
  BufferAttribute, BufferGeometry, Color, LineBasicMaterial, LineSegments,
  OrthographicCamera, Scene, Vector3, WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { toolColor } from './parse.js';

export type Layer = { z: number; paths: Float32Array };
type CameraView = 'top' | 'bottom';
type CameraState = { position: Vector3; target: Vector3; zoom: number };
type ViewportProps = {
  layers: Layer[]; bounds: number[]; colors: string[]; index: number; cumulative: boolean;
  view: { side: CameraView }; label: string; unavailable: string;
  cameraState: { current: CameraState | null };
};

export function ToolpathViewport({ layers, bounds, colors, index, cumulative, view, label, unavailable, cameraState }: ViewportProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const runtime = useRef<{
    draw: () => void; geometry: BufferGeometry; camera: OrthographicCamera; orbit: OrbitControls; ends: number[]; span: number;
  }>(null);
  const lastView = useRef(view);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const surface = canvas.current;
    if (!surface) return;
    let renderer: WebGLRenderer;
    try {
      renderer = new WebGLRenderer({ canvas: surface, alpha: true, antialias: true });
    } catch {
      setFailed(true);
      return;
    }
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    const [left, bottom, right, top] = bounds;
    const span = Math.max(right - left, top - bottom, 1) * 1.12;
    const center = new Vector3((left + right) / 2, (bottom + top) / 2, 0);
    const camera = new OrthographicCamera(-span / 2, span / 2, span / 2, -span / 2, 0.01, span * 8);
    camera.up.set(0, 1, 0);
    camera.position.copy(cameraState.current?.position ?? center.clone().add(new Vector3(0, 0, span * 2)));
    camera.zoom = cameraState.current?.zoom ?? 1;
    const orbit = new OrbitControls(camera, surface);
    orbit.target.copy(cameraState.current?.target ?? center);
    orbit.minZoom = 0.3;
    orbit.maxZoom = 85;
    orbit.zoomToCursor = true;
    orbit.update();

    const length = layers.reduce((sum, layer) => sum + layer.paths.length / 5 * 6, 0);
    const positions = new Float32Array(length);
    const rgb = new Float32Array(length);
    const palette = new Map<number, Color>();
    const ends = [0];
    let cursor = 0;
    for (const layer of layers) {
      const paths = layer.paths;
      for (let i = 0; i < paths.length; i += 5) {
        const tool = paths[i + 4];
        let color = palette.get(tool);
        if (!color) {
          color = new Color(toolColor(colors, tool));
          palette.set(tool, color);
        }
        positions.set([paths[i], paths[i + 1], layer.z, paths[i + 2], paths[i + 3], layer.z], cursor);
        rgb.set([color.r, color.g, color.b, color.r, color.g, color.b], cursor);
        cursor += 6;
      }
      ends.push(cursor / 3);
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(positions, 3));
    geometry.setAttribute('color', new BufferAttribute(rgb, 3));
    const material = new LineBasicMaterial({ vertexColors: true });
    const scene = new Scene();
    scene.add(new LineSegments(geometry, material));
    const draw = () => renderer.render(scene, camera);
    const resize = () => {
      const width = surface.clientWidth;
      const height = surface.clientHeight;
      if (!width || !height) return;
      const halfY = span / 2 * Math.max(1, height / width);
      const halfX = halfY * width / height;
      camera.left = -halfX;
      camera.right = halfX;
      camera.top = halfY;
      camera.bottom = -halfY;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
      draw();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(surface);
    orbit.addEventListener('change', draw);
    runtime.current = { draw, geometry, camera, orbit, ends, span };
    resize();
    return () => {
      cameraState.current = { position: camera.position.clone(), target: orbit.target.clone(), zoom: camera.zoom };
      observer.disconnect();
      orbit.dispose();
      geometry.dispose();
      material.dispose();
      renderer.dispose();
      runtime.current = null;
    };
  }, [layers, bounds, colors, cameraState]);

  useEffect(() => {
    const current = runtime.current;
    if (!current) return;
    const start = cumulative ? 0 : current.ends[index];
    current.geometry.setDrawRange(start, current.ends[index + 1] - start);
    current.draw();
  }, [layers, index, cumulative]);

  useEffect(() => {
    const current = runtime.current;
    if (!current || lastView.current === view) return;
    lastView.current = view;
    const { camera, orbit, span } = current;
    orbit.target.set((bounds[0] + bounds[2]) / 2, (bounds[1] + bounds[3]) / 2, 0);
    camera.position.copy(orbit.target).add(new Vector3(0, 0, (view.side === 'bottom' ? -2 : 2) * span));
    camera.zoom = 1;
    camera.updateProjectionMatrix();
    orbit.update();
    current.draw();
  }, [view, bounds]);

  return failed ? <p role="alert">{unavailable}</p> :
    <canvas ref={canvas} className="h-[min(67svh,44rem)] w-full touch-none rounded-md border bg-background" aria-label={label} />;
}
