// The music room's HDR light (P6-06). On a screen that shows more than paper white, in a browser
// whose WebGPU canvas can draw it ("extended" tone mapping, Chrome 129 and later), the player
// piano's lights are drawn a second time on a canvas laid over the room, brighter than white: the
// holes at the tracker bar, a key that plays, the pedal's light, the gold bar itself. The room
// underneath is drawn as everywhere else, so where this layer cannot be made nothing changes.
// Plain WebGPU, no library; the browser confirms the tone mapping before the layer is used.
import type { Vec3 } from './wide';

/** One light, in the canvas's CSS px. */
export interface Light {
  /** The bright core. */
  x: number;
  y: number;
  w: number;
  h: number;
  radius: number;
  /** How far the light spreads outside the core, in px. */
  soft: number;
  /** The colour as `hdrColour` gives it: past 1 is brighter than white. */
  colour: Vec3;
  /** Brightest at the bottom of the core, fading out towards its top. */
  fade?: boolean;
}

export interface HdrLayer {
  draw(lights: readonly Light[], width: number, height: number): void;
  destroy(): void;
}

/** More lights than this in one frame are left out (a dense chord with the pedal is about 40). */
const MAX_LIGHTS = 512;
/** Floats per light in the instance buffer: box 4, colour 3 + fade 1, radius, soft, 2 spare. */
const STRIDE = 12;

const SHADER = /* wgsl */ `
struct Uniforms { size: vec2f, pad: vec2f };
@group(0) @binding(0) var<uniform> u: Uniforms;

struct Out {
  @builtin(position) position: vec4f,
  @location(0) local: vec2f,
  @location(1) half: vec2f,
  @location(2) colour: vec4f,
  @location(3) shape: vec2f,
};

@vertex
fn vs(
  @builtin(vertex_index) i: u32,
  @location(0) box: vec4f,
  @location(1) colour: vec4f,
  @location(2) shape: vec4f,
) -> Out {
  var corners = array<vec2f, 6>(
    vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0),
    vec2f(-1.0, 1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0),
  );
  let corner = corners[i];
  let half = box.zw * 0.5;
  let reach = half + vec2f(shape.y);
  let p = box.xy + half + corner * reach;
  var o: Out;
  o.position = vec4f(p.x / u.size.x * 2.0 - 1.0, 1.0 - p.y / u.size.y * 2.0, 0.0, 1.0);
  o.local = corner * reach;
  o.half = half;
  o.colour = colour;
  o.shape = shape.xy;
  return o;
}

fn roundedBox(p: vec2f, half: vec2f, r: f32) -> f32 {
  let q = abs(p) - half + vec2f(r);
  return length(max(q, vec2f(0.0))) + min(max(q.x, q.y), 0.0) - r;
}

@fragment
fn fs(o: Out) -> @location(0) vec4f {
  let r = min(o.shape.x, min(o.half.x, o.half.y));
  let d = roundedBox(o.local, o.half, r);
  // Full inside the core, falling off smoothly over the spread outside it.
  var cover = 1.0 - smoothstep(0.0, max(o.shape.y, 0.75), d);
  if (o.colour.a > 0.5) {
    // Brightest at the bottom of the core.
    let t = clamp((o.local.y + o.half.y) / max(2.0 * o.half.y, 1.0), 0.0, 1.0);
    cover = cover * t * t;
  }
  // Light adds to what is under it; the alpha only lets the room show through.
  return vec4f(o.colour.rgb * cover, cover * 0.25);
}
`;

/** Whether this screen and browser might show HDR; the layer still checks the canvas itself. */
export function hdrPossible(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    'gpu' in navigator &&
    typeof matchMedia === 'function' &&
    matchMedia('(dynamic-range: high)').matches &&
    !document.documentElement.hasAttribute('data-high-contrast')
  );
}

/** Makes the HDR layer on `canvas`, or null where the screen or the browser cannot show it. */
export async function createHdrLayer(canvas: HTMLCanvasElement): Promise<HdrLayer | null> {
  if (!hdrPossible()) return null;
  let device: GPUDevice | null = null;
  try {
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) return null;
    device = await adapter.requestDevice();
    const context = canvas.getContext('webgpu');
    if (!context) {
      device.destroy();
      return null;
    }
    const format: GPUTextureFormat = 'rgba16float';
    context.configure({
      device,
      format,
      colorSpace: 'display-p3',
      toneMapping: { mode: 'extended' },
      alphaMode: 'premultiplied',
    });
    // A browser that does not know the tone mapping ignores it and clamps to white: no use.
    if (context.getConfiguration?.()?.toneMapping?.mode !== 'extended') {
      context.unconfigure();
      device.destroy();
      return null;
    }
    const gpu = device;
    const module = gpu.createShaderModule({ code: SHADER });
    const pipeline = gpu.createRenderPipeline({
      layout: 'auto',
      vertex: {
        module,
        entryPoint: 'vs',
        buffers: [
          {
            arrayStride: STRIDE * 4,
            stepMode: 'instance',
            attributes: [
              { shaderLocation: 0, offset: 0, format: 'float32x4' },
              { shaderLocation: 1, offset: 16, format: 'float32x4' },
              { shaderLocation: 2, offset: 32, format: 'float32x4' },
            ],
          },
        ],
      },
      fragment: {
        module,
        entryPoint: 'fs',
        targets: [
          {
            format,
            blend: {
              color: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
              alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
            },
          },
        ],
      },
      primitive: { topology: 'triangle-list' },
    });
    const uniforms = gpu.createBuffer({
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    const instances = gpu.createBuffer({
      size: MAX_LIGHTS * STRIDE * 4,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    const bindGroup = gpu.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: uniforms } }],
    });
    const data = new Float32Array(MAX_LIGHTS * STRIDE);
    let lost = false;
    void gpu.lost.then(() => {
      lost = true;
    });
    return {
      draw(lights, width, height) {
        if (lost || width < 1 || height < 1) return;
        const n = Math.min(MAX_LIGHTS, lights.length);
        for (let i = 0; i < n; i++) {
          const l = lights[i] as Light;
          data.set(
            [l.x, l.y, l.w, l.h, l.colour[0], l.colour[1], l.colour[2], l.fade ? 1 : 0],
            i * STRIDE,
          );
          data[i * STRIDE + 8] = l.radius;
          data[i * STRIDE + 9] = l.soft;
        }
        gpu.queue.writeBuffer(uniforms, 0, new Float32Array([width, height, 0, 0]));
        if (n > 0) gpu.queue.writeBuffer(instances, 0, data, 0, n * STRIDE);
        const encoder = gpu.createCommandEncoder();
        const pass = encoder.beginRenderPass({
          colorAttachments: [
            {
              view: context.getCurrentTexture().createView(),
              clearValue: { r: 0, g: 0, b: 0, a: 0 },
              loadOp: 'clear',
              storeOp: 'store',
            },
          ],
        });
        if (n > 0) {
          pass.setPipeline(pipeline);
          pass.setBindGroup(0, bindGroup);
          pass.setVertexBuffer(0, instances);
          pass.draw(6, n);
        }
        pass.end();
        gpu.queue.submit([encoder.finish()]);
      },
      destroy() {
        lost = true;
        context.unconfigure();
        gpu.destroy();
      },
    };
  } catch {
    device?.destroy();
    return null;
  }
}
