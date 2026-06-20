# ChronoCamera

A simple desktop timelapse app for webcam capture, built with Electron.

## Features
- Live webcam preview
- Start/stop timelapse recording
- Timelapse interval settings with defaults: 2s, 5s, 10s, 30s, 60s
- Custom interval in seconds
- Save directory picker and optional filename input
- Always exports `.mp4` files at `1920x1080`
- If no filename is supplied, output uses: `chronocamera-{ISO8601_TIMESTAMP}.mp4`

## Prerequisites
- [Node.js](https://nodejs.org/) (v18+)
- [FFmpeg](https://ffmpeg.org/) installed and available on your system PATH

## Development

```bash
npm install
npm start
```

## Build executables

Build for Linux:
```bash
npm run build:linux
```

Build for Windows:
```bash
npm run build:win
```

Build for both:
```bash
npm run build
```

Packaged output will be in the `dist/` directory.

## Architecture
- **Main process** (`src/main.js`): Electron window, native dialogs, frame-to-mp4 encoding via FFmpeg.
- **Preload** (`src/preload.js`): Secure IPC bridge between renderer and main.
- **Renderer** (`src/index.html`, `src/renderer.js`, `src/styles.css`): UI, webcam preview, timelapse capture logic.
