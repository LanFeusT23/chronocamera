import datetime as dt
import os
import time
import tkinter as tk
from pathlib import Path
from tkinter import filedialog, messagebox, ttk

import cv2
from PIL import Image, ImageTk

DEFAULT_INTERVALS = (2, 5, 10, 30, 60)
DEFAULT_EXPORT_SIZE = (1920, 1080)
DEFAULT_OUTPUT_FPS = 30
DEFAULT_PREVIEW_SIZE = (960, 540)
DEFAULT_MP4_CODECS = ("avc1", "mp4v")


class ChronoCameraApp:
    def __init__(self, root: tk.Tk) -> None:
        self.root = root
        self.root.title("ChronoCamera")

        self.capture = cv2.VideoCapture(0)
        if not self.capture.isOpened():
            raise RuntimeError("Unable to open webcam")

        self.capture_interval_seconds = DEFAULT_INTERVALS[0]
        self.recording = False
        self.next_capture_time = 0.0
        self.captured_frames = []
        self.current_frame = None

        self.save_dir_var = tk.StringVar(value=str(Path.cwd()))
        self.filename_var = tk.StringVar()
        self.interval_label_var = tk.StringVar(value=f"Interval: {self.capture_interval_seconds}s")

        self.preview_label = ttk.Label(root)
        self.preview_label.pack(fill="both", expand=True, padx=12, pady=(12, 8))

        controls = ttk.Frame(root)
        controls.pack(fill="x", padx=12, pady=(0, 12))

        self.record_button = ttk.Button(controls, text="Start Recording", command=self.toggle_recording)
        self.record_button.grid(row=0, column=0, sticky="w")

        ttk.Button(controls, text="Settings", command=self.open_settings).grid(row=0, column=1, padx=8, sticky="w")
        ttk.Label(controls, textvariable=self.interval_label_var).grid(row=0, column=2, sticky="w")

        ttk.Label(controls, text="Save directory:").grid(row=1, column=0, pady=(10, 0), sticky="w")
        ttk.Entry(controls, textvariable=self.save_dir_var, width=48).grid(row=1, column=1, columnspan=2, padx=(8, 8), pady=(10, 0), sticky="we")
        ttk.Button(controls, text="Browse", command=self.browse_directory).grid(row=1, column=3, pady=(10, 0), sticky="w")

        ttk.Label(controls, text="Optional filename:").grid(row=2, column=0, pady=(8, 0), sticky="w")
        ttk.Entry(controls, textvariable=self.filename_var, width=48).grid(row=2, column=1, columnspan=3, padx=(8, 0), pady=(8, 0), sticky="we")

        controls.columnconfigure(2, weight=1)

        self.status_var = tk.StringVar(value="Idle")
        ttk.Label(root, textvariable=self.status_var).pack(fill="x", padx=12, pady=(0, 12))

        self.root.protocol("WM_DELETE_WINDOW", self.on_close)
        self.update_preview()

    def browse_directory(self) -> None:
        selected = filedialog.askdirectory(initialdir=self.save_dir_var.get() or str(Path.cwd()))
        if selected:
            self.save_dir_var.set(selected)

    def open_settings(self) -> None:
        dialog = tk.Toplevel(self.root)
        dialog.title("Timelapse settings")
        dialog.transient(self.root)
        dialog.grab_set()

        selected_mode = tk.StringVar(value=str(self.capture_interval_seconds if self.capture_interval_seconds in DEFAULT_INTERVALS else "custom"))
        custom_var = tk.StringVar(value="" if self.capture_interval_seconds in DEFAULT_INTERVALS else str(self.capture_interval_seconds))
        custom_entry = ttk.Entry(dialog, textvariable=custom_var, width=10)

        def toggle_custom() -> None:
            self._toggle_custom_state(selected_mode, custom_entry)

        ttk.Label(dialog, text="Choose interval:").grid(row=0, column=0, sticky="w", padx=12, pady=(12, 8))

        row = 1
        for interval in DEFAULT_INTERVALS:
            ttk.Radiobutton(
                dialog,
                text=f"{interval}s",
                value=str(interval),
                variable=selected_mode,
                command=toggle_custom,
            ).grid(row=row, column=0, sticky="w", padx=12)
            row += 1

        ttk.Radiobutton(
            dialog,
            text="Custom (seconds):",
            value="custom",
            variable=selected_mode,
            command=toggle_custom,
        ).grid(row=row, column=0, sticky="w", padx=12, pady=(2, 0))
        custom_entry.grid(row=row, column=1, sticky="w", padx=(0, 12), pady=(2, 0))

        self._toggle_custom_state(selected_mode, custom_entry)

        def save_settings() -> None:
            mode = selected_mode.get()
            if mode == "custom":
                try:
                    value = int(custom_var.get().strip())
                    if value <= 0:
                        raise ValueError
                except ValueError:
                    messagebox.showerror("Invalid interval", "Custom interval must be a positive integer.", parent=dialog)
                    return
            else:
                value = int(mode)

            self.capture_interval_seconds = value
            self.interval_label_var.set(f"Interval: {self.capture_interval_seconds}s")
            dialog.destroy()

        buttons = ttk.Frame(dialog)
        buttons.grid(row=row + 1, column=0, columnspan=2, sticky="e", padx=12, pady=12)
        ttk.Button(buttons, text="Cancel", command=dialog.destroy).pack(side="right")
        ttk.Button(buttons, text="Save", command=save_settings).pack(side="right", padx=(0, 8))

    @staticmethod
    def _toggle_custom_state(selected_mode: tk.StringVar, custom_entry: ttk.Entry) -> None:
        custom_entry.configure(state="normal" if selected_mode.get() == "custom" else "disabled")

    def toggle_recording(self) -> None:
        if self.recording:
            self.stop_recording()
        else:
            self.start_recording()

    def start_recording(self) -> None:
        save_dir = self.save_dir_var.get().strip()
        if not save_dir:
            messagebox.showerror("Missing save directory", "Please select a directory to save the video.")
            return
        if not os.path.isdir(save_dir):
            messagebox.showerror("Invalid save directory", "The selected save directory does not exist.")
            return

        self.captured_frames = []
        self.recording = True
        self.next_capture_time = time.time()
        self.record_button.configure(text="Stop Recording")
        self.status_var.set("Recording timelapse...")

    def stop_recording(self) -> None:
        self.recording = False
        self.record_button.configure(text="Start Recording")

        if not self.captured_frames:
            self.status_var.set("No frames captured.")
            messagebox.showwarning("No frames", "No frames were captured during this recording.")
            return

        output_path = self._build_output_path()
        success = self._write_video(output_path)
        if success:
            self.status_var.set(f"Saved: {output_path}")
            messagebox.showinfo("Saved", f"Timelapse saved to:\n{output_path}")
        else:
            self.status_var.set("Failed to save video.")
            messagebox.showerror("Save failed", "Unable to save MP4 output.")

    def _build_output_path(self) -> str:
        save_dir = Path(self.save_dir_var.get().strip())
        filename = self.filename_var.get().strip()

        if filename:
            filename = Path(filename).stem
        else:
            timestamp = dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
            filename = f"chronocamera-{timestamp}"

        return str(save_dir / f"{filename}.mp4")

    @staticmethod
    def _create_video_writer(output_path: str) -> cv2.VideoWriter | None:
        for codec in DEFAULT_MP4_CODECS:
            attempt = cv2.VideoWriter(output_path, cv2.VideoWriter_fourcc(*codec), DEFAULT_OUTPUT_FPS, DEFAULT_EXPORT_SIZE)
            if attempt.isOpened():
                return attempt
            attempt.release()
        return None

    def _write_video(self, output_path: str) -> bool:
        writer = self._create_video_writer(output_path)
        if writer is None:
            return False

        for frame in self.captured_frames:
            resized = cv2.resize(frame, DEFAULT_EXPORT_SIZE)
            writer.write(resized)

        writer.release()
        return True

    def update_preview(self) -> None:
        ret, frame = self.capture.read()
        if ret:
            self.current_frame = frame
            rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            image = Image.fromarray(rgb)
            image.thumbnail(DEFAULT_PREVIEW_SIZE)
            photo = ImageTk.PhotoImage(image=image)
            self.preview_label.configure(image=photo)
            self.preview_label.image = photo

            if self.recording:
                now = time.time()
                if now >= self.next_capture_time:
                    self.captured_frames.append(frame.copy())
                    self.next_capture_time = now + self.capture_interval_seconds
                    self.status_var.set(f"Recording timelapse... Frames: {len(self.captured_frames)}")

        self.root.after(30, self.update_preview)

    def on_close(self) -> None:
        try:
            self.capture.release()
        finally:
            self.root.destroy()


def main() -> None:
    root = tk.Tk()
    ChronoCameraApp(root)
    root.minsize(900, 640)
    root.mainloop()


if __name__ == "__main__":
    main()
