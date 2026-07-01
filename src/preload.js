const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  selectDirectory: () => ipcRenderer.invoke('select-directory'),
  startRecordingSession: (data) => ipcRenderer.invoke('start-recording-session', data),
  saveSnapshot: (data) => ipcRenderer.invoke('save-snapshot', data),
  createTimelapse: (data) => ipcRenderer.invoke('create-timelapse', data),
  checkFfmpeg: () => ipcRenderer.invoke('check-ffmpeg'),
  getPlatformInfo: () => ipcRenderer.invoke('get-platform-info'),
  downloadFfmpeg: () => ipcRenderer.invoke('download-ffmpeg'),
  onFfmpegDownloadProgress: (callback) => {
    ipcRenderer.on('ffmpeg-download-progress', (_event, data) => callback(data));
  },
});
