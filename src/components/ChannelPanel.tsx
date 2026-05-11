import { Trash2 } from "lucide-react";
import type { ChannelSource, ShaderChannel, ShaderPass } from "../lib/shaderTypes";

type TextureOption = {
  assetId: string;
  label: string;
  mediaType?: "image" | "video" | "audio";
};

interface ChannelPanelProps {
  pass: ShaderPass;
  bufferPasses: ShaderPass[];
  textureOptions: TextureOption[];
  canRemovePass: boolean;
  onChannelChange: (channel: ShaderChannel) => void;
  onRemovePass: () => void;
}

const emptyChannel = (index: number): ShaderChannel => ({
  index,
  source: { kind: "none" },
  filter: "linear",
  wrap: "clamp",
  vflip: false
});

export function ChannelPanel({
  pass,
  bufferPasses,
  textureOptions,
  canRemovePass,
  onChannelChange,
  onRemovePass
}: ChannelPanelProps) {
  if (pass.type === "common" || pass.type === "sound") {
    return (
      <div className="channel-panel">
        <div className="channel-panel-header">
          <span className="eyebrow">Channels</span>
          <span>No inputs for this pass</span>
        </div>
      </div>
    );
  }

  return (
    <div className="channel-panel">
      <div className="channel-panel-header">
        <span className="eyebrow">Channels</span>
        {canRemovePass && (
          <button type="button" className="danger-command" onClick={onRemovePass}>
            <Trash2 size={14} />
            <span>Remove Pass</span>
          </button>
        )}
      </div>
      <div className="channel-grid">
        {[0, 1, 2, 3].map((index) => {
          const channel = pass.channels.find((item) => item.index === index) ?? emptyChannel(index);
          return (
            <div className="channel-row" key={index}>
              <label htmlFor={`channel-${index}`}>iChannel{index}</label>
              <select
                id={`channel-${index}`}
                value={sourceValue(channel.source)}
                onChange={(event) => onChannelChange({
                  ...channel,
                  source: sourceFromValue(event.target.value, textureOptions)
                })}
              >
                <option value="none">None</option>
                <optgroup label="Buffers">
                  {bufferPasses.map((buffer) => (
                    <option key={buffer.id} value={`buffer:${buffer.id}`}>
                      {buffer.name}
                    </option>
                  ))}
                </optgroup>
                {textureOptions.length > 0 && (
                  <optgroup label="Imported Media">
                    {textureOptions.map((texture) => (
                      <option key={texture.assetId} value={`texture:${texture.assetId}`}>
                        {texture.label}
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
              <select
                aria-label={`iChannel${index} filter`}
                value={channel.filter}
                onChange={(event) => onChannelChange({ ...channel, filter: event.target.value as ShaderChannel["filter"] })}
              >
                <option value="linear">Linear</option>
                <option value="nearest">Nearest</option>
              </select>
              <select
                aria-label={`iChannel${index} wrap`}
                value={channel.wrap}
                onChange={(event) => onChannelChange({ ...channel, wrap: event.target.value as ShaderChannel["wrap"] })}
              >
                <option value="clamp">Clamp</option>
                <option value="repeat">Repeat</option>
              </select>
              <label className="channel-toggle">
                <input
                  type="checkbox"
                  checked={channel.vflip}
                  onChange={(event) => onChannelChange({ ...channel, vflip: event.target.checked })}
                />
                <span>VFlip</span>
              </label>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function sourceValue(source: ChannelSource) {
  if (source.kind === "buffer") return `buffer:${source.passId}`;
  if (source.kind === "texture") return `texture:${source.assetId}`;
  return "none";
}

function sourceFromValue(value: string, textureOptions: TextureOption[]): ChannelSource {
  if (value.startsWith("buffer:")) return { kind: "buffer", passId: value.slice("buffer:".length) };
  if (value.startsWith("texture:")) {
    const assetId = value.slice("texture:".length);
    const texture = textureOptions.find((item) => item.assetId === assetId);
    return { kind: "texture", assetId, mediaType: texture?.mediaType };
  }
  return { kind: "none" };
}
