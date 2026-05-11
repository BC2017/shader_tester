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
- Settings menu for Shadertoy import and workspace preferences
- SQLite-backed editable project persistence
- Project autosave
- Shadertoy import command that fetches shader JSON and caches referenced `/media/...` assets locally
- Imported shaders are converted into editable local projects
- Cached imported image textures can be loaded into `iChannel0..3`
- Cached imported video textures can be loaded into `iChannel0..3`
- Buffer B/C/D passes can be created from the workspace toolbar
- Active pass `iChannel0..3` inputs can be edited with buffer/media source, filter, wrap, and vflip controls

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

1. Expand cached media support to audio inputs.
2. Add keyboard texture, webcam, microphone, and audio FFT inputs.
3. Implement sound shader generation/playback.
4. Add local gallery, thumbnails, tags, favorites, and search.
5. Add portable import/export bundles.
