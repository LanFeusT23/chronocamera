// ChronoCamera Renderer Process
(function () {
  'use strict';

  const DEFAULT_INTERVALS = [2, 5, 10, 30, 60];
  const EXPORT_WIDTH = 1920;
  const EXPORT_HEIGHT = 1080;

  // DOM elements
  const videoEl = document.getElementById('webcam-preview');
  const canvasEl = document.getElementById('capture-canvas');
  const recordBtn = document.getElementById('record-btn');
  const timelapseBtn = document.getElementById('timelapse-btn');
  const settingsBtn = document.getElementById('settings-btn');
  const intervalLabel = document.getElementById('interval-label');
  const saveDirInput = document.getElementById('save-dir');
  const browseBtn = document.getElementById('browse-btn');
  const filenameInput = document.getElementById('filename');
  const statusBar = document.getElementById('status-bar');
  const captureProgressContainer = document.getElementById('capture-progress-container');
  const captureProgressBar = document.getElementById('capture-progress-bar');
  const settingsModal = document.getElementById('settings-modal');
  const settingsSaveBtn = document.getElementById('settings-save-btn');
  const settingsCancelBtn = document.getElementById('settings-cancel-btn');
  const customIntervalInput = document.getElementById('custom-interval');

  // State
  let captureIntervalSeconds = DEFAULT_INTERVALS[0];
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
    setStatus('Creating timelapse video...');

    const result = await window.electronAPI.createTimelapse({ sessionPath });

    timelapseBtn.disabled = false;
    recordBtn.disabled = false;

    if (result.success) {
      setStatus(`Timelapse saved: ${result.outputPath}`);
      alert(`Timelapse video saved to:\n${result.outputPath}`);
      timelapseBtn.classList.add('hidden');
    } else {
      setStatus('Failed to create timelapse.');
      alert(`Timelapse creation failed:\n${result.error}`);
    }
  });

  // Browse directory
  browseBtn.addEventListener('click', async () => {
    const dir = await window.electronAPI.selectDirectory();
    if (dir) saveDirInput.value = dir;
  });

  // Settings modal
  settingsBtn.addEventListener('click', () => {
    // Sync current state to modal
    const radios = settingsModal.querySelectorAll('input[name="interval"]');
    let found = false;
    radios.forEach((radio) => {
      if (radio.value === String(captureIntervalSeconds)) {
        radio.checked = true;
        found = true;
      } else if (radio.value === 'custom' && !found) {
        // will handle below
      } else {
        radio.checked = false;
      }
    });
    if (!found) {
      const customRadio = settingsModal.querySelector('input[value="custom"]');
      customRadio.checked = true;
      customIntervalInput.value = captureIntervalSeconds;
      customIntervalInput.disabled = false;
    } else {
      customIntervalInput.disabled = true;
      customIntervalInput.value = '';
    }
    // Sync timestamp overlay checkbox
    document.getElementById('timestamp-overlay').checked = timestampOverlayEnabled;
    settingsModal.classList.remove('hidden');
  });

  // Toggle custom input when radio changes
  settingsModal.addEventListener('change', (e) => {
    if (e.target.name === 'interval') {
      customIntervalInput.disabled = e.target.value !== 'custom';
      if (e.target.value === 'custom') customIntervalInput.focus();
    }
  });

  settingsSaveBtn.addEventListener('click', () => {
    const selected = settingsModal.querySelector('input[name="interval"]:checked');
    if (!selected) return;

    if (selected.value === 'custom') {
      const val = parseInt(customIntervalInput.value, 10);
      if (!val || val <= 0) {
        alert('Custom interval must be a positive integer (1 or greater).');
        return;
      }
      captureIntervalSeconds = val;
    } else {
      captureIntervalSeconds = parseInt(selected.value, 10);
    }

    // Save timestamp overlay setting
    const timestampCheckbox = document.getElementById('timestamp-overlay');
    timestampOverlayEnabled = timestampCheckbox.checked;

    intervalLabel.textContent = `Interval: ${captureIntervalSeconds}s`;
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
