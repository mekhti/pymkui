import os
import sys
import json
import time
import psutil
import traceback
import httpx
import mk_loader
import mk_logger
import mk_plugin as _mk_plugin
import urllib.parse
from datetime import datetime
from typing import Optional
from fastapi import Request
from fastapi import FastAPI, Request, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, RedirectResponse
from database import Database


# ---------- Add: global  JSON  prettify ----------
class PrettyJSONResponse(JSONResponse):
    def render(self, content) -> bytes:
        return json.dumps(
            content,
            ensure_ascii=False,
            indent=4
        ).encode("utf-8")
# ------------------------------------------------------------------

t = """
|  port  |  protocol    | Service                            |
| ----- | ------- | ------------------------------- |
| 10800 | TCP     | StreamUI frontend                    |
| 10801 | TCP     | StreamUI backend               |
| 1935  | TCP     | RTMP push/pull                   |
| 8080  | TCP     | FLV, HLS, TS, fMP4, WebRTC  support |
| 8443  | TCP     | HTTPS, WebSocket  support           |
| 8554  | TCP     | RTSP  service port                   |
| 10000 | TCP/UDP | RTP, RTCP  port                  |
| 8000  | UDP     | WebRTC ICE/STUN  port            |
| 9000  | UDP     | WebRTC  auxiliary port                 |
"""

app = FastAPI(
    title="API",
    version="latest",
    description=t,
    default_response_class=PrettyJSONResponse   # ★ add this row
)

@app.exception_handler(Exception)
async def all_exception_handler(request: Request, exc: Exception):
    stack = traceback.format_exc()
    mk_logger.log_warn(f"FastAPI crashed: {exc}\n{stack}")
    return {"code": 500, "msg": "server internal error"}

# Set up  CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Global variables (must be defined at the top of the module, cannot be placed inside a function)
_last_net_bytes = None
_last_net_time = None

@app.get(
    "/index/pyapi/host-stats",
    tags=["Performance"],
    summary="Get current system resource usage",
)
async def get_host_stats():
    timestamp = datetime.now().strftime("%H:%M:%S")

    # CPU  usage
    cpu_percent = psutil.cpu_percent(interval=None)

    # memory
    memory = psutil.virtual_memory()
    memory_info = {
        "used": round(memory.used / (1024**3), 2),
        "total": round(memory.total / (1024**3), 2),
    }

    record_path = mk_loader.get_full_path(mk_loader.get_config("protocol.mp4_save_path"))
    # Disk
    disk = psutil.disk_usage(record_path)
    disk_info = {
        "used": round(disk.used / (1024**3), 2),
        "total": round(disk.total / (1024**3), 2),
    }

    # network speed (KB/s)
    net = psutil.net_io_counters()
    now = time.time()

    global _last_net_bytes, _last_net_time

    if _last_net_bytes is None:
        net_info = {"sent": 0.0, "recv": 0.0, "sent_total": net.bytes_sent / 1024, "recv_total": net.bytes_recv / 1024}
    else:
        dt = now - (_last_net_time or now)
        sent_speed = (net.bytes_sent - _last_net_bytes[0]) / 1024 / dt
        recv_speed = (net.bytes_recv - _last_net_bytes[1]) / 1024 / dt
        net_info = {
            "sent": round(sent_speed, 2),
            "recv": round(recv_speed, 2),
            "sent_total": net.bytes_sent / 1024,
            "recv_total": net.bytes_recv / 1024
        }

    # record this value
    _last_net_bytes = (net.bytes_sent, net.bytes_recv)
    _last_net_time = now

    return {
        "code": 0,
        "data": {
            "time": timestamp,
            "cpu": round(cpu_percent, 2),
            "memory": memory_info,
            "disk": disk_info,
            "network": net_info
        },
    }


client = httpx.AsyncClient(
    timeout=30.0,
    limits=httpx.Limits(
        max_connections=100,
        max_keepalive_connections=50,
    ),
)

async def get_param_from_request(
    request: Request,
    name: str,
) -> Optional[str]:
    """
    From  Request  in order from:
      1. query param
      2. body (json / form)
      3. header
    get the param, return  str  or  None
    """

    # ---------- 1️⃣ Query ----------
    value = request.query_params.get(name)
    if value is not None:
        return value

    # ---------- 2️⃣ Body ----------
    try:
        body_bytes = await request.body()
        if body_bytes:
            content_type = request.headers.get("content-type", "")

            # ---- JSON ----
            if "application/json" in content_type:
                data = json.loads(body_bytes.decode("utf-8"))
                if isinstance(data, dict) and name in data:
                    v = data.get(name)
                    return None if v is None else str(v)

            # ---- form / multipart ----
            elif (
                "application/x-www-form-urlencoded" in content_type
                or "multipart/form-data" in content_type
            ):
                parsed = urllib.parse.parse_qs(
                    body_bytes.decode("utf-8"),
                    keep_blank_values=True,
                )
                if name in parsed and parsed[name]:
                    return parsed[name][0]
    except Exception:
        # body  parse failure is ignored, continue checking  header
        pass

    # ---------- 3️⃣ Header ----------
    value = request.headers.get(name)
    if value is not None:
        return value

    return None


def get_zlm_base_url() -> str:
    """
    Get ZLMediaKit  internal-access  base URL.
    - http.port != 0  → http://127.0.0.1:{http.port}
    - http.port == 0  → https://127.0.0.1:{http.ssl_port}
    """
    http_port = mk_loader.get_config("http.port")
    try:
        http_port = int(http_port)
    except (TypeError, ValueError):
        http_port = 0

    if http_port != 0:
        return f"http://127.0.0.1:{http_port}"
    else:
        ssl_port = mk_loader.get_config("http.ssl_port")
        return f"https://127.0.0.1:{ssl_port}"


def get_forward_headers(request: Request) -> dict:
    """
    Extract from the inbound request the headers to pass through to  ZLMediaKit  of  headers (currently only  cookie).
    """
    headers: dict = {}
    # directly from  headers  get from  cookie  field (case-insensitive)
    cookie_header = None
    for key, value in request.headers.items():
        if key.lower() == "cookie":
            cookie_header = value
            break
    
    if cookie_header:
        headers["Cookie"] = cookie_header
    return headers


# Initialize database instance
db = Database()

@app.post(
    "/index/pyapi/add_protocol_options",
    tags=["Remux preset"],
    summary="Add remux preset params",
)
async def add_protocol_options(request: Request):
    """
    Add remux preset params
    
    Params:
    - name: Preset name (required)
    - modify_stamp: whether to enable frame-level timestamp override during remux (string type)
    - enable_audio: whether remux enables audio (string type)
    - add_mute_audio: Add acc silent audio (string type)
    - auto_close: whether to close directly when no one is watching (string type)
    - continue_push_ms: timeout after push disconnects (ms, string type)
    - paced_sender_ms: smooth send timer interval (ms, string type)
    - enable_hls: whether to enable conversion to hls(mpegts) (string type)
    - enable_hls_fmp4: whether to enable conversion to hls(fmp4) (string type)
    - enable_mp4: whether to enable MP4 recording (string type)
    - enable_rtsp: whether to enable conversion to rtsp/webrtc (string type)
    - enable_rtmp: whether to enable conversion to rtmp/flv (string type)
    - enable_ts: whether to enable conversion to http-ts/ws-ts (string type)
    - enable_fmp4: whether to enable conversion to http-fmp4/ws-fmp4 (string type)
    - mp4_as_player: whether to mp4 recording counted as a viewer (string type)
    - mp4_max_second: mp4 segment size (sec, string type)
    - mp4_save_path: mp4 recording save path (string type)
    - hls_save_path: hls recording save path (string type)
    - hls_demand: hls protocol is generated on-demand (string type)
    - rtsp_demand: rtsp[s] protocol is generated on-demand (string type)
    - rtmp_demand: rtmp[s], http[s]-flv, ws[s]-flv protocol is generated on-demand (string type)
    - ts_demand: http[s]-ts protocol is generated on-demand (string type)
    - fmp4_demand: http[s]-fmp4, ws[s]-fmp4 protocol is generated on-demand (string type)
    
    Note: all params are string type, default is NULL; the user may omit it, C++ program will load the default config from the config file
    """
    try:
        body_bytes = await request.body()
        if not body_bytes:
            return {"code": -1, "msg": "Request body is empty"}
        
        content_type = request.headers.get("content-type", "")
        
        if "application/json" in content_type or not content_type:
            try:
                data = json.loads(body_bytes.decode("utf-8"))
            except:
                data = {}
        elif "application/x-www-form-urlencoded" in content_type or "multipart/form-data" in content_type:
            parsed = urllib.parse.parse_qs(body_bytes.decode("utf-8"), keep_blank_values=True)
            data = {k: v[0] if len(v) == 1 else v for k, v in parsed.items()}
        else:
            try:
                data = json.loads(body_bytes.decode("utf-8"))
            except:
                return {"code": -1, "msg": f"Unsupported Content-Type: {content_type}"}
        
        if not isinstance(data, dict):
            return {"code": -1, "msg": "Invalid parameter format"}
        
        name = data.get("name")
        if not name:
            return {"code": -1, "msg": "Preset name cannot be empty"}
        
        kwargs = {}
        for key in ['modify_stamp', 'enable_audio', 'add_mute_audio', 'auto_close',
                    'continue_push_ms', 'paced_sender_ms', 'enable_hls', 'enable_hls_fmp4',
                    'enable_mp4', 'enable_rtsp', 'enable_rtmp', 'enable_ts', 'enable_fmp4',
                    'mp4_as_player', 'mp4_max_second', 'mp4_save_path', 'hls_save_path',
                    'hls_demand', 'rtsp_demand', 'rtmp_demand', 'ts_demand', 'fmp4_demand']:
            if key in data:
                kwargs[key] = str(data[key])
        
        option_id = db.add_protocol_option(name, **kwargs)
        if option_id:
            return {"code": 0, "msg": "Added successfully", "data": {"id": option_id}}
        else:
            return {"code": -1, "msg": "Add failed, preset name may already exist"}
    except Exception as e:
        mk_logger.log_warn(f"Failed to add remux preset: {e}")
        return {"code": -1, "msg": f"Add failed: {str(e)}"}

@app.post(
    "/index/pyapi/update_protocol_options",
    tags=["Remux preset"],
    summary="Update remux preset params",
)
async def update_protocol_options(request: Request):
    """
    Update remux preset params
    
    Params:
    - id: preset ID (required)
    - other params are the same as the add API
    """
    try:
        body_bytes = await request.body()
        if not body_bytes:
            return {"code": -1, "msg": "Request body is empty"}
        
        content_type = request.headers.get("content-type", "")
        
        if "application/json" in content_type or not content_type:
            try:
                data = json.loads(body_bytes.decode("utf-8"))
            except:
                data = {}
        elif "application/x-www-form-urlencoded" in content_type or "multipart/form-data" in content_type:
            parsed = urllib.parse.parse_qs(body_bytes.decode("utf-8"), keep_blank_values=True)
            data = {k: v[0] if len(v) == 1 else v for k, v in parsed.items()}
        else:
            try:
                data = json.loads(body_bytes.decode("utf-8"))
            except:
                return {"code": -1, "msg": f"Unsupported Content-Type: {content_type}"}
        
        if not isinstance(data, dict):
            return {"code": -1, "msg": "Invalid parameter format"}
        
        option_id = data.get("id")
        if not option_id:
            return {"code": -1, "msg": "preset ID cannot be empty"}
        
        try:
            option_id = int(option_id)
        except (ValueError, TypeError):
            return {"code": -1, "msg": "preset ID format error"}
        
        kwargs = {}
        for key in ['name', 'modify_stamp', 'enable_audio', 'add_mute_audio', 'auto_close',
                    'continue_push_ms', 'paced_sender_ms', 'enable_hls', 'enable_hls_fmp4',
                    'enable_mp4', 'enable_rtsp', 'enable_rtmp', 'enable_ts', 'enable_fmp4',
                    'mp4_as_player', 'mp4_max_second', 'mp4_save_path', 'hls_save_path',
                    'hls_demand', 'rtsp_demand', 'rtmp_demand', 'ts_demand', 'fmp4_demand']:
            if key in data:
                kwargs[key] = str(data[key])
        
        if db.update_protocol_option(option_id, **kwargs):
            return {"code": 0, "msg": "Updated successfully"}
        else:
            return {"code": -1, "msg": "Update failed, preset does not exist or name already exists"}
    except Exception as e:
        mk_logger.log_warn(f"Failed to update remux preset: {e}")
        return {"code": -1, "msg": f"Update failed: {str(e)}"}

@app.post(
    "/index/pyapi/delete_protocol_options",
    tags=["Remux preset"],
    summary="Delete remux preset params",
)
async def delete_protocol_options(request: Request):
    """
    Delete remux preset params
    
    Params:
    - id: preset ID (required)
    """
    try:
        body_bytes = await request.body()
        if not body_bytes:
            return {"code": -1, "msg": "Request body is empty"}
        
        content_type = request.headers.get("content-type", "")
        
        if "application/json" in content_type or not content_type:
            try:
                data = json.loads(body_bytes.decode("utf-8"))
            except:
                data = {}
        elif "application/x-www-form-urlencoded" in content_type or "multipart/form-data" in content_type:
            parsed = urllib.parse.parse_qs(body_bytes.decode("utf-8"), keep_blank_values=True)
            data = {k: v[0] if len(v) == 1 else v for k, v in parsed.items()}
        else:
            try:
                data = json.loads(body_bytes.decode("utf-8"))
            except:
                return {"code": -1, "msg": f"Unsupported Content-Type: {content_type}"}
        
        if not isinstance(data, dict):
            return {"code": -1, "msg": "Invalid parameter format"}
        
        option_id = data.get("id")
        if not option_id:
            return {"code": -1, "msg": "preset ID cannot be empty"}
        
        try:
            option_id = int(option_id)
        except (ValueError, TypeError):
            return {"code": -1, "msg": "preset ID format error"}
        
        if db.delete_protocol_option(option_id):
            return {"code": 0, "msg": "Deleted successfully"}
        else:
            return {"code": -1, "msg": "Delete failed, preset does not exist"}
    except Exception as e:
        mk_logger.log_warn(f"Failed to delete remux preset: {e}")
        return {"code": -1, "msg": f"Delete failed: {str(e)}"}

@app.get(
    "/index/pyapi/get_protocol_options_list",
    tags=["Remux preset"],
    summary="Get remux preset params list",
)
async def get_protocol_options_list():
    """
    Get remux preset params list
    """
    try:
        options = db.get_all_protocol_options()
        return {"code": 0, "msg": "Retrieved successfully", "data": options}
    except Exception as e:
        mk_logger.log_warn(f"Failed to get remux preset list: {e}")
        return {"code": -1, "msg": f"Get failed: {str(e)}"}

@app.get(
    "/index/pyapi/get_protocol_options",
    tags=["Remux preset"],
    summary="Get remux preset params detail",
)
async def get_protocol_options(id: int = Query(..., description="preset ID")):
    """
    Get remux preset params detail
    
    Params:
    - id: preset ID (required)
    """
    try:
        option = db.get_protocol_option(id)
        if option:
            return {"code": 0, "msg": "Retrieved successfully", "data": option}
        else:
            return {"code": -1, "msg": "preset does not exist"}
    except Exception as e:
        mk_logger.log_warn(f"Failed to get remux preset detail: {e}")
        return {"code": -1, "msg": f"Get failed: {str(e)}"}

@app.post(
    "/index/pyapi/addStreamProxy",
    tags=["Pull Proxy"],
    summary="Add Pull Proxy",
)
async def add_stream_proxy(request: Request):
    """
    Add Pull Proxy

    Params:
    - vhost: virtual host, default __defaultVhost__
    - app: application name (required)
    - stream: stream ID (required)
    - url: pull URL (required)
    - on_demand: on-demand pull (bool, 0/1). When 1, ZLMediaKit addStreamProxy is not called immediately,
                 only writes the config to the database, waiting for someone to play before ZLM auto-triggers the pull.
    - custom_params: custom params (JSON string)
    - protocol_params: remux params (JSON string)
    """
    try:
        body_bytes = await request.body()
        if not body_bytes:
            return {"code": -1, "msg": "Request body is empty"}
        
        content_type = request.headers.get("content-type", "")
        
        if "application/json" in content_type or not content_type:
            try:
                data = json.loads(body_bytes.decode("utf-8"))
            except:
                data = {}
        elif "application/x-www-form-urlencoded" in content_type or "multipart/form-data" in content_type:
            parsed = urllib.parse.parse_qs(body_bytes.decode("utf-8"), keep_blank_values=True)
            data = {k: v[0] if len(v) == 1 else v for k, v in parsed.items()}
        else:
            try:
                data = json.loads(body_bytes.decode("utf-8"))
            except:
                return {"code": -1, "msg": f"Unsupported Content-Type: {content_type}"}
        
        if not isinstance(data, dict):
            return {"code": -1, "msg": "Invalid parameter format"}
        
        vhost = data.get("vhost", "__defaultVhost__")
        app = data.get("app")
        stream = data.get("stream")

        # Multi-address: urls=[{"url":..., "params": {"schema":"hls","rtp_type":"0",...}}, ...]
        urls_raw = data.get("urls")
        if isinstance(urls_raw, str):
            try:
                urls_raw = json.loads(urls_raw)
            except Exception:
                urls_raw = None
        urls_list = [u for u in (urls_raw or []) if isinstance(u, dict) and u.get("url")]

        if not app or not stream or not urls_list:
            return {"code": -1, "msg": "app, stream, urls params cannot be empty"}

        # Take the first one as the primary address and its address-level params (schema, rtp_type, etc.)
        first_item        = urls_list[0]
        url               = first_item.get("url")
        first_url_params  = first_item.get("params", {})
        if not isinstance(first_url_params, dict):
            try:
                first_url_params = json.loads(first_url_params)
            except Exception:
                first_url_params = {}

        custom_params   = data.get("custom_params", "{}")
        protocol_params = data.get("protocol_params", "{}")
        remark          = data.get("remark", "")

        # on_demand: accepts bool / 0 / 1 / "0" / "1" / "true" / "false"
        raw_on_demand = data.get("on_demand", 0)
        if isinstance(raw_on_demand, str):
            on_demand = raw_on_demand.lower() in ("1", "true", "yes")
        else:
            on_demand = bool(raw_on_demand)

        # force: force-add mode, 1=write to DB even if pull fails; also passed through to ZLM's force param
        raw_force = data.get("force", 0)
        if isinstance(raw_force, str):
            force = 1 if raw_force in ("1", "true", "yes") else 0
        else:
            force = 1 if raw_force else 0

        if on_demand:
            # On-demand mode: write to DB directly, don't call ZLM, ZLM auto-pulls on playback
            proxy_id = db.add_pull_proxy({
                "vhost": vhost,
                "app": app,
                "stream": stream,
                "remark": remark,
                "custom_params": custom_params,
                "protocol_params": protocol_params,
                "on_demand": 1,
            })
            if proxy_id:
                db.set_proxy_urls(proxy_id, urls_list)
                return {"code": 0, "msg": "Added successfully (on-demand mode, not pulled immediately)", "data": {"id": proxy_id}}
            else:
                return {"code": -1, "msg": "Failed to write to database, vhost/app/stream combination may already exist"}

        # Normal/force mode: call ZLMediaKit via mk_loader.add_stream_proxy
        # Build the opt param passed to mk_loader (address-level + custom + protocol)
        proxy_record_tmp = {
            "vhost": vhost, "app": app, "stream": stream,
            "custom_params": custom_params,
            "protocol_params": protocol_params,
        }
        _, _, _, _, retry_count_tmp, timeout_sec_tmp, opt_tmp = _mk_plugin._build_proxy_call_args(
            proxy_record_tmp, url, first_url_params
        )

        add_result_holder = {}

        def _add_cb(err, key):
            add_result_holder["err"] = err
            add_result_holder["key"] = key

        mk_loader.add_stream_proxy(
            vhost, app, stream, url,
            _add_cb,
            retry_count=retry_count_tmp,
            force=bool(force),
            timeout_sec=timeout_sec_tmp,
            opt=opt_tmp,
        )

        add_err = add_result_holder.get("err")
        if not add_err or force:
            pid = db.add_pull_proxy({
                "vhost": vhost,
                "app": app,
                "stream": stream,
                "remark": remark,
                "custom_params": custom_params,
                "protocol_params": protocol_params,
                "on_demand": 0,
            })
            if pid:
                db.set_proxy_urls(pid, urls_list)
            if add_err:
                return {"code": 0, "msg": f"Force-add succeeded (ZLM: {add_err})"}
            return {"code": 0, "msg": "Added successfully"}
        else:
            return {"code": -1, "msg": f"Add failed: {add_err}"}
    except Exception as e:
        mk_logger.log_warn(f"Failed to add Pull Proxy: {e}")
        return {"code": -1, "msg": f"Add failed: {str(e)}"}

@app.post(
    "/index/pyapi/delStreamProxy",
    tags=["Pull Proxy"],
    summary="Delete Pull Proxy",
)
async def del_stream_proxy(request: Request):
    """
    Delete Pull Proxy

    Params:
    - id: unique ID of the database record (required)

    Flow:
    1. Query the database by id to get vhost/app/stream
    2. Combine key = vhost/app/stream, call ZLMediaKit delStreamProxy (no error if it doesn't exist on the ZLM side)
    3. Regardless of what ZLM returns, delete the record from the database
    """
    try:
        body_bytes = await request.body()
        if not body_bytes:
            return {"code": -1, "msg": "Request body is empty"}

        content_type = request.headers.get("content-type", "")

        if "application/json" in content_type or not content_type:
            try:
                data = json.loads(body_bytes.decode("utf-8"))
            except:
                data = {}
        elif "application/x-www-form-urlencoded" in content_type or "multipart/form-data" in content_type:
            parsed = urllib.parse.parse_qs(body_bytes.decode("utf-8"), keep_blank_values=True)
            data = {k: v[0] if len(v) == 1 else v for k, v in parsed.items()}
        else:
            try:
                data = json.loads(body_bytes.decode("utf-8"))
            except:
                return {"code": -1, "msg": f"Unsupported Content-Type: {content_type}"}

        if not isinstance(data, dict):
            return {"code": -1, "msg": "Invalid parameter format"}

        proxy_id = data.get("id")
        if not proxy_id:
            return {"code": -1, "msg": "id param cannot be empty"}
        try:
            proxy_id = int(proxy_id)
        except (ValueError, TypeError):
            return {"code": -1, "msg": "id format error, must be an integer"}

        # 1. Query the database to get stream info
        proxy = db.get_pull_proxy(proxy_id)
        if not proxy:
            return {"code": -1, "msg": "proxy does not exist"}

        vhost  = proxy.get("vhost") or "__defaultVhost__"
        app    = proxy.get("app") or ""
        stream = proxy.get("stream") or ""
        if not app or not stream:
            return {"code": -1, "msg": "Abnormal database record: app/stream is empty"}
        key    = f"{vhost}/{app}/{stream}"

        # 2. Call ZLMediaKit delStreamProxy; if it doesn't exist on the ZLM side, just log it
        try:
            zlm_url = f"{get_zlm_base_url()}/index/api/delStreamProxy"
            response = await client.post(
                zlm_url,
                data={"key": key},
                headers=get_forward_headers(request),
            )
            zlm_result = response.json()
            if zlm_result.get("code") != 0:
                mk_logger.log_warn(
                    f"ZLM delStreamProxy returned non-0: {zlm_result.get('msg')}, key={key}"
                )
        except Exception as e:
            mk_logger.log_warn(f"Failed to call ZLM delStreamProxy (ignored): {e}, key={key}")

        # 3. Regardless of the ZLM result, delete the database record
        db.delete_pull_proxy(vhost, app, stream)

        return {"code": 0, "msg": "Deleted successfully"}
    except Exception as e:
        mk_logger.log_warn(f"Failed to delete Pull Proxy: {e}")
        return {"code": -1, "msg": f"Delete failed: {str(e)}"}

@app.get(
    "/index/pyapi/getStreamProxyList",
    tags=["Pull Proxy"],
    summary="Get Pull Proxy list",
)
async def get_stream_proxy_list():
    """Get Pull Proxy list (including each proxy's multi-address list)"""
    try:
        proxies = db.get_all_pull_proxies_with_urls()
        return {"code": 0, "msg": "Retrieved successfully", "data": proxies}
    except Exception as e:
        mk_logger.log_warn(f"Failed to get Pull Proxy list: {e}")
        return {"code": -1, "msg": f"Get failed: {str(e)}"}

@app.get(
    "/index/pyapi/getStreamProxy",
    tags=["Pull Proxy"],
    summary="Get Pull Proxy detail",
)
async def get_stream_proxy(id: int = Query(..., description="proxy ID")):
    """Get Pull Proxy detail (including multi-address list)"""
    try:
        proxy = db.get_pull_proxy_with_urls(id)
        if proxy:
            return {"code": 0, "msg": "Retrieved successfully", "data": proxy}
        else:
            return {"code": -1, "msg": "proxy does not exist"}
    except Exception as e:
        mk_logger.log_warn(f"Failed to get Pull Proxy detail: {e}")
        return {"code": -1, "msg": f"Get failed: {str(e)}"}

@app.post(
    "/index/pyapi/updateStreamProxy",
    tags=["Pull Proxy"],
    summary="Update Pull Proxy config",
)
async def update_stream_proxy(request: Request):
    """
    Update the Pull Proxy config (does not restart the ZLM pull, only updates the database).

    Params:
    - id: database record ID (required)
    - urls: multi-address list ([{"url":..., "params":{...}}, ...], optional)
    - remark: note (optional)
    - vhost: virtual host (optional, not recommended to modify)
    - app: application name (optional, not recommended to modify)
    - stream: stream ID (optional, not recommended to modify)
    - on_demand: on-demand mode (optional)
    - custom_params: custom params JSON (optional)
    - protocol_params: remux params JSON (optional)
    """
    try:
        body_bytes = await request.body()
        if not body_bytes:
            return {"code": -1, "msg": "Request body is empty"}
        content_type = request.headers.get("content-type", "")
        if "application/json" in content_type or not content_type:
            try:
                data = json.loads(body_bytes.decode("utf-8"))
            except Exception:
                data = {}
        else:
            parsed = urllib.parse.parse_qs(body_bytes.decode("utf-8"), keep_blank_values=True)
            data = {k: v[0] if len(v) == 1 else v for k, v in parsed.items()}

        if not isinstance(data, dict):
            return {"code": -1, "msg": "Invalid parameter format"}

        proxy_id = data.get("id")
        if not proxy_id:
            return {"code": -1, "msg": "id param cannot be empty"}
        try:
            proxy_id = int(proxy_id if not isinstance(proxy_id, list) else proxy_id[0])
        except (ValueError, TypeError):
            return {"code": -1, "msg": "id format error, must be an integer"}

        # Confirm the record exists
        existing = db.get_pull_proxy(proxy_id)
        if not existing:
            return {"code": -1, "msg": "proxy does not exist"}

        # Build update fields (only update the fields passed in)
        update_kwargs = {}
        if "vhost" in data:
            update_kwargs["vhost"] = data["vhost"] or "__defaultVhost__"
        if "app" in data and data["app"]:
            update_kwargs["app"] = data["app"]
        if "stream" in data and data["stream"]:
            update_kwargs["stream"] = data["stream"]
        if "remark" in data:
            update_kwargs["remark"] = data.get("remark", "")
        if "custom_params" in data:
            update_kwargs["custom_params"] = data["custom_params"] if isinstance(data["custom_params"], str) else json.dumps(data["custom_params"], ensure_ascii=False)
        if "protocol_params" in data:
            update_kwargs["protocol_params"] = data["protocol_params"] if isinstance(data["protocol_params"], str) else json.dumps(data["protocol_params"], ensure_ascii=False)
        if "on_demand" in data:
            raw_od = data["on_demand"]
            if isinstance(raw_od, str):
                update_kwargs["on_demand"] = 1 if raw_od.lower() in ("1", "true", "yes") else 0
            else:
                update_kwargs["on_demand"] = 1 if raw_od else 0

        # Update the main table
        if update_kwargs:
            db.update_pull_proxy(proxy_id, **update_kwargs)

        # Update the multi-address list (full replacement)
        urls_raw = data.get("urls")
        if urls_raw is not None:
            if isinstance(urls_raw, str):
                try:
                    urls_raw = json.loads(urls_raw)
                except Exception:
                    urls_raw = []
            urls_list = [u for u in (urls_raw or []) if isinstance(u, dict) and u.get("url")]
            db.set_proxy_urls(proxy_id, urls_list)

        # Read the latest record after update, determine whether ZLM needs to be synced
        updated = db.get_pull_proxy(proxy_id)
        final_on_demand = int(updated.get("on_demand", 1)) if updated else 1

        if final_on_demand == 0 and updated:
            # on_demand=0: must first delete the old proxy on the ZLM side, then re-add to ensure the config takes effect
            vhost  = updated.get("vhost") or "__defaultVhost__"
            app    = updated.get("app") or ""
            stream = updated.get("stream") or ""
            key    = f"{vhost}/{app}/{stream}"

            # 1. Call ZLM delStreamProxy (only log on failure)
            try:
                zlm_del_url = f"{get_zlm_base_url()}/index/api/delStreamProxy"
                del_resp = await client.post(
                    zlm_del_url,
                    data={"key": key},
                    headers=get_forward_headers(request),
                )
                del_result = del_resp.json()
                if del_result.get("code") != 0:
                    mk_logger.log_warn(
                        f"update_stream_proxy | ZLM delStreamProxy non-0: {del_result.get('msg')}, key={key}"
                    )
            except Exception as e:
                mk_logger.log_warn(f"update_stream_proxy | ZLM delStreamProxy failed (ignored): {e}, key={key}")

            # 2. Take the address list, call mk_loader.add_stream_proxy
            proxy_urls = db.get_proxy_urls(proxy_id)
            if proxy_urls:
                first_item = proxy_urls[0]
                url = first_item.get("url", "")
                first_url_params = first_item.get("params", {})
                if isinstance(first_url_params, str):
                    try:
                        first_url_params = json.loads(first_url_params)
                    except Exception:
                        first_url_params = {}
                if not isinstance(first_url_params, dict):
                    first_url_params = {}

                if url:
                    _, _, _, _, rc_tmp, ts_tmp, opt_tmp = _mk_plugin._build_proxy_call_args(
                        updated, url, first_url_params
                    )

                    def _update_cb(err, k):
                        if err:
                            mk_logger.log_warn(
                                f"update_stream_proxy | mk_loader.add_stream_proxy failed: {err}, key={k}"
                            )
                        else:
                            mk_logger.log_info(f"update_stream_proxy | mk_loader.add_stream_proxy succeeded, key={k}")

                    mk_loader.add_stream_proxy(
                        vhost, app, stream, url,
                        _update_cb,
                        retry_count=rc_tmp,
                        force=True,
                        timeout_sec=ts_tmp,
                        opt=opt_tmp,
                    )

        return {"code": 0, "msg": "Updated successfully"}
    except Exception as e:
        mk_logger.log_warn(f"Failed to update Pull Proxy: {e}")
        return {"code": -1, "msg": f"Update failed: {str(e)}"}


@app.post(
    "/index/pyapi/toggleStreamProxyMode",
    tags=["Pull Proxy"],
    summary="Toggle Pull Proxy mode (on-demand ↔ immediate)",
)
async def toggle_stream_proxy_mode(request: Request):
    """
    Toggle the Pull Proxy's on_demand mode.

    - on-demand (on_demand=1) → immediate (on_demand=0):
      call ZLM addStreamProxy (force=1 overrides existing), write DB on_demand=0
    - immediate (on_demand=0) → on-demand (on_demand=1):
      call ZLM delStreamProxy to stop the current pull, write DB on_demand=1

    Params:
    - id: database record ID (required)
    """
    try:
        body_bytes = await request.body()
        if not body_bytes:
            return {"code": -1, "msg": "Request body is empty"}
        content_type = request.headers.get("content-type", "")
        if "application/json" in content_type or not content_type:
            try:
                data = json.loads(body_bytes.decode("utf-8"))
            except Exception:
                data = {}
        else:
            parsed = urllib.parse.parse_qs(body_bytes.decode("utf-8"), keep_blank_values=True)
            data = {k: v[0] if len(v) == 1 else v for k, v in parsed.items()}

        if not isinstance(data, dict):
            return {"code": -1, "msg": "Invalid parameter format"}

        proxy_id = data.get("id")
        if not proxy_id:
            return {"code": -1, "msg": "id param cannot be empty"}
        try:
            proxy_id = int(proxy_id)
        except (ValueError, TypeError):
            return {"code": -1, "msg": "id format error, must be an integer"}

        proxy = db.get_pull_proxy(proxy_id)
        if not proxy:
            return {"code": -1, "msg": "proxy does not exist"}

        vhost  = proxy.get("vhost") or "__defaultVhost__"
        app    = proxy.get("app") or ""
        stream = proxy.get("stream") or ""
        key    = f"{vhost}/{app}/{stream}"
        current_on_demand = int(bool(proxy.get("on_demand", 0)))

        # Take the first address from the multi-address table
        proxy_urls = db.get_proxy_urls(proxy_id)
        first_url_item  = proxy_urls[0] if proxy_urls else {}
        url             = first_url_item.get("url") or ""
        url_params      = first_url_item.get("params") or {}  # already deserialized to dict by get_proxy_urls

        if current_on_demand == 1:
            # on-demand → immediate: via mk_loader.add_stream_proxy (force=True)
            if not url:
                return {"code": -1, "msg": "proxy has no valid pull URL"}

            _, _, _, _, rc_tmp, ts_tmp, opt_tmp = _mk_plugin._build_proxy_call_args(proxy, url, url_params)

            toggle_result = {"err": None}

            def _toggle_add_cb(err, k):
                toggle_result["err"] = err

            mk_loader.add_stream_proxy(
                vhost, app, stream, url,
                _toggle_add_cb,
                retry_count=rc_tmp,
                force=True,
                timeout_sec=ts_tmp,
                opt=opt_tmp,
            )

            if toggle_result["err"]:
                return {"code": -1, "msg": f"ZLM add failed: {toggle_result['err']}"}
            db.update_pull_proxy(proxy_id, on_demand=0)
            return {"code": 0, "msg": "Switched to immediate mode", "data": {"on_demand": 0}}
        else:
            # immediate → on-demand: call ZLM delStreamProxy to stop the pull
            zlm_url = f"{get_zlm_base_url()}/index/api/delStreamProxy"
            try:
                response = await client.post(
                    zlm_url,
                    data={"key": key},
                    headers=get_forward_headers(request),
                )
                zlm_result = response.json()
                if zlm_result.get("code") != 0:
                    mk_logger.log_warn(
                        f"ZLM delStreamProxy returned non-0: {zlm_result.get('msg')}, key={key}"
                    )
            except (httpx.ConnectError, httpx.ConnectTimeout, httpx.TimeoutException) as e:
                mk_logger.log_warn(f"Failed to connect when calling ZLM delStreamProxy (ignored, continue writing DB): {e}, key={key}")
            except Exception as e:
                mk_logger.log_warn(f"Failed to call ZLM delStreamProxy (ignored): {e}, key={key}")
            db.update_pull_proxy(proxy_id, on_demand=1)
            return {"code": 0, "msg": "Switched to on-demand mode", "data": {"on_demand": 1}}

    except Exception as e:
        mk_logger.log_warn(f"toggle_stream_proxy_mode | Failed to toggle Pull Proxy mode: {e}")
        return {"code": -1, "msg": f"Toggle failed: {str(e)}"}


# ══════════════════════════════════════════════════════════════════════
# Plugins API
# ══════════════════════════════════════════════════════════════════════
import py_plugin as _py_plugin


@app.get(
    "/index/pyapi/plugin/list",
    tags=["Plugins"],
    summary="Get list of loaded plugins",
)
async def plugin_list():
    """Return basic info of all plugins currently loaded in memory"""
    try:
        plugins = _py_plugin.registry.get_all()
        return {"code": 0, "data": plugins}
    except Exception as e:
        mk_logger.log_warn(f"plugin_list error: {e}")
        return {"code": -1, "msg": str(e)}


@app.post(
    "/index/pyapi/plugin/reload",
    tags=["Plugins"],
    summary="Hot-reload the plugins directory",
)
async def plugin_reload():
    """
    Re-scan the plugins/ directory and hot-reload all plugin modules.
    After loading, automatically re-sync existing bindings from the database to the registry.
    """
    try:
        loaded = _py_plugin.registry.load()
        # After reload, re-sync the database bindings to the registry
        _sync_bindings_from_db()
        return {
            "code": 0,
            "msg": f"Hot-reload complete, loaded {len(loaded)} plugins in total",
            "data": list(loaded.keys()),
        }
    except Exception as e:
        mk_logger.log_warn(f"plugin_reload error: {e}")
        return {"code": -1, "msg": str(e)}


@app.get(
    "/index/pyapi/plugin/events",
    tags=["Plugins"],
    summary="Get all supported event types",
)
async def plugin_events():
    """Return all ZLM event types that the system supports binding plugins to"""
    return {"code": 0, "data": _py_plugin.SUPPORTED_EVENTS}


@app.get(
    "/index/pyapi/plugin/bindings",
    tags=["Plugins"],
    summary="Get all event binding configs",
)
async def plugin_get_bindings():
    """
    Return the binding configs of all supported events.
    Format: [{event_type, bindings:[{id, plugin_name, params, priority, enabled}], updated_at}, ...]
    """
    try:
        db_rows = db.get_all_plugin_bindings()
        # Build event_type → bindings mapping
        db_map = {r["event_type"]: r for r in db_rows}
        result = []
        for evt in _py_plugin.SUPPORTED_EVENTS:
            rec = db_map.get(evt)
            if rec:
                result.append(rec)
            else:
                result.append({
                    "event_type": evt,
                    "bindings": [],
                })
        return {"code": 0, "data": result}
    except Exception as e:
        mk_logger.log_warn(f"plugin_get_bindings error: {e}")
        return {"code": -1, "msg": str(e)}


@app.post(
    "/index/pyapi/plugin/bindings/save",
    tags=["Plugins"],
    summary="Save event binding config (full replacement)",
)
async def plugin_save_binding(request: Request):
    """
    Save the full plugin binding config for an event type and apply it to memory immediately.

    Request body (JSON):
    - event_type: str  — event type, must be one of SUPPORTED_EVENTS
    - bindings: list   — binding list (ordered), each item format:
        {"plugin_name": str, "params": dict, "enabled": 0/1}
    - enabled: int (0/1) — whole-group enabled state, default 1
    """
    try:
        body = await request.body()
        data = json.loads(body.decode("utf-8"))

        event_type = data.get("event_type", "").strip()
        bindings   = data.get("bindings", [])
        enabled    = int(data.get("enabled", 1))

        if event_type not in _py_plugin.SUPPORTED_EVENTS:
            return {"code": -1, "msg": f"Unsupported event type: {event_type}"}
        if not isinstance(bindings, list):
            return {"code": -1, "msg": "bindings must be an array"}

        # Write to DB (full replacement)
        ok = db.save_plugin_bindings_for_event(event_type, bindings, enabled)
        if not ok:
            return {"code": -1, "msg": "Database write failed"}

        # Immediately sync to the in-memory registry (re-read from DB to get the latest id)
        if enabled:
            saved = db.get_plugin_bindings_for_event(event_type)
            registry_bindings = [
                {"name": r["plugin_name"], "params": r.get("params") or {}, "id": r["id"]}
                for r in saved
            ]
            _py_plugin.registry.set_bindings(event_type, registry_bindings)
        else:
            _py_plugin.registry.set_bindings(event_type, [])

        return {"code": 0, "msg": "Saved successfully"}
    except Exception as e:
        mk_logger.log_warn(f"plugin_save_binding error: {e}")
        return {"code": -1, "msg": str(e)}


@app.post(
    "/index/pyapi/plugin/bindings/update_params",
    tags=["Plugins"],
    summary="Update params of a single binding",
)
async def plugin_update_binding_params(request: Request):
    """
    Update the custom params of an event-plugin binding without affecting other bindings.

    Request body (JSON):
    - event_type: str
    - plugin_name: str
    - params: dict       — custom param key-value pairs
    - enabled: int (0/1) — optional, default unchanged
    """
    try:
        body = await request.body()
        data = json.loads(body.decode("utf-8"))

        event_type  = data.get("event_type", "").strip()
        plugin_name = data.get("plugin_name", "").strip()
        params      = data.get("params", {})

        if not event_type or not plugin_name:
            return {"code": -1, "msg": "event_type and plugin_name cannot be empty"}

        # Read the current bindings, find this item and update its params
        current = db.get_plugin_bindings_for_event(event_type)
        item = next((x for x in current if x["plugin_name"] == plugin_name), None)
        if item is None:
            return {"code": -1, "msg": f"Binding does not exist: {event_type}/{plugin_name}"}

        enabled  = data.get("enabled", item["enabled"])
        priority = item["priority"]

        ok = db.upsert_plugin_binding_item(event_type, plugin_name, params, priority, enabled)
        if not ok:
            return {"code": -1, "msg": "Database update failed"}

        # Sync memory
        _sync_bindings_from_db_for_event(event_type)
        return {"code": 0, "msg": "Params updated successfully"}
    except Exception as e:
        mk_logger.log_warn(f"plugin_update_binding_params error: {e}")
        return {"code": -1, "msg": str(e)}


@app.post(
    "/index/pyapi/plugin/bindings/delete",
    tags=["Plugins"],
    summary="Delete event binding config",
)
async def plugin_delete_binding(request: Request):
    """
    Delete all binding configs (or a single one) for an event type and clear them from memory.

    Request body (JSON):
    - event_type: str   — required
    - plugin_name: str  — optional; if provided, only delete this plugin's binding, otherwise delete the whole event's bindings
    """
    try:
        body = await request.body()
        data = json.loads(body.decode("utf-8"))
        event_type  = data.get("event_type", "").strip()
        plugin_name = data.get("plugin_name", "").strip()
        if not event_type:
            return {"code": -1, "msg": "event_type cannot be empty"}
        if plugin_name:
            db.delete_plugin_binding_item(event_type, plugin_name)
            _sync_bindings_from_db_for_event(event_type)
        else:
            db.delete_plugin_bindings_for_event(event_type)
            _py_plugin.registry.set_bindings(event_type, [])
        return {"code": 0, "msg": "Deleted successfully"}
    except Exception as e:
        mk_logger.log_warn(f"plugin_delete_binding error: {e}")
        return {"code": -1, "msg": str(e)}


def _sync_bindings_from_db():
    """On startup / after hot-reload, sync all enabled bindings from the database to the in-memory registry"""
    try:
        rows = db.get_all_plugin_bindings()
        for row in rows:
            event_type = row["event_type"]
            bindings = row.get("bindings", [])
            # Filter out the bindings with enabled=1
            active = [
                {"name": b["plugin_name"], "params": b.get("params") or {}, "id": b["id"]}
                for b in bindings if b.get("enabled", 1)
            ]
            _py_plugin.registry.set_bindings(event_type, active)
        mk_logger.log_info(f"[plugin] Binding sync complete, {len(rows)} events in total")
    except Exception as e:
        mk_logger.log_warn(f"[plugin] Binding sync failed: {e}")


def _sync_bindings_from_db_for_event(event_type: str):
    """Update the in-memory binding of a single event type"""
    try:
        bindings = db.get_plugin_bindings_for_event(event_type)
        active = [
            {"name": b["plugin_name"], "params": b.get("params") or {}, "id": b["id"]}
            for b in bindings if b.get("enabled", 1)
        ]
        _py_plugin.registry.set_bindings(event_type, active)
    except Exception as e:
        mk_logger.log_warn(f"[plugin] Failed to sync single-event binding {event_type}: {e}")


# ──────────────────────────────────────────────────────────────────────
# Plugin URL params API
# ──────────────────────────────────────────────────────────────────────

@app.get(
    "/index/pyapi/plugin/url_params",
    tags=["Plugins"],
    summary="Get URL extra params generated by plugins for a given stream",
)
async def get_plugin_url_params(
    event_type: str = Query(..., description="event type, e.g. on_play, on_publish"),
    app: str = Query(..., description="application name"),
    stream: str = Query(..., description="stream ID"),
    vhost: str = Query(default="__defaultVhost__", description="virtual host"),
):
    """
    Collect the URL extra params generated for the current stream by all enabled plugins under the given event (on_play / on_publish, etc.).

    The returned data is a dict; the frontend just appends all its key-value pairs to the query params of the corresponding URL.
    If no plugin is bound under this event or no plugin provides params, data is an empty dict {}.
    """
    try:
        if event_type not in _py_plugin.SUPPORTED_EVENTS:
            return {"code": -1, "msg": f"Unsupported event type: {event_type}"}
        extra = _py_plugin.registry.collect_url_params(
            event_type,
            vhost=vhost,
            app=app,
            stream=stream,
        )
        return {"code": 0, "data": extra}
    except Exception as e:
        mk_logger.log_warn(f"get_plugin_url_params error: {e}")
        return {"code": -1, "msg": str(e)}


# ══════════════════════════════════════════════════════════════════════
# Recordings API
# ══════════════════════════════════════════════════════════════════════

@app.get(
    "/index/pyapi/recordings/streams",
    tags=["Recordings"],
    summary="Get list of all streams that have recordings",
)
async def get_recording_streams():
    """Return a deduplicated list of vhost/app/stream that have recordings in the database"""
    try:
        return {"code": 0, "data": db.get_recording_streams()}
    except Exception as e:
        mk_logger.log_warn(f"get_recording_streams error: {e}")
        return {"code": -1, "msg": str(e)}


@app.get(
    "/index/pyapi/recordings",
    tags=["Recordings"],
    summary="Query recordings list",
)
async def get_recordings(
    app: str = Query(default="", description="application name, empty means no filter"),
    stream: str = Query(default="", description="stream ID, empty means no filter"),
    vhost: str = Query(default="", description="virtual host, empty means no filter"),
    date: str = Query(default="", description="date YYYY-MM-DD, empty means no filter"),
    start_ts: int = Query(default=0, description="start timestamp (sec), 0 means no filter"),
    end_ts: int = Query(default=0, description="end timestamp (sec), 0 means no filter"),
    limit: int = Query(default=200, description="max number of items to return"),
    offset: int = Query(default=0, description="pagination offset"),
):
    try:
        rows = db.get_recordings(app=app, stream=stream, vhost=vhost,
                                 date=date, limit=limit, offset=offset,
                                 start_ts=start_ts, end_ts=end_ts)
        return {"code": 0, "data": rows, "total": len(rows)}
    except Exception as e:
        mk_logger.log_warn(f"get_recordings error: {e}")
        return {"code": -1, "msg": str(e)}


@app.get(
    "/index/pyapi/recordings/dates",
    tags=["Recordings"],
    summary="Query the list of dates that have recordings in a given month",
)
async def get_recording_dates(
    year:   int = Query(..., description="year, e.g. 2026"),
    month:  int = Query(..., description="month, 1-12"),
    app:    str = Query(default="", description="application name, empty means no filter"),
    stream: str = Query(default="", description="stream ID, empty means no filter"),
    vhost:  str = Query(default="", description="virtual host, empty means no filter"),
):
    """Return the list of dates that have recordings in the given month, format ['YYYY-MM-DD', ...]"""
    try:
        dates = db.get_recording_dates(year=year, month=month,
                                       app=app, stream=stream, vhost=vhost)
        return {"code": 0, "data": dates}
    except Exception as e:
        mk_logger.log_warn(f"get_recording_dates error: {e}")
        return {"code": -1, "msg": str(e)}


@app.post(
    "/index/pyapi/recordings/delete",
    tags=["Recordings"],
    summary="Delete recording records (only DB records, not files)",
)
async def delete_recording(request: Request):
    try:
        body = await request.body()
        data = json.loads(body.decode("utf-8")) if body else {}
        rec_id = data.get("id")
        if not rec_id:
            return {"code": -1, "msg": "id cannot be empty"}
        db.delete_recording(int(rec_id))
        return {"code": 0, "msg": "Deleted successfully"}
    except Exception as e:
        mk_logger.log_warn(f"delete_recording error: {e}")
        return {"code": -1, "msg": str(e)}


@app.post(
    "/index/pyapi/recordings/delete_stream",
    tags=["Recordings"],
    summary="Delete all recording records and files of a given stream",
)
async def delete_recordings_by_stream(request: Request):
    try:
        body = await request.body()
        data = json.loads(body.decode("utf-8")) if body else {}
        vhost  = data.get("vhost",  "__defaultVhost__")
        app    = data.get("app",    "")
        stream = data.get("stream", "")
        if not app or not stream:
            return {"code": -1, "msg": "app and stream cannot be empty"}
        count = db.delete_recordings_by_stream(vhost, app, stream)
        return {"code": 0, "msg": f"Deleted {count} recordings"}
    except Exception as e:
        mk_logger.log_warn(f"delete_recordings_by_stream error: {e}")
        return {"code": -1, "msg": str(e)}


@app.post(
    "/index/pyapi/recordings/delete_day",
    tags=["Recordings"],
    summary="Delete all recording records and files of a given stream on a given day",
)
async def delete_recordings_by_day(request: Request):
    try:
        body = await request.body()
        data = json.loads(body.decode("utf-8")) if body else {}
        vhost  = data.get("vhost",  "__defaultVhost__")
        app    = data.get("app",    "")
        stream = data.get("stream", "")
        date   = data.get("date",   "")
        if not app or not stream or not date:
            return {"code": -1, "msg": "app, stream and date cannot be empty"}
        count = db.delete_recordings_by_stream_date(vhost, app, stream, date)
        return {"code": 0, "msg": f"Deleted {count} recordings"}
    except Exception as e:
        mk_logger.log_warn(f"delete_recordings_by_day error: {e}")
        return {"code": -1, "msg": str(e)}


@app.get(
    "/index/pyapi/recordings/file",
    tags=["Recordings"],
    summary="Redirect to the ZLM downloadFile API to play or download a recording",
)
async def serve_recording_file(
    id: int = Query(..., description="recording record ID"),
    disposition: str = Query(default="inline", description="inline=play, attachment=download"),
):
    """
    Query the DB for the recording file_path, redirect to ZLM's built-in API /index/api/downloadFile.
    disposition=inline  → inline playback in the browser
    disposition=attachment → trigger download, with save_name
    """
    try:
        row = db.get_recording_by_id(int(id))
        if not row:
            raise HTTPException(status_code=404, detail="recording record does not exist")
        file_path = row.get("file_path", "")
        if not file_path:
            raise HTTPException(status_code=404, detail="recording file path is empty")
        encoded_path = urllib.parse.quote(file_path, safe='')
        if disposition == "attachment":
            file_name = row.get("file_name") or os.path.basename(file_path)
            encoded_name = urllib.parse.quote(file_name, safe='')
            redirect_url = (
                f"/index/api/downloadFile"
                f"?file_path={encoded_path}"
                f"&save_name={encoded_name}"
            )
        else:
            redirect_url = f"/index/api/downloadFile?file_path={encoded_path}"
        return RedirectResponse(url=redirect_url, status_code=302)
    except HTTPException:
        raise
    except Exception as e:
        mk_logger.log_warn(f"serve_recording_file error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get(
    "/index/pyapi/recordings/day",
    tags=["Recordings"],
    summary="Get the ordered list of all recordings of a given stream on a given day (for sequential playback on the frontend)",
)
async def get_day_recordings(
    vhost:  str = Query(default="", description="virtual host"),
    app:    str = Query(...,        description="application name"),
    stream: str = Query(...,        description="stream ID"),
    date:   str = Query(...,        description="date YYYY-MM-DD"),
):
    """Return the list of all recordings of that day sorted by start_time ascending, used by the frontend for sequential playback."""
    try:
        rows = db.get_recordings(vhost=vhost, app=app, stream=stream,
                                 date=date, limit=10000)
        rows.sort(key=lambda r: r.get("start_time") or 0)
        rows = [r for r in rows if r.get("file_path")]
        if not rows:
            return {"code": 1, "msg": "No recordings for this stream on that day", "data": []}
        return {"code": 0, "data": rows}
    except Exception as e:
        mk_logger.log_warn(f"get_day_recordings error: {e}")
        return {"code": -1, "msg": str(e), "data": []}
