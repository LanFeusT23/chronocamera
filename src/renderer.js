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
  const settingsBtn = document.getElementById('settings-btn');
  const intervalLabel = document.getElementById('interval-label');
  const saveDirInput = document.getElementById('save-dir');
  const browseBtn = document.getElementById('browse-btn');
  const filenameInput = document.getElementById('filename');
  const statusBar = document.getElementById('status-bar');
  const settingsModal = document.getElementById('settings-modal');
  const settingsSaveBtn = document.getElementById('settings-save-btn');
  const settingsCancelBtn = document.getElementById('settings-cancel-btn');
  const customIntervalInput = document.getElementById('custom-interval');

  // State
  let captureIntervalSeconds = DEFAULT_INTERVALS[0];
  let recording = false;
  let capturedFrames = [];
  let captureTimerId = null;
  let stream = null;

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

  // Frame capture
  function captureFrame() {
    if (!stream || !videoEl.videoWidth) return;
    ctx.drawImage(videoEl, 0, 0, EXPORT_WIDTH, EXPORT_HEIGHT);
    const dataUrl = canvasEl.toDataURL('image/png');
    capturedFrames.push(dataUrl);
    setStatus(`Recording timelapse... Frames: ${capturedFrames.length}`);
  }

  function startCapture() {
    capturedFrames = [];
    captureFrame(); // Capture first frame immediately
    captureTimerId = setInterval(captureFrame, captureIntervalSeconds * 1000);
  }

  function stopCapture() {
    if (captureTimerId !== null) {
      clearInterval(captureTimerId);
      captureTimerId = null;
    }
  }

  // Recording toggle
  recordBtn.addEventListener('click', async () => {
    if (!recording) {
      // Validate save directory
      const saveDir = saveDirInput.value.trim();
      if (!saveDir) {
        alert('Please select a directory to save the video.');
        return;
      }
      recording = true;
      recordBtn.textContent = 'Stop Recording';
      recordBtn.classList.add('recording');
      setStatus('Recording timelapse...');
      startCapture();
    } else {
      recording = false;
      recordBtn.textContent = 'Start Recording';
      recordBtn.classList.remove('recording');
      stopCapture();

      if (capturedFrames.length === 0) {
        setStatus('No frames captured.');
        alert('No frames were captured during this recording.');
        return;
      }

      setStatus('Encoding video...');
      recordBtn.disabled = true;

      const result = await window.electronAPI.encodeVideo({
        frames: capturedFrames,
        saveDir: saveDirInput.value.trim(),
        filename: filenameInput.value.trim(),
      });

      recordBtn.disabled = false;

      if (result.success) {
        setStatus(`Saved: ${result.outputPath}`);
        alert(`Timelapse saved to:\n${result.outputPath}`);
      } else {
        setStatus('Failed to save video.');
        alert(`Save failed: ${result.error}`);
      }

      capturedFrames = [];
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

    intervalLabel.textContent = `Interval: ${captureIntervalSeconds}s`;
    settingsModal.classList.add('hidden');
  });

  settingsCancelBtn.addEventListener('click', () => {
    settingsModal.classList.add('hidden');
  });

  // Initialize
  initWebcam();
})();
