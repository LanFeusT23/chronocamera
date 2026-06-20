const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 780,
    minWidth: 900,
    minHeight: 640,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// IPC: Open directory picker
ipcMain.handle('select-directory', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
  });
  if (result.canceled) return null;
  return result.filePaths[0];
});

// IPC: Encode frames to mp4
ipcMain.handle('encode-video', async (_event, { frames, saveDir, filename }) => {
  // frames is an array of base64-encoded PNG data URIs
  if (!frames || frames.length === 0) {
    return { success: false, error: 'No frames captured.' };
  }

  // Validate save directory
  if (!saveDir || !fs.existsSync(saveDir)) {
    return { success: false, error: 'Invalid save directory.' };
  }

  // Build output filename
  let outputName;
  if (filename && filename.trim()) {
    // Strip any extension and force .mp4
    outputName = path.parse(filename.trim()).name + '.mp4';
  } else {
    const now = new Date();
    const timestamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    outputName = `chronocamera-${timestamp}.mp4`;
  }

  const outputPath = path.join(saveDir, outputName);
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chronocamera-'));

  try {
    // Write frames as numbered PNGs
    for (let i = 0; i < frames.length; i++) {
      const base64Data = frames[i].replace(/^data:image\/png;base64,/, '');
      const framePath = path.join(tempDir, `frame-${String(i).padStart(6, '0')}.png`);
      fs.writeFileSync(framePath, Buffer.from(base64Data, 'base64'));
    }

    // Encode with FFmpeg
    await runFFmpeg(tempDir, outputPath);

    return { success: true, outputPath };
  } catch (err) {
    return { success: false, error: err.message || 'FFmpeg encoding failed.' };
  } finally {
    // Cleanup temp frames
    try {
      const tempFiles = fs.readdirSync(tempDir);
      for (const f of tempFiles) fs.unlinkSync(path.join(tempDir, f));
      fs.rmdirSync(tempDir);
    } catch { /* ignore cleanup errors */ }
  }
});

function runFFmpeg(inputDir, outputPath) {
  return new Promise((resolve, reject) => {
    const inputPattern = path.join(inputDir, 'frame-%06d.png');
    const args = [
      '-y',
      '-framerate', '30',
      '-i', inputPattern,
      '-vf', 'scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2',
      '-c:v', 'libx264',
      '-pix_fmt', 'yuv420p',
      '-preset', 'fast',
      outputPath,
    ];

    const ffmpeg = spawn('ffmpeg', args);

    let stderr = '';
    ffmpeg.stderr.on('data', (data) => { stderr += data.toString(); });

    ffmpeg.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`FFmpeg exited with code ${code}: ${stderr.slice(-500)}`));
    });

    ffmpeg.on('error', (err) => {
      if (err.code === 'ENOENT') {
        reject(new Error('FFmpeg not found. Please install FFmpeg and ensure it is in your system PATH.'));
      } else {
        reject(err);
      }
    });
  });
}
