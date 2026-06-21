const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const { spawn } = require('child_process');
const https = require('https');
const http = require('http');

let mainWindow;
let customFfmpegPath = null;

// Path to store settings
const settingsPath = path.join(app.getPath('userData'), 'settings.json');

function loadSettings() {
  try {
    if (fs.existsSync(settingsPath)) {
      const data = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
      if (data.ffmpegPath && fs.existsSync(data.ffmpegPath)) {
        customFfmpegPath = data.ffmpegPath;
      }
    }
  } catch { /* ignore */ }
}

function saveSettings() {
  try {
    const data = { ffmpegPath: customFfmpegPath || null };
    fs.writeFileSync(settingsPath, JSON.stringify(data, null, 2));
  } catch { /* ignore */ }
}

function getFfmpegCommand() {
  return customFfmpegPath || 'ffmpeg';
}

/**
 * Check if FFmpeg is available (either custom path or in system PATH)
 */
function checkFfmpeg() {
  return new Promise((resolve) => {
    const cmd = getFfmpegCommand();
    const proc = spawn(cmd, ['-version'], { stdio: 'pipe' });
    proc.on('close', (code) => {
      resolve(code === 0);
    });
    proc.on('error', () => {
      resolve(false);
    });
  });
}

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

app.whenReady().then(() => {
  loadSettings();
  createWindow();
});

app.on('window-all-closed', () => {
  app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// IPC: Check if FFmpeg is available
ipcMain.handle('check-ffmpeg', async () => {
  return await checkFfmpeg();
});

// IPC: Get platform info for FFmpeg download
ipcMain.handle('get-platform-info', () => {
  return { platform: process.platform, arch: process.arch };
});

// IPC: Download and install FFmpeg
ipcMain.handle('download-ffmpeg', async (_event) => {
  const platform = process.platform;

  if (platform === 'linux') {
    return {
      success: false,
      error: 'On Linux, please install FFmpeg using your package manager:\n\nsudo apt install ffmpeg\n\nor\n\nsudo dnf install ffmpeg',
    };
  }

  if (platform !== 'win32') {
    return {
      success: false,
      error: `Automatic FFmpeg download is not supported on ${platform}. Please install FFmpeg manually.`,
    };
  }

  // Windows: Download from gyan.dev (same as reference C# app)
  const url = 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip';
  const ffmpegDir = path.join(app.getPath('userData'), 'ffmpeg');
  const zipPath = path.join(app.getPath('userData'), 'ffmpeg-download.zip');

  try {
    // Create ffmpeg directory
    if (!fs.existsSync(ffmpegDir)) {
      fs.mkdirSync(ffmpegDir, { recursive: true });
    }

    // Download
    mainWindow.webContents.send('ffmpeg-download-progress', { percent: 0, status: 'Downloading FFmpeg...' });
    await downloadFile(url, zipPath, (percent) => {
      mainWindow.webContents.send('ffmpeg-download-progress', { percent, status: `Downloading... ${percent}%` });
    });

    // Extract
    mainWindow.webContents.send('ffmpeg-download-progress', { percent: 100, status: 'Extracting...' });
    await extractZip(zipPath, ffmpegDir);

    // Find ffmpeg.exe in extracted directory
    const ffmpegExe = findFile(ffmpegDir, 'ffmpeg.exe');
    if (!ffmpegExe) {
      return { success: false, error: 'Could not find ffmpeg.exe in the downloaded archive.' };
    }

    // Save the path
    customFfmpegPath = ffmpegExe;
    saveSettings();

    // Cleanup zip
    try { fs.unlinkSync(zipPath); } catch { /* ignore */ }

    mainWindow.webContents.send('ffmpeg-download-progress', { percent: 100, status: 'Done!' });
    return { success: true, ffmpegPath: ffmpegExe };
  } catch (err) {
    // Cleanup zip on error
    try { fs.unlinkSync(zipPath); } catch { /* ignore */ }
    return { success: false, error: err.message || 'Download failed.' };
  }
});

// IPC: Open directory picker
ipcMain.handle('select-directory', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
  });
  if (result.canceled) return null;
  return result.filePaths[0];
});

// IPC: create temp capture session for incremental frame writes
ipcMain.handle('create-capture-session', async () => {
  const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'chronocamera-'));
  return { tempDir };
});

// IPC: save a single captured frame to temp session directory
ipcMain.handle('save-capture-frame', async (_event, { tempDir, frameIndex, dataUrl }) => {
  if (!tempDir || typeof tempDir !== 'string') {
    return { success: false, error: 'Invalid capture session directory.' };
  }
  if (!Number.isInteger(frameIndex) || frameIndex < 0) {
    return { success: false, error: 'Invalid frame index.' };
  }
  if (!dataUrl || typeof dataUrl !== 'string') {
    return { success: false, error: 'Invalid frame data.' };
  }

  const framePath = path.join(tempDir, `frame-${String(frameIndex).padStart(6, '0')}.png`);
  const base64Data = dataUrl.replace(/^data:image\/png;base64,/, '');

  try {
    await fsp.writeFile(framePath, Buffer.from(base64Data, 'base64'));
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message || 'Failed to save captured frame.' };
  }
});

// IPC: Encode frames to mp4
ipcMain.handle('encode-video', async (_event, { frames, tempDir, frameCount, saveDir, filename }) => {
  const hasTempFrames = tempDir && Number.isInteger(frameCount) && frameCount > 0;
  const hasMemoryFrames = Array.isArray(frames) && frames.length > 0;

  if (!hasTempFrames && !hasMemoryFrames) {
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
  const workingTempDir = hasTempFrames ? tempDir : fs.mkdtempSync(path.join(os.tmpdir(), 'chronocamera-'));

  try {
    // Backward-compatible path: write in-memory frames to a temp directory.
    if (hasMemoryFrames) {
      for (let i = 0; i < frames.length; i++) {
        const base64Data = frames[i].replace(/^data:image\/png;base64,/, '');
        const framePath = path.join(workingTempDir, `frame-${String(i).padStart(6, '0')}.png`);
        fs.writeFileSync(framePath, Buffer.from(base64Data, 'base64'));
      }
    }

    // Encode with FFmpeg
    await runFFmpeg(workingTempDir, outputPath);

    return { success: true, outputPath };
  } catch (err) {
    return { success: false, error: err.message || 'FFmpeg encoding failed.' };
  } finally {
    await removeDirRecursive(workingTempDir);
  }
});

function runFFmpeg(inputDir, outputPath) {
  return new Promise((resolve, reject) => {
    const inputPattern = path.join(inputDir, 'frame-%06d.png');
    const args = [
      '-y',
      '-framerate', '1/0.3', // Each input frame is displayed for 0.3 seconds
      '-i', inputPattern,
      '-vf', 'scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2',
      '-c:v', 'libx264',
      '-pix_fmt', 'yuv420p',
      '-r', '30',
      '-preset', 'fast',
      outputPath,
    ];

    const cmd = getFfmpegCommand();
    const ffmpeg = spawn(cmd, args);

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

/**
 * Download a file with progress callback
 */
function downloadFile(url, destPath, onProgress) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath);
    const request = (url.startsWith('https') ? https : http).get(url, (response) => {
      // Handle redirects
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        file.close();
        fs.unlinkSync(destPath);
        return downloadFile(response.headers.location, destPath, onProgress).then(resolve).catch(reject);
      }

      if (response.statusCode !== 200) {
        file.close();
        reject(new Error(`Download failed with status ${response.statusCode}`));
        return;
      }

      const totalSize = parseInt(response.headers['content-length'], 10);
      let downloaded = 0;

      response.on('data', (chunk) => {
        downloaded += chunk.length;
        if (totalSize && onProgress) {
          onProgress(Math.round((downloaded / totalSize) * 100));
        }
      });

      response.pipe(file);

      file.on('finish', () => {
        file.close();
        resolve();
      });
    });

    request.on('error', (err) => {
      file.close();
      try { fs.unlinkSync(destPath); } catch { /* ignore */ }
      reject(err);
    });
  });
}

/**
 * Extract a zip file using Node.js built-in (Electron ships with it)
 * Uses the unzip command on the system or a simple JS-based approach
 */
function extractZip(zipPath, destDir) {
  return new Promise((resolve, reject) => {
    // Use system tools for extraction
    if (process.platform === 'win32') {
      // Use PowerShell on Windows
      const ps = spawn('powershell', [
        '-NoProfile', '-Command',
        `Expand-Archive -Path '${zipPath}' -DestinationPath '${destDir}' -Force`
      ]);
      ps.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error('Failed to extract FFmpeg archive.'));
      });
      ps.on('error', reject);
    } else {
      // Use unzip on Linux/Mac
      const unzip = spawn('unzip', ['-o', zipPath, '-d', destDir]);
      unzip.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error('Failed to extract FFmpeg archive.'));
      });
      unzip.on('error', reject);
    }
  });
}

/**
 * Recursively find a file by name in a directory
 */
function findFile(dir, filename) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const found = findFile(fullPath, filename);
      if (found) return found;
    } else if (entry.name.toLowerCase() === filename.toLowerCase()) {
      return fullPath;
    }
  }
  return null;
}

async function removeDirRecursive(dirPath) {
  try {
    await fsp.rm(dirPath, { recursive: true, force: true });
  } catch { /* ignore cleanup errors */ }
}
