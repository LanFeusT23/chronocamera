// ChronoCamera Renderer Process
(function () {
  'use strict';

  const DEFAULT_FRAME_DURATION = 0.3;
  const EXPORT_WIDTH = 1920;
  const EXPORT_HEIGHT = 1080;

  function formatFrameDuration(value) {
    return `${parseFloat(value).toFixed(2).replace(/\.?0+$/, '')}s`;
  }

  // DOM elements
  const videoEl = document.getElementById('webcam-preview');
  const canvasEl = document.getElementById('capture-canvas');
  const recordBtn = document.getElementById('record-btn');
  const timelapseBtn = document.getElementById('timelapse-btn');
  const openFolderBtn = document.getElementById('open-folder-btn');
  const settingsBtn = document.getElementById('settings-btn');
  const intervalLabel = document.getElementById('interval-label');
  const speedLabel = document.getElementById('speed-label');
  const saveDirInput = document.getElementById('save-dir');
  const browseBtn = document.getElementById('browse-btn');
  const filenameInput = document.getElementById('filename');
  const statusBar = document.getElementById('status-bar');
  const captureProgressContainer = document.getElementById('capture-progress-container');
  const captureProgressBar = document.getElementById('capture-progress-bar');
  const encodeProgressContainer = document.getElementById('encode-progress-container');
  const encodeProgressBar = document.getElementById('encode-progress-bar');
  const encodeProgressText = document.getElementById('encode-progress-text');
  const settingsModal = document.getElementById('settings-modal');
  const settingsSaveBtn = document.getElementById('settings-save-btn');
  const settingsCancelBtn = document.getElementById('settings-cancel-btn');
  const intervalSlider = document.getElementById('interval-slider');
  const intervalSliderValue = document.getElementById('interval-slider-value');
  const speedSlider = document.getElementById('speed-slider');
  const speedSliderValue = document.getElementById('speed-slider-value');

  // State
  let captureIntervalSeconds = DEFAULT_INTERVALS[0];
  let frameDurationSeconds = DEFAULT_FRAME_DURATION;
  let recording = false;
  let captureTimerId = null;
  let captureBusy = false;
  let stream = null;
  let timestampOverlayEnabled = false;
  let recordingStartTime = null;
  let lastCaptureTime = null;
  let progressRafId = null;
  let sessionPath = null;
  let sessionBaseName = null;
  let sessionSaveDir = null;
  let sessionSnapshotCount = 0;

  // Canvas context for frame capture
  canvasEl.width = EXPORT_WIDTH;
  canvasEl.height = EXPORT_HEIGHT;
  const ctx = canvasEl.getContext('2d');

  // Initialize webcam
  async function initWebcam() {
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false,
      });
      videoEl.srcObject = stream;
      setStatus('Idle');
    } catch (err) {
      setStatus('Error: Unable to access webcam. Check that a webcam is connected and not in use.');
      console.error('Webcam error:', err);
    }
  }

  function setStatus(text) {
    statusBar.textContent = text;
  }

  // Frame capture — saves snapshot as JPEG to the session folder on disk
  async function captureFrame() {
    if (captureBusy || !stream || !videoEl.videoWidth) return;
    captureBusy = true;
    try {
      ctx.drawImage(videoEl, 0, 0, EXPORT_WIDTH, EXPORT_HEIGHT);

      if (timestampOverlayEnabled) {
        drawTimestamp();
      }

      const captureDate = new Date().toISOString();
      const imageData = canvasEl.toDataURL('image/jpeg', 0.92);

      const result = await window.electronAPI.saveSnapshot({
        sessionPath,
        baseName: sessionBaseName,
        imageData,
        captureDate,
      });

      if (result.success) {
        sessionSnapshotCount++;
        setStatus(`Recording... ${sessionSnapshotCount} snapshot${sessionSnapshotCount !== 1 ? 's' : ''} saved`);
      } else {
        console.error('Snapshot save failed:', result.error);
      }

      lastCaptureTime = Date.now();
    } finally {
      captureBusy = false;
    }
  }

  function drawTimestamp() {
    const elapsed = recordingStartTime ? Math.floor((Date.now() - recordingStartTime) / 1000) : 0;
    const hours = String(Math.floor(elapsed / 3600)).padStart(2, '0');
    const minutes = String(Math.floor((elapsed % 3600) / 60)).padStart(2, '0');
    const seconds = String(elapsed % 60).padStart(2, '0');
    const text = `${hours}:${minutes}:${seconds}`;

    const fontSize = 36;
    const padding = 16;
    ctx.font = `bold ${fontSize}px monospace`;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'top';

    // Draw background for readability
    const metrics = ctx.measureText(text);
    const bgX = EXPORT_WIDTH - padding - metrics.width - 8;
    const bgY = padding - 4;
    const bgW = metrics.width + 16;
    const bgH = fontSize + 12;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.fillRect(bgX, bgY, bgW, bgH);

    // Draw text
    ctx.fillStyle = '#ffffff';
    ctx.fillText(text, EXPORT_WIDTH - padding, padding);
  }

  async function startCapture() {
    sessionSnapshotCount = 0;
    recordingStartTime = Date.now();
    lastCaptureTime = null;

    const result = await window.electronAPI.startRecordingSession({
      saveDir: sessionSaveDir,
      filename: filenameInput.value.trim(),
    });

    if (!result.success) {
      setStatus(`Failed to start session: ${result.error}`);
      alert(`Could not create session folder:\n${result.error}`);
      recording = false;
      recordBtn.textContent = 'Start Recording';
      recordBtn.classList.remove('recording');
      return;
    }

    sessionPath = result.sessionPath;
    sessionBaseName = result.baseName;

    // Capture first frame immediately, then on interval
    await captureFrame();
    captureTimerId = setInterval(() => { captureFrame(); }, captureIntervalSeconds * 1000);
    captureProgressContainer.classList.remove('hidden');
    startProgressAnimation();
  }

  function stopCapture() {
    if (captureTimerId !== null) {
      clearInterval(captureTimerId);
      captureTimerId = null;
    }
    recordingStartTime = null;
    lastCaptureTime = null;
    stopProgressAnimation();
    captureProgressContainer.classList.add('hidden');
    captureProgressBar.style.width = '0%';
  }

  function startProgressAnimation() {
    const intervalMs = captureIntervalSeconds * 1000;
    function tick() {
      if (lastCaptureTime !== null) {
        const elapsed = Date.now() - lastCaptureTime;
        const pct = Math.min(elapsed / intervalMs, 1) * 100;
        captureProgressBar.style.width = `${pct}%`;
      }
      progressRafId = requestAnimationFrame(tick);
    }
    progressRafId = requestAnimationFrame(tick);
  }

  function stopProgressAnimation() {
    if (progressRafId !== null) {
      cancelAnimationFrame(progressRafId);
      progressRafId = null;
    }
  }

  // Recording toggle
  recordBtn.addEventListener('click', async () => {
    if (!recording) {
      // Validate save directory
      const saveDir = saveDirInput.value.trim();
      if (!saveDir) {
        alert('Please select a directory to save the snapshots.');
        return;
      }
      recording = true;
      sessionSaveDir = saveDir;
      recordBtn.textContent = 'Stop Recording';
      recordBtn.classList.add('recording');
      timelapseBtn.classList.add('hidden');
      setStatus('Starting recording session...');
      await startCapture();
    } else {
      recording = false;
      recordBtn.textContent = 'Start Recording';
      recordBtn.classList.remove('recording');
      stopCapture();

      if (sessionSnapshotCount === 0) {
        setStatus('No snapshots captured.');
        alert('No snapshots were captured during this recording.');
        return;
      }

      setStatus(`Recording stopped — ${sessionSnapshotCount} snapshot${sessionSnapshotCount !== 1 ? 's' : ''} saved to: ${sessionPath}`);
      timelapseBtn.classList.remove('hidden');
    }
  });

  // Create Timelapse button
  timelapseBtn.addEventListener('click', async () => {
    if (!sessionPath) {
      alert('No recording session found.');
      return;
    }

    timelapseBtn.disabled = true;
    recordBtn.disabled = true;
    openFolderBtn.disabled = true;
    encodeProgressContainer.classList.remove('hidden');
    encodeProgressBar.style.width = '0%';
    encodeProgressText.textContent = '0%';
    setStatus('Creating timelapse video...');

    const result = await window.electronAPI.createTimelapse({ sessionPath, frameDuration: frameDurationSeconds });

    encodeProgressContainer.classList.add('hidden');
    timelapseBtn.disabled = false;
    recordBtn.disabled = false;
    openFolderBtn.disabled = false;

    if (result.success) {
      setStatus(`Timelapse saved: ${result.outputPath}`);
      alert(`Timelapse video saved to:\n${result.outputPath}`);
      timelapseBtn.classList.add('hidden');
    } else {
      setStatus('Failed to create timelapse.');
      alert(`Timelapse creation failed:\n${result.error}`);
    }
  });

  // Open existing folder of images for timelapse reprocessing
  openFolderBtn.addEventListener('click', async () => {
    const info = await window.electronAPI.openFolderForTimelapse();
    if (!info) return;

    if (info.imageCount === 0) {
      alert('No images (JPG/JPEG/PNG) found in the selected folder.');
      return;
    }

    sessionPath = info.folderPath;
    sessionBaseName = info.folderPath.replace(/\\/g, '/').split('/').pop() || info.folderPath;
    sessionSnapshotCount = info.imageCount;
    setStatus(`Opened folder: ${info.imageCount} image${info.imageCount !== 1 ? 's' : ''} found — ${info.folderPath}`);
    timelapseBtn.classList.remove('hidden');
  });

  // Listen for encoding progress events
  window.electronAPI.onTimelapseProgress((data) => {
    const pct = Math.min(data.percent, 100);
    encodeProgressBar.style.width = `${pct}%`;
    encodeProgressText.textContent = `${pct}%`;
  });

  // Browse directory
  browseBtn.addEventListener('click', async () => {
    const dir = await window.electronAPI.selectDirectory();
    if (dir) saveDirInput.value = dir;
  });

  // Settings modal
  settingsBtn.addEventListener('click', () => {
    // Sync capture interval to slider
    intervalSlider.value = captureIntervalSeconds;
    intervalSliderValue.textContent = `${captureIntervalSeconds}s`;

    // Sync frame duration to slider
    speedSlider.value = frameDurationSeconds;
    speedSliderValue.textContent = formatFrameDuration(frameDurationSeconds);

    // Sync timestamp overlay checkbox
    document.getElementById('timestamp-overlay').checked = timestampOverlayEnabled;
    settingsModal.classList.remove('hidden');
  });

  // Live-update slider value labels
  intervalSlider.addEventListener('input', () => {
    intervalSliderValue.textContent = `${intervalSlider.value}s`;
  });

  speedSlider.addEventListener('input', () => {
    speedSliderValue.textContent = formatFrameDuration(speedSlider.value);
  });

  settingsSaveBtn.addEventListener('click', () => {
    captureIntervalSeconds = parseInt(intervalSlider.value, 10);
    frameDurationSeconds = parseFloat(speedSlider.value);

    // Save timestamp overlay setting
    const timestampCheckbox = document.getElementById('timestamp-overlay');
    timestampOverlayEnabled = timestampCheckbox.checked;

    intervalLabel.textContent = `Interval: ${captureIntervalSeconds}s`;
    speedLabel.textContent = `Frame: ${frameDurationSeconds}s`;
    settingsModal.classList.add('hidden');
  });

  settingsCancelBtn.addEventListener('click', () => {
    settingsModal.classList.add('hidden');
  });

  // FFmpeg modal elements
  const ffmpegModal = document.getElementById('ffmpeg-modal');
  const ffmpegPlatformInfo = document.getElementById('ffmpeg-platform-info');
  const ffmpegDownloadBtn = document.getElementById('ffmpeg-download-btn');
  const ffmpegCloseBtn = document.getElementById('ffmpeg-close-btn');
  const ffmpegProgressContainer = document.getElementById('ffmpeg-progress-container');
  const ffmpegProgressBar = document.getElementById('ffmpeg-progress-bar');
  const ffmpegProgressStatus = document.getElementById('ffmpeg-progress-status');
  const ffmpegError = document.getElementById('ffmpeg-error');
  const ffmpegSuccess = document.getElementById('ffmpeg-success');

  // Check FFmpeg availability on startup
  async function checkFfmpegAvailability() {
    const available = await window.electronAPI.checkFfmpeg();
    if (!available) {
      showFfmpegModal();
    }
  }

  async function showFfmpegModal() {
    const { platform } = await window.electronAPI.getPlatformInfo();

    if (platform === 'win32') {
      ffmpegPlatformInfo.innerHTML = `
        <p>Click <strong>Download FFmpeg</strong> to automatically download and install FFmpeg for Windows.</p>
        <p>Source: <span style="color: #5b9bd5;">gyan.dev/ffmpeg/builds</span></p>
      `;
      ffmpegDownloadBtn.style.display = '';
    } else if (platform === 'linux') {
      ffmpegPlatformInfo.innerHTML = `
        <p>Install FFmpeg using your package manager:</p>
        <p><code>sudo apt install ffmpeg</code></p>
        <p>or</p>
        <p><code>sudo dnf install ffmpeg</code></p>
      `;
      ffmpegDownloadBtn.style.display = 'none';
    } else {
      ffmpegPlatformInfo.innerHTML = `
        <p>Please install FFmpeg manually and ensure it is in your system PATH.</p>
        <p>Visit: <span style="color: #5b9bd5;">ffmpeg.org/download.html</span></p>
      `;
      ffmpegDownloadBtn.style.display = 'none';
    }

    ffmpegModal.classList.remove('hidden');
  }

  ffmpegDownloadBtn.addEventListener('click', async () => {
    ffmpegDownloadBtn.disabled = true;
    ffmpegError.classList.add('hidden');
    ffmpegSuccess.classList.add('hidden');
    ffmpegProgressContainer.classList.remove('hidden');
    ffmpegProgressBar.style.width = '0%';
    ffmpegProgressStatus.textContent = 'Starting download...';

    const result = await window.electronAPI.downloadFfmpeg();

    if (result.success) {
      ffmpegSuccess.classList.remove('hidden');
      ffmpegProgressContainer.classList.add('hidden');
      ffmpegDownloadBtn.style.display = 'none';
    } else {
      ffmpegError.textContent = result.error;
      ffmpegError.classList.remove('hidden');
      ffmpegProgressContainer.classList.add('hidden');
      ffmpegDownloadBtn.disabled = false;
    }
  });

  // Listen for download progress
  window.electronAPI.onFfmpegDownloadProgress((data) => {
    ffmpegProgressBar.style.width = `${data.percent}%`;
    ffmpegProgressStatus.textContent = data.status;
  });

  ffmpegCloseBtn.addEventListener('click', () => {
    ffmpegModal.classList.add('hidden');
  });

  // Initialize
  initWebcam();
  checkFfmpegAvailability();
})();
