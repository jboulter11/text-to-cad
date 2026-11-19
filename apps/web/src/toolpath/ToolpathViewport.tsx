import { useEffect, useRef, useState } from 'react';
import {
  BufferAttribute, BufferGeometry, Color, LineBasicMaterial, LineSegments,
  PerspectiveCamera, Scene, Vector3, WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { toolColor } from './parse.js';

export type Layer = { z: number; paths: Float32Array };
type CameraView = 'top' | 'bottom';
type CameraState = { position: Vector3; target: Vector3 };
type ViewportProps = {
  layers: Layer[]; bounds: number[]; colors: string[]; index: number; cumulative: boolean; colorByFilament: boolean;
  view: { side: CameraView }; label: string; unavailable: string;
  cameraState: { current: CameraState | null };
};

export function ToolpathViewport({ layers, bounds, colors, index, cumulative, colorByFilament, view, label, unavailable, cameraState }: ViewportProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const runtime = useRef<{
    draw: () => void; geometry: BufferGeometry; camera: PerspectiveCamera; orbit: OrbitControls; ends: number[]; center: Vector3; distance: number;
  }>(null);
  const lastView = useRef(view);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const surface = canvas.current;
    if (!surface) return;
    let renderer: WebGLRenderer;
    try {
      renderer = new WebGLRenderer({ canvas: surface, antialias: true });
    } catch {
      setFailed(true);
      return;
    }
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    const [left, bottom, right, top] = bounds;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const { z } of layers) {
      minZ = Math.min(minZ, z);
      maxZ = Math.max(maxZ, z);
    }
    const center = new Vector3((left + right) / 2, (bottom + top) / 2, (minZ + maxZ) / 2);
    const span = Math.max(right - left, top - bottom, maxZ - minZ, 1);
    const distance = span * 1.8 * Math.max(1, surface.clientHeight / Math.max(surface.clientWidth, 1));
    const camera = new PerspectiveCamera(45, 1, 0.1, 5000);
    camera.up.set(0, 0, 1);
    camera.position.copy(cameraState.current?.position ??
      center.clone().add(new Vector3(distance * 0.6, -distance, distance * 0.8)));
    const orbit = new OrbitControls(camera, surface);
    orbit.target.copy(cameraState.current?.target ?? center);
    orbit.update();

    const length = layers.reduce((sum, layer) => sum + layer.paths.length / 5 * 6, 0);
    const positions = new Float32Array(length);
    const rgb = new Float32Array(length);
    const ends = [0];
    let cursor = 0;
    for (const { z, paths } of layers) {
      for (let i = 0; i < paths.length; i += 5) {
        positions.set([paths[i], paths[i + 1], z, paths[i + 2], paths[i + 3], z], cursor);
        cursor += 6;
      }
      ends.push(cursor / 3);
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(positions, 3));
    geometry.setAttribute('color', new BufferAttribute(rgb, 3));
    const material = new LineBasicMaterial({ vertexColors: true });
    const scene = new Scene();
    scene.background = new Color(0x101a23);
    scene.add(new LineSegments(geometry, material));
    let frame: number | null = null;
    const draw = () => {
      if (frame !== null) return;
      frame = requestAnimationFrame(() => {
        frame = null;
        renderer.render(scene, camera);
      });
    };
    const resize = () => {
      const width = surface.clientWidth;
      const height = surface.clientHeight;
      if (!width || !height) return;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
      draw();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(surface);
    orbit.addEventListener('change', draw);
    runtime.current = { draw, geometry, camera, orbit, ends, center, distance };
    resize();
    return () => {
      cameraState.current = { position: camera.position.clone(), target: orbit.target.clone() };
      if (frame !== null) cancelAnimationFrame(frame);
      observer.disconnect();
      orbit.dispose();
      geometry.dispose();
      material.dispose();
      renderer.dispose();
      runtime.current = null;
    };
  }, [layers, bounds, cameraState]);

  useEffect(() => {
    const current = runtime.current;
    if (!current) return;
    const attribute = current.geometry.getAttribute('color') as BufferAttribute;
    const maxZ = layers.reduce((max, layer) => Math.max(max, layer.z), 1);
    const palette = new Map<number, Color>();
    const height = new Color();
    let vertex = 0;
    for (const { z, paths } of layers) {
      height.setHSL(0.6 - 0.6 * z / maxZ, 0.8, 0.55);
      for (let i = 4; i < paths.length; i += 5) {
        const tool = paths[i];
        let color = height;
        if (colorByFilament) {
          const cached = palette.get(tool);
          color = cached ?? new Color(toolColor(colors, tool));
          if (!cached) palette.set(tool, color);
        }
        attribute.setXYZ(vertex++, color.r, color.g, color.b);
        attribute.setXYZ(vertex++, color.r, color.g, color.b);
      }
    }
    attribute.needsUpdate = true;
    current.draw();
  }, [layers, bounds, cameraState, colors, colorByFilament]);

  useEffect(() => {
    const current = runtime.current;
    if (!current) return;
    const start = cumulative ? 0 : current.ends[index];
    current.geometry.setDrawRange(start, current.ends[index + 1] - start);
    current.draw();
  }, [layers, bounds, cameraState, index, cumulative]);

  useEffect(() => {
    const current = runtime.current;
    if (!current || lastView.current === view) return;
    lastView.current = view;
    const { camera, orbit, center, distance } = current;
    const direction = view.side === 'bottom' ? -1 : 1;
    orbit.target.copy(center);
    camera.position.copy(center).add(new Vector3(0, -direction * distance * 0.0001, direction * distance));
    orbit.update();
    current.draw();
  }, [view, bounds]);

  return failed ? <p role="alert">{unavailable}</p> :
    <canvas ref={canvas} className="h-[min(67svh,44rem)] w-full touch-none rounded-md border" aria-label={label} />;
}
