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

type RuntimeOptions = {
  loadAsset?: (assetId: string) => Promise<string | null>;
};

type AudioTextureState = {
  analyser?: AnalyserNode;
  source?: AudioBufferSourceNode;
  decodedSamples?: Float32Array;
  sampleRate: number;
  frequencyData: Uint8Array<ArrayBuffer>;
  waveformData: Uint8Array<ArrayBuffer>;
  pixels: Uint8Array<ArrayBuffer>;
};

function replaceFunction(source: string, returnType: string, name: string, replacement: string) {
  const pattern = new RegExp(`\\b${returnType}\\s+${name}\\s*\\(`);
  const match = pattern.exec(source);
  if (!match) return source;

  const bodyStart = source.indexOf("{", match.index);
  if (bodyStart < 0) return source;

  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    const char = source[index];
    if (char === "{") depth += 1;
    if (char === "}") depth -= 1;
    if (depth === 0) {
      return `${source.slice(0, match.index)}${replacement}${source.slice(index + 1)}`;
    }
  }

  return source;
}

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
  private keyboardTexture: WebGLTexture;
  private keyboardPixels = new Uint8Array(256 * 3 * 4);
  private pressedKeys = new Set<number>();
  private toggledKeys = new Set<number>();
  private renderTextureInternalFormat: number;
  private renderTextureType: number;
  private renderTextureFilter: number;
  private maxRenderWidth: number;
  private maxRenderHeight: number;
  private project?: ShaderProject;
  private programs = new Map<string, CompiledProgram>();
  private buffers = new Map<string, BufferTarget>();
  private assetTextures = new Map<string, WebGLTexture>();
  private assetVideos = new Map<string, HTMLVideoElement>();
  private assetAudios = new Map<string, AudioTextureState>();
  private assetDimensions = new Map<string, [number, number]>();
  private loadingAssets = new Set<string>();
  private audioContext?: AudioContext;
  private bufferWarning = "";
  private assetWarning = "";
  private animation = 0;
  private isRunning = false;
  private startTime = performance.now();
  private lastFrameTime = this.startTime;
  private frame = 0;
  private fps = 0;
  private shaderError = "";
  private mouse = [0, 0, 0, 0];
  private statusHandler?: (status: RuntimeStatus) => void;

  constructor(private canvas: HTMLCanvasElement, private options: RuntimeOptions = {}) {
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
    const hasFloatRenderTargets = Boolean(gl.getExtension("EXT_color_buffer_float"));
    const hasFloatLinearFiltering = Boolean(gl.getExtension("OES_texture_float_linear"));
    this.renderTextureInternalFormat = hasFloatRenderTargets ? gl.RGBA32F : gl.RGBA;
    this.renderTextureType = hasFloatRenderTargets ? gl.FLOAT : gl.UNSIGNED_BYTE;
    this.renderTextureFilter = hasFloatRenderTargets && !hasFloatLinearFiltering ? gl.NEAREST : gl.LINEAR;
    if (!hasFloatRenderTargets) {
      this.bufferWarning = "Floating-point buffer targets unavailable; multipass buffers may lose precision";
    }
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
    this.keyboardTexture = this.createKeyboardTexture();
    this.bindPointerEvents();
    this.bindKeyboardEvents();
  }

  onStatus(handler: (status: RuntimeStatus) => void) {
    this.statusHandler = handler;
  }

  load(project: ShaderProject) {
    this.project = project;
    this.frame = 0;
    this.startTime = performance.now();
    this.compileProject();
    this.resize(true);
    this.loadProjectAssets();
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
    if (this.isRunning) return;
    this.isRunning = true;
    this.lastFrameTime = performance.now();
    const tick = () => {
      this.render();
      this.animation = requestAnimationFrame(tick);
    };
    cancelAnimationFrame(this.animation);
    this.animation = requestAnimationFrame(tick);
  }

  stop() {
    cancelAnimationFrame(this.animation);
    this.animation = 0;
    this.isRunning = false;
  }

  pause() {
    this.stop();
    this.emitStatus(true, "Paused");
  }

  resize(forceRebuildBuffers = false) {
    const rect = this.previewBounds();
    const cssWidth = rect.width || this.canvas.clientWidth;
    const cssHeight = rect.height || this.canvas.clientHeight;
    const hasLayoutSize = cssWidth > 0 && cssHeight > 0;

    if (!hasLayoutSize) {
      this.emitStatus(false, "Waiting for preview layout");
      return false;
    }

    const pixelRatio = Math.max(1, window.devicePixelRatio || 1);
    const width = this.stableRenderDimension(cssWidth * pixelRatio, this.maxRenderWidth);
    const height = this.stableRenderDimension(cssHeight * pixelRatio, this.maxRenderHeight);
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
      this.rebuildBuffers(width, height);
    } else if (forceRebuildBuffers) {
      this.rebuildBuffers(width, height);
    }
    return true;
  }

  private previewBounds() {
    const parent = this.canvas.parentElement;
    const rect = parent?.getBoundingClientRect();
    if (rect && rect.width > 0 && rect.height > 0) return rect;
    return this.canvas.getBoundingClientRect();
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

  private bindKeyboardEvents() {
    window.addEventListener("keydown", (event) => {
      const code = event.keyCode;
      if (code < 0 || code > 255) return;
      if (!event.repeat) {
        if (this.toggledKeys.has(code)) this.toggledKeys.delete(code);
        else this.toggledKeys.add(code);
      }
      this.pressedKeys.add(code);
    });
    window.addEventListener("keyup", (event) => {
      const code = event.keyCode;
      if (code < 0 || code > 255) return;
      this.pressedKeys.delete(code);
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
    const dimension = Math.min(maxDimension, Math.max(2, Math.round(cssPixels)));
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
    const common = this.normalizeShaderCode(commonCode);
    const pass = this.normalizeShaderCode(passCode);
    const hasMainImage = /\bvoid\s+mainImage\s*\(/.test(pass);
    const hasMain = /\bvoid\s+main\s*\(/.test(pass);

    return `#version 300 es
precision highp float;
precision highp sampler2D;

uniform vec3 iResolution;
uniform float iTime;
uniform float iTimeDelta;
uniform float iFrameRate;
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

#define HW_PERFORMANCE 0
#define iGlobalTime iTime
#define texture2D texture
#define texture2DProj textureProj
#define texture2DLod textureLod
#define texture2DLodEXT textureLod
#define texture2DGrad textureGrad
#define texture2DGradEXT textureGrad
#define textureCube texture
#define textureCubeLod textureLod
#define textureCubeLodEXT textureLod
#define gl_FragColor outColor

out vec4 outColor;

${common}

${pass}

${hasMainImage ? `
void main() {
  vec4 color = vec4(0.0);
  mainImage(color, gl_FragCoord.xy);
  outColor = color;
}` : hasMain ? "" : `
void main() {
  outColor = vec4(0.0, 0.0, 0.0, 1.0);
}`}
`;
  }

  private normalizeShaderCode(code: string) {
    const normalized = code
      .split(/\r?\n/)
      .filter((line) => !/^#extension\s+(GL_OES_standard_derivatives|GL_EXT_shader_texture_lod)\s*:/.test(line.trim()))
      .join("\n");
    return this.replaceBitPackingHelpers(normalized);
  }

  private replaceBitPackingHelpers(code: string) {
    if (!code.includes("intBitsToFloat") && !code.includes("floatBitsToInt")) return code;

    const packReplacement = `float pack4(in vec4 rgba) {
    vec3 bytes = floor(clamp(rgba.rgb, 0.0, 1.0) * 255.0 + 0.5);
    return dot(bytes, vec3(1.0, 256.0, 65536.0)) / 16777215.0;
}`;
    const unpackReplacement = `vec4 unpack4(in float col) {
    float value = floor(clamp(col, 0.0, 1.0) * 16777215.0 + 0.5);
    float r = mod(value, 256.0);
    value = floor(value / 256.0);
    float g = mod(value, 256.0);
    value = floor(value / 256.0);
    float b = mod(value, 256.0);
    return vec4(r, g, b, 0.0) / 255.0;
}`;

    return replaceFunction(replaceFunction(code, "float", "pack4", packReplacement), "vec4", "unpack4", unpackReplacement);
  }

  private collectUniforms(program: WebGLProgram) {
    const names = [
      "iResolution",
      "iTime",
      "iTimeDelta",
      "iFrameRate",
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
    this.frame = 0;
    this.startTime = performance.now();
    this.lastFrameTime = this.startTime;

    for (const pass of this.project.passes.filter((item) => item.type === "buffer")) {
      try {
        this.buffers.set(pass.id, this.createBufferTarget(width, height));
      } catch (error) {
        this.bufferWarning = `${pass.name} disabled: ${error instanceof Error ? error.message : String(error)}`;
      }
    }
  }

  private loadProjectAssets() {
    if (!this.project || !this.options.loadAsset) return;

    const textureIds = new Map<string, "image" | "video" | "audio">();
    for (const pass of this.project.passes) {
      for (const channel of pass.channels) {
        if (channel.source.kind === "texture") {
          textureIds.set(channel.source.assetId, channel.source.mediaType ?? "image");
        }
      }
    }

    for (const [assetId, mediaType] of textureIds) {
      if (this.assetTextures.has(assetId) || this.loadingAssets.has(assetId)) continue;
      this.loadingAssets.add(assetId);
      this.options.loadAsset(assetId)
        .then((url) => {
          if (!url) {
            this.assetWarning = `Missing texture asset: ${assetId}`;
            return;
          }
          if (mediaType === "video") return this.loadVideoTexture(assetId, url);
          if (mediaType === "audio") return this.loadAudioTexture(assetId, url);
          return this.loadImageTexture(assetId, url);
        })
        .catch((error) => {
          this.assetWarning = `Texture load failed: ${error instanceof Error ? error.message : String(error)}`;
        })
        .finally(() => {
          this.loadingAssets.delete(assetId);
        });
    }
  }

  private loadImageTexture(assetId: string, url: string) {
    return new Promise<void>((resolve, reject) => {
      const image = new Image();
      image.onload = () => {
        try {
          const texture = this.createImageTexture(image);
          const previous = this.assetTextures.get(assetId);
          if (previous) this.gl.deleteTexture(previous);
          this.assetTextures.set(assetId, texture);
          this.assetDimensions.set(assetId, [image.naturalWidth || 1, image.naturalHeight || 1]);
          this.assetWarning = "";
          resolve();
        } catch (error) {
          reject(error);
        }
      };
      image.onerror = () => reject(new Error(`Could not decode image texture ${assetId}`));
      image.src = url;
    });
  }

  private loadVideoTexture(assetId: string, url: string) {
    return new Promise<void>((resolve, reject) => {
      const video = document.createElement("video");
      video.muted = true;
      video.loop = true;
      video.playsInline = true;
      video.preload = "auto";

      video.addEventListener("loadeddata", () => {
        try {
          const texture = this.createSolidTexture([0, 0, 0, 255]);
          const previous = this.assetTextures.get(assetId);
          if (previous) this.gl.deleteTexture(previous);
          this.assetTextures.set(assetId, texture);
          this.assetVideos.set(assetId, video);
          this.assetDimensions.set(assetId, [video.videoWidth || 1, video.videoHeight || 1]);
          void video.play().catch(() => {
            this.assetWarning = `Video texture loaded but playback is paused: ${assetId}`;
          });
          this.assetWarning = "";
          resolve();
        } catch (error) {
          reject(error);
        }
      }, { once: true });

      video.onerror = () => reject(new Error(`Could not decode video texture ${assetId}`));
      video.src = url;
      video.load();
    });
  }

  private loadAudioTexture(assetId: string, url: string) {
    const texture = this.createAudioTexture();
    const previous = this.assetTextures.get(assetId);
    if (previous) this.gl.deleteTexture(previous);

    const state: AudioTextureState = {
      sampleRate: 44100,
      frequencyData: new Uint8Array(512),
      waveformData: new Uint8Array(512),
      pixels: new Uint8Array(512 * 2 * 4)
    };
    state.waveformData.fill(128);

    this.assetTextures.set(assetId, texture);
    this.assetAudios.set(assetId, state);
    this.assetDimensions.set(assetId, [512, 2]);
    this.assetWarning = "";

    return this.decodeAudioTexture(assetId, url, state);
  }

  private async decodeAudioTexture(assetId: string, url: string, state: AudioTextureState) {
    try {
      const response = await fetch(url);
      const audioData = await response.arrayBuffer();
      const context = this.audioContext ?? new AudioContext();
      this.audioContext = context;
      const buffer = await context.decodeAudioData(audioData.slice(0));
      state.decodedSamples = buffer.getChannelData(0);
      state.sampleRate = buffer.sampleRate;
      this.configureAudioAnalyser(state, buffer);
      await this.startAudioPlayback(assetId);
    } catch (error) {
      this.assetWarning = `Audio texture load failed: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  private configureAudioAnalyser(state: AudioTextureState, buffer: AudioBuffer) {
    if (state.analyser || state.source) return;
    const context = this.audioContext ?? new AudioContext();
    this.audioContext = context;
    const source = context.createBufferSource();
    const analyser = context.createAnalyser();
    const silentGain = context.createGain();
    source.buffer = buffer;
    source.loop = true;
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.65;
    silentGain.gain.value = 0;
    source.connect(analyser);
    analyser.connect(silentGain);
    silentGain.connect(context.destination);
    source.start();
    state.source = source;
    state.analyser = analyser;
  }

  private async startAudioPlayback(assetId: string) {
    try {
      if (this.audioContext?.state === "suspended") {
        await this.audioContext.resume();
      }
      if (this.assetWarning.includes(assetId)) {
        this.assetWarning = "";
      }
    } catch {
      this.assetWarning = `Audio texture loaded but playback is paused: ${assetId}`;
    }
  }

  private createImageTexture(image: TexImageSource) {
    const gl = this.gl;
    const texture = gl.createTexture();
    if (!texture) throw new Error("Failed to create image texture.");
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);
    const error = gl.getError();
    if (error !== gl.NO_ERROR) {
      throw new Error(`Failed to upload image texture: 0x${error.toString(16)}`);
    }
    return texture;
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
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, this.renderTextureFilter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, this.renderTextureFilter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      this.renderTextureInternalFormat,
      width,
      height,
      0,
      gl.RGBA,
      this.renderTextureType,
      null
    );
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

  private createKeyboardTexture() {
    const gl = this.gl;
    const texture = gl.createTexture();
    if (!texture) throw new Error("Failed to create keyboard texture.");
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 256, 3, 0, gl.RGBA, gl.UNSIGNED_BYTE, this.keyboardPixels);
    return texture;
  }

  private createAudioTexture() {
    const gl = this.gl;
    const texture = gl.createTexture();
    if (!texture) throw new Error("Failed to create audio texture.");
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 512, 2, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
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
    this.fps = 1 / delta;

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
    this.emitStatus(true, this.assetWarning || this.bufferWarning || "Rendering");
  }

  private draw(compiled: CompiledProgram, time: number, delta: number, width: number, height: number) {
    const gl = this.gl;
    this.updateVideoTextures();
    this.updateAudioTextures(time);
    this.updateKeyboardTexture();
    gl.viewport(0, 0, width, height);
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
    gl.useProgram(compiled.program);
    const uniforms = compiled.uniforms;

    gl.uniform3f(uniforms.iResolution, width, height, 1);
    gl.uniform1f(uniforms.iTime, time);
    gl.uniform1f(uniforms.iTimeDelta, delta);
    gl.uniform1f(uniforms.iFrameRate, this.fps);
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

  private updateVideoTextures() {
    const gl = this.gl;
    for (const [assetId, video] of this.assetVideos) {
      const texture = this.assetTextures.get(assetId);
      if (!texture || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) continue;
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);
      this.assetDimensions.set(assetId, [video.videoWidth || 1, video.videoHeight || 1]);
    }
  }

  private updateAudioTextures(time: number) {
    const gl = this.gl;
    for (const [assetId, state] of this.assetAudios) {
      const texture = this.assetTextures.get(assetId);
      if (!texture) continue;
      let hasAnalyserData = false;
      if (state.analyser) {
        state.analyser.getByteFrequencyData(state.frequencyData);
        state.analyser.getByteTimeDomainData(state.waveformData);
        hasAnalyserData = state.frequencyData.some((value) => value > 0) || state.waveformData.some((value) => value !== 128);
      }
      if (!hasAnalyserData && state.decodedSamples) {
        this.writeDecodedAudioTexture(state, time);
      }

      for (let index = 0; index < 512; index += 1) {
        const frequency = state.frequencyData[index];
        const waveform = state.waveformData[index];
        const frequencyOffset = index * 4;
        const waveformOffset = (512 + index) * 4;
        state.pixels[frequencyOffset] = frequency;
        state.pixels[frequencyOffset + 1] = frequency;
        state.pixels[frequencyOffset + 2] = frequency;
        state.pixels[frequencyOffset + 3] = 255;
        state.pixels[waveformOffset] = waveform;
        state.pixels[waveformOffset + 1] = waveform;
        state.pixels[waveformOffset + 2] = waveform;
        state.pixels[waveformOffset + 3] = 255;
      }

      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 512, 2, gl.RGBA, gl.UNSIGNED_BYTE, state.pixels);
    }
  }

  private writeDecodedAudioTexture(state: AudioTextureState, time: number) {
    const samples = state.decodedSamples;
    if (!samples?.length) return;

    const sampleBase = Math.floor(time * state.sampleRate) % samples.length;
    for (let index = 0; index < 512; index += 1) {
      const sampleIndex = (sampleBase + index) % samples.length;
      state.waveformData[index] = this.normalizedAudioByte(samples[sampleIndex]);
      state.frequencyData[index] = this.frequencyMagnitude(samples, sampleBase, index, state.sampleRate);
    }
  }

  private normalizedAudioByte(sample: number) {
    return Math.max(0, Math.min(255, Math.round((sample * 0.5 + 0.5) * 255)));
  }

  private frequencyMagnitude(samples: Float32Array, sampleBase: number, bin: number, sampleRate: number) {
    const sampleCount = 128;
    const frequency = (bin / 512) * (sampleRate / 2);
    let real = 0;
    let imaginary = 0;
    for (let index = 0; index < sampleCount; index += 1) {
      const sample = samples[(sampleBase + index) % samples.length];
      const phase = (2 * Math.PI * frequency * index) / sampleRate;
      real += sample * Math.cos(phase);
      imaginary -= sample * Math.sin(phase);
    }
    const magnitude = Math.sqrt(real * real + imaginary * imaginary) / sampleCount;
    return Math.max(0, Math.min(255, Math.round(magnitude * 768)));
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
    if (channel.source.kind === "texture") {
      return this.assetTextures.get(channel.source.assetId) ?? this.fallbackTexture;
    }
    if (channel.source.kind === "keyboard") {
      return this.keyboardTexture;
    }
    return this.fallbackTexture;
  }

  private channelResolutions(pass: ShaderPass) {
    const values = new Float32Array(12);
    for (let index = 0; index < 4; index += 1) {
      values[index * 3] = 1;
      values[index * 3 + 1] = 1;
      values[index * 3 + 2] = 1;

      const channel = pass.channels.find((item) => item.index === index);
      if (channel?.source.kind === "buffer") {
        const buffer = this.buffers.get(channel.source.passId);
        values[index * 3] = buffer?.width ?? 1;
        values[index * 3 + 1] = buffer?.height ?? 1;
      } else if (channel?.source.kind === "texture" && this.assetTextures.has(channel.source.assetId)) {
        const [width, height] = this.assetDimensions.get(channel.source.assetId) ?? [1, 1];
        values[index * 3] = width;
        values[index * 3 + 1] = height;
      } else if (channel?.source.kind === "keyboard") {
        values[index * 3] = 256;
        values[index * 3 + 1] = 3;
      }
    }
    return values;
  }

  private updateKeyboardTexture() {
    this.keyboardPixels.fill(0);
    for (const code of this.pressedKeys) {
      this.writeKeyboardPixel(code, 0, 255);
    }
    for (const code of this.toggledKeys) {
      this.writeKeyboardPixel(code, 2, 255);
    }

    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.keyboardTexture);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 256, 3, gl.RGBA, gl.UNSIGNED_BYTE, this.keyboardPixels);
  }

  private writeKeyboardPixel(code: number, row: number, value: number) {
    const offset = (row * 256 + code) * 4;
    this.keyboardPixels[offset] = value;
    this.keyboardPixels[offset + 1] = value;
    this.keyboardPixels[offset + 2] = value;
    this.keyboardPixels[offset + 3] = 255;
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
