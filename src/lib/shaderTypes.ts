export type ShaderPassType = "common" | "buffer" | "image" | "sound";

export type ChannelSource =
  | { kind: "none" }
  | { kind: "buffer"; passId: string }
  | { kind: "keyboard" }
  | { kind: "webcam" }
  | { kind: "microphone" }
  | { kind: "texture"; assetId: string; mediaType?: "image" | "video" | "audio" };

export interface ShaderChannel {
  index: number;
  source: ChannelSource;
  filter: "linear" | "nearest";
  wrap: "repeat" | "clamp";
  vflip: boolean;
}

export interface ShaderPass {
  id: string;
  name: string;
  type: ShaderPassType;
  code: string;
  channels: ShaderChannel[];
}

export interface ShaderProject {
  id: string;
  name: string;
  author: string;
  description: string;
  tags: string[];
  sourceUrl?: string;
  editable: boolean;
  passes: ShaderPass[];
}

export interface RuntimeStats {
  frame: number;
  time: number;
  fps: number;
  resolution: [number, number];
}
