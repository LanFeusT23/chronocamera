const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  selectDirectory: () => ipcRenderer.invoke('select-directory'),
  encodeVideo: (data) => ipcRenderer.invoke('encode-video', data),
  checkFfmpeg: () => ipcRenderer.invoke('check-ffmpeg'),
  getPlatformInfo: () => ipcRenderer.invoke('get-platform-info'),
  downloadFfmpeg: () => ipcRenderer.invoke('download-ffmpeg'),
  onFfmpegDownloadProgress: (callback) => {
    ipcRenderer.on('ffmpeg-download-progress', (_event, data) => callback(data));
  },
});
