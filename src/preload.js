const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  selectDirectory: () => ipcRenderer.invoke('select-directory'),
  createCaptureSession: () => ipcRenderer.invoke('create-capture-session'),
  saveCaptureFrame: (data) => ipcRenderer.invoke('save-capture-frame', data),
  discardCaptureSession: (tempDir) => ipcRenderer.invoke('discard-capture-session', tempDir),
  encodeVideo: (data) => ipcRenderer.invoke('encode-video', data),
  checkFfmpeg: () => ipcRenderer.invoke('check-ffmpeg'),
  getPlatformInfo: () => ipcRenderer.invoke('get-platform-info'),
  downloadFfmpeg: () => ipcRenderer.invoke('download-ffmpeg'),
  onFfmpegDownloadProgress: (callback) => {
    ipcRenderer.on('ffmpeg-download-progress', (_event, data) => callback(data));
  },
});
