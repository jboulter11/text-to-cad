import {
  DoubleSide, Float32BufferAttribute, InstancedBufferGeometry,
  InstancedInterleavedBuffer, InterleavedBufferAttribute, ShaderMaterial,
} from 'three';

export function extrusionGeometry(positions: Float32Array, colors: Float32Array) {
  const geometry = new InstancedBufferGeometry();
  geometry.setIndex([0, 1, 2, 2, 1, 3]);
  geometry.setAttribute('position', new Float32BufferAttribute([
    0, -1, 0, 1, -1, 0, 0, 1, 0, 1, 1, 0,
  ], 3));

  const endpoints = new InstancedInterleavedBuffer(positions, 6);
  geometry.setAttribute('segmentStart', new InterleavedBufferAttribute(endpoints, 3, 0));
  geometry.setAttribute('segmentEnd', new InterleavedBufferAttribute(endpoints, 3, 3));
  geometry.setAttribute('segmentColor', new InterleavedBufferAttribute(new InstancedInterleavedBuffer(colors, 3), 3, 0));
  geometry.instanceCount = endpoints.count;
  return geometry;
}

export function extrusionMaterial(width: number) {
  return new ShaderMaterial({
    side: DoubleSide,
    uniforms: { radius: { value: width / 2 } },
    // Each path is a single capsule lying flat on its sliced layer.
    vertexShader: `
      uniform float radius;
      attribute vec3 segmentStart;
      attribute vec3 segmentEnd;
      attribute vec3 segmentColor;
      varying vec3 pathColor;
      varying vec2 pathPoint;
      varying float end;
      void main() {
        vec2 delta = segmentEnd.xy - segmentStart.xy;
        float distance = length(delta);
        vec2 direction = delta / max(distance, 0.000001);
        vec2 perpendicular = vec2(-direction.y, direction.x);
        float along = mix(-radius, distance + radius, position.x);
        vec2 offset = along * direction + position.y * radius * perpendicular;
        pathColor = segmentColor;
        pathPoint = vec2(along / radius, position.y);
        end = distance / radius;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(segmentStart + vec3(offset, 0.0), 1.0);
      }
    `,
    fragmentShader: `
      varying vec3 pathColor;
      varying vec2 pathPoint;
      varying float end;
      void main() {
        float cap = max(max(-pathPoint.x, pathPoint.x - end), 0.0);
        if (cap * cap + pathPoint.y * pathPoint.y > 1.0) discard;
        gl_FragColor = vec4(pathColor, 1.0);
        #include <colorspace_fragment>
      }
    `,
  });
}
