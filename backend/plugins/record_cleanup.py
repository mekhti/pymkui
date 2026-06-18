"""
Automatic recording-cleanup plugin (on_start type)

When the service starts, launch a background scheduled task to clean up old recordings of each stream per the following rules:
  - max_size_gb: max total recording size to keep per stream (GB), default 10
  - max_days: max number of days to keep recordings per stream, default 7

When the limit is exceeded, delete database records one by one by start_time from old to new **and delete the actual files**,
until the limit is satisfied.
"""

import os
import time
import threading
import json

import mk_logger
from py_plugin import PluginBase


_CHECK_INTERVAL_SEC  = 3600   # check once per hour
_cleanup_started     = False  # prevent duplicate startup


def _do_cleanup(max_size_bytes: float, max_days: int):
    """Perform one cleanup pass, iterating over all streams"""
    try:
        from py_http_api import db
        streams = db.get_recording_streams()
    except Exception as e:
        mk_logger.log_warn(f"[record_cleanup] Failed to get the stream list: {e}")
        return

    now_ts     = time.time()
    cutoff_ts  = now_ts - max_days * 86400

    for s in streams:
        vhost  = s.get("vhost", "")
        app    = s.get("app", "")
        stream = s.get("stream", "")

        try:
            # Get all recordings of this stream, sorted by time ascending (oldest first)
            rows = db.get_recordings(vhost=vhost, app=app, stream=stream,
                                     limit=100000, offset=0)
            rows.sort(key=lambda r: r.get("start_time") or 0)
        except Exception as e:
            mk_logger.log_warn(f"[record_cleanup] Failed to query recordings {app}/{stream}: {e}")
            continue

        if not rows:
            continue

        # Compute the current total size
        total_size = sum(r.get("file_size") or 0 for r in rows)

        for r in rows:
            should_delete = False
            reason = ""

            start_time = r.get("start_time") or 0
            if start_time and start_time < cutoff_ts:
                should_delete = True
                reason = f"exceeds {max_days} days"
            elif total_size > max_size_bytes:
                should_delete = True
                reason = f"total size {total_size/1024**3:.2f}GB exceeds {max_size_bytes/1024**3:.1f}GB"

            if not should_delete:
                continue

            file_path  = r.get("file_path", "")
            file_size  = r.get("file_size") or 0
            rec_id     = r.get("id")

            # Delete the file and empty parent directories
            if file_path:
                try:
                    db._remove_file_and_empty_parents(file_path)
                    mk_logger.log_info(
                        f"[record_cleanup] Deleted file {file_path} ({reason})"
                    )
                except Exception as e:
                    mk_logger.log_warn(f"[record_cleanup] Failed to delete file {file_path}: {e}")

            # Delete the database record (file already deleted; delete_recording internally skips file deletion)
            try:
                if rec_id is not None:
                    db.delete_recording(int(rec_id))
                total_size -= file_size
                mk_logger.log_info(
                    f"[record_cleanup] Deleted record id={rec_id} {app}/{stream} {reason}"
                )
            except Exception as e:
                mk_logger.log_warn(f"[record_cleanup] Failed to delete record id={rec_id}: {e}")


def _cleanup_loop(max_size_bytes: float, max_days: int):
    """Background loop thread"""
    mk_logger.log_info(
        f"[record_cleanup] Cleanup thread started, "
        f"max {max_size_bytes/1024**3:.1f}GB / {max_days} days, "
        f"interval {_CHECK_INTERVAL_SEC}s"
    )
    while True:
        try:
            _do_cleanup(max_size_bytes, max_days)
        except Exception as e:
            mk_logger.log_warn(f"[record_cleanup] Cleanup exception: {e}")
        time.sleep(_CHECK_INTERVAL_SEC)


class RecordCleanup(PluginBase):
    name        = "record_cleanup"
    version     = "1.0.0"
    description = (
        "Automatic recording-cleanup plugin (on_start)."
        "Computes total size and recording age per stream; when limits are exceeded, deletes files and database records starting from the oldest recordings."
    )
    type        = "on_start"
    interruptible = False  # listening type: doesn't block other plugins after cleanup completes

    def params(self) -> dict:
        return {
            "max_size_gb": {
                "type": "number",
                "default": 10,
                "description": "Max total recording size to keep per stream (GB); when exceeded, delete starting from the oldest recordings"
            },
            "max_days": {
                "type": "number",
                "default": 7,
                "description": "Max number of days to keep recordings per stream; when exceeded, delete expired recordings"
            },
        }

    def run(self, **kwargs) -> bool:
        global _cleanup_started
        if _cleanup_started:
            return False
        _cleanup_started = True

        # Read config from the binding params (editable on the Plugins management page)
        # Fall back to the defaults defined in params() when not configured
        schema       = self.params()
        bound_params = kwargs.get("params", {})
        if isinstance(bound_params, str):
            try:
                bound_params = json.loads(bound_params)
            except Exception:
                bound_params = {}

        def _get(key):
            return bound_params.get(key, schema[key]["default"])

        max_size_gb    = float(_get("max_size_gb"))
        max_days       = int(_get("max_days"))
        max_size_bytes = max_size_gb * 1024 ** 3

        t = threading.Thread(
            target=_cleanup_loop,
            args=(max_size_bytes, max_days),
            daemon=True,
            name="record-cleanup",
        )
        t.start()
        return False  # non-exclusive
