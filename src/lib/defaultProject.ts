import type { ShaderProject } from "./shaderTypes";

const COMMON_CODE = `vec3 palette(float t) {
    vec3 a = vec3(0.5, 0.5, 0.5);
    vec3 b = vec3(0.5, 0.5, 0.5);
    vec3 c = vec3(1.0, 1.0, 1.0);
    vec3 d = vec3(0.0, 0.33, 0.67);
    return a + b * cos(6.28318 * (c * t + d));
}`;

const BUFFER_A_CODE = `void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec2 uv = fragCoord / iResolution.xy;
    vec2 p = uv * 2.0 - 1.0;
    p.x *= iResolution.x / iResolution.y;

    float d = length(p);
    float wave = sin(16.0 * d - iTime * 4.0);
    float glow = smoothstep(0.018, 0.0, abs(wave) * d);

    vec4 previous = texture(iChannel0, uv);
    vec3 color = mix(previous.rgb * 0.965, palette(d + iTime * 0.08) * glow, 0.72);
    fragColor = vec4(color, 1.0);
}`;

const IMAGE_CODE = `void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec2 uv = fragCoord / iResolution.xy;
    vec3 bufferColor = texture(iChannel0, uv).rgb;
    vec2 vignetteUv = uv * (1.0 - uv.yx);
    float vignette = pow(vignetteUv.x * vignetteUv.y * 18.0, 0.18);
    fragColor = vec4(bufferColor * vignette, 1.0);
}`;

export const defaultProject: ShaderProject = {
  id: "starter",
  name: "ShaderTester Starter",
  author: "Local",
  description: "Editable Shadertoy-style multipass shader.",
  tags: ["multipass", "offline"],
  editable: true,
  passes: [
    {
      id: "common",
      name: "Common",
      type: "common",
      code: COMMON_CODE,
      channels: []
    },
    {
      id: "buffer-a",
      name: "Buffer A",
      type: "buffer",
      code: BUFFER_A_CODE,
      channels: [
        {
          index: 0,
          source: { kind: "buffer", passId: "buffer-a" },
          filter: "linear",
          wrap: "clamp",
          vflip: false
        }
      ]
    },
    {
      id: "image",
      name: "Image",
      type: "image",
      code: IMAGE_CODE,
      channels: [
        {
          index: 0,
          source: { kind: "buffer", passId: "buffer-a" },
          filter: "linear",
          wrap: "clamp",
          vflip: false
        }
      ]
    }
  ]
};
