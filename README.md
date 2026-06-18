# PyMKUI

PyMKUI is a modern web management interface for [ZLMediaKit](https://github.com/ZLMediaKit/ZLMediaKit). Built on deep integration through the Python plugin mechanism, it provides an intuitive, polished way to manage your streaming media server.

> ⚠️ **The project is under rapid development and the database schema changes frequently. After every code update, delete the old database first:**
>
> ```bash
> rm data/pymkui.db
> ```
>
> The database is rebuilt automatically on the next start.

---

## Features

- 🎬 **Stream management** — view, play, and stop streams; capture snapshots
- 📡 **Pull-stream proxy** — multiple backup sources, on-demand/immediate modes, automatic failover, persistent recovery, online editing
- 🔄 **Transcode presets** — save multiple protocol-conversion parameter sets and load them with one click when pulling a stream; supports loading the server defaults
- 👥 **Viewer list** — see online viewers and connection details for each stream in real time
- 📊 **Server monitoring** — real-time charts for CPU, memory, disk, and network
- ⚙️ **Service configuration** — read and write ZLMediaKit configuration items online
- 🌐 **Browser publishing** — WHIP-based live publishing straight from the browser
- 🔗 **Network connections** — view and manage all current TCP/UDP sessions
- 📁 **Recording management** — recordings organized by stream and by date, with search, in-browser playback and download, and automatic policy-based cleanup of expired files
- 🧩 **Plugin system** — built-in extensible Python event hooks; implement custom business logic such as publish authentication, recording callbacks, and stream on/offline notifications without modifying the core code
- 🩺 **Video quality probe** — real-time sampling and analysis of published/pulled streams, reporting multi-dimensional quality metrics (bitrate, frame rate, GOP, audio/video interleaving, and more) as line and scatter charts to quickly pinpoint anomalies such as stuttering and artifacts

---

## Quick start (one-command Docker deployment)

Already integrated into the ZLMediaKit Docker image — no manual configuration required:

```bash
docker run -id \
  -p 1935:1935 \
  -p 80:80 \
  -p 443:443 \
  -p 554:554 \
  -p 10000:10000 \
  -p 10000:10000/udp \
  -p 8000:8000/udp \
  -p 9000:9000/udp \
  zlmediakit/zlmediakit:master_py
```

Once it starts, open `http://<server-IP>/` in your browser and log in with your `api.secret` key.

### Ports

| Port  | Protocol | Purpose            |
| ----- | -------- | ------------------ |
| 80    | TCP      | HTTP (frontend + API) |
| 443   | TCP      | HTTPS / WSS        |
| 1935  | TCP      | RTMP               |
| 554   | TCP      | RTSP               |
| 10000 | TCP/UDP  | RTP                |
| 8000  | UDP      | WebRTC             |
| 9000  | UDP      | SRT                |

---

## Manual deployment (from source)

For cases where you compile ZLMediaKit yourself and want to use PyMKUI.

### Project structure

```text
pymkui/
├─ frontend/          # Static frontend pages
├─ backend/           # Python plugin and FastAPI interface
│  ├─ mk_plugin.py    # ZLMediaKit Python plugin entry point
│  ├─ py_http_api.py  # FastAPI HTTP API
│  ├─ database.py     # SQLite database
│  ├─ config.py       # Path configuration
│  ├─ mk_logger.py    # Logging wrapper
│  └─ shared_loop.py  # Shared asyncio event loop
├─ data/              # Generated automatically at runtime
│  └─ pymkui.db       # ⚠️ Delete when upgrading
└─ README.md
```

### Step 1: Install the Python dependencies

> Requires Python 3.10+

```bash
cd pymkui/backend
pip install -r requirements.txt
```

<details>
<summary>conda / venv</summary>

```bash
# conda
conda create -n pymkui python=3.12 && conda activate pymkui
pip install -r requirements.txt

# venv (Linux/Mac)
python -m venv venv && source venv/bin/activate && pip install -r requirements.txt

# venv (Windows)
python -m venv venv && venv\Scripts\activate && pip install -r requirements.txt
```

</details>

### Step 2: Enable Python support when building ZLMediaKit

```bash
# Install the Python-related dependencies
apt-get update && apt-get install -y python3 python3-dev python3-pip
# Enable the Python features during cmake
cmake .. -DENABLE_PYTHON=ON
```

### Step 3: Edit `config.ini`

```ini
[python]
plugin=mk_plugin

[http]
rootPath=/path/to/pymkui/frontend
```

### Step 4: Let ZLMediaKit find the backend module

```bash
# Linux/Mac
export PYTHONPATH=/path/to/pymkui/backend:$PYTHONPATH

# Windows
set PYTHONPATH=C:\pymkui\backend;%PYTHONPATH%
```

### Step 5: Start and verify

```bash
# Start ZLMediaKit
./MediaServer

# Verify that the frontend is reachable
curl -sv http://localhost:80/login.html
# Should return HTTP/1.1 200 OK
```

---

## FAQ

| Issue                                          | Solution                                                        |
| ---------------------------------------------- | --------------------------------------------------------------- |
| ZLM prints red Python error logs               | Update both ZLM and PyMKUI to the latest versions               |
| `/index/pyapi/*` returns "not logged in"       | Expected — the API is reachable; just complete the login        |
| Still getting 404 after setting `rootPath`     | Make sure the path points to the `frontend/` directory and that `login.html` exists |
| Database error on startup                      | Delete `data/pymkui.db` and restart                             |

---

## Tech stack

| Layer    | Technology                                        |
| -------- | ------------------------------------------------- |
| Frontend | HTML5 + Tailwind CSS + Font Awesome               |
| Player   | Jessibuca (FLV), native HLS, WHEP (WebRTC)        |
| Backend  | Python + FastAPI (embedded in the ZLMediaKit Python plugin) |
| Database | SQLite                                            |
| Server   | ZLMediaKit (C++)                                  |

---

## Roadmap

- 🤖 **AI inference integration** — integrate ONNX / TensorRT / OpenCV DNN for real-time video analysis (object detection, face recognition, and so on)

## Contributing

Issues and pull requests are welcome.

## License

MIT License
