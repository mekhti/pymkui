"""
Stream relay-push plugin (on_media_changed)

When a media source registers (comes online), call ZLM addStreamPusherProxy to start relaying;
When a media source unregisters (goes offline), call ZLM delStreamPusherProxy to stop relaying.

Supports:
  - rtsp / rtmp target push (auto-detected from the dst_url schema)
  - vhost / app / stream / schema source filtering (wildcard * supported)
  - Target URL variable substitution: {vhost} {app} {stream}
  - multi_binding=True: can bind multiple times, each instance pushing to a different target
"""

import fnmatch
import threading
import httpx
import asyncio
import mk_loader
import mk_logger
from py_plugin import PluginBase
from shared_loop import SharedLoop


# ── Global push-state table ────────────────────────────────────────────────────
# state_key → ZLM pusher key (data.key returned by addStreamPusherProxy)
_pusher_keys: dict = {}
_lock = threading.Lock()


def _zlm_base_url() -> str:
    """Get ZLM's local access address"""
    try:
        port = int(mk_loader.get_config("http.port") or 0)
        if port:
            return f"http://127.0.0.1:{port}"
        ssl_port = mk_loader.get_config("http.ssl_port") or 443
        return f"https://127.0.0.1:{ssl_port}"
    except Exception:
        return "http://127.0.0.1:80"


def _zlm_secret() -> str:
    try:
        return mk_loader.get_config("api.secret") or ""
    except Exception:
        return ""


def _add_pusher(dst_schema: str, vhost: str, app: str, stream: str,
                dst_url: str, rtp_type: int,
                retry_count: int, timeout_sec: float):
    """
    Call ZLM addStreamPusherProxy, synchronously wait for the reply, and return the key.
    """
    params = {
        "secret":   _zlm_secret(),
        "schema":   dst_schema,
        "vhost":    vhost,
        "app":      app,
        "stream":   stream,
        "dst_url":  dst_url,
        "rtp_type": rtp_type,
    }
    if retry_count >= 0:
        params["retry_count"] = retry_count
    if timeout_sec > 0:
        params["timeout_sec"] = timeout_sec

    # Handle the rtsps and rtmps protocols; ZLM's addStreamPusherProxy interface only accepts rtsp or rtmp
    zlm_schema = dst_schema
    if dst_schema == "rtsps":
        zlm_schema = "rtsp"
    elif dst_schema == "rtmps":
        zlm_schema = "rtmp"
    
    # Update the schema in params
    params["schema"] = zlm_schema
    
    
    # Synchronously call the addStreamPusherProxy interface and wait for the response
    api_url = f"{_zlm_base_url()}/index/api/addStreamPusherProxy"
    try:
        resp = httpx.get(api_url, params=params, timeout=10.0)
        data = resp.json()
        if data.get("code") == 0:
            # Get the key from the data field
            zlm_key = data.get("data", {}).get("key")
            if zlm_key:
                mk_logger.log_info(
                    f"[stream_pusher] Relay started {vhost}/{app}/{stream} → {dst_url}  key={zlm_key}"
                )
                return zlm_key
            else:
                # If ZLM didn't return a key, use the key we generated ourselves
                mk_logger.log_info(
                    f"[stream_pusher] Relay started {vhost}/{app}/{stream} → {dst_url}  key={key} (ZLM didn't return a key)")
                return None
        else:
            mk_logger.log_warn(
                f"[stream_pusher] addStreamPusherProxy failed: code={data.get('code')} "
                f"msg={data.get('msg')}  {vhost}/{app}/{stream} → {dst_url}"
            )
            return None
    except Exception as e:
        mk_logger.log_warn(f"[stream_pusher] addStreamPusherProxy request exception: {e}")
        return None


def _del_pusher(key: str):
    """Call ZLM delStreamPusherProxy to stop relaying, synchronously waiting for the reply"""
    api_url = f"{_zlm_base_url()}/index/api/delStreamPusherProxy"
    params = {"secret": _zlm_secret(), "key": key}
    try:
        resp = httpx.get(api_url, params=params, timeout=10.0)
        data = resp.json()
        if data.get("code") == 0:
            mk_logger.log_info(f"[stream_pusher] Relay stopped key={key}")
        else:
            mk_logger.log_warn(
                f"[stream_pusher] delStreamPusherProxy failed: code={data.get('code')} "
                f"msg={data.get('msg')}  key={key}"
            )
    except Exception as e:
        mk_logger.log_warn(f"[stream_pusher] delStreamPusherProxy request exception: {e}")


# ── Plugin class ────────────────────────────────────────────────────────────

class StreamPusher(PluginBase):
    name        = "stream_pusher"
    version     = "1.0.0"
    description = (
        "Stream relay-push plugin (on_media_changed)."
        "When the stream comes online, automatically call ZLM addStreamPusherProxy to relay to the target address, "
        "When the stream goes offline, call delStreamPusherProxy to stop relaying."
        "Supports rtsp/rtmp targets; the target URL supports {vhost}/{app}/{stream} variable substitution."
    )
    type          = "on_media_changed"
    interruptible = False   # listening type: doesn't intercept events, continues dispatching to subsequent plugins
    multi_binding = True    # supports multiple instances, each independently pushing to a different target

    def params(self) -> dict:
        return {
            "dst_url": {
                "type": "str",
                "description": (
                    "Target relay address; must start with rtsp:// or rtmp://."
                    "Supported variables: {vhost} {app} {stream}, "
                    "e.g.: rtmp://relay.example.com/live/{stream}"
                ),
                "default": "",
            },
            "rtp_type": {
                "type": "int",
                "description": "RTSP push transport mode: 0=TCP, 1=UDP",
                "default": 0,
            },
            "retry_count": {
                "type": "int",
                "description": "Push retry count on failure; -1 = infinite retries, 0 = no retry",
                "default": -1,
            },
            "timeout_sec": {
                "type": "float",
                "description": "Push timeout (seconds); 0 uses the ZLM default",
                "default": 0,
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
            mk_logger.log_warn(f"[stream_pusher] Exception getting stream info: {e}")
            return False

        # Read binding params (instance params take priority; fall back to params() defaults)
        p = self.params()
        def _get(key):
            return binding_params.get(key, p[key]["default"])

        dst_url_tpl   = str(_get("dst_url")).strip()
        rtp_type      = int(_get("rtp_type"))
        retry_count   = int(_get("retry_count"))
        timeout_sec   = float(_get("timeout_sec"))
        vhost_filter  = str(_get("vhost_filter")  or "*")
        app_filter    = str(_get("app_filter")    or "*")
        stream_filter = str(_get("stream_filter") or "*")

        if not dst_url_tpl:
            return False

        # ── Source filtering ──
        if not fnmatch.fnmatch(vhost,  vhost_filter):  return False
        if not fnmatch.fnmatch(app,    app_filter):    return False
        if not fnmatch.fnmatch(stream, stream_filter): return False
        
        # ── Filter events automatically by the push URL protocol type ──
        # Extract the target protocol
        dst_schema = dst_url_tpl.split("://")[0].lower() if "://" in dst_url_tpl else ""
        if dst_schema in ("rtsp", "rtsps"):
            # If the push URL is RTSP(S), only handle RTSP source events
            if src_schema.lower() != "rtsp":
                return False
        elif dst_schema in ("rtmp", "rtmps"):
            # If the push URL is RTMP(S), only handle RTMP source events
            if src_schema.lower() != "rtmp":
                return False

        # ── Variable substitution to generate the actual target URL ──
        dst_url = (dst_url_tpl
                   .replace("{vhost}",  vhost)
                   .replace("{app}",    app)
                   .replace("{stream}", stream))

        # ── Extract the target protocol ──
        dst_schema = dst_url.split("://")[0].lower() if "://" in dst_url else ""
        if dst_schema not in ("rtsp", "rtsps", "rtmp", "rtmps"):
            mk_logger.log_warn(
                f"[stream_pusher] Unsupported target protocol '{dst_schema}', "
                f"dst_url={dst_url}, must start with rtsp://, rtsps://, rtmp://, or rtmps://"
            )
            return False

        # State key: template URL + stream identifier, uniquely identifying one push task
        state_key = f"{dst_url_tpl}|{vhost}|{app}|{stream}"

        # Create an async coroutine to perform the actual HTTP call (without referencing the sender object)
        async def _async_run():
            if is_register:
                with _lock:
                    if state_key in _pusher_keys:
                        mk_logger.log_info(
                            f"[stream_pusher] Push already exists, skipping duplicate start "
                            f"{vhost}/{app}/{stream} → {dst_url}"
                        )
                        return

                zlm_key = _add_pusher(
                    dst_schema, vhost, app, stream,
                    dst_url, rtp_type, retry_count, timeout_sec
                )
                if zlm_key:
                    with _lock:
                        _pusher_keys[state_key] = zlm_key
            else:
                with _lock:
                    zlm_key = _pusher_keys.pop(state_key, None)
                if zlm_key:
                    _del_pusher(zlm_key)
                else:
                    mk_logger.log_info(
                        f"[stream_pusher] Stream went offline; no corresponding push record found (already stopped or never started)"
                        f" {vhost}/{app}/{stream}"
                    )

        # Use SharedLoop to run the async coroutine in the background
        loop = SharedLoop.get_loop()
        asyncio.run_coroutine_threadsafe(_async_run(), loop)
        
        return False  # listening type, never intercepts subsequent plugins
