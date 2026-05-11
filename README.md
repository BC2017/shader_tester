# ShaderTester

ShaderTester is a cross-platform desktop shader IDE for building and editing Shadertoy-style projects offline.

## Stack

- Tauri 2 desktop shell
- React + TypeScript + Vite
- Monaco Editor for GLSL editing
- WebGL2 Shadertoy-compatible runtime
- Rust backend with SQLite persistence

## Current Slice

- Modern desktop IDE layout
- Editable starter project
- Common, Buffer A, and Image passes
- WebGL2 fullscreen renderer
- Multipass buffer rendering with ping-pong feedback
- Core Shadertoy uniforms:
  - `iResolution`
  - `iTime`
  - `iTimeDelta`
  - `iFrame`
  - `iMouse`
  - `iDate`
  - `iSampleRate`
  - `iChannel0..3`
  - `iChannelResolution`
  - `iChannelTime`
- Setup modal for a Shadertoy API key
- SQLite-backed editable project persistence
- Project autosave with a local library list
- Shadertoy import command that fetches shader JSON and caches referenced `/media/...` assets locally
- Imported shaders are converted into editable local projects
- Cached imported image textures can be loaded into `iChannel0..3`
- Cached imported video textures can be loaded into `iChannel0..3`
- Cached imported audio textures can be loaded into `iChannel0..3` as Shadertoy-style 512x2 spectrum/waveform textures

## Development

Install frontend dependencies:

```powershell
npm install
```

Run the browser preview:

```powershell
npm run dev
```

Run the desktop app:

```powershell
npm run tauri:dev
```

Build the frontend:

```powershell
npm run build
```

Check the Tauri backend:

```powershell
cd src-tauri
cargo check
```

## Next Milestones

1. Add Buffer B/C/D creation and channel editing UI.
2. Add keyboard texture, webcam, microphone, and live audio input textures.
3. Implement sound shader generation/playback.
4. Add local gallery, thumbnails, tags, favorites, and search.
5. Add portable import/export bundles.
