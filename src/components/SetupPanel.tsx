import { FormEvent, useState } from "react";
import { KeyRound, MonitorPlay, Settings, X } from "lucide-react";

interface SetupPanelProps {
  initialApiKey: string;
  showEditorMinimap: boolean;
  showChannelEditor: boolean;
  isPreviewPaused: boolean;
  onClose: () => void;
  onSave: (apiKey: string) => Promise<void>;
  onShowEditorMinimapChange: (enabled: boolean) => void;
  onShowChannelEditorChange: (enabled: boolean) => void;
  onPreviewPausedChange: (paused: boolean) => void;
}

export function SetupPanel({
  initialApiKey,
  showEditorMinimap,
  showChannelEditor,
  isPreviewPaused,
  onClose,
  onSave,
  onShowEditorMinimapChange,
  onShowChannelEditorChange,
  onPreviewPausedChange
}: SetupPanelProps) {
  const [apiKey, setApiKey] = useState(initialApiKey);
  const [status, setStatus] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setStatus("Saving...");
    try {
      await onSave(apiKey);
      setStatus("");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <form className="setup-modal" onSubmit={submit}>
        <header>
          <div className="modal-icon">
            <Settings size={18} />
          </div>
          <div>
            <h2>Settings</h2>
            <p>Configure import access, editor display, and preview playback.</p>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close settings">
            <X size={17} />
          </button>
        </header>

        <section className="settings-section">
          <div className="settings-section-title">
            <KeyRound size={16} />
            <div>
              <h3>Shadertoy Import</h3>
              <p>Used only for online import. Imported shaders and media stay cached for offline editing.</p>
            </div>
          </div>
          <label htmlFor="api-key">API key</label>
          <input
            id="api-key"
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            placeholder="Paste API key"
            autoComplete="off"
          />
        </section>

        <section className="settings-section">
          <div className="settings-section-title">
            <MonitorPlay size={16} />
            <div>
              <h3>Workspace</h3>
              <p>Adjust editor and preview behavior for this session.</p>
            </div>
          </div>
          <label className="settings-toggle">
            <input
              type="checkbox"
              checked={showEditorMinimap}
              onChange={(event) => onShowEditorMinimapChange(event.target.checked)}
            />
            <span>Show editor minimap</span>
          </label>
          <label className="settings-toggle">
            <input
              type="checkbox"
              checked={showChannelEditor}
              onChange={(event) => onShowChannelEditorChange(event.target.checked)}
            />
            <span>Show channel editor</span>
          </label>
          <label className="settings-toggle">
            <input
              type="checkbox"
              checked={isPreviewPaused}
              onChange={(event) => onPreviewPausedChange(event.target.checked)}
            />
            <span>Pause live preview</span>
          </label>
        </section>

        <footer>
          <span>{status}</span>
          <button type="submit">Save Settings</button>
        </footer>
      </form>
    </div>
  );
}
