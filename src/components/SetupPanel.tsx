import { FormEvent, useState } from "react";
import { KeyRound, X } from "lucide-react";

interface SetupPanelProps {
  initialApiKey: string;
  onClose: () => void;
  onSave: (apiKey: string) => Promise<void>;
}

export function SetupPanel({ initialApiKey, onClose, onSave }: SetupPanelProps) {
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
            <KeyRound size={18} />
          </div>
          <div>
            <h2>Shadertoy Import Setup</h2>
            <p>Add an API key to import public shaders, then ShaderTester caches them for offline editing.</p>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close setup">
            <X size={17} />
          </button>
        </header>

        <label htmlFor="api-key">Shadertoy API key</label>
        <input
          id="api-key"
          value={apiKey}
          onChange={(event) => setApiKey(event.target.value)}
          placeholder="Paste API key"
          autoComplete="off"
        />

        <footer>
          <span>{status}</span>
          <button type="submit">Save Key</button>
        </footer>
      </form>
    </div>
  );
}
