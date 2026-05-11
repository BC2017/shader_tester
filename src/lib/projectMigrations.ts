import type { ShaderChannel, ShaderProject } from "./shaderTypes";

const reversedSmoothstep = "smoothstep(0.018, 0.0, abs(wave) * d)";
const stableGlow = "1.0 - smoothstep(0.0, 0.018, abs(wave) * d)";
const oldStarterFeedback = "palette(d + iTime * 0.08) * glow";
const oldStarterImage = "fragColor = vec4(bufferColor * vignette, 1.0);";

const visibleStarterBufferA = `void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec2 uv = fragCoord / iResolution.xy;
    vec2 p = uv * 2.0 - 1.0;
    p.x *= iResolution.x / iResolution.y;

    float d = length(p);
    float angle = atan(p.y, p.x);
    float wave = 0.5 + 0.5 * cos(9.0 * d - iTime * 2.4 + angle * 3.0);
    float pulse = 0.5 + 0.5 * sin((p.x + p.y) * 5.0 + iTime * 1.8);

    vec4 previous = texture(iChannel0, uv);
    vec3 base = palette(d * 0.55 + wave * 0.35 + iTime * 0.08);
    vec3 color = base * (0.35 + 0.45 * wave + 0.2 * pulse);
    color = mix(color, previous.rgb, 0.18);
    fragColor = vec4(color, 1.0);
}`;

const visibleStarterImage = `void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec2 uv = fragCoord / iResolution.xy;
    vec3 bufferColor = texture(iChannel0, uv).rgb;
    vec3 fallback = palette(uv.x * 0.45 + uv.y * 0.35 + iTime * 0.08) * (0.35 + 0.25 * sin(iTime + uv.x * 8.0));
    vec2 vignetteUv = uv * (1.0 - uv.yx);
    float vignette = pow(vignetteUv.x * vignetteUv.y * 18.0, 0.18);
    fragColor = vec4(max(bufferColor, fallback) * vignette, 1.0);
}`;

export function upgradeProject(project: ShaderProject): ShaderProject {
  const terrainProject = repairMousePaintTerrainProject(project);
  if (terrainProject !== project) return terrainProject;
  if (project.id !== "starter") return project;

  let changed = false;
  const passes = project.passes.map((pass) => {
    if (pass.id === "buffer-a" && pass.code.includes(oldStarterFeedback)) {
      changed = true;
      return {
        ...pass,
        code: visibleStarterBufferA
      };
    }

    if (pass.id === "image" && pass.code.includes(oldStarterImage)) {
      changed = true;
      return {
        ...pass,
        code: visibleStarterImage
      };
    }

    if (!pass.code.includes(reversedSmoothstep)) return pass;
    changed = true;
    return {
      ...pass,
      code: pass.code.replace(reversedSmoothstep, stableGlow)
    };
  });

  return changed ? { ...project, passes } : project;
}

function repairMousePaintTerrainProject(project: ShaderProject): ShaderProject {
  const hasTerrainShader = project.passes.some((pass) => pass.code.includes("Advanced terrain erosion filter"));
  const hasMousePaintBuffer = project.passes.some((pass) => pass.code.includes("Raw height map painted with the mouse"));
  if (!hasTerrainShader || !hasMousePaintBuffer) return project;

  let changed = false;
  const passes = project.passes.map((pass) => {
    if (pass.id === "buffer-a") {
      const channels = [
        bufferChannel(0, "buffer-a"),
        keyboardChannel(1)
      ];
      if (JSON.stringify(pass.channels) !== JSON.stringify(channels)) changed = true;
      return { ...pass, channels };
    }

    if (pass.id === "buffer-b") {
      const channels = [
        bufferChannel(0, "buffer-a"),
        keyboardChannel(1)
      ];
      if (JSON.stringify(pass.channels) !== JSON.stringify(channels)) changed = true;
      return { ...pass, channels };
    }

    if (pass.id === "buffer-c") {
      if (pass.channels.length > 0) changed = true;
      return { ...pass, channels: [] };
    }

    if (pass.id === "image") {
      const existingChannel2 = pass.channels.find((channel) => channel.index === 2);
      const channels = [
        bufferChannel(0, "buffer-b"),
        bufferChannel(1, "buffer-c"),
        existingChannel2?.source.kind === "texture" ? existingChannel2 : noneChannel(2)
      ];
      if (JSON.stringify(pass.channels) !== JSON.stringify(channels)) changed = true;
      return { ...pass, channels };
    }

    return pass;
  });

  return changed ? { ...project, passes } : project;
}

function bufferChannel(index: number, passId: string): ShaderChannel {
  return {
    index,
    source: { kind: "buffer", passId },
    filter: "linear",
    wrap: "clamp",
    vflip: false
  };
}

function keyboardChannel(index: number): ShaderChannel {
  return {
    index,
    source: { kind: "keyboard" },
    filter: "nearest",
    wrap: "clamp",
    vflip: false
  };
}

function noneChannel(index: number): ShaderChannel {
  return {
    index,
    source: { kind: "none" },
    filter: "linear",
    wrap: "clamp",
    vflip: false
  };
}
