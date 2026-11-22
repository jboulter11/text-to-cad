import {
  DoubleSide, Float32BufferAttribute, InstancedBufferGeometry,
  InstancedInterleavedBuffer, InterleavedBufferAttribute, ShaderMaterial,
} from 'three';

export function extrusionGeometry(positions: Float32Array, colors: Float32Array) {
  const geometry = new InstancedBufferGeometry();
  // Two semicircular ends form a capsule. Store longitudinal offsets separately
  // from endpoint selection so short moves keep their full bead width.
  const vertices: number[] = [], offsets: number[] = [], indices: number[] = [];
  const capSteps = 4;
  const ring = 2 * (capSteps + 1);
  for (const z of [0, 1]) {
    for (const endpoint of [1, 0]) {
      for (let i = 0; i <= capSteps; i++) {
        const angle = (endpoint ? -Math.PI / 2 : Math.PI / 2) + i * Math.PI / capSteps;
        vertices.push(endpoint, Math.sin(angle), z);
        offsets.push(Math.cos(angle));
      }
    }
  }
  for (let i = 1; i < ring - 1; i++) {
    indices.push(0, i + 1, i, ring, ring + i, ring + i + 1);
  }
  for (let i = 0; i < ring; i++) {
    const j = (i + 1) % ring;
    indices.push(i, j, j + ring, i, j + ring, i + ring);
  }
  geometry.setIndex(indices);
  geometry.setAttribute('position', new Float32BufferAttribute(vertices, 3));
  geometry.setAttribute('capOffset', new Float32BufferAttribute(offsets, 1));
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
    vertexShader: `
      uniform float radius;
      attribute vec3 segmentStart;
      attribute vec3 segmentEnd;
      attribute vec3 segmentColor;
      attribute float capOffset;
      varying vec3 pathColor;
      void main() {
        vec2 delta = segmentEnd.xy - segmentStart.xy;
        vec2 direction = delta / max(length(delta), 0.000001);
        vec2 perpendicular = vec2(-direction.y, direction.x);
        vec2 xy = mix(segmentStart.xy, segmentEnd.xy, position.x)
          + radius * (capOffset * direction + position.y * perpendicular);
        float z = mix(segmentEnd.z, segmentStart.z, position.z);
        pathColor = segmentColor * mix(0.78, 1.0, position.z);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(xy, z, 1.0);
      }
    `,
    fragmentShader: `
      varying vec3 pathColor;
      void main() {
        gl_FragColor = vec4(pathColor, 1.0);
        #include <colorspace_fragment>
      }
    `,
  });
}
