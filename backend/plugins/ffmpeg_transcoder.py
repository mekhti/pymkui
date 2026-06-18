"""
FFmpeg transcoding plugin (on_media_changed)

When a media source registers (comes online), start an FFmpeg process to transcode;
When a media source unregisters (goes offline), stop the FFmpeg process.

Supports:
  - Custom FFmpeg command-line arguments
  - vhost / app / stream source filtering (wildcard * supported)
  - Command-line argument variable substitution: {vhost} {app} {stream}
  - multi_binding=True: can bind multiple times, each instance using different transcoding params
"""

import fnmatch
import threading
import subprocess
import os
import signal
import mk_loader
import mk_logger
from py_plugin import PluginBase


# ── Global transcoding-process state table ────────────────────────────────────────────────────
# state_key → FFmpeg process object
_transcoder_processes: dict = {}
_lock = threading.Lock()


# ── Plugin class ────────────────────────────────────────────────────────────

class FFMpegTranscoder(PluginBase):
    name        = "ffmpeg_transcoder"
    version     = "1.0.0"
    description = (
        "FFmpeg transcoding plugin (on_media_changed)."
        "Starts an FFmpeg process to transcode when the stream comes online, "
        "stops the FFmpeg process when the stream goes offline."
        "Supports custom command-line arguments and {vhost}/{app}/{stream} variable substitution."
    )
    type          = "on_media_changed"
    interruptible = False   # listening type: doesn't intercept events, continues dispatching to subsequent plugins
    multi_binding = True    # supports multiple instances, each using different transcoding params

    def params(self) -> dict:
        return {
            "ffmpeg_cmd": {
                "type": "str",
                "description": (
                    "FFmpeg command-line arguments; supported variables: {vhost} {app} {stream}, "
                    "e.g.: -i rtsp://localhost:554/{app}/{stream} -c:v libx264 -c:a aac -f flv rtmp://localhost/live/{stream}_transcoded"
                ),
                "default": "",
            },
            "vhost_filter": {
                "type": "str",
                "description": "Source vhost filter; wildcard * supported; matches all by default",
                "default": "*",
            },
            "app_filter": {
                "type": "str",
                "description": "Source app filter; wildcard * supported; matches all by default",
                "default": "*",
            },
            "stream_filter": {
                "type": "str",
                "description": "Source stream filter; wildcard * supported; matches all by default",
                "default": "*",
            },
            "schema_filter": {
                "type": "str",
                "description": (
                    "Triggers only for the specified source protocols; separate multiple with commas; "
                    "e.g. rtsp,rtmp. Empty matches all protocols."
                ),
                "default": "",
            },
        }

    def run(self, **kwargs) -> bool:
        is_register: bool    = kwargs.get("is_register", False)
        sender               = kwargs.get("sender")
        binding_params: dict = kwargs.get("binding_params") or {}

        if sender is None:
            return False

        # Synchronously get source stream info (sender is a temporary object, can't be referenced in async coroutines)
        try:
            src_schema = sender.getSchema()
            mt     = sender.getMediaTuple()
            vhost  = mt.vhost
            app    = mt.app
            stream = mt.stream
        except Exception as e:
            mk_logger.log_warn(f"[ffmpeg_transcoder] Exception getting stream info: {e}")
            return False

        # Read binding params (instance params take priority; fall back to params() defaults)
        p = self.params()
        def _get(key):
            return binding_params.get(key, p[key]["default"])

        ffmpeg_cmd   = str(_get("ffmpeg_cmd")).strip()
        vhost_filter  = str(_get("vhost_filter")  or "*")
        app_filter    = str(_get("app_filter")    or "*")
        stream_filter = str(_get("stream_filter") or "*")
        schema_filter = str(_get("schema_filter") or "").strip().lower()

        if not ffmpeg_cmd:
            return False

        # ── Source filtering ──
        if not fnmatch.fnmatch(vhost,  vhost_filter):  return False
        if not fnmatch.fnmatch(app,    app_filter):    return False
        if not fnmatch.fnmatch(stream, stream_filter): return False
        if schema_filter:
            allowed = [s.strip() for s in schema_filter.split(",") if s.strip()]
            if allowed and src_schema.lower() not in allowed:
                return False

        # ── Variable substitution to generate the actual command line ──
        # Get the FFmpeg executable path
        ffmpeg_bin = mk_loader.get_config('ffmpeg.bin') or 'ffmpeg'
        # Build the full command
        cmd = f"{ffmpeg_bin} {ffmpeg_cmd}"
        # Variable substitution
        cmd = (cmd
               .replace("{vhost}",  vhost)
               .replace("{app}",    app)
               .replace("{stream}", stream))

        # State key: command template + stream identifier, uniquely identifying one transcoding task
        state_key = f"{ffmpeg_cmd}|{vhost}|{app}|{stream}"

        if is_register:
            with _lock:
                if state_key in _transcoder_processes:
                    mk_logger.log_info(
                        f"[ffmpeg_transcoder] Transcoding process already exists, skipping duplicate start "
                        f"{vhost}/{app}/{stream}"
                    )
                    return False

            # Start the FFmpeg process
            try:
                # Use shell=True to execute the full command line
                process = subprocess.Popen(cmd, shell=True, preexec_fn=os.setsid)
                with _lock:
                    _transcoder_processes[state_key] = process
                mk_logger.log_info(
                    f"[ffmpeg_transcoder] Transcoding process started {vhost}/{app}/{stream} → command: {cmd}"
                )
            except Exception as e:
                mk_logger.log_warn(f"[ffmpeg_transcoder] Failed to start transcoding process: {e}")
        else:
            with _lock:
                process = _transcoder_processes.pop(state_key, None)
            if process:
                try:
                    # Terminate the process group to ensure all child processes are killed
                    os.killpg(os.getpgid(process.pid), signal.SIGTERM)
                    process.wait(timeout=5)
                    mk_logger.log_info(
                        f"[ffmpeg_transcoder] Transcoding process stopped {vhost}/{app}/{stream}"
                    )
                except Exception as e:
                    mk_logger.log_warn(f"[ffmpeg_transcoder] Failed to stop transcoding process: {e}")
            else:
                mk_logger.log_info(
                    f"[ffmpeg_transcoder] Stream went offline; no corresponding transcoding process found (already stopped or never started)"
                    f" {vhost}/{app}/{stream}"
                )

        return False  # listening type, never intercepts subsequent plugins
