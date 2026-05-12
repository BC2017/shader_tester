import type { ChannelSource, ShaderChannel, ShaderPass, ShaderProject } from "./shaderTypes";

interface ShadertoyInput {
  channel?: number;
  id?: number | string;
  src?: string;
  filepath?: string;
  ctype?: string;
  sampler?: {
    filter?: string;
    wrap?: string;
    vflip?: string;
  };
}

interface ShadertoyOutput {
  id?: number | string;
  channel?: number;
}

interface ShadertoyRenderPass {
  name?: string;
  type?: string;
  code?: string;
  inputs?: ShadertoyInput[];
  outputs?: ShadertoyOutput[];
}

interface ShadertoyPayload {
  info?: {
    id?: string;
    name?: string;
    username?: string;
    description?: string;
    tags?: string[];
  };
  renderpass?: ShadertoyRenderPass[];
}

const bufferIds: Record<string, string> = {
  "buffer a": "buffer-a",
  "buffer b": "buffer-b",
  "buffer c": "buffer-c",
  "buffer d": "buffer-d",
  buffer0: "buffer-a",
  buffer1: "buffer-b",
  buffer2: "buffer-c",
  buffer3: "buffer-d"
};

export function shadertoyJsonToProject(json: unknown, sourceUrl?: string): ShaderProject {
  const shader = json as ShadertoyPayload;
  const outputPasses = outputPassMap(shader.renderpass ?? []);
  const passes = (shader.renderpass ?? []).map((pass) => convertPass(pass, outputPasses)).sort(passSort);
  const safePasses = passes.length > 0 ? passes : [fallbackImagePass()];

  return {
    id: shader.info?.id ?? crypto.randomUUID(),
    name: shader.info?.name ?? "Imported Shader",
    author: shader.info?.username ?? "Shadertoy",
    description: shader.info?.description ?? "Imported from Shadertoy.",
    tags: shader.info?.tags ?? ["imported"],
    sourceUrl,
    editable: true,
    passes: safePasses
  };
}

function convertPass(pass: ShadertoyRenderPass, outputPasses: Map<string, string>): ShaderPass {
  const name = pass.name || titleCase(pass.type || "Image");
  const type = pass.type === "common" ? "common" : pass.type === "sound" ? "sound" : pass.type === "image" ? "image" : "buffer";
  const id = passId(name, type);

  return {
    id,
    name,
    type,
    code: pass.code ?? "void mainImage(out vec4 fragColor, in vec2 fragCoord) {\n    fragColor = vec4(0.0);\n}",
    channels: (pass.inputs ?? []).map((input) => convertInput(input, outputPasses))
  };
}

function convertInput(input: ShadertoyInput, outputPasses: Map<string, string>): ShaderChannel {
  return {
    index: input.channel ?? 0,
    source: sourceForInput(input, outputPasses),
    filter: input.sampler?.filter === "nearest" ? "nearest" : "linear",
    wrap: input.sampler?.wrap === "repeat" ? "repeat" : "clamp",
    vflip: input.sampler?.vflip === "true"
  };
}

function sourceForInput(input: ShadertoyInput, outputPasses: Map<string, string>): ChannelSource {
  if (input.ctype === "keyboard") return { kind: "keyboard" };
  if (input.ctype === "webcam") return { kind: "webcam" };
  if (input.ctype === "mic" || input.ctype === "microphone") return { kind: "microphone" };
  if (isBufferInput(input)) return { kind: "buffer", passId: bufferPassId(input, outputPasses) };
  if (input.src) return { kind: "texture", assetId: input.src, mediaType: mediaTypeForInput(input) };
  return { kind: "none" };
}

function outputPassMap(renderPasses: ShadertoyRenderPass[]) {
  const map = new Map<string, string>();

  for (const pass of renderPasses) {
    const name = pass.name || titleCase(pass.type || "Image");
    const type = pass.type === "common" ? "common" : pass.type === "sound" ? "sound" : pass.type === "image" ? "image" : "buffer";
    const id = passId(name, type);
    for (const output of pass.outputs ?? []) {
      if (output.id === undefined || output.id === null) continue;
      map.set(String(output.id), id);
    }
  }

  return map;
}

function isBufferInput(input: ShadertoyInput) {
  return input.ctype === "buffer" || [input.src, input.filepath].some((value) => bufferReference(value));
}

function bufferPassId(input: ShadertoyInput, outputPasses: Map<string, string>) {
  if (input.id !== undefined && input.id !== null) {
    const passIdForOutput = outputPasses.get(String(input.id));
    if (passIdForOutput) return passIdForOutput;
  }

  return bufferReference(input.src) ?? bufferReference(input.filepath) ?? "buffer-a";
}

function bufferReference(value?: string) {
  if (!value) return undefined;
  const normalized = normalizeReference(value);
  const compact = normalized.replace(/[^a-z0-9]/g, "");

  if (bufferIds[normalized]) return bufferIds[normalized];
  if (bufferIds[compact]) return bufferIds[compact];

  const letter = compact.match(/(?:buffer|buf)([abcd])/);
  if (letter) return bufferIds[`buffer ${letter[1]}`];

  const number = compact.match(/(?:buffer|buf)0?([0-3])/);
  if (number) return bufferIds[`buffer${number[1]}`];

  return undefined;
}

function normalizeReference(value: string) {
  try {
    return decodeURIComponent(value).toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  } catch {
    return value.toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  }
}

function mediaTypeForInput(input: ShadertoyInput): "image" | "video" | "audio" {
  if (input.ctype === "video") return "video";
  if (input.ctype === "music" || input.ctype === "musicstream") return "audio";
  return "image";
}

function passId(name: string, type: string) {
  const bufferId = type === "buffer" ? bufferReference(name) : undefined;
  if (bufferId) return bufferId;

  const key = name.toLowerCase();
  if (bufferIds[key]) return bufferIds[key];
  if (type === "common") return "common";
  if (type === "image") return "image";
  if (type === "sound") return "sound";
  return key.replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function passSort(left: ShaderPass, right: ShaderPass) {
  const order = ["common", "buffer-a", "buffer-b", "buffer-c", "buffer-d", "image", "sound"];
  const leftIndex = order.indexOf(left.id);
  const rightIndex = order.indexOf(right.id);
  return (leftIndex === -1 ? order.length : leftIndex) - (rightIndex === -1 ? order.length : rightIndex);
}

function titleCase(value: string) {
  return value.slice(0, 1).toUpperCase() + value.slice(1);
}

function fallbackImagePass(): ShaderPass {
  return {
    id: "image",
    name: "Image",
    type: "image",
    code: "void mainImage(out vec4 fragColor, in vec2 fragCoord) {\n    fragColor = vec4(fragCoord / iResolution.xy, 0.0, 1.0);\n}",
    channels: []
  };
}
