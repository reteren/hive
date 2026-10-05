/**
 * The drawing's raster lives on the GPU (debug 24): one WebGL2 context owns every tile (RGBA8,
 * premultiplied, mipmapped), the live stroke state and the Undo copies. The CPU never touches tile
 * pixels except for explicit readbacks (fill flood, selection cut, save).
 *
 * Coordinates: every offscreen target (tile, stroke tile, readback) stores raster row 0 at texel row 0,
 * i.e. raster y grows with GL y. Only the on-screen canvas flips (screen y grows downwards).
 */

export type BlendKind = "over" | "atop" | "out" | "under" | "replace";

export interface TexRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A mipmapped premultiplied RGBA8 texture plus its framebuffer. */
export interface GpuTexture {
  tex: WebGLTexture;
  fbo: WebGLFramebuffer;
  width: number;
  height: number;
  mipmapped: boolean;
  mipsDirty: boolean;
}

export interface DrawQuad {
  /** Destination rectangle in target px (raster orientation for offscreen targets). */
  dst: TexRect;
  /** Source texture and the part of it mapped onto dst, in source texture px. */
  src: { texture: WebGLTexture; width: number; height: number; rect: TexRect };
  /** "rgba": premultiplied colour × multiplier; "mask": red channel × colour. */
  mode: "rgba" | "mask";
  /** Premultiplied multiplier (rgba) or premultiplied colour incl. opacity (mask). */
  color: [number, number, number, number];
  clip?: { texture: WebGLTexture; width: number; height: number; rect: TexRect } | null;
}

const VERTEX_SHADER = `#version 300 es
in vec2 a_pos;
uniform vec4 u_dst;   // NDC x, y, w, h
uniform vec4 u_src;   // uv x, y, w, h
uniform vec4 u_clip;  // clip uv x, y, w, h
out vec2 v_uv;
out vec2 v_clip;
void main() {
  gl_Position = vec4(u_dst.xy + a_pos * u_dst.zw, 0.0, 1.0);
  v_uv = u_src.xy + a_pos * u_src.zw;
  v_clip = u_clip.xy + a_pos * u_clip.zw;
}`;

const COMPOSITE_SHADER = `#version 300 es
precision highp float;
in vec2 v_uv;
in vec2 v_clip;
uniform sampler2D u_tex;
uniform sampler2D u_clipTex;
uniform int u_mode;
uniform int u_useClip;
uniform vec4 u_color;
out vec4 outColor;
void main() {
  vec4 texel = texture(u_tex, v_uv);
  vec4 color = u_mode == 1 ? u_color * texel.r : texel * u_color;
  if (u_useClip == 1) {
    float inside = step(0.0, v_clip.x) * step(0.0, v_clip.y) * step(v_clip.x, 1.0) * step(v_clip.y, 1.0);
    color *= texture(u_clipTex, v_clip).r * inside;
  }
  outColor = color;
}`;

/**
 * One soft-brush pass over the segments of a pointer event, identical to accumulateStrokeSegment
 * (brush.ts) per pixel: within a pass alpha is the max, a return from further along the path is
 * composited over the earlier passes, with a smooth ramp between the two rules.
 */
const STROKE_SHADER = `#version 300 es
precision highp float;
precision highp int;
uniform sampler2D u_state;
uniform sampler2D u_pos;
uniform vec2 u_origin;
uniform vec4 u_seg[64];
uniform vec2 u_len[64];
uniform int u_count;
uniform float u_radius;
uniform float u_core;
uniform float u_edge;
uniform float u_pass;
layout(location = 0) out vec4 outState;
layout(location = 1) out vec4 outPos;
float rnd(float v) { return floor(v + 0.5); }
void main() {
  ivec2 texel = ivec2(gl_FragCoord.xy);
  vec4 st = texelFetch(u_state, texel, 0) * 255.0;
  float value = rnd(st.r);
  float base = rnd(st.g);
  float pass = rnd(st.b);
  float blend = rnd(st.a);
  float position = texelFetch(u_pos, texel, 0).r;
  vec2 p = u_origin + vec2(texel) + 0.5;
  float r2 = u_radius * u_radius;
  float c2 = u_core * u_core;
  for (int i = 0; i < 64; i++) {
    if (i >= u_count) break;
    vec4 s = u_seg[i];
    vec2 a = s.xy;
    vec2 d = s.zw - s.xy;
    vec2 q = p - a;
    float l2 = dot(d, d);
    float t = l2 > 0.0 ? clamp(dot(q, d) / l2, 0.0, 1.0) : 0.0;
    vec2 o = q - t * d;
    float dist2 = dot(o, o);
    if (dist2 > r2) continue;
    float alpha = 255.0;
    if (dist2 > c2) {
      float e = clamp((sqrt(dist2) - u_core) / u_edge, 0.0, 1.0);
      alpha = rnd(255.0 * (1.0 - e * e * (3.0 - 2.0 * e)));
      if (alpha <= 0.0) continue;
    }
    float at = u_len[i].x + t * (u_len[i].y - u_len[i].x);
    float gap = at - position;
    if (gap > u_pass) {
      float ramp = min(1.0, (gap - u_pass) / (u_pass * 2.0));
      base = value;
      pass = alpha;
      blend = rnd(255.0 * ramp * ramp * (3.0 - 2.0 * ramp));
    } else if (alpha > pass) {
      pass = alpha;
    }
    position = at;
    float over = base + pass * (255.0 - base) / 255.0;
    float w = blend / 255.0;
    float shown = rnd(max(base, pass) * (1.0 - w) + over * w);
    value = max(value, shown);
  }
  outState = vec4(value, base, pass, blend) / 255.0;
  outPos = vec4(position, 0.0, 0.0, 0.0);
}`;

const NEVER_TOUCHED = -1e30;
export const STROKE_SEGMENTS_PER_PASS = 64;

export class DrawingGpu {
  readonly canvas: HTMLCanvasElement;
  readonly gl: WebGL2RenderingContext;
  private readonly composite: WebGLProgram;
  private readonly stroke: WebGLProgram;
  private readonly quad: WebGLVertexArrayObject;
  private readonly compositeUniforms: Record<string, WebGLUniformLocation | null>;
  private readonly strokeUniforms: Record<string, WebGLUniformLocation | null>;
  private readonly emptyClip: WebGLTexture;
  private scratch: GpuTexture | null = null;
  /**
   * Re-render the visible canvas now (set by DrawingLayer). The canvas does not preserve its buffer
   * between frames, so anything copying it (drawImage) must render first, in the same task.
   */
  renderNow: (() => void) | null = null;
  private lost = false;
  private readonly lostListeners = new Set<() => void>();
  private readonly restoredListeners = new Set<() => void>();

  constructor(canvas: HTMLCanvasElement, gl: WebGL2RenderingContext) {
    this.canvas = canvas;
    this.gl = gl;
    if (!gl.getExtension("EXT_color_buffer_float")) throw new Error("Drawing needs float render targets (EXT_color_buffer_float).");
    this.composite = link(gl, VERTEX_SHADER, COMPOSITE_SHADER);
    this.stroke = link(gl, VERTEX_SHADER, STROKE_SHADER);
    this.compositeUniforms = uniforms(gl, this.composite, ["u_dst", "u_src", "u_clip", "u_tex", "u_clipTex", "u_mode", "u_useClip", "u_color"]);
    this.strokeUniforms = uniforms(gl, this.stroke, ["u_dst", "u_src", "u_clip", "u_state", "u_pos", "u_origin", "u_seg", "u_len", "u_count", "u_radius", "u_core", "u_edge", "u_pass"]);
    const vao = gl.createVertexArray();
    const buffer = gl.createBuffer();
    if (!vao || !buffer) throw new Error("Could not create the drawing quad.");
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
    for (const program of [this.composite, this.stroke]) {
      const location = gl.getAttribLocation(program, "a_pos");
      if (location >= 0) {
        gl.enableVertexAttribArray(location);
        gl.vertexAttribPointer(location, 2, gl.FLOAT, false, 0, 0);
      }
    }
    gl.bindVertexArray(null);
    this.quad = vao;
    this.emptyClip = this.createMaskTexture(1, 1, new Uint8Array([255]));
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.DITHER);
    canvas.addEventListener("webglcontextlost", (event) => {
      event.preventDefault();
      this.lost = true;
      for (const listener of this.lostListeners) listener();
    });
    canvas.addEventListener("webglcontextrestored", () => {
      // Every GL object is gone: callers reload tiles from the project (see persistence).
      for (const listener of this.restoredListeners) listener();
    });
  }

  get isLost(): boolean {
    return this.lost || this.gl.isContextLost();
  }

  onContextLost(listener: () => void): () => void {
    this.lostListeners.add(listener);
    return () => this.lostListeners.delete(listener);
  }

  onContextRestored(listener: () => void): () => void {
    this.restoredListeners.add(listener);
    return () => this.restoredListeners.delete(listener);
  }

  /** Empty premultiplied RGBA8 texture with a framebuffer; mipmapped textures get a full mip chain. */
  createTexture(width: number, height: number, mipmapped: boolean): GpuTexture {
    const gl = this.gl;
    const tex = gl.createTexture();
    const fbo = gl.createFramebuffer();
    if (!tex || !fbo) throw new Error("Out of GPU memory for the drawing.");
    gl.bindTexture(gl.TEXTURE_2D, tex);
    const levels = mipmapped ? Math.floor(Math.log2(Math.max(width, height))) + 1 : 1;
    gl.texStorage2D(gl.TEXTURE_2D, levels, gl.RGBA8, width, height);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mipmapped ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.clearColor(0, 0, 0, 0);
    gl.disable(gl.SCISSOR_TEST);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { tex, fbo, width, height, mipmapped, mipsDirty: mipmapped };
  }

  deleteTexture(texture: GpuTexture | null | undefined): void {
    if (!texture || this.isLost) return;
    this.gl.deleteTexture(texture.tex);
    this.gl.deleteFramebuffer(texture.fbo);
  }

  /** Single-channel coverage texture (selection masks), straight bytes. */
  createMaskTexture(width: number, height: number, data: Uint8Array): WebGLTexture {
    const gl = this.gl;
    const tex = gl.createTexture();
    if (!tex) throw new Error("Out of GPU memory for the drawing.");
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, width, height, 0, gl.RED, gl.UNSIGNED_BYTE, data);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return tex;
  }

  deleteRawTexture(tex: WebGLTexture | null | undefined): void {
    if (tex && !this.isLost) this.gl.deleteTexture(tex);
  }

  /** Upload straight-alpha pixels (ImageData / canvas / bitmap) into a fresh mipmapped texture. */
  uploadImage(source: ImageData | HTMLCanvasElement | ImageBitmap): GpuTexture {
    const texture = this.createTexture(source.width, source.height, true);
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, texture.tex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    texture.mipsDirty = true;
    return texture;
  }

  /** Replace a sub-rectangle of a texture with straight-alpha RGBA bytes. */
  writePixels(texture: GpuTexture, x: number, y: number, width: number, height: number, straight: Uint8ClampedArray | Uint8Array): void {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, texture.tex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, x, y, width, height, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(straight.buffer, straight.byteOffset, straight.byteLength));
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    texture.mipsDirty = texture.mipmapped;
  }

  /** Upload premultiplied RGBA bytes covering the whole texture (Undo demotion round trip). */
  writePremultiplied(texture: GpuTexture, data: Uint8Array): void {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, texture.tex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, texture.width, texture.height, gl.RGBA, gl.UNSIGNED_BYTE, data);
    texture.mipsDirty = texture.mipmapped;
  }

  /** Premultiplied RGBA bytes of a texture rect (raster row order). */
  readPremultiplied(texture: GpuTexture, rect: TexRect = { x: 0, y: 0, width: texture.width, height: texture.height }): Uint8Array {
    const gl = this.gl;
    const data = new Uint8Array(rect.width * rect.height * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, texture.fbo);
    gl.readPixels(rect.x, rect.y, rect.width, rect.height, gl.RGBA, gl.UNSIGNED_BYTE, data);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return data;
  }

  /** Straight-alpha RGBA of a texture rect (for CPU algorithms and PNG). */
  readStraight(texture: GpuTexture, rect?: TexRect): Uint8ClampedArray {
    return unpremultiply(this.readPremultiplied(texture, rect));
  }

  /** Copy one texture's base level over another of the same size (Undo copies). */
  copyTexture(from: GpuTexture, to: GpuTexture): void {
    const gl = this.gl;
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, from.fbo);
    gl.bindTexture(gl.TEXTURE_2D, to.tex);
    gl.copyTexSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 0, 0, Math.min(from.width, to.width), Math.min(from.height, to.height));
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
    to.mipsDirty = to.mipmapped;
  }

  clear(texture: GpuTexture, rect?: TexRect): void {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, texture.fbo);
    if (rect) {
      gl.enable(gl.SCISSOR_TEST);
      gl.scissor(rect.x, rect.y, rect.width, rect.height);
    } else {
      gl.disable(gl.SCISSOR_TEST);
    }
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.disable(gl.SCISSOR_TEST);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    texture.mipsDirty = texture.mipmapped;
  }

  ensureMips(texture: GpuTexture): void {
    if (!texture.mipmapped || !texture.mipsDirty) return;
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, texture.tex);
    gl.generateMipmap(gl.TEXTURE_2D);
    texture.mipsDirty = false;
  }

  /** Draw quads into an offscreen texture (raster orientation) with one blend mode. */
  drawInto(target: GpuTexture, quads: readonly DrawQuad[], blend: BlendKind): void {
    if (!quads.length) return;
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
    gl.viewport(0, 0, target.width, target.height);
    this.drawQuads(quads, blend, target.width, target.height, false);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    target.mipsDirty = target.mipmapped;
  }

  /** Size the visible canvas to device px; returns its backing size. */
  fitCanvas(cssWidth: number, cssHeight: number, ratio: number): { width: number; height: number } {
    const width = Math.max(1, Math.round(cssWidth * ratio));
    const height = Math.max(1, Math.round(cssHeight * ratio));
    if (this.canvas.width !== width) this.canvas.width = width;
    if (this.canvas.height !== height) this.canvas.height = height;
    return { width, height };
  }

  /** Clear the visible canvas and draw quad groups in screen orientation (y down). */
  drawToScreen(groups: readonly { quads: readonly DrawQuad[]; blend: BlendKind }[]): void {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.disable(gl.SCISSOR_TEST);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    for (const group of groups) {
      if (group.quads.length) this.drawQuads(group.quads, group.blend, this.canvas.width, this.canvas.height, true);
    }
  }

  /** A reusable offscreen texture at least `width`×`height` (readback composites). */
  scratchTexture(width: number, height: number): GpuTexture {
    if (!this.scratch || this.scratch.width < width || this.scratch.height < height) {
      this.deleteTexture(this.scratch);
      this.scratch = this.createTexture(Math.max(width, this.scratch?.width ?? 0), Math.max(height, this.scratch?.height ?? 0), false);
    }
    return this.scratch;
  }

  /** Stroke state target: RGBA8 state (mipmapped for coarser commits) + R32F path position. */
  createStrokeState(size: number): StrokeStateTile {
    const gl = this.gl;
    const make = (): StrokeStateBuffers => {
      const state = gl.createTexture();
      const position = gl.createTexture();
      const fbo = gl.createFramebuffer();
      if (!state || !position || !fbo) throw new Error("Out of GPU memory for the brush.");
      gl.bindTexture(gl.TEXTURE_2D, state);
      gl.texStorage2D(gl.TEXTURE_2D, Math.floor(Math.log2(size)) + 1, gl.RGBA8, size, size);
      // Only level 0 is valid while drawing; ensureStrokeMips switches to trilinear for the commit.
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.bindTexture(gl.TEXTURE_2D, position);
      gl.texStorage2D(gl.TEXTURE_2D, 1, gl.R32F, size, size);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, state, 0);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, position, 0);
      gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
      gl.disable(gl.SCISSOR_TEST);
      gl.clearBufferfv(gl.COLOR, 0, [0, 0, 0, 0]);
      gl.clearBufferfv(gl.COLOR, 1, [NEVER_TOUCHED, 0, 0, 0]);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      return { state, position, fbo };
    };
    return { size, current: make(), next: make(), mipsDirty: true };
  }

  deleteStrokeState(tile: StrokeStateTile): void {
    if (this.isLost) return;
    for (const buffers of [tile.current, tile.next]) {
      this.gl.deleteTexture(buffers.state);
      this.gl.deleteTexture(buffers.position);
      this.gl.deleteFramebuffer(buffers.fbo);
    }
  }

  /**
   * Run up to 64 segments of a pointer event over `rect` (tile px) of a stroke tile whose top-left
   * raster pixel is `origin`. Writes into `next`, then copies the rect back into `current`.
   */
  strokePass(
    tile: StrokeStateTile,
    origin: { x: number; y: number },
    rect: TexRect,
    segments: Float32Array,
    lengths: Float32Array,
    count: number,
    brush: { radius: number; core: number; edge: number; passWindow: number },
    commit = true,
  ): void {
    const gl = this.gl;
    const u = this.strokeUniforms;
    gl.useProgram(this.stroke);
    gl.bindVertexArray(this.quad);
    gl.bindFramebuffer(gl.FRAMEBUFFER, tile.next.fbo);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
    gl.viewport(0, 0, tile.size, tile.size);
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(rect.x, rect.y, rect.width, rect.height);
    gl.disable(gl.BLEND);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tile.current.state);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, tile.current.position);
    gl.uniform1i(u.u_state, 0);
    gl.uniform1i(u.u_pos, 1);
    gl.uniform4f(u.u_dst, -1, -1, 2, 2);
    gl.uniform4f(u.u_src, 0, 0, 1, 1);
    gl.uniform4f(u.u_clip, 0, 0, 1, 1);
    gl.uniform2f(u.u_origin, origin.x, origin.y);
    gl.uniform4fv(u.u_seg, segments);
    gl.uniform2fv(u.u_len, lengths);
    gl.uniform1i(u.u_count, count);
    gl.uniform1f(u.u_radius, brush.radius);
    gl.uniform1f(u.u_core, brush.core);
    gl.uniform1f(u.u_edge, brush.edge);
    gl.uniform1f(u.u_pass, brush.passWindow);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.disable(gl.SCISSOR_TEST);
    gl.bindVertexArray(null);
    // A committed pass is copied back so the next pass reads it; a provisional one (the live tail)
    // stays only in `next`, which is what the preview shows.
    if (commit) this.blitState(tile.next.fbo, tile.current.fbo, rect);
    tile.mipsDirty = true;
  }

  ensureStrokeMips(tile: StrokeStateTile): void {
    if (!tile.mipsDirty) return;
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, tile.current.state);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    tile.mipsDirty = false;
  }

  /** Copy a rect of the committed stroke state over the scratch buffers (drops a provisional tail). */
  syncStrokeRect(tile: StrokeStateTile, rect: TexRect): void {
    this.blitState(tile.current.fbo, tile.next.fbo, rect);
  }

  private blitState(from: WebGLFramebuffer, to: WebGLFramebuffer, rect: TexRect): void {
    const gl = this.gl;
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, from);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, to);
    for (const attachment of [gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]) {
      gl.readBuffer(attachment);
      gl.drawBuffers(attachment === gl.COLOR_ATTACHMENT0 ? [gl.COLOR_ATTACHMENT0, gl.NONE] : [gl.NONE, gl.COLOR_ATTACHMENT1]);
      gl.blitFramebuffer(rect.x, rect.y, rect.x + rect.width, rect.y + rect.height, rect.x, rect.y, rect.x + rect.width, rect.y + rect.height, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    }
    gl.readBuffer(gl.COLOR_ATTACHMENT0);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
  }

  /** Red channel (stroke coverage) of a stroke tile rect as 0..255 bytes, raster row order. */
  readStrokeCoverage(tile: StrokeStateTile, rect: TexRect): Uint8Array {
    const gl = this.gl;
    const rgba = new Uint8Array(rect.width * rect.height * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, tile.current.fbo);
    gl.readBuffer(gl.COLOR_ATTACHMENT0);
    gl.readPixels(rect.x, rect.y, rect.width, rect.height, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    const coverage = new Uint8Array(rect.width * rect.height);
    for (let index = 0; index < coverage.length; index += 1) coverage[index] = rgba[index * 4]!;
    return coverage;
  }

  private drawQuads(quads: readonly DrawQuad[], blend: BlendKind, targetWidth: number, targetHeight: number, flipY: boolean): void {
    const gl = this.gl;
    const u = this.compositeUniforms;
    gl.useProgram(this.composite);
    gl.bindVertexArray(this.quad);
    setBlend(gl, blend);
    gl.uniform1i(u.u_tex, 0);
    gl.uniform1i(u.u_clipTex, 1);
    for (const quad of quads) {
      const { dst, src } = quad;
      const x = (dst.x / targetWidth) * 2 - 1;
      const w = (dst.width / targetWidth) * 2;
      let y = (dst.y / targetHeight) * 2 - 1;
      let h = (dst.height / targetHeight) * 2;
      if (flipY) {
        y = 1 - (dst.y / targetHeight) * 2;
        h = -h;
      }
      gl.uniform4f(u.u_dst, x, y, w, h);
      gl.uniform4f(u.u_src, src.rect.x / src.width, src.rect.y / src.height, src.rect.width / src.width, src.rect.height / src.height);
      gl.uniform1i(u.u_mode, quad.mode === "mask" ? 1 : 0);
      gl.uniform4f(u.u_color, quad.color[0], quad.color[1], quad.color[2], quad.color[3]);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, src.texture);
      gl.activeTexture(gl.TEXTURE1);
      if (quad.clip) {
        const clip = quad.clip;
        gl.bindTexture(gl.TEXTURE_2D, clip.texture);
        gl.uniform1i(u.u_useClip, 1);
        gl.uniform4f(u.u_clip, clip.rect.x / clip.width, clip.rect.y / clip.height, clip.rect.width / clip.width, clip.rect.height / clip.height);
      } else {
        gl.bindTexture(gl.TEXTURE_2D, this.emptyClip);
        gl.uniform1i(u.u_useClip, 0);
        gl.uniform4f(u.u_clip, 0, 0, 1, 1);
      }
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
    gl.activeTexture(gl.TEXTURE0);
    gl.bindVertexArray(null);
    gl.disable(gl.BLEND);
  }
}

export interface StrokeStateBuffers {
  state: WebGLTexture;
  position: WebGLTexture;
  fbo: WebGLFramebuffer;
}

export interface StrokeStateTile {
  size: number;
  current: StrokeStateBuffers;
  next: StrokeStateBuffers;
  mipsDirty: boolean;
}

function setBlend(gl: WebGL2RenderingContext, blend: BlendKind): void {
  if (blend === "replace") {
    gl.disable(gl.BLEND);
    return;
  }
  gl.enable(gl.BLEND);
  gl.blendEquation(gl.FUNC_ADD);
  // Premultiplied Porter-Duff: result = src·Fs + dst·Fd.
  if (blend === "over") gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  else if (blend === "atop") gl.blendFuncSeparate(gl.DST_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE);
  else if (blend === "out") gl.blendFunc(gl.ZERO, gl.ONE_MINUS_SRC_ALPHA);
  else gl.blendFunc(gl.ONE_MINUS_DST_ALPHA, gl.ONE);
}

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error("Could not create a drawing shader.");
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS) && !gl.isContextLost()) {
    throw new Error(`Drawing shader failed: ${gl.getShaderInfoLog(shader) ?? "unknown error"}`);
  }
  return shader;
}

function link(gl: WebGL2RenderingContext, vertex: string, fragment: string): WebGLProgram {
  const program = gl.createProgram();
  if (!program) throw new Error("Could not create a drawing program.");
  gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, vertex));
  gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, fragment));
  gl.bindAttribLocation(program, 0, "a_pos");
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS) && !gl.isContextLost()) {
    throw new Error(`Drawing program failed: ${gl.getProgramInfoLog(program) ?? "unknown error"}`);
  }
  return program;
}

function uniforms(gl: WebGL2RenderingContext, program: WebGLProgram, names: readonly string[]): Record<string, WebGLUniformLocation | null> {
  return Object.fromEntries(names.map((name) => [name, gl.getUniformLocation(program, name)]));
}

/** Premultiplied → straight alpha, in place on a copy. */
export function unpremultiply(data: Uint8Array): Uint8ClampedArray {
  const out = new Uint8ClampedArray(data.length);
  for (let index = 0; index < data.length; index += 4) {
    const alpha = data[index + 3]!;
    if (alpha === 0) continue;
    if (alpha === 255) {
      out[index] = data[index]!;
      out[index + 1] = data[index + 1]!;
      out[index + 2] = data[index + 2]!;
    } else {
      const scale = 255 / alpha;
      out[index] = Math.min(255, Math.round(data[index]! * scale));
      out[index + 1] = Math.min(255, Math.round(data[index + 1]! * scale));
      out[index + 2] = Math.min(255, Math.round(data[index + 2]! * scale));
    }
    out[index + 3] = alpha;
  }
  return out;
}

let engine: DrawingGpu | null | undefined;

/** The shared engine, created on first use; null where WebGL2 is unavailable (unit tests). */
export function drawingGpu(): DrawingGpu | null {
  if (engine !== undefined) return engine;
  if (typeof document === "undefined") return (engine = null);
  try {
    const canvas = document.createElement("canvas");
    canvas.className = "drawing-surface";
    canvas.dataset.drawingSurface = "";
    const gl = canvas.getContext("webgl2", { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: false });
    engine = gl ? new DrawingGpu(canvas, gl) : null;
  } catch (error) {
    console.error("Drawing GPU engine is unavailable", error);
    engine = null;
  }
  return engine;
}

/** Throwing accessor for code paths that cannot work without the GPU. */
export function requireDrawingGpu(): DrawingGpu {
  const gpu = drawingGpu();
  if (!gpu) throw new Error("Drawing needs WebGL2, which is not available here.");
  return gpu;
}
