const jessibucaInstances = [];
const hlsInstances = [];

function cleanupStreamsPage() {
    console.log('Clean up Streams page resources, destroy all player instances');
    
    // Destroy Jessibuca player instance
    jessibucaInstances.forEach(instance => {
        try {
            if (instance) {
                instance.destroy();
            }
        } catch (error) {
            console.error('Destroy Jessibuca player instance failed:', error);
        }
    });
    jessibucaInstances.length = 0;
    
    // Destroy HLS player instance
    hlsInstances.forEach(instance => {
        try {
            if (instance) {
                instance.destroy();
            }
        } catch (error) {
            console.error('Destroy HLS player instance failed:', error);
        }
    });
    hlsInstances.length = 0;
    
    // Clear modal container
    const streamsModalContainer = document.getElementById('streams-modal-container');
    if (streamsModalContainer) {
        streamsModalContainer.innerHTML = '';
    }
}

async function loadStreams() {
    const tbody = document.getElementById('streamsTableBody');
    const protocolFilter = document.getElementById('protocolFilter');
    const vhostFilter = document.getElementById('vhostFilter');
    const appFilter = document.getElementById('appFilter');
    const streamFilter = document.getElementById('streamFilter');
    
    const schema = protocolFilter ? protocolFilter.value : 'all';
    const vhost = vhostFilter ? vhostFilter.value.trim() : '';
    const app = appFilter ? appFilter.value.trim() : '';
    const stream = streamFilter ? streamFilter.value.trim() : '';
    
    tbody.innerHTML = `
        <tr>
            <td colspan="10" class="p-10 text-center">
                <div class="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary mx-auto mb-4"></div>
                <span class="text-white/60 font-semibold">Loading...</span>
            </td>
        </tr>
    `;
    
    try {
        const result = await Api.getMediaList(
            schema === 'all' ? undefined : schema,
            vhost || undefined,
            app || undefined,
            stream || undefined
        );
        
        console.log('getMediaList returned result:', result);
        
        if (result.code === 0) {
            const data = result.data || [];
            
            console.log('Stream list data:', data);
            
            if (data.length === 0) {
                tbody.innerHTML = `
                    <tr>
                        <td colspan="10" class="p-10 text-center text-white/60 font-semibold">
                            No media streams
                        </td>
                    </tr>
                `;
                return;
            }
            
            let html = '';
            data.forEach(stream => {
                console.log('Stream data:', stream);
                const vhost = stream.vhost || '__defaultVhost__';
                const readerCount = stream.readerCount || 0;
                const aliveSecond = stream.aliveSecond || 0;
                const bytesSpeed = stream.bytesSpeed || 0;
                
                const aliveTime = formatAliveTime(aliveSecond);
                const bitrate = formatBitrate(bytesSpeed);
                
                // Process track info
                let tracksInfo = '-';
                if (stream.tracks && stream.tracks.length > 0) {
                    const trackCodes = stream.tracks.map(track => {
                        const codec = track.codec_id_name || track.codec_name || '-';
                        return track.codec_type === 0 ? `Video: ${codec}` : `Audio: ${codec}`;
                    });
                    tracksInfo = trackCodes.join('<br>');
                }
                
                html += `
                    <tr class="border-b border-white/5 hover:bg-white/5 transition-colors">
                        <td class="p-4 text-white/60 text-sm" title="${vhost}">${vhost}</td>
                        <td class="p-4 text-white">${stream.app || '-'}</td>
                        <td class="p-4 text-white">${stream.stream || '-'}</td>
                        <td class="p-4 text-white">${stream.schema || '-'}</td>
                        <td class="p-4 text-white">${stream.originTypeStr || '-'}</td>
                        <td class="p-4 text-white">${readerCount}</td>
                        <td class="p-4 text-white">${aliveTime}</td>
                        <td class="p-4 text-white">${bitrate}</td>
                        <td class="p-4 text-white" style="white-space: pre-line;">${tracksInfo}</td>
                        <td class="p-4">
                            <button class="bg-gradient-primary text-white px-3 py-1 rounded-lg text-sm font-semibold hover:shadow-neon transition-colors mr-2" onclick="playStream('${stream.app}', '${stream.stream}', '${stream.schema}')">Play</button>
                            <button class="bg-gradient-accent text-white px-3 py-1 rounded-lg text-sm font-semibold hover:shadow-neon transition-colors" onclick="showStreamInfo('${stream.schema}', '${vhost}', '${stream.app}', '${stream.stream}')">View</button>
                        </td>
                    </tr>
                `;
            });
            
            tbody.innerHTML = html;
        } else {
            tbody.innerHTML = `
                <tr>
                    <td colspan="10" class="p-10 text-center text-white/60 font-semibold">
                        Load failed: ${result.msg || 'Unknown error'}
                    </td>
                </tr>
            `;
        }
    } catch (error) {
        tbody.innerHTML = `
            <tr>
                <td colspan="10" class="p-10 text-center text-white/60 font-semibold">
                    Network error: ${error.message}
                </td>
            </tr>
        `;
    }
}

function formatAliveTime(seconds) {
    if (!seconds || seconds <= 0) {
        return '-';
    }
    
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    
    let result = '';
    if (days > 0) {
        result += `${days} d`;
    }
    if (hours > 0) {
        result += `${hours} h`;
    }
    if (minutes > 0) {
        result += `${minutes} min`;
    }
    if (secs > 0) {
        result += `${secs} s`;
    }
    
    return result || '-';
}

function formatBitrate(bytesPerSecond) {
    if (!bytesPerSecond || bytesPerSecond <= 0) {
        return '-';
    }
    
    const kbps = bytesPerSecond / 1024;
    const mbps = kbps / 1024;
    
    if (mbps >= 1) {
        return `${mbps.toFixed(2)} MB/s`;
    } else {
        return `${kbps.toFixed(2)} KB/s`;
    }
}

function generatePlayUrl(app, stream, schema, extraParams) {
    const baseUrl = Api.getBaseUrl();
    let playUrl = '';
    
    if (schema === 'rtmp') {
        playUrl = `${baseUrl}/${app}/${stream}.live.flv`;
    } else if (schema === 'hls') {
        playUrl = `${baseUrl}/${app}/${stream}/hls.m3u8`;
    } else if (schema === 'hls.fmp4') {
        playUrl = `${baseUrl}/${app}/${stream}/hls.fmp4.m3u8`;
    } else if (schema === 'ts') {
        playUrl = `${baseUrl}/${app}/${stream}.live.ts`;
    } else if (schema === 'fmp4') {
        playUrl = `${baseUrl}/${app}/${stream}.live.mp4`;
    } else if (schema === 'rtsp') {
        playUrl = `${baseUrl}/index/api/whep?app=${encodeURIComponent(app)}&stream=${encodeURIComponent(stream)}`;
    } else {
        playUrl = `${baseUrl}/${app}/${stream}.live.flv`;
    }
    
    if (extraParams && typeof extraParams === 'object') {
        const qs = new URLSearchParams(extraParams).toString();
        if (qs) {
            playUrl += (playUrl.includes('?') ? '&' : '?') + qs;
        }
    }
    
    return playUrl;
}

async function fetchPlayUrlParams(app, stream) {
    try {
        const result = await Api.getPluginUrlParams('on_play', app, stream);
        if (result.code === 0 && result.data && Object.keys(result.data).length > 0) {
            return result.data;
        }
    } catch (e) {
        console.warn('Get play URL extra params failed, playing in default mode:', e);
    }
    return null;
}

async function playStream(app, stream, schema) {
    console.log('Play stream:', app, stream, schema);
    
    if (schema === 'rtsp') {
        playWithWHEP(app, stream);
    } else if (schema === 'fmp4') {
        const urlParams = await fetchPlayUrlParams(app, stream);
        playWithNative(app, stream, schema, urlParams);
    } else if (schema === 'rtmp') {
        const urlParams = await fetchPlayUrlParams(app, stream);
        playWithJessibuca(app, stream, schema, urlParams);
    } else if (schema === 'hls' || schema === 'hls.fmp4') {
        const urlParams = await fetchPlayUrlParams(app, stream);
        playWithNative(app, stream, schema, urlParams);
    } else if (schema === 'ts') {
        showToast('TS protocol does not support playback yet', 'error');
    } else {
        showToast('This protocol does not support playback yet', 'error');
    }
}

function playWithNative(app, stream, schema, urlParams) {
    try {
        const modal = document.createElement('div');
        modal.className = 'absolute inset-0 bg-black/80 flex items-center justify-center pointer-events-auto';
        modal.setAttribute('data-modal', 'streams');
        modal.innerHTML = `
            <div class="bg-gray-900 rounded-xl p-6 max-w-4xl w-full mx-4 border border-white/20" onclick="event.stopPropagation()">
                <div class="flex justify-between items-center mb-4">
                    <h3 class="text-xl font-bold text-white">Play stream: ${app}/${stream}</h3>
                    <button class="text-white/60 hover:text-white">
                        <i class="fa fa-times text-2xl"></i>
                    </button>
                </div>
                <div class="aspect-video bg-black rounded-lg overflow-hidden">
                    <video id="nativeVideo" class="w-full h-full" controls autoplay playsinline></video>
                </div>
                <div class="mt-4 text-white/60 text-sm">
                    Protocol: ${schema.toUpperCase()} | App: ${app} | stream: ${stream}
                </div>
            </div>
        `;
        document.getElementById('streams-modal-container').appendChild(modal);
        
        const playUrl = generatePlayUrl(app, stream, schema, urlParams);
        
        console.log('Native playback URL:', playUrl);
        
        const video = document.getElementById('nativeVideo');
        
        let hlsInstance = null;
        
        const destroyPlayer = () => {
            if (hlsInstance) {
                console.log('Destroy HLS player');
                hlsInstance.destroy();
                const index = hlsInstances.indexOf(hlsInstance);
                if (index > -1) {
                    hlsInstances.splice(index, 1);
                }
                hlsInstance = null;
            }
            if (video && !video.paused) {
                video.pause();
            }
        };
        
        if (schema === 'hls' || schema === 'hls.fmp4') {
            if (video.canPlayType('application/vnd.apple.mpegurl')) {
                video.src = playUrl;
            } else if (typeof Hls !== 'undefined' && Hls.isSupported()) {
                hlsInstance = new Hls();
                hlsInstances.push(hlsInstance);
                hlsInstance.loadSource(playUrl);
                hlsInstance.attachMedia(video);
                hlsInstance.on(Hls.Events.MANIFEST_PARSED, () => {
                    console.log('HLS manifest parsed successfully');
                    video.play();
                });
                hlsInstance.on(Hls.Events.ERROR, (event, data) => {
                    console.error('HLS Playback error:', data);
                    showToast('HLS Playback error: ' + data.type, 'error');
                });
            } else {
                showToast('Browser does not support HLS playback', 'error');
                return;
            }
        } else {
            video.src = playUrl;
        }
        
        video.play().catch(error => {
            console.error('Playback failed:', error);
            showToast('Playback failed: ' + error.message, 'error');
        });
        
        modal.addEventListener('click', function(e) {
            if (e.target === modal) {
                destroyPlayer();
                modal.remove();
            }
        });
        
        modal.querySelector('button').addEventListener('click', () => {
            destroyPlayer();
            modal.remove();
        });
        
    } catch (error) {
        console.error('Native playback failed:', error);
        showToast('Playback failed: ' + error.message, 'error');
    }
}

async function showStreamInfo(schema, vhost, app, stream) {
    try {
        console.log('Get stream info:', schema, vhost, app, stream);
        
        const result = await Api.getMediaInfo(schema, vhost, app, stream);
        
        if (result.code !== 0) {
            showToast('Failed to get stream info: ' + (result.msg || 'Unknown error'), 'error');
            return;
        }
        
        const data = result;
        
        const modal = document.createElement('div');
        modal.className = 'absolute inset-0 bg-black/80 flex items-center justify-center overflow-y-auto pointer-events-auto';
        modal.setAttribute('data-modal', 'streams');
        modal.innerHTML = `
            <div class="bg-gray-900 rounded-xl p-6 max-w-4xl w-full mx-4 my-8 border border-white/20 flex flex-col" style="max-height:90vh;" onclick="event.stopPropagation()">
                <div class="flex justify-between items-center mb-4 shrink-0">
                    <h3 class="text-xl font-bold text-white">Stream info: ${app}/${stream}</h3>
                    <button class="text-white/60 hover:text-white" onclick="this.closest('.absolute').remove()">
                        <i class="fa fa-times text-2xl"></i>
                    </button>
                </div>
                <div class="space-y-4 overflow-y-auto flex-1 min-h-0">
                    <div class="bg-white/5 rounded-lg p-4">
                        <h4 class="text-lg font-semibold text-white mb-3 border-b border-white/10 pb-2">Stream snapshot</h4>
                        <div class="flex items-center justify-center h-48 bg-white/5 rounded-lg" id="stream-snap-container">
                            <div class="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-primary"></div>
                        </div>
                    </div>
                    <div class="bg-white/5 rounded-lg p-4" id="stream-playurl-container">
                        <h4 class="text-lg font-semibold text-white mb-3 border-b border-white/10 pb-2">Play URL</h4>
                        <div class="flex items-center gap-2 text-sm text-white/40"><i class="fa fa-spinner fa-spin"></i> Loading...</div>
                    </div>
                    ${renderStreamInfo(data, vhost, app, stream)}
                </div>
                <div class="flex justify-end gap-2 pt-4 mt-2 border-t border-white/10 shrink-0">
                    <button class="bg-teal-500 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:shadow-neon transition-colors probe-btn" data-vhost="${vhost}" data-app="${app}" data-stream="${stream}"><i class="fa fa-stethoscope mr-1"></i>Probe</button>
                    <button class="bg-purple-500 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:shadow-neon transition-colors rec-nav-btn" data-vhost="${vhost}" data-app="${app}" data-stream="${stream}"><i class="fa fa-film mr-1"></i>Recordings</button>
                    <button class="bg-blue-500 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:shadow-neon transition-colors" onclick="showStreamPlayers('${schema}', '${vhost}', '${app}', '${stream}')"><i class="fa fa-users mr-1"></i>Viewers</button>
                    <button class="bg-red-500 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:shadow-neon transition-colors" onclick="stopStream('${schema}', '${vhost}', '${app}', '${stream}')"><i class="fa fa-stop mr-1"></i>Stop</button>
                </div>
            </div>
        `;
        document.getElementById('streams-modal-container').appendChild(modal);

        // Recordings button: via data-* avoid nested-quote issues
        modal.querySelector('.rec-nav-btn')?.addEventListener('click', function() {
            navigateToRecordings(this.dataset.vhost, this.dataset.app, this.dataset.stream);
        });

        // Probe button
        modal.querySelector('.probe-btn')?.addEventListener('click', function() {
            showProbeModal(this.dataset.vhost, this.dataset.app, this.dataset.stream);
        });

        modal.addEventListener('click', function(e) {
            if (e.target === modal) {
                modal.remove();
            }
        });
        
        // Get snapshot and display
        const snapUrlParams = await fetchPlayUrlParams(app, stream);
        const playUrl = generatePlayUrl(app, stream, schema, snapUrlParams);

        // Snapshot URL: rtsp use rtmp protocol flv address and append self=1
        const baseUrl = Api.getBaseUrl();
        let snapUrl;
        if (schema === 'rtsp') {
            snapUrl = `${baseUrl}/${app}/${stream}.live.flv`;
            if (snapUrlParams) {
                const qs = new URLSearchParams(snapUrlParams).toString();
                if (qs) snapUrl += '?' + qs;
            }
        } else {
            snapUrl = playUrl;
        }
        snapUrl += (snapUrl.includes('?') ? '&' : '?') + 'self=1';

        // Fill in play URLs
        const playUrlContainer = document.getElementById('stream-playurl-container');
        if (playUrlContainer) {
            playUrlContainer.innerHTML = `
                <h4 class="text-lg font-semibold text-white mb-3 border-b border-white/10 pb-2">Play URL</h4>
                <div class="flex items-center gap-2 text-sm">
                    <span class="text-white/80 break-all flex-1 font-mono bg-black/30 rounded px-3 py-2 select-all">${playUrl}</span>
                    <button class="shrink-0 bg-yellow-500 hover:bg-yellow-400 text-white px-3 py-2 rounded-lg font-semibold transition-colors" onclick="navigator.clipboard.writeText('${playUrl.replace(/'/g, "\\'")}').then(()=>showToast('Copied to clipboard','success')).catch(()=>showToast('Copy failed','error'))">
                        <i class="fa fa-copy mr-1"></i>Copy
                    </button>
                </div>
            `;
        }

        const snapContainer = document.getElementById('stream-snap-container');
        if (snapContainer) {
            await getStreamSnap(snapUrl, snapContainer);
        }
        
    } catch (error) {
        console.error('Failed to get stream info:', error);
        showToast('Failed to get stream info: ' + error.message, 'error');
    }
}

function renderStreamInfo(data, vhost, app, stream) {
    let html = '';
    
    html += `
        <div class="bg-white/5 rounded-lg p-4">
            <h4 class="text-lg font-semibold text-white mb-3 border-b border-white/10 pb-2">Basic info</h4>
            <div class="grid grid-cols-2 gap-3 text-sm">
                <div><span class="text-white/60">App:</span> <span class="text-white">${data.app || '-'}</span></div>
                <div><span class="text-white/60">Stream ID:</span> <span class="text-white">${data.stream || '-'}</span></div>
                <div><span class="text-white/60">Protocol:</span> <span class="text-white">${data.schema || '-'}</span></div>
                <div><span class="text-white/60">Virtual host:</span> <span class="text-white">${data.vhost || '-'}</span></div>
                <div><span class="text-white/60">Alive time:</span> <span class="text-white">${data.aliveSecond ? data.aliveSecond + ' s' : '-'}</span></div>
                <div><span class="text-white/60">Viewers:</span> <span class="text-white">${data.readerCount || 0}</span></div>
                <div><span class="text-white/60">Total viewers:</span> <span class="text-white">${data.totalReaderCount || 0}</span></div>
                <div><span class="text-white/60">Bitrate:</span> <span class="text-white">${data.bytesSpeed ? (data.bytesSpeed / 1024).toFixed(2) + ' KB/s' : '-'}</span></div>
                <div><span class="text-white/60">Total traffic:</span> <span class="text-white">${data.totalBytes ? (data.totalBytes / 1024 / 1024).toFixed(2) + ' MB' : '-'}</span></div>
                <div><span class="text-white/60">Created at:</span> <span class="text-white">${data.createStamp ? new Date(data.createStamp * 1000).toLocaleString() : '-'}</span></div>
                <div><span class="text-white/60">Current timestamp:</span> <span class="text-white">${data.currentStamp || '-'}</span></div>
                <div><span class="text-white/60">Params:</span> <span class="text-white break-all">${data.params || '-'}</span></div>
            </div>
        </div>
    `;
    
    if (data.originSock) {
        html += `
            <div class="bg-white/5 rounded-lg p-4">
                <h4 class="text-lg font-semibold text-white mb-3 border-b border-white/10 pb-2">Source info</h4>
                <div class="grid grid-cols-2 gap-3 text-sm">
                    <div><span class="text-white/60">Source type:</span> <span class="text-white">${data.originTypeStr || '-'}</span></div>
                    <div><span class="text-white/60">Source type ID:</span> <span class="text-white">${data.originType || '-'}</span></div>
                    <div><span class="text-white/60">Source URL:</span> <span class="text-white break-all">${data.originUrl || '-'}</span></div>
                    <div><span class="text-white/60">Local address:</span> <span class="text-white">${data.originSock.local_ip}:${data.originSock.local_port}</span></div>
                    <div><span class="text-white/60">Remote address:</span> <span class="text-white">${data.originSock.peer_ip}:${data.originSock.peer_port}</span></div>
                    <div><span class="text-white/60">Identifier:</span> <span class="text-white">${data.originSock.identifier || '-'}</span></div>
                </div>
            </div>
        `;
    }
    
    if (data.tracks && data.tracks.length > 0) {
        html += `
            <div class="bg-white/5 rounded-lg p-4">
                <h4 class="text-lg font-semibold text-white mb-3 border-b border-white/10 pb-2">Track info</h4>
                <div class="space-y-3">
        `;
        
        data.tracks.forEach((track, index) => {
            const isVideo = track.codec_type === 0;
            html += `
                <div class="bg-white/5 rounded p-3">
                    <div class="font-semibold text-white mb-2">${isVideo ? 'Video track' : 'Audio track'} #${index + 1}</div>
                    <div class="grid grid-cols-2 gap-2 text-sm">
                        <div><span class="text-white/60">Codec:</span> <span class="text-white">${track.codec_id_name || '-'}</span></div>
                        <div><span class="text-white/60">Ready:</span> <span class="text-white">${track.ready ? 'Yes' : 'No'}</span></div>
                        ${isVideo ? `
                            <div><span class="text-white/60">Resolution:</span> <span class="text-white">${track.width || '-'}x${track.height || '-'}</span></div>
                            <div><span class="text-white/60">FPS:</span> <span class="text-white">${track.fps || '-'}</span></div>
                            <div><span class="text-white/60">GOP size:</span> <span class="text-white">${track.gop_size || '-'}</span></div>
                            <div><span class="text-white/60">GOP interval:</span> <span class="text-white">${track.gop_interval_ms || '-'}ms</span></div>
                            <div><span class="text-white/60">Keyframe count:</span> <span class="text-white">${track.key_frames || '-'}</span></div>
                            <div><span class="text-white/60">Total frames:</span> <span class="text-white">${track.frames || '-'}</span></div>
                        ` : `
                            <div><span class="text-white/60">Sample rate:</span> <span class="text-white">${track.sample_rate || '-'}</span></div>
                            <div><span class="text-white/60">Channels:</span> <span class="text-white">${track.channels || '-'}</span></div>
                            <div><span class="text-white/60">Sample bits:</span> <span class="text-white">${track.sample_bit || '-'}</span></div>
                            <div><span class="text-white/60">Total frames:</span> <span class="text-white">${track.frames || '-'}</span></div>
                        `}
                        <div><span class="text-white/60">Duration:</span> <span class="text-white">${track.duration ? (track.duration / 1000).toFixed(2) + ' s' : '-'}</span></div>
                        <div><span class="text-white/60">Loss rate:</span> <span class="text-white">${track.loss || 0}%</span></div>
                    </div>
                </div>
            `;
        });
        
        html += `
                </div>
            </div>
        `;
    }
    
    if (data.isRecordingHLS !== undefined || data.isRecordingMP4 !== undefined) {
        const hlsRecording = !!data.isRecordingHLS;
        const mp4Recording = !!data.isRecordingMP4;
        const v = vhost, a = app, s = stream;
        html += `
            <div class="bg-white/5 rounded-lg p-4">
                <h4 class="text-lg font-semibold text-white mb-3 border-b border-white/10 pb-2">Recording status</h4>
                <div class="grid grid-cols-2 gap-4 text-sm">
                    <div class="flex items-center gap-3">
                        <span class="text-white/60">HLS:</span>
                        <span class="text-white mr-1">${hlsRecording ? '<span class="text-green-400">Recording</span>' : '<span class="text-white/40">Not recording</span>'}</span>
                        ${hlsRecording
                            ? `<button class="bg-red-500 hover:bg-red-400 text-white px-3 py-1 rounded-lg text-xs font-semibold transition-colors" onclick="toggleRecord(0,'${v}','${a}','${s}',false,this)"><i class="fa fa-stop mr-1"></i>Stop</button>`
                            : `<button class="bg-green-600 hover:bg-green-500 text-white px-3 py-1 rounded-lg text-xs font-semibold transition-colors" onclick="toggleRecord(0,'${v}','${a}','${s}',true,this)"><i class="fa fa-circle mr-1"></i>Start</button>`
                        }
                    </div>
                    <div class="flex items-center gap-3">
                        <span class="text-white/60">MP4:</span>
                        <span class="text-white mr-1">${mp4Recording ? '<span class="text-green-400">Recording</span>' : '<span class="text-white/40">Not recording</span>'}</span>
                        ${mp4Recording
                            ? `<button class="bg-red-500 hover:bg-red-400 text-white px-3 py-1 rounded-lg text-xs font-semibold transition-colors" onclick="toggleRecord(1,'${v}','${a}','${s}',false,this)"><i class="fa fa-stop mr-1"></i>Stop</button>`
                            : `<button class="bg-green-600 hover:bg-green-500 text-white px-3 py-1 rounded-lg text-xs font-semibold transition-colors" onclick="toggleRecord(1,'${v}','${a}','${s}',true,this)"><i class="fa fa-circle mr-1"></i>Start</button>`
                        }
                    </div>
                </div>
            </div>
        `;
    }
    
    if (data.transcode && data.transcode.length > 0) {
        html += `
            <div class="bg-white/5 rounded-lg p-4">
                <h4 class="text-lg font-semibold text-white mb-3 border-b border-white/10 pb-2">Transcode info</h4>
                <div class="space-y-3">
        `;
        
        data.transcode.forEach((transcode, index) => {
            html += `
                <div class="bg-white/5 rounded p-3">
                    <div class="font-semibold text-white mb-2">Transcode config #${index + 1}</div>
                    <div class="grid grid-cols-2 gap-2 text-sm">
                        <div><span class="text-white/60">Video decode:</span> <span class="text-white">${transcode.vdec || '-'}</span></div>
                        <div><span class="text-white/60">Video codec:</span> <span class="text-white">${transcode.venc || '-'}</span></div>
                        <div><span class="text-white/60">Audio decode:</span> <span class="text-white">${transcode.adec || '-'}</span></div>
                        <div><span class="text-white/60">Audio codec:</span> <span class="text-white">${transcode.aenc || '-'}</span></div>
                        <div><span class="text-white/60">Name:</span> <span class="text-white">${transcode.name || '-'}</span></div>
                    </div>
            `;
            
            if (transcode.setting) {
                html += `
                    <div class="mt-2 pt-2 border-t border-white/10">
                        <div class="text-white/80 font-semibold mb-1">Transcode settings</div>
                        <div class="grid grid-cols-2 gap-2 text-sm">
                            <div><span class="text-white/60">Target video codec:</span> <span class="text-white">${transcode.setting.target_vcodec || '-'}</span></div>
                            <div><span class="text-white/60">Target audio codec:</span> <span class="text-white">${transcode.setting.target_acodec || '-'}</span></div>
                            <div><span class="text-white/60">Video decoder threads:</span> <span class="text-white">${transcode.setting.vdecoder_threads || '-'}</span></div>
                            <div><span class="text-white/60">Video encoder threads:</span> <span class="text-white">${transcode.setting.vencoder_threads || '-'}</span></div>
                            <div><span class="text-white/60">Audio decoder threads:</span> <span class="text-white">${transcode.setting.adecoder_threads || '-'}</span></div>
                            <div><span class="text-white/60">Audio encoder threads:</span> <span class="text-white">${transcode.setting.aencoder_threads || '-'}</span></div>
                            <div><span class="text-white/60">Filter threads:</span> <span class="text-white">${transcode.setting.filter_threads || '-'}</span></div>
                            <div><span class="text-white/60">Filter:</span> <span class="text-white">${transcode.setting.filter || '-'}</span></div>
                            <div><span class="text-white/60">Hardware decode:</span> <span class="text-white">${transcode.setting.hw_decoder ? 'Yes' : 'No'}</span></div>
                            <div><span class="text-white/60">Hardware encode:</span> <span class="text-white">${transcode.setting.hw_encoder ? 'Yes' : 'No'}</span></div>
                            <div><span class="text-white/60">Force transcode:</span> <span class="text-white">${transcode.setting.force ? 'Yes' : 'No'}</span></div>
                        </div>
                    </div>
                `;
            }
            
            if (transcode.venc_ctx) {
                html += `
                    <div class="mt-2 pt-2 border-t border-white/10">
                        <div class="text-white/80 font-semibold mb-1">Video encoder params</div>
                        <div class="grid grid-cols-2 gap-2 text-sm">
                            <div><span class="text-white/60">Resolution:</span> <span class="text-white">${transcode.venc_ctx.width || '-'}x${transcode.venc_ctx.height || '-'}</span></div>
                            <div><span class="text-white/60">FPS:</span> <span class="text-white">${transcode.venc_ctx.fps || '-'}</span></div>
                            <div><span class="text-white/60">Bitrate:</span> <span class="text-white">${transcode.venc_ctx.bit_rate || '-'}</span></div>
                            <div><span class="text-white/60">GOP:</span> <span class="text-white">${transcode.venc_ctx.gop || '-'}</span></div>
                            <div><span class="text-white/60">Pixel format:</span> <span class="text-white">${transcode.venc_ctx.pix_fmt || '-'}</span></div>
                            <div><span class="text-white/60">Bframes:</span> <span class="text-white">${transcode.venc_ctx.has_b_frames || '-'}</span></div>
                        </div>
                    </div>
                `;
            }
            
            if (transcode.aenc_ctx) {
                html += `
                    <div class="mt-2 pt-2 border-t border-white/10">
                        <div class="text-white/80 font-semibold mb-1">Audio encoder params</div>
                        <div class="grid grid-cols-2 gap-2 text-sm">
                            <div><span class="text-white/60">Sample rate:</span> <span class="text-white">${transcode.aenc_ctx.sample_rate || '-'}</span></div>
                            <div><span class="text-white/60">Channels:</span> <span class="text-white">${transcode.aenc_ctx.channels || '-'}</span></div>
                            <div><span class="text-white/60">Bitrate:</span> <span class="text-white">${transcode.aenc_ctx.bit_rate || '-'}</span></div>
                            <div><span class="text-white/60">Frame size:</span> <span class="text-white">${transcode.aenc_ctx.frame_size || '-'}</span></div>
                            <div><span class="text-white/60">Sample format:</span> <span class="text-white">${transcode.aenc_ctx.sample_fmt || '-'}</span></div>
                        </div>
                    </div>
                `;
            }
            
            html += `</div>`;
        });
        
        html += `
                </div>
            </div>
        `;
    }
    
    return html;
}

async function playWithWHEP(app, stream) {
    try {
        const modal = document.createElement('div');
        modal.className = 'absolute inset-0 bg-black/80 flex items-center justify-center pointer-events-auto';
        modal.setAttribute('data-modal', 'streams');
        modal.innerHTML = `
            <div class="bg-gray-900 rounded-xl p-6 max-w-4xl w-full mx-4 border border-white/20" onclick="event.stopPropagation()">
                <div class="flex justify-between items-center mb-4">
                    <h3 class="text-xl font-bold text-white">Play stream: ${app}/${stream}</h3>
                    <button class="text-white/60 hover:text-white" onclick="this.closest('.absolute').remove()">
                        <i class="fa fa-times text-2xl"></i>
                    </button>
                </div>
                <div class="aspect-video bg-black rounded-lg overflow-hidden">
                    <video id="whepVideo" class="w-full h-full" controls autoplay playsinline></video>
                </div>
                <div class="mt-4 text-white/60 text-sm">
                    Protocol: WHEP (WebRTC) | App: ${app} | stream: ${stream}
                </div>
            </div>
        `;
        document.getElementById('streams-modal-container').appendChild(modal);
        
        modal.addEventListener('click', function(e) {
            if (e.target === modal) {
                modal.remove();
            }
        });
        
        const video = document.getElementById('whepVideo');
        
        const peerConnection = new RTCPeerConnection({
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' }
            ]
        });
        
        peerConnection.addTransceiver('video', { direction: 'recvonly' });
        peerConnection.addTransceiver('audio', { direction: 'recvonly' });
        
        peerConnection.ontrack = (event) => {
            console.log('Received remote track:', event.track.kind);
            if (video.srcObject === null) {
                video.srcObject = new MediaStream();
            }
            video.srcObject.addTrack(event.track);
        };
        
        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);
        
        const whepUrlParams = await fetchPlayUrlParams(app, stream);
        const whepUrl = generatePlayUrl(app, stream, 'rtsp', whepUrlParams);
        console.log('Send WHEP request to:', whepUrl);
        
        const response = await fetch(whepUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/sdp'
            },
            body: offer.sdp,
            credentials: 'include'
        });
        
        if (!response.ok) {
            throw new Error(`WHEP server returned error: ${response.status}`);
        }
        
        const answerSDP = await response.text();
        await peerConnection.setRemoteDescription(new RTCSessionDescription({
            type: 'answer',
            sdp: answerSDP
        }));
        
        console.log('WHEP Playback succeeded');
        
        modal.querySelector('button').addEventListener('click', () => {
            peerConnection.close();
            video.srcObject = null;
        });
        
    } catch (error) {
        console.error('WHEP Playback failed:', error);
        showToast('Playback failed: ' + error.message, 'error');
    }
}

function playWithJessibuca(app, stream, schema, urlParams) {
    try {
        const modal = document.createElement('div');
        modal.className = 'absolute inset-0 bg-black/80 flex items-center justify-center pointer-events-auto';
        modal.setAttribute('data-modal', 'streams');
        modal.innerHTML = `
            <div class="bg-gray-900 rounded-xl p-6 max-w-4xl w-full mx-4 border border-white/20" onclick="event.stopPropagation()">
                <div class="flex justify-between items-center mb-4">
                    <h3 class="text-xl font-bold text-white">Play stream: ${app}/${stream}</h3>
                    <button class="text-white/60 hover:text-white" onclick="this.closest('.absolute').remove()">
                        <i class="fa fa-times text-2xl"></i>
                    </button>
                </div>
                <div class="aspect-video bg-black rounded-lg overflow-hidden">
                    <div id="jessibucaContainer" class="w-full h-full"></div>
                </div>
                <div class="mt-4 text-white/60 text-sm">
                    Protocol: ${schema.toUpperCase()} | App: ${app} | stream: ${stream}
                </div>
            </div>
        `;
        document.getElementById('streams-modal-container').appendChild(modal);
        
        const playUrl = generatePlayUrl(app, stream, schema, urlParams);
        
        console.log('Jessibuca Play URL:', playUrl);
        
        let jessibucaInstance = null;
        
        const destroyPlayer = () => {
            if (jessibucaInstance) {
                console.log('Destroy Jessibuca player');
                jessibucaInstance.destroy();
                const index = jessibucaInstances.indexOf(jessibucaInstance);
                if (index > -1) {
                    jessibucaInstances.splice(index, 1);
                }
                jessibucaInstance = null;
            }
        };
        
        modal.addEventListener('click', function(e) {
            if (e.target === modal) {
                destroyPlayer();
                modal.remove();
            }
        });
        
        if (window.Jessibuca) {
            jessibucaInstance = initJessibucaPlayer(playUrl, modal, destroyPlayer);
        } else {
            const script = document.createElement('script');
            script.src = 'js/lib/jessibuca.js';
            script.onload = () => {
                console.log('Jessibuca Player loaded successfully');
                jessibucaInstance = initJessibucaPlayer(playUrl, modal, destroyPlayer);
            };
            script.onerror = () => {
                console.error('Load Jessibuca player failed');
                showToast('Failed to load player', 'error');
            };
            document.head.appendChild(script);
        }
        
    } catch (error) {
        console.error('Jessibuca Playback failed:', error);
        showToast('Playback failed: ' + error.message, 'error');
    }
}

function initJessibucaPlayer(playUrl, modal, destroyCallback) {
    try {
        const jessibuca = new window.Jessibuca({
            container: document.getElementById('jessibucaContainer'),
            videoBuffer: 0.5,
            isResize: true,
            loadingText: 'Loading...',
            hasAudio: true,
            hasVideo: true,
            debug: true,
            supportDblclickFullscreen: true,
            showBandwidth: true,
            operateBtns: {
                fullscreen: true,
                screenshot: true,
                play: true,
                audio: true
            },
            forceNoOffscreen: true,
            isNotMute: true,
            timeout: 10,
            heartTimeout: 10,
            heartTimeoutReplay: true,
            heartTimeoutReplayTimes: 3,
            wasmDecodeErrorReplay: true,
            decoder: 'js/lib/decoder.js'
        });
        
        jessibuca.on('play', () => {
            console.log('Jessibuca started playing');
        });
        
        jessibuca.on('pause', () => {
            console.log('Jessibuca Playback paused');
        });
        
        jessibuca.on('error', (error) => {
            console.error('Jessibuca Playback error:', error);
            showToast('Playback error: ' + JSON.stringify(error), 'error');
        });
        
        jessibuca.on('timeout', () => {
            console.error('Jessibuca Playback timed out');
            showToast('Playback timed out, please check the stream URL', 'error');
        });
        
        console.log('Start playing:', playUrl);
        jessibuca.play(playUrl);
        
        jessibucaInstances.push(jessibuca);
        
        modal.querySelector('button').addEventListener('click', () => {
            if (destroyCallback) {
                destroyCallback();
            }
        });
        
        return jessibuca;
    } catch (error) {
        console.error('Init Jessibuca player failed:', error);
        showToast('Failed to init player: ' + error.message, 'error');
        return null;
    }
}

function showConfirmModal(title, message, onConfirm, onCancel) {
    const modal = document.createElement('div');
    modal.className = 'fixed inset-0 bg-black/80 flex items-center justify-center z-50';
    modal.innerHTML = `
        <div class="bg-gray-900 rounded-xl p-6 max-w-md w-full mx-4 border border-white/20" id="confirmModalContent">
            <div class="flex justify-between items-center mb-4">
                <h3 class="text-xl font-bold text-white">${title}</h3>
                <button class="text-white/60 hover:text-white" id="confirmModalClose">
                    <i class="fa fa-times text-2xl"></i>
                </button>
            </div>
            <p class="text-white/80 mb-6">${message}</p>
            <div class="flex justify-end space-x-3">
                <button class="bg-gray-700 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-gray-600 transition-colors" id="confirmModalCancel">Cancel</button>
                <button class="bg-red-500 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:shadow-neon transition-colors" id="confirmModalConfirm">Confirm</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
    
    // Add event listener
    document.getElementById('confirmModalClose').addEventListener('click', function() {
        modal.remove();
    });
    
    document.getElementById('confirmModalCancel').addEventListener('click', function() {
        modal.remove();
        if (typeof onCancel === 'function') {
            onCancel();
        }
    });
    
    document.getElementById('confirmModalConfirm').addEventListener('click', function() {
        modal.remove();
        if (typeof onConfirm === 'function') {
            onConfirm();
        }
    });
    
    document.getElementById('confirmModalContent').addEventListener('click', function(e) {
        e.stopPropagation();
    });
    
    modal.addEventListener('click', function(e) {
        if (e.target === modal) {
            modal.remove();
        }
    });
}

async function showStreamPlayers(schema, vhost, app, stream) {
    try {
        console.log('Get player list:', schema, vhost, app, stream);
        
        const result = await Api.getMediaPlayerList(schema, vhost, app, stream);
        
        if (result.code !== 0) {
            showToast('Failed to get player list: ' + (result.msg || 'Unknown error'), 'error');
            return;
        }
        
        const players = result.data || [];
        
        const modal = document.createElement('div');
        modal.className = 'absolute inset-0 bg-black/80 flex items-center justify-center overflow-y-auto pointer-events-auto';
        modal.setAttribute('data-modal', 'streams');
        
        let playersHtml = '';
        if (players.length === 0) {
            playersHtml = `
                <div class="p-8 text-center text-white/60">
                    No player connections
                </div>
            `;
        } else {
            playersHtml = `
                <div class="space-y-4">
                    ${players.map((player, index) => `
                        <div class="bg-white/5 rounded-lg p-4">
                            <div class="grid grid-cols-2 gap-3 text-sm">
                                <div><span class="text-white/60">Identifier:</span> <span class="text-white">${player.identifier || '-'}</span></div>
                                <div><span class="text-white/60">Type:</span> <span class="text-white">${player.typeid || '-'}</span></div>
                                <div><span class="text-white/60">Local IP:</span> <span class="text-white">${player.local_ip || '-'}</span></div>
                                <div><span class="text-white/60">Local port:</span> <span class="text-white">${player.local_port || '-'}</span></div>
                                <div><span class="text-white/60">Remote IP:</span> <span class="text-white">${player.peer_ip || '-'}</span></div>
                                <div><span class="text-white/60">Remote port:</span> <span class="text-white">${player.peer_port || '-'}</span></div>
                            </div>
                        </div>
                    `).join('')}
                </div>
            `;
        }
        
        modal.innerHTML = `
            <div class="bg-gray-900 rounded-xl p-6 max-w-4xl w-full mx-4 my-8 border border-white/20" onclick="event.stopPropagation()">
                <div class="flex justify-between items-center mb-4">
                    <h3 class="text-xl font-bold text-white">Player list: ${app}/${stream}</h3>
                    <button class="text-white/60 hover:text-white" onclick="this.closest('.absolute').remove()">
                        <i class="fa fa-times text-2xl"></i>
                    </button>
                </div>
                <div class="max-h-[70vh] overflow-y-auto">
                    ${playersHtml}
                </div>
            </div>
        `;
        document.getElementById('streams-modal-container').appendChild(modal);
        
        modal.addEventListener('click', function(e) {
            if (e.target === modal) {
                modal.remove();
            }
        });
        
    } catch (error) {
        console.error('Failed to get player list:', error);
        showToast('Failed to get player list: ' + error.message, 'error');
    }
}

async function getStreamSnap(url, container) {
    try {
        console.log('Get snapshot:', url);
        
        // Show loading state
        container.innerHTML = `
            <div class="flex items-center justify-center h-full bg-white/5 rounded-lg">
                <div class="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-primary"></div>
            </div>
        `;
        
        // call getSnap API to get the snapshot
        const result = await Api.getSnap(url, 5, 3);
        
        if (result.code === 0 && result.data) {
            // Show snapshot
            container.innerHTML = `
                <div class="relative flex items-center justify-center h-full">
                    <img src="${result.data}" alt="Stream snapshot" class="max-w-full max-h-full object-contain rounded-lg border border-white/20 cursor-pointer hover:opacity-90 transition-opacity" onclick="showSnapModal('${result.data}')">
                    <div class="absolute bottom-2 right-2 flex space-x-1">
                        <button class="bg-blue-500 text-white px-2 py-1 rounded text-xs font-semibold hover:bg-blue-600 transition-colors" onclick="downloadSnap('${result.data}')">
                            <i class="fa fa-download mr-1"></i>Download
                        </button>
                    </div>
                </div>
            `;
        } else {
            // Show error state
            container.innerHTML = `
                <div class="flex items-center justify-center h-full bg-white/5 rounded-lg">
                    <span class="text-white/60 text-sm">Failed to get</span>
                </div>
            `;
        }
    } catch (error) {
        console.error('Failed to get snapshot:', error);
        // Show error state
        container.innerHTML = `
            <div class="flex items-center justify-center h-full bg-white/5 rounded-lg">
                <span class="text-white/60 text-sm">Failed to get</span>
            </div>
        `;
    }
}

function downloadSnap(imageUrl) {
    // Create a temporary link and click to download
    const link = document.createElement('a');
    link.href = imageUrl;
    link.download = `stream-snap-${Date.now()}.jpg`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

function showSnapModal(imageUrl) {
    // Create a popup to show the enlarged snapshot
    const modal = document.createElement('div');
    modal.className = 'fixed inset-0 bg-black/90 flex items-center justify-center z-50';
    modal.innerHTML = `
        <div class="bg-gray-900 rounded-xl p-6 max-w-4xl w-full mx-4 border border-white/20" onclick="event.stopPropagation()">
            <div class="flex justify-between items-center mb-4">
                <h3 class="text-xl font-bold text-white">Stream snapshot</h3>
                <button class="text-white/60 hover:text-white" onclick="this.closest('.fixed').remove()">
                    <i class="fa fa-times text-2xl"></i>
                </button>
            </div>
            <div class="flex justify-center">
                <img src="${imageUrl}" alt="Stream snapshot" class="max-w-full max-h-[70vh] object-contain rounded-lg">
            </div>
            <div class="mt-4 flex justify-end">
                <button class="bg-blue-500 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:shadow-neon transition-colors" onclick="downloadSnap('${imageUrl}')">
                    <i class="fa fa-download mr-2"></i>Download snapshot
                </button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
    
    // Click outside the popup to close
    modal.addEventListener('click', function(e) {
        if (e.target === modal) {
            modal.remove();
        }
    });
}

async function copyStreamUrl(app, stream, schema) {
    const urlParams = await fetchPlayUrlParams(app, stream);
    const url = generatePlayUrl(app, stream, schema, urlParams);
    try {
        await navigator.clipboard.writeText(url);
        showToast('Address copied to clipboard', 'success');
    } catch (e) {
        // Fallback
        const input = document.createElement('input');
        input.value = url;
        document.body.appendChild(input);
        input.select();
        document.execCommand('copy');
        document.body.removeChild(input);
        showToast('Address copied to clipboard', 'success');
    }
}

async function toggleRecord(type, vhost, app, stream, start, btn) {
    // type: 0=hls, 1=mp4; start: true=Start recording, false=Stop recording
    const typeName = type === 0 ? 'HLS' : 'MP4';
    try {
        btn.disabled = true;
        btn.innerHTML = '<i class="fa fa-spinner fa-spin mr-1"></i>Processing...';
        let result;
        if (start) {
            result = await Api.startRecord(type, vhost, app, stream);
        } else {
            result = await Api.stopRecord(type, vhost, app, stream);
        }
        if (result.code === 0 && result.result !== false) {
            showToast(`${typeName} recording ${start ? 'started' : 'stopped'}`, 'success');
            // Toggle button state
            const isNowRecording = start;
            btn.className = isNowRecording
                ? 'bg-red-500 hover:bg-red-400 text-white px-3 py-1 rounded-lg text-xs font-semibold transition-colors'
                : 'bg-green-600 hover:bg-green-500 text-white px-3 py-1 rounded-lg text-xs font-semibold transition-colors';
            btn.innerHTML = isNowRecording
                ? '<i class="fa fa-stop mr-1"></i>Stop'
                : '<i class="fa fa-circle mr-1"></i>Start';
            btn.setAttribute('onclick', `toggleRecord(${type},'${vhost}','${app}','${stream}',${!isNowRecording},this)`);
            btn.disabled = false;
            // Update status text
            const statusSpan = btn.parentElement.querySelector('span.text-white span');
            if (statusSpan) {
                statusSpan.className = isNowRecording ? 'text-green-400' : 'text-white/40';
                statusSpan.textContent = isNowRecording ? 'Recording' : 'Not recording';
            }
        } else {
            showToast(`${typeName} recording ${start ? 'start' : 'stop'} failed: ${result.msg || 'Unknown error'}`, 'error');
            btn.disabled = false;
            btn.innerHTML = start
                ? '<i class="fa fa-circle mr-1"></i>Start'
                : '<i class="fa fa-stop mr-1"></i>Stop';
        }
    } catch (error) {
        showToast(`Operation failed: ${error.message}`, 'error');
        btn.disabled = false;
    }
}

async function stopStream(schema, vhost, app, stream) {
    // Show custom confirm modal
    showConfirmModal(
        'Confirm stop stream',
        `Are you sure you want to stop stream ${app}/${stream} ?`,
        async function() {
            try {
                console.log('Stop stream:', schema, vhost, app, stream);
                
                const result = await Api.closeStream(schema, vhost, app, stream);
                
                if (result.code === 0) {
                    showToast('Stream stopped', 'success');
                    // Reload the stream list
                    loadStreams();
                } else {
                    showToast('Stop stream failed: ' + (result.msg || 'Unknown error'), 'error');
                }
            } catch (error) {
                console.error('Stop stream failed:', error);
                showToast('Stop stream failed: ' + error.message, 'error');
            }
        }
    );
}

// ══════════════════════════════════════════════════════════
// Stream Probe - Frame data analysis modal
// ══════════════════════════════════════════════════════════
async function showProbeModal(vhost, app, stream) {
    const container = document.getElementById('streams-modal-container');

    // Show the loading modal first
    const modal = document.createElement('div');
    modal.className = 'absolute inset-0 bg-black/80 overflow-y-auto pointer-events-auto';
    modal.setAttribute('data-modal', 'probe');
    modal.innerHTML = `
        <div class="bg-gray-900 rounded-xl p-6 w-full mx-auto my-8 border border-white/20" style="max-width:1200px;" onclick="event.stopPropagation()">
            <div class="flex justify-between items-center mb-4">
                <h3 class="text-xl font-bold text-white"><i class="fa fa-stethoscope mr-2 text-teal-400"></i>Stream Probe analysis: ${app}/${stream}</h3>
                <button class="text-white/60 hover:text-white" onclick="this.closest('[data-modal=probe]').remove()">
                    <i class="fa fa-times text-2xl"></i>
                </button>
            </div>
            <div id="probe-body" class="flex items-center justify-center min-h-32">
                <div class="text-center text-white/60 py-12">
                    <div class="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-teal-400 mx-auto mb-4"></div>
                    <p>Collecting 5 sec of frame data, please wait…</p>
                </div>
            </div>
        </div>
    `;
    container.appendChild(modal);
    modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });

    try {
        const result = await Api.addProbe(vhost, app, stream, 5000);
        const body = modal.querySelector('#probe-body');
        if (result.code !== 0) {
            body.innerHTML = `<div class="text-red-400 p-6">Probe failed: ${result.msg || 'Unknown error'}</div>`;
            return;
        }
        const frames = result.data || [];
        body.innerHTML = renderProbeAnalysis(frames);
        bindChartHover(body);
    } catch (e) {
        const body = modal.querySelector('#probe-body');
        body.innerHTML = `<div class="text-red-400 p-6">Request failed: ${e.message}</div>`;
    }
}

/**
 * Bind line-chart hover interaction (must be after innerHTML is filled)
 */
function bindChartHover(container) {
    container.querySelectorAll('[id^="pc"]').forEach(svg => {
        const tip = document.getElementById(svg.id + '-tip');
        if (!tip) return;
        const W = parseFloat(svg.getAttribute('viewBox').split(' ')[2]) || 1000;
        svg.querySelectorAll('.probe-hit').forEach(g => {
            g.addEventListener('mouseenter', function () {
                const vline = this.querySelector('.probe-vline');
                const dot   = this.querySelector('.probe-dot');
                if (vline) vline.style.display = '';
                if (dot)   dot.style.display   = '';
                const tx = parseFloat(this.getAttribute('transform').replace('translate(', ''));
                tip.textContent = this.dataset.val + ' ms';
                tip.style.left  = (tx / W * 100).toFixed(2) + '%';
                tip.style.display = 'block';
            });
            g.addEventListener('mouseleave', function () {
                const vline = this.querySelector('.probe-vline');
                const dot   = this.querySelector('.probe-dot');
                if (vline) vline.style.display = 'none';
                if (dot)   dot.style.display   = 'none';
                tip.style.display = 'none';
            });
        });
    });
}

/**
 * Analyze frame data and render the analysis report
 */
function renderProbeAnalysis(frames) {
    if (!frames.length) return `<div class="text-white/50 p-6 text-center">No frame data retrieved</div>`;

    // ── by codec group ──
    const groups = {};
    for (const f of frames) {
        const key = f.codec;
        if (!groups[key]) groups[key] = [];
        groups[key].push(f);
    }

    const codecKeys = Object.keys(groups);

    // ── For each codec stats ──
    function analyzeGroup(list) {
        // Dedup (sometimes one frame has several records, config_frame differs), keep frame_size with the max
        const byDts = {};
        for (const f of list) {
            const k = f.dts;
            if (!byDts[k] || f.frame_size > byDts[k].frame_size) byDts[k] = f;
        }
        const uniq = Object.values(byDts).sort((a, b) => a.dts - b.dts);

        // dts interval
        const dtsIntervals = [];
        for (let i = 1; i < uniq.length; i++) dtsIntervals.push(uniq[i].dts - uniq[i - 1].dts);

        // recv_stamp interval (arrival interval)
        const recvIntervals = [];
        for (let i = 1; i < uniq.length; i++) recvIntervals.push(uniq[i].recv_stamp - uniq[i - 1].recv_stamp);

        // pts - dts offset
        const ptsDtsOffsets = uniq.map(f => f.pts - f.dts);

        function stats(arr) {
            if (!arr.length) return { min: 0, max: 0, avg: 0, stddev: 0, p95: 0 };
            const sorted = [...arr].sort((a, b) => a - b);
            const avg = arr.reduce((s, v) => s + v, 0) / arr.length;
            const variance = arr.reduce((s, v) => s + (v - avg) ** 2, 0) / arr.length;
            return {
                min: sorted[0],
                max: sorted[sorted.length - 1],
                avg: avg.toFixed(2),
                stddev: Math.sqrt(variance).toFixed(2),
                p95: sorted[Math.floor(sorted.length * 0.95)] ?? sorted[sorted.length - 1],
            };
        }

        const dtsStats  = stats(dtsIntervals);
        const recvStats = stats(recvIntervals);
        const ptsStats  = stats(ptsDtsOffsets);
        const keyFrames = uniq.filter(f => f.key_frame).length;
        const totalBytes = uniq.reduce((s, f) => s + f.frame_size, 0);
        const duration = uniq.length > 1 ? uniq[uniq.length - 1].dts - uniq[0].dts : 0;
        const fps = duration > 0 ? ((uniq.length / duration) * 1000).toFixed(2) : 'N/A';

        // Smoothness score (stddev/avg smaller is smoother)
        function smoothScore(s) {
            if (!s.avg || s.avg == 0) return '—';
            const ratio = s.stddev / s.avg;
            if (ratio < 0.05) return '<span class="text-green-400 font-bold">Excellent</span>';
            if (ratio < 0.15) return '<span class="text-yellow-400 font-bold">Good</span>';
            if (ratio < 0.30) return '<span class="text-orange-400 font-bold">Fair</span>';
            return '<span class="text-red-400 font-bold">Jitter</span>';
        }

        return { uniq, dtsStats, recvStats, ptsStats, keyFrames, totalBytes, duration, fps, smoothScore };
    }

    // ── Audio/video interleaving analysis ──
    function interleaveScore(allFrames) {
        if (codecKeys.length < 2) return null;
        // by recv_stamp sort, check whether audio/video alternate
        const sorted = [...allFrames].sort((a, b) => a.recv_stamp - b.recv_stamp);
        let runs = 0, prev = null;
        for (const f of sorted) {
            const type = f.track_type ? f.track_type.toLowerCase() : (f.index === 65535 ? 'audio' : 'video');
            if (type !== prev) { runs++; prev = type; }
        }
        // runs more is better (means more frequent alternation)
        const ratio = runs / sorted.length;
        if (ratio > 0.6) return `<span class="text-green-400 font-bold">Good</span>(interleave ratio ${(ratio * 100).toFixed(0)}%)`;
        if (ratio > 0.3) return `<span class="text-yellow-400 font-bold">Fair</span>(interleave ratio ${(ratio * 100).toFixed(0)}%)`;
        return `<span class="text-red-400 font-bold">Poor</span>(interleave ratio ${(ratio * 100).toFixed(0)}%)`;
    }

    const interleave = interleaveScore(frames);

    // ── Render each codec visual timeline ──
    function renderTimeline(uniq, label) {
        if (uniq.length < 2) return '';
        const baseTs = uniq[0].dts;
        const totalDur = uniq[uniq.length - 1].dts - baseTs || 1;
        const W = 1000;
        const dots = uniq.map(f => {
            const x = Math.round(((f.dts - baseTs) / totalDur) * W);
            const color = f.key_frame ? '#34d399' : (f.config_frame ? '#60a5fa' : '#a78bfa');
            const tip = `dts=${f.dts} pts=${f.pts} size=${f.frame_size}B key=${f.key_frame}`;
            return `<circle cx="${x}" cy="12" r="${f.key_frame ? 5 : 3}" fill="${color}" opacity="0.85"><title>${tip}</title></circle>`;
        }).join('');
        return `
            <div class="mt-3">
                <div class="text-xs text-white/50 mb-1">${label} frame timeline
                    <span class="ml-3 text-green-400">● Keyframe</span>
                    <span class="ml-2 text-blue-400">● Config frame</span>
                    <span class="ml-2 text-purple-400">● Normal frame</span>
                </div>
                <svg width="100%" viewBox="0 0 ${W} 24" style="height:24px;background:rgba(255,255,255,0.04);border-radius:4px;">
                    <line x1="0" y1="12" x2="${W}" y2="12" stroke="rgba(255,255,255,0.1)" stroke-width="1"/>
                    ${dots}
                </svg>
            </div>
        `;
    }

    // ── Generate line chart (generic)──
    // Globally ensure probe hover tooltip inject styles only once
    if (!document.getElementById('probe-chart-style')) {
        const s = document.createElement('style');
        s.id = 'probe-chart-style';
        s.textContent = `
            .probe-chart-wrap { position:relative; }
            .probe-chart-tip {
                position:absolute; top:-28px; transform:translateX(-50%);
                background:rgba(15,15,20,0.92); color:#fff;
                font-size:11px; padding:2px 7px; border-radius:4px;
                white-space:nowrap; pointer-events:none;
                border:1px solid rgba(255,255,255,0.15);
                display:none; z-index:99;
            }
            .probe-chart-wrap:hover .probe-chart-tip { display:block; }
        `;
        document.head.appendChild(s);
    }

    // Generate unique id avoid clashes between multiple charts
    let _chartId = 0;
    function renderLineChart(intervals, label, color) {
        if (intervals.length < 2) return '';
        const absMax = Math.max(...intervals.map(Math.abs), 1);
        const W = 1000, H = 40, mid = H / 2;
        const step = W / (intervals.length - 1 || 1);
        const id = `pc${++_chartId}`;

        // Line coordinates
        const pts = intervals.map((v, i) => ({
            x: i * step,
            y: mid - (v / absMax) * mid,
            v
        }));
        const pointsAttr = pts.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');

        // Draw a transparent wide hit-area rect for each data point + vertical line (hover show)
        const hitAreas = pts.map((p, i) => {
            const hw = Math.max(step / 2, 6);
            return `<g class="probe-hit" data-val="${p.v}" data-idx="${i}"
                        transform="translate(${p.x.toFixed(1)},0)" style="cursor:crosshair;">
                <rect x="${(-hw).toFixed(1)}" y="0" width="${(hw * 2).toFixed(1)}" height="${H}"
                      fill="transparent"/>
                <line x1="0" y1="0" x2="0" y2="${H}"
                      stroke="rgba(255,255,255,0.25)" stroke-width="1"
                      class="probe-vline" style="display:none;"/>
                <circle cx="0" cy="${p.y.toFixed(1)}" r="3"
                        fill="${color}" class="probe-dot" style="display:none;"/>
            </g>`;
        }).join('');

        return `
            <div class="mt-3">
                <div class="text-xs text-white/50 mb-1">${label}</div>
                <div class="probe-chart-wrap" style="position:relative;">
                    <div class="probe-chart-tip" id="${id}-tip"></div>
                    <svg id="${id}" width="100%" viewBox="0 0 ${W} ${H}"
                         style="height:40px;background:rgba(255,255,255,0.04);border-radius:4px;display:block;">
                        <line x1="0" y1="${mid}" x2="${W}" y2="${mid}"
                              stroke="rgba(255,255,255,0.1)" stroke-width="1" stroke-dasharray="4 4"/>
                        <polyline points="${pointsAttr}" fill="none" stroke="${color}" stroke-width="1.5" opacity="0.85"/>
                        ${hitAreas}
                    </svg>
                </div>
            </div>
        `;
    }

    // ── Overall summary card ──
    let summaryCards = codecKeys.map(codec => {
        const g = analyzeGroup(groups[codec]);
        const trackType = (groups[codec][0]?.track_type || '').toLowerCase();
        const isVideo = trackType ? trackType === 'video' : true;
        const icon = isVideo ? '🎬' : '🎵';
        return `
        <div class="bg-white/5 rounded-lg p-4 border border-white/10">
            <div class="flex items-center justify-between mb-3">
                <span class="text-white font-bold text-base">${icon} ${codec}</span>
                <span class="text-white/40 text-xs">${g.uniq.length} frames · ${(g.totalBytes / 1024).toFixed(1)} KB · ${g.duration} ms</span>
            </div>
            <div class="grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
                <div class="text-white/50">Frame rate / FPS</div>
                <div class="text-white font-mono">${g.fps}</div>
                <div class="text-white/50">Keyframe count</div>
                <div class="text-white font-mono">${g.keyFrames}</div>

                <div class="text-white/50 mt-2 col-span-2 border-t border-white/10 pt-2 font-semibold text-white/70">DTS timestamp interval (ms)</div>
                <div class="text-white/50">Mean / Jitter (σ)</div>
                <div class="text-white font-mono">${g.dtsStats.avg} / ${g.dtsStats.stddev} ms — Smoothness: ${g.smoothScore(g.dtsStats)}</div>
                <div class="text-white/50">Min / Max</div>
                <div class="text-white font-mono">${g.dtsStats.min} / ${g.dtsStats.max} ms</div>

                <div class="text-white/50 mt-2 col-span-2 border-t border-white/10 pt-2 font-semibold text-white/70">Receive interval (arrival jitter)</div>
                <div class="text-white/50">Mean / Jitter (σ)</div>
                <div class="text-white font-mono">${g.recvStats.avg} / ${g.recvStats.stddev} ms — Smoothness: ${g.smoothScore(g.recvStats)}</div>
                <div class="text-white/50">Min / Max</div>
                <div class="text-white font-mono">${g.recvStats.min} / ${g.recvStats.max} ms</div>

                <div class="text-white/50 mt-2 col-span-2 border-t border-white/10 pt-2 font-semibold text-white/70">PTS - DTS offset</div>
                <div class="text-white/50">Mean / Jitter (σ)</div>
                <div class="text-white font-mono">${g.ptsStats.avg} / ${g.ptsStats.stddev} ms</div>
                <div class="text-white/50">Min / Max</div>
                <div class="text-white font-mono">${g.ptsStats.min} / ${g.ptsStats.max} ms</div>
            </div>
            ${renderTimeline(g.uniq, codec)}
            ${renderLineChart(
                g.uniq.slice(1).map((f, i) => g.uniq[i + 1].dts - g.uniq[i].dts),
                `${codec} ΔDTS timestamp interval jitter (ms)`, '#a78bfa'
            )}
            ${renderLineChart(
                g.uniq.slice(1).map((f, i) => g.uniq[i + 1].recv_stamp - g.uniq[i].recv_stamp),
                `${codec} ΔRecv arrival interval jitter (ms)`, '#2dd4bf'
            )}
        </div>
        `;
    }).join('');

    // ── A/V DTS interleaving scatter plot ──
    function renderInterleaveChart(allFrames) {
        if (codecKeys.length < 2) return '';

        // by dts sort, drop config_frame (SPS/PPS and other meaningless frames)
        const sorted = allFrames
            .filter(f => !f.config_frame)
            .sort((a, b) => a.dts - b.dts);
        if (sorted.length < 2) return '';

        // For each codec assign a separate Y row
        const tracks = [...new Set(sorted.map(f => f.codec))];
        const trackY  = {};   // codec → center Y
        const ROW_H   = 28;   // Row height
        const PAD_TOP = 6;    // Top padding
        const LABEL_W = Math.min(Math.max(...tracks.map(t => t.length)) * 7 + 16, 160);  // computed dynamically by the longest name, max 160
        const W_TOTAL = 1000;
        const W_CHART = W_TOTAL - LABEL_W; // plot area width
        tracks.forEach((t, i) => { trackY[t] = PAD_TOP + i * ROW_H + ROW_H / 2; });
        const H = PAD_TOP + tracks.length * ROW_H + 4;

        const minDts = sorted[0].recv_stamp;
        const maxDts = sorted[sorted.length - 1].recv_stamp || minDts + 1;
        const xOf = ts => LABEL_W + ((ts - minDts) / (maxDts - minDts)) * W_CHART;

        // Track colors
        const COLORS = ['#a78bfa', '#2dd4bf', '#f59e0b', '#f87171', '#34d399', '#60a5fa'];
        const trackColor = {};
        tracks.forEach((t, i) => { trackColor[t] = COLORS[i % COLORS.length]; });

        // Horizontal reference lines (plot area only)
        const hlines = tracks.map(t => {
            const y = trackY[t].toFixed(1);
            return `<line x1="${LABEL_W}" y1="${y}" x2="${W_TOTAL}" y2="${y}" stroke="${trackColor[t]}" stroke-width="0.5" opacity="0.15"/>`;
        }).join('');

        // Label-area background dividers
        const labelSep = `<line x1="${LABEL_W}" y1="0" x2="${LABEL_W}" y2="${H}" stroke="rgba(255,255,255,0.08)" stroke-width="1"/>`;

        // Frame dots (by recv_stamp draw in order, x axis is recv_stamp)
        const vlines = sorted.map(f => {
            const x = xOf(f.recv_stamp).toFixed(1);
            const y = trackY[f.codec];
            const r = f.key_frame ? 4 : 2.5;
            const color = trackColor[f.codec];
            const tip = `[${f.codec}] recv=${f.recv_stamp} dts=${f.dts} size=${f.frame_size}B key=${f.key_frame}`;
            return `<circle cx="${x}" cy="${y.toFixed(1)}" r="${r}" fill="${color}" opacity="0.75"><title>${tip}</title></circle>`;
        }).join('');

        // Connector lines: recv_stamp connect adjacent cross-track frames
        const byRecv = [...sorted].sort((a, b) => a.recv_stamp - b.recv_stamp);
        const connLines = [];
        for (let i = 1; i < byRecv.length; i++) {
            const a = byRecv[i - 1], b = byRecv[i];
            if (a.codec !== b.codec) {
                const x1 = xOf(a.recv_stamp).toFixed(1), y1 = trackY[a.codec].toFixed(1);
                const x2 = xOf(b.recv_stamp).toFixed(1), y2 = trackY[b.codec].toFixed(1);
                connLines.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="rgba(255,255,255,0.08)" stroke-width="0.8"/>`);
            }
        }

        // Track labels (drawn last to ensure top layer; background rect prevents text/point overlap)
        const labels = tracks.map(t => {
            const y = trackY[t];
            const color = trackColor[t];
            return `
                <rect x="2" y="${(y - 8).toFixed(1)}" width="${LABEL_W - 6}" height="16" rx="2"
                      fill="rgba(17,24,39,0.85)"/>
                <text x="6" y="${(y + 4).toFixed(1)}"
                      font-size="10" fill="${color}" text-anchor="start"
                      font-family="monospace">${t}</text>
            `;
        }).join('');

        return `
            <div class="mt-4">
                <div class="text-xs text-white/50 mb-1">A/V RecvStamp interleaving scatter plot
                    <span class="ml-3 text-white/30">X-axis=recv_stamp arrival time · large dot=Keyframe · connector line=cross-track for adjacent arriving frames</span>
                </div>
                <svg width="100%" viewBox="0 0 ${W_TOTAL} ${H}"
                     style="height:${H}px;background:rgba(255,255,255,0.03);border-radius:4px;display:block;">
                    ${hlines}
                    ${labelSep}
                    ${connLines.join('')}
                    ${vlines}
                    ${labels}
                </svg>
            </div>
        `;
    }

    const interleaveRow = interleave ? `
        <div class="bg-white/5 rounded-lg p-4 border border-white/10">
            <div class="flex items-center gap-4 mb-3">
                <span class="text-white/70 font-semibold">🎵🎬 Audio/video interleaving</span>
                <span>${interleave}</span>
                <span class="text-white/40 text-xs ml-auto">by recv_stamp count audio/video alternation frequency by time order</span>
            </div>
            ${renderInterleaveChart(frames)}
        </div>
    ` : '';

    // Raw frame table (collapsed)- Compute each track (codec) within the Δdts and Δrecv_stamp
    const trackLastDts = {};
    const trackLastRecv = {};
    const rows = frames.map(f => {
        const codec = f.codec;
        const deltaDts  = codec in trackLastDts  ? f.dts        - trackLastDts[codec]  : '—';
        const deltaRecv = codec in trackLastRecv ? f.recv_stamp - trackLastRecv[codec] : '—';
        trackLastDts[codec]  = f.dts;
        trackLastRecv[codec] = f.recv_stamp;

        const dtsColor  = (typeof deltaDts  === 'number' && deltaDts  < 0) ? 'text-red-400' : 'text-white';
        const recvColor = (typeof deltaRecv === 'number' && deltaRecv < 0) ? 'text-red-400'
                        : (typeof deltaRecv === 'number' && deltaRecv > 200) ? 'text-yellow-400' : 'text-white';
        return `
        <tr class="border-b border-white/5 hover:bg-white/5 text-xs">
            <td class="px-2 py-1 font-mono text-white/70">${f.codec}</td>
            <td class="px-2 py-1 font-mono">${f.dts}</td>
            <td class="px-2 py-1 font-mono">${f.pts}</td>
            <td class="px-2 py-1 font-mono">${f.pts - f.dts}</td>
            <td class="px-2 py-1 font-mono">${f.recv_stamp}</td>
            <td class="px-2 py-1 font-mono ${dtsColor}">${deltaDts}</td>
            <td class="px-2 py-1 font-mono ${recvColor}">${deltaRecv}</td>
            <td class="px-2 py-1 font-mono">${f.frame_size}</td>
            <td class="px-2 py-1">${f.key_frame ? '<span class="text-green-400">✓</span>' : ''}</td>
            <td class="px-2 py-1">${f.config_frame ? '<span class="text-blue-400">✓</span>' : ''}</td>
        </tr>
    `}).join('');

    return `
        <div class="space-y-4 p-1">
            ${summaryCards}
            ${interleaveRow}
            <details class="bg-white/5 rounded-lg border border-white/10">
                <summary class="px-4 py-3 cursor-pointer text-white/60 text-sm hover:text-white select-none">
                    <i class="fa fa-table mr-2"></i>Raw frame data (${frames.length})
                </summary>
                <div class="overflow-x-auto max-h-64 overflow-y-auto">
                    <table class="w-full text-white">
                        <thead class="sticky top-0 bg-gray-900">
                            <tr class="border-b border-white/10 text-xs text-white/50">
                                <th class="px-2 py-2 text-left">Codec</th>
                                <th class="px-2 py-2 text-left">DTS</th>
                                <th class="px-2 py-2 text-left">PTS</th>
                                <th class="px-2 py-2 text-left">PTS-DTS</th>
                                <th class="px-2 py-2 text-left">RecvStamp</th>
                                <th class="px-2 py-2 text-left">ΔDTS</th>
                                <th class="px-2 py-2 text-left">ΔRecv</th>
                                <th class="px-2 py-2 text-left">Size(B)</th>
                                <th class="px-2 py-2 text-left">KeyFrm</th>
                                <th class="px-2 py-2 text-left">CfgFrm</th>
                            </tr>
                        </thead>
                        <tbody>${rows}</tbody>
                    </table>
                </div>
            </details>
        </div>
    `;
}
