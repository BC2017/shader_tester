import type { ShaderChannel, ShaderPass, ShaderProject } from "./shaderTypes";

interface ShadertoyInput {
  channel?: number;
  src?: string;
  ctype?: string;
  sampler?: {
    filter?: string;
    wrap?: string;
    vflip?: string;
  };
}

interface ShadertoyRenderPass {
  name?: string;
  type?: string;
  code?: string;
  inputs?: ShadertoyInput[];
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
  const passes = (shader.renderpass ?? []).map(convertPass).sort(passSort);
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

function convertPass(pass: ShadertoyRenderPass): ShaderPass {
  const name = pass.name || titleCase(pass.type || "Image");
  const type = pass.type === "common" ? "common" : pass.type === "sound" ? "sound" : pass.type === "image" ? "image" : "buffer";
  const id = passId(name, type);

  return {
    id,
    name,
    type,
    code: pass.code ?? "void mainImage(out vec4 fragColor, in vec2 fragCoord) {\n    fragColor = vec4(0.0);\n}",
    channels: (pass.inputs ?? []).map(convertInput)
  };
}

function convertInput(input: ShadertoyInput): ShaderChannel {
  const source = input.ctype === "keyboard"
    ? { kind: "keyboard" as const }
    : input.ctype === "buffer" || input.src?.toLowerCase().includes("buffer")
      ? { kind: "buffer" as const, passId: bufferIds[(input.src ?? "").toLowerCase()] ?? "buffer-a" }
      : input.src
        ? { kind: "texture" as const, assetId: input.src, mediaType: mediaTypeForInput(input) }
        : { kind: "none" as const };

  return {
    index: input.channel ?? 0,
    source,
    filter: input.sampler?.filter === "nearest" ? "nearest" : "linear",
    wrap: input.sampler?.wrap === "repeat" ? "repeat" : "clamp",
    vflip: input.sampler?.vflip === "true"
  };
}

function mediaTypeForInput(input: ShadertoyInput): "image" | "video" | "audio" {
  if (input.ctype === "video") return "video";
  if (input.ctype === "music" || input.ctype === "musicstream") return "audio";
  return "image";
}

function passId(name: string, type: string) {
  const key = name.toLowerCase();
  if (bufferIds[key]) return bufferIds[key];
  if (type === "common") return "common";
  if (type === "image") return "image";
  if (type === "sound") return "sound";
  return key.replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function passSort(left: ShaderPass, right: ShaderPass) {
  const order = ["common", "buffer-a", "buffer-b", "buffer-c", "buffer-d", "image", "sound"];
  return order.indexOf(left.id) - order.indexOf(right.id);
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
