# chronocamera

A simple desktop timelapse app for webcam capture.

## Features
- Live webcam preview
- Start/stop timelapse recording
- Timelapse interval settings with defaults: 2s, 5s, 10s, 30s, 60s
- Custom interval in seconds
- Save directory input and optional filename input
- Always exports `.mp4` files at `1920x1080`
- If no filename is supplied, output uses: `chronocamera-{ISO8601_DATE}.mp4`

## Run
```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python app.py
```
