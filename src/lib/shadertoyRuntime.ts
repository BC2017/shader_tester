import type { RuntimeStats, ShaderPass, ShaderProject } from "./shaderTypes";

type RuntimeStatus = {
  ok: boolean;
  message: string;
  stats: RuntimeStats;
};

type CompiledProgram = {
  pass: ShaderPass;
  program: WebGLProgram;
  uniforms: Record<string, WebGLUniformLocation | null>;
};

type BufferTarget = {
  read: WebGLTexture;
  write: WebGLTexture;
  framebuffer: WebGLFramebuffer;
  width: number;
  height: number;
};

const VERTEX_SHADER = `#version 300 es
precision highp float;
layout(location = 0) in vec2 aPosition;
void main() {
  gl_Position = vec4(aPosition, 0.0, 1.0);
}`;

export class ShadertoyRuntime {
  private gl: WebGL2RenderingContext;
  private vao: WebGLVertexArrayObject;
  private vertexBuffer: WebGLBuffer;
  private fallbackTexture: WebGLTexture;
  private maxRenderWidth: number;
  private maxRenderHeight: number;
  private project?: ShaderProject;
  private programs = new Map<string, CompiledProgram>();
  private buffers = new Map<string, BufferTarget>();
  private bufferWarning = "";
  private animation = 0;
  private startTime = performance.now();
  private lastFrameTime = this.startTime;
  private frame = 0;
  private shaderError = "";
  private mouse = [0, 0, 0, 0];
  private statusHandler?: (status: RuntimeStatus) => void;

  constructor(private canvas: HTMLCanvasElement) {
    const gl = canvas.getContext("webgl2", {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      preserveDrawingBuffer: true
    });

    if (!gl) {
      throw new Error("WebGL2 is required for ShaderTester.");
    }

    this.gl = gl;
    const maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
    const maxViewportDims = gl.getParameter(gl.MAX_VIEWPORT_DIMS) as Int32Array;
    this.maxRenderWidth = Math.max(1, Math.min(maxTextureSize, maxViewportDims[0]));
    this.maxRenderHeight = Math.max(1, Math.min(maxTextureSize, maxViewportDims[1]));

    const vao = gl.createVertexArray();
    if (!vao) {
      throw new Error("Failed to create WebGL vertex array.");
    }
    this.vao = vao;
    gl.bindVertexArray(this.vao);
    const vertexBuffer = gl.createBuffer();
    if (!vertexBuffer) {
      throw new Error("Failed to create WebGL vertex buffer.");
    }
    this.vertexBuffer = vertexBuffer;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 3, -1, -1, 3]),
      gl.STATIC_DRAW
    );
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    this.fallbackTexture = this.createSolidTexture([0, 0, 0, 255]);
    this.bindPointerEvents();
  }

  onStatus(handler: (status: RuntimeStatus) => void) {
    this.statusHandler = handler;
  }

  load(project: ShaderProject) {
    this.project = project;
    this.frame = 0;
    this.startTime = performance.now();
    this.compileProject();
    this.resize();
  }

  updatePass(passId: string, code: string) {
    if (!this.project) return;
    this.project = {
      ...this.project,
      passes: this.project.passes.map((pass) => (pass.id === passId ? { ...pass, code } : pass))
    };
    this.compileProject();
  }

  start() {
    const tick = () => {
      this.render();
      this.animation = requestAnimationFrame(tick);
    };
    cancelAnimationFrame(this.animation);
    this.animation = requestAnimationFrame(tick);
  }

  stop() {
    cancelAnimationFrame(this.animation);
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const cssWidth = rect.width || this.canvas.clientWidth;
    const cssHeight = rect.height || this.canvas.clientHeight;
    const hasLayoutSize = cssWidth > 0 && cssHeight > 0;

    if (!hasLayoutSize) {
      this.emitStatus(false, "Waiting for preview layout");
      return false;
    }

    const width = this.stableRenderDimension(cssWidth, this.maxRenderWidth);
    const height = this.stableRenderDimension(cssHeight, this.maxRenderHeight);
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
      this.rebuildBuffers(width, height);
    }
    return true;
  }

  private bindPointerEvents() {
    this.canvas.addEventListener("pointerdown", (event) => {
      const point = this.pointer(event);
      this.mouse = [point[0], point[1], point[0], point[1]];
      this.canvas.setPointerCapture(event.pointerId);
    });
    this.canvas.addEventListener("pointermove", (event) => {
      if (event.buttons === 0) return;
      const point = this.pointer(event);
      this.mouse = [point[0], point[1], this.mouse[2], this.mouse[3]];
    });
    this.canvas.addEventListener("pointerup", (event) => {
      const point = this.pointer(event);
      this.mouse = [point[0], point[1], -Math.abs(this.mouse[2]), -Math.abs(this.mouse[3])];
      this.canvas.releasePointerCapture(event.pointerId);
    });
  }

  private pointer(event: PointerEvent): [number, number] {
    const rect = this.canvas.getBoundingClientRect();
    const scaleX = rect.width > 0 ? this.canvas.width / rect.width : 1;
    const scaleY = rect.height > 0 ? this.canvas.height / rect.height : 1;
    return [
      (event.clientX - rect.left) * scaleX,
      (rect.bottom - event.clientY) * scaleY
    ];
  }

  private stableRenderDimension(cssPixels: number, maxDimension: number) {
    const dimension = Math.min(maxDimension, Math.max(2, Math.floor(cssPixels)));
    if (dimension <= 2) return Math.max(1, dimension);
    return dimension % 2 === 0 ? dimension : dimension - 1;
  }

  private compileProject() {
    if (!this.project) return;
    const nextPrograms = new Map<string, CompiledProgram>();
    const common = this.project.passes.find((pass) => pass.type === "common")?.code ?? "";

    try {
      for (const pass of this.project.passes) {
        if (pass.type === "common" || pass.type === "sound") continue;
        let program: WebGLProgram;
        try {
          program = this.createProgram(common, pass.code);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          throw new Error(`${pass.name}: ${message}`);
        }
        nextPrograms.set(pass.id, {
          pass,
          program,
          uniforms: this.collectUniforms(program)
        });
      }
      this.programs.forEach(({ program }) => this.gl.deleteProgram(program));
      this.programs = nextPrograms;
      this.shaderError = "";
      this.emitStatus(true, "Compiled");
    } catch (error) {
      nextPrograms.forEach(({ program }) => this.gl.deleteProgram(program));
      this.programs.forEach(({ program }) => this.gl.deleteProgram(program));
      this.programs.clear();
      this.shaderError = `Shader Error: ${error instanceof Error ? error.message : String(error)}`;
      this.clearPreview();
      this.emitStatus(false, this.shaderError);
    }
  }

  private createProgram(commonCode: string, passCode: string): WebGLProgram {
    const gl = this.gl;
    const vertex = this.compileShader(gl.VERTEX_SHADER, VERTEX_SHADER);
    const fragment = this.compileShader(gl.FRAGMENT_SHADER, this.fragmentSource(commonCode, passCode));
    const program = gl.createProgram();
    if (!program) throw new Error("Failed to create shader program.");
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const info = gl.getProgramInfoLog(program) || "Unknown program link error.";
      gl.deleteProgram(program);
      throw new Error(info);
    }

    return program;
  }

  private compileShader(type: number, source: string): WebGLShader {
    const gl = this.gl;
    const shader = gl.createShader(type);
    if (!shader) throw new Error("Failed to create shader.");
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const info = gl.getShaderInfoLog(shader) || "Unknown shader compile error.";
      gl.deleteShader(shader);
      throw new Error(info);
    }
    return shader;
  }

  private fragmentSource(commonCode: string, passCode: string) {
    return `#version 300 es
precision highp float;
precision highp sampler2D;

uniform vec3 iResolution;
uniform float iTime;
uniform float iTimeDelta;
uniform int iFrame;
uniform vec4 iMouse;
uniform vec4 iDate;
uniform float iSampleRate;
uniform vec3 iChannelResolution[4];
uniform float iChannelTime[4];
uniform sampler2D iChannel0;
uniform sampler2D iChannel1;
uniform sampler2D iChannel2;
uniform sampler2D iChannel3;

out vec4 outColor;

${commonCode}

${passCode}

void main() {
  vec4 color = vec4(0.0);
  mainImage(color, gl_FragCoord.xy);
  outColor = color;
}`;
  }

  private collectUniforms(program: WebGLProgram) {
    const names = [
      "iResolution",
      "iTime",
      "iTimeDelta",
      "iFrame",
      "iMouse",
      "iDate",
      "iSampleRate",
      "iChannelResolution",
      "iChannelTime",
      "iChannel0",
      "iChannel1",
      "iChannel2",
      "iChannel3"
    ];

    return Object.fromEntries(names.map((name) => [name, this.gl.getUniformLocation(program, name)]));
  }

  private rebuildBuffers(width: number, height: number) {
    if (!this.project) return;
    this.buffers.forEach((target) => {
      this.gl.deleteTexture(target.read);
      this.gl.deleteTexture(target.write);
      this.gl.deleteFramebuffer(target.framebuffer);
    });
    this.buffers.clear();
    this.bufferWarning = "";

    for (const pass of this.project.passes.filter((item) => item.type === "buffer")) {
      try {
        this.buffers.set(pass.id, this.createBufferTarget(width, height));
      } catch (error) {
        this.bufferWarning = `${pass.name} disabled: ${error instanceof Error ? error.message : String(error)}`;
      }
    }
  }

  private createBufferTarget(width: number, height: number): BufferTarget {
    const gl = this.gl;
    const target = {
      read: this.createTexture(width, height),
      write: this.createTexture(width, height),
      framebuffer: gl.createFramebuffer(),
      width,
      height
    };

    if (!target.framebuffer) {
      throw new Error("Failed to create framebuffer.");
    }

    this.assertFramebufferComplete(target, target.write);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return target;
  }

  private createTexture(width: number, height: number) {
    const gl = this.gl;
    const texture = gl.createTexture();
    if (!texture) throw new Error("Failed to create texture.");
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    const error = gl.getError();
    if (error !== gl.NO_ERROR) {
      throw new Error(`Failed to allocate render texture ${width}x${height}: 0x${error.toString(16)}`);
    }
    return texture;
  }

  private createSolidTexture(color: [number, number, number, number]) {
    const gl = this.gl;
    const texture = gl.createTexture();
    if (!texture) throw new Error("Failed to create fallback texture.");
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      1,
      1,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      new Uint8Array(color)
    );
    return texture;
  }

  private assertFramebufferComplete(target: BufferTarget, texture: WebGLTexture) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (status !== gl.FRAMEBUFFER_COMPLETE) {
      throw new Error(`Framebuffer incomplete for ${target.width}x${target.height} render target: 0x${status.toString(16)}`);
    }
  }

  private render() {
    if (!this.project) return;
    if (!this.resize()) return;
    if (this.shaderError) {
      this.clearPreview();
      this.emitStatus(false, this.shaderError);
      return;
    }

    const now = performance.now();
    const time = (now - this.startTime) / 1000;
    const delta = Math.max(0.001, (now - this.lastFrameTime) / 1000);
    this.lastFrameTime = now;

    const ordered = this.project.passes.filter((pass) => pass.type === "buffer" || pass.type === "image");
    for (const pass of ordered) {
      const compiled = this.programs.get(pass.id);
      if (!compiled) continue;
      if (pass.type === "buffer") {
        const target = this.buffers.get(pass.id);
        if (!target) continue;
        try {
          this.assertFramebufferComplete(target, target.write);
        } catch (error) {
          this.emitStatus(false, error instanceof Error ? error.message : String(error));
          return;
        }
        this.draw(compiled, time, delta, target.width, target.height);
        [target.read, target.write] = [target.write, target.read];
      } else {
        this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null);
        this.draw(compiled, time, delta, this.canvas.width, this.canvas.height);
      }
    }

    this.frame += 1;
    this.emitStatus(true, this.bufferWarning || "Rendering");
  }

  private draw(compiled: CompiledProgram, time: number, delta: number, width: number, height: number) {
    const gl = this.gl;
    gl.viewport(0, 0, width, height);
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
    gl.useProgram(compiled.program);
    const uniforms = compiled.uniforms;

    gl.uniform3f(uniforms.iResolution, width, height, 1);
    gl.uniform1f(uniforms.iTime, time);
    gl.uniform1f(uniforms.iTimeDelta, delta);
    gl.uniform1i(uniforms.iFrame, this.frame);
    gl.uniform4f(uniforms.iMouse, this.mouse[0], this.mouse[1], this.mouse[2], this.mouse[3]);
    gl.uniform4fv(uniforms.iDate, this.dateUniform());
    gl.uniform1f(uniforms.iSampleRate, 44100);
    gl.uniform3fv(uniforms.iChannelResolution, this.channelResolutions(compiled.pass));
    gl.uniform1fv(uniforms.iChannelTime, new Float32Array([time, time, time, time]));

    for (let index = 0; index < 4; index += 1) {
      gl.activeTexture(gl.TEXTURE0 + index);
      gl.bindTexture(gl.TEXTURE_2D, this.textureForChannel(compiled.pass, index));
      gl.uniform1i(uniforms[`iChannel${index}`], index);
    }

    gl.drawArrays(gl.TRIANGLES, 0, 3);
    const error = gl.getError();
    if (error !== gl.NO_ERROR) {
      this.emitStatus(false, `WebGL draw error: 0x${error.toString(16)}`);
    }
  }

  private clearPreview() {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, Math.max(1, this.canvas.width), Math.max(1, this.canvas.height));
    gl.clearColor(0.03, 0.015, 0.018, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  private textureForChannel(pass: ShaderPass, index: number): WebGLTexture | null {
    const channel = pass.channels.find((item) => item.index === index);
    if (!channel || channel.source.kind === "none") return this.fallbackTexture;
    if (channel.source.kind === "buffer") {
      return this.buffers.get(channel.source.passId)?.read ?? this.fallbackTexture;
    }
    return this.fallbackTexture;
  }

  private channelResolutions(pass: ShaderPass) {
    const values = new Float32Array(12);
    for (let index = 0; index < 4; index += 1) {
      const channel = pass.channels.find((item) => item.index === index);
      if (channel?.source.kind === "buffer") {
        const buffer = this.buffers.get(channel.source.passId);
        values[index * 3] = buffer?.width ?? 0;
        values[index * 3 + 1] = buffer?.height ?? 0;
        values[index * 3 + 2] = 1;
      }
    }
    return values;
  }

  private dateUniform() {
    const now = new Date();
    const start = new Date(now.getFullYear(), 0, 0);
    const day = Math.floor((Number(now) - Number(start)) / 86400000);
    const seconds = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
    return new Float32Array([now.getFullYear(), now.getMonth() + 1, day, seconds]);
  }

  private emitStatus(ok: boolean, message: string) {
    if (!this.statusHandler) return;
    const now = performance.now();
    const elapsed = (now - this.startTime) / 1000;
    this.statusHandler({
      ok,
      message,
      stats: {
        frame: this.frame,
        time: elapsed,
        fps: this.frame > 0 ? this.frame / Math.max(elapsed, 0.001) : 0,
        resolution: [this.canvas.width, this.canvas.height]
      }
    });
  }
}
