// ==================== Pull Proxy page ====================

// Pagination state
const _pullProxyState = {
    all: [],       // Full data
    page: 1,       // Current page (from  1  start)
    pageSize: 10,  // Rows per page
};

// Status cache: key => ZLM listStreamProxy  returned single record (or  null=offline)
const _pullProxyStatusCache = {};

function initPullProxyEvents() {
    const addButton = document.getElementById('addPullProxy');
    if (addButton) {
        const newBtn = addButton.cloneNode(true);
        addButton.parentNode.replaceChild(newBtn, addButton);
        newBtn.addEventListener('click', openAddPullProxyModal);
    }

    const refreshBtn = document.getElementById('refreshPullProxy');
    if (refreshBtn) {
        const newRefreshBtn = refreshBtn.cloneNode(true);
        refreshBtn.parentNode.replaceChild(newRefreshBtn, refreshBtn);
        newRefreshBtn.addEventListener('click', loadPullProxyList);
    }
}

async function loadPullProxyList() {
    initPullProxyEvents();

    const tbody = document.getElementById('pullProxyTableBody');
    if (!tbody) return;

    tbody.innerHTML = `
        <tr>
            <td colspan="10" class="p-10 text-center">
                <div class="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary mx-auto mb-4"></div>
                <span class="text-white/60 font-semibold">Loading...</span>
            </td>
        </tr>
    `;

    try {
        const result = await Api.getStreamProxyList();

        if (result.code === 0) {
            _pullProxyState.all = result.data || [];
            _pullProxyState.page = 1;

            // Batch query ZLM status (concurrent, ignore failures)
            await _fetchAllProxyStatus(_pullProxyState.all);

            _renderPullProxyPage();
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

/**
 * Batch-concurrently query all proxies in  ZLM  status, write the result into  _pullProxyStatusCache
 */
async function _fetchAllProxyStatus(proxies) {
    await Promise.all(proxies.map(async proxy => {
        const vhost  = proxy.vhost  || '__defaultVhost__';
        const app    = proxy.app    || '';
        const stream = proxy.stream || '';
        const key    = `${vhost}/${app}/${stream}`;
        try {
            const res = await Api.listStreamProxy(key);
            if (res && res.code === 0 && Array.isArray(res.data) && res.data.length > 0) {
                _pullProxyStatusCache[key] = res.data[0];
            } else {
                _pullProxyStatusCache[key] = null;
            }
        } catch (e) {
            _pullProxyStatusCache[key] = null;
        }
    }));
}

function _renderPullProxyPage() {
    const tbody = document.getElementById('pullProxyTableBody');
    const pagination = document.getElementById('pullProxyPagination');
    const pageInfo = document.getElementById('pullProxyPageInfo');
    const pageBtns = document.getElementById('pullProxyPageBtns');
    const prevBtn = document.getElementById('pullProxyPrevBtn');
    const nextBtn = document.getElementById('pullProxyNextBtn');
    if (!tbody) return;

    const { all, page, pageSize } = _pullProxyState;
    const total = all.length;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const curPage = Math.min(page, totalPages);
    _pullProxyState.page = curPage;

    if (total === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="10" class="p-10 text-center text-white/60 font-semibold">
                    No pull proxies yet, click "Add Pull Proxy" to add one
                </td>
            </tr>
        `;
        if (pagination) pagination.classList.add('hidden');
        return;
    }

    const start = (curPage - 1) * pageSize;
    const pageData = all.slice(start, start + pageSize);

    let html = '';
    pageData.forEach(proxy => {
        const onDemand = proxy.on_demand ? 1 : 0;
        const onDemandClass = onDemand
            ? 'bg-yellow-500/20 text-yellow-400 hover:bg-yellow-500/40 cursor-pointer'
            : 'bg-blue-500/20 text-blue-300 hover:bg-blue-500/40 cursor-pointer';
        const onDemandText = onDemand ? 'On-demand' : 'Immediate';
        const onDemandIcon = onDemand ? 'fa-clock-o' : 'fa-play-circle';
        const onDemandTitle = onDemand ? 'Currently on-demand mode, click to switch to immediate pull' : 'Currently immediate mode, click to switch to on-demand pull';
        const createdAt = proxy.created_at || '-';

        // ---- status column ----
        const vhost  = proxy.vhost  || '__defaultVhost__';
        const key    = `${vhost}/${proxy.app}/${proxy.stream}`;
        const status = _pullProxyStatusCache[key]; // null=Offline / undefined=Not queried / object=ZLMdata
        let statusHtml = '';
        if (status === undefined) {
            // Not queried
            statusHtml = `<span class="px-3 py-1 rounded-full text-xs font-semibold bg-white/10 text-white/40">Querying</span>`;
        } else if (status === null) {
            // ZLM no such record → Offline, click to start manually
            statusHtml = `<button class="px-3 py-1 rounded-full text-xs font-semibold bg-white/10 text-white/40 hover:bg-orange-500/30 hover:text-orange-300 transition-colors"
                title="Offline, click to try re-pulling"
                onclick="startOfflineProxy(${proxy.id})">
                <i class="fa fa-circle mr-1"></i>Offline
            </button>`;
        } else {
            const ss = status.status_str || '';
            //  put  status  object into the global  map, used  key  reference, to avoid  onclick inline JSON escaping issues
            _pullProxyStatusCache['__detail__' + key] = status;
            const escapedKey = key.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
            if (ss === 'playing') {
                statusHtml = `<button class="px-3 py-1 rounded-full text-xs font-semibold bg-green-500/20 text-green-400 hover:bg-green-500/30 transition-colors"
                    onclick="showProxyStatusDetail('${escapedKey}')">
                    <i class="fa fa-circle mr-1"></i>Online
                </button>`;
            } else {
                statusHtml = `<button class="px-3 py-1 rounded-full text-xs font-semibold bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-colors"
                    onclick="showProxyStatusDetail('${escapedKey}')">
                    <i class="fa fa-exclamation-circle mr-1"></i>Failed
                </button>`;
            }
        }

        html += `
            <tr class="border-b border-white/5 hover:bg-white/5 transition-colors">
                <td class="p-4 text-white/70 text-sm">${proxy.id}</td>
                <td class="p-4 text-white text-sm">${proxy.vhost || '__defaultVhost__'}</td>
                <td class="p-4 text-white font-semibold">${proxy.app || '-'}</td>
                <td class="p-4 text-white font-semibold">${proxy.stream || '-'}</td>
                <td class="p-4 text-white/80 text-sm" style="max-width:240px">${_renderProxyUrlCell(proxy.urls)}</td>
                <td class="p-4 text-white/60 text-sm whitespace-nowrap overflow-hidden text-ellipsis" style="max-width:160px" title="${proxy.remark || ''}">${proxy.remark || '-'}</td>
                <td class="p-4">
                    <button class="px-3 py-1 rounded-full text-sm font-semibold transition-colors ${onDemandClass}"
                        title="${onDemandTitle}"
                        onclick="togglePullProxyMode(${proxy.id}, ${onDemand})">
                        <i class="fa ${onDemandIcon} mr-1"></i>${onDemandText}
                    </button>
                </td>
                <td class="p-4">${statusHtml}</td>
                <td class="p-4 text-white/60 text-sm">${createdAt}</td>
                <td class="p-4 space-x-2 whitespace-nowrap">
                    <button class="bg-blue-500/80 text-white px-3 py-1 rounded-lg text-sm font-semibold hover:shadow-neon transition-colors"
                        onclick="viewPullProxyDetail(${proxy.id})">
                        Details
                    </button>
                    <button class="bg-yellow-500/80 text-white px-3 py-1 rounded-lg text-sm font-semibold hover:shadow-neon transition-colors"
                        onclick="editPullProxy(${proxy.id})">
                        Edit
                    </button>
                    <button class="bg-green-600/80 text-white px-3 py-1 rounded-lg text-sm font-semibold hover:shadow-neon transition-colors"
                        onclick="navigateToStreams('${(proxy.vhost || '__defaultVhost__').replace(/'/g, "\\'")}', '${(proxy.app || '').replace(/'/g, "\\'")}', '${(proxy.stream || '').replace(/'/g, "\\'")}')">
                        View stream
                    </button>
                    <button class="bg-red-500/80 text-white px-3 py-1 rounded-lg text-sm font-semibold hover:shadow-neon transition-colors"
                        onclick="deletePullProxy('${proxy.vhost || '__defaultVhost__'}', '${proxy.app}', '${proxy.stream}', ${proxy.id})">
                        Delete
                    </button>
                </td>
            </tr>
        `;
    });
    tbody.innerHTML = html;

    // ---- Pagination controls ----
    if (pagination) pagination.classList.remove('hidden');
    if (pageInfo) pageInfo.textContent = `Total ${total} entries, page ${curPage} / ${totalPages}`;

    // Prev/Next-page button
    if (prevBtn) {
        prevBtn.disabled = curPage <= 1;
        prevBtn.onclick = () => { _pullProxyState.page = curPage - 1; _renderPullProxyPage(); };
    }
    if (nextBtn) {
        nextBtn.disabled = curPage >= totalPages;
        nextBtn.onclick = () => { _pullProxyState.page = curPage + 1; _renderPullProxyPage(); };
    }

    // Page-number buttons (show at most  7 : first, last, current±2, ellipsis)
    if (pageBtns) {
        const btnCls = (active) => active
            ? 'px-3 py-1 rounded-lg bg-primary text-white text-sm font-bold'
            : 'px-3 py-1 rounded-lg bg-white/10 text-white text-sm font-semibold hover:bg-white/20 transition-colors';

        const pages = _calcPageRange(curPage, totalPages);
        pageBtns.innerHTML = '';
        pages.forEach(p => {
            if (p === '...') {
                const span = document.createElement('span');
                span.className = 'px-2 py-1 text-white/40 text-sm';
                span.textContent = '…';
                pageBtns.appendChild(span);
            } else {
                const btn = document.createElement('button');
                btn.className = btnCls(p === curPage);
                btn.textContent = p;
                btn.onclick = () => { _pullProxyState.page = p; _renderPullProxyPage(); };
                pageBtns.appendChild(btn);
            }
        });
    }
}

// Compute the page-number sequence to show, at most 7 slots
function _calcPageRange(cur, total) {
    if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
    const result = [];
    const add = (p) => { if (!result.includes(p)) result.push(p); };
    add(1);
    if (cur - 2 > 2) result.push('...');
    for (let p = Math.max(2, cur - 2); p <= Math.min(total - 1, cur + 2); p++) add(p);
    if (cur + 2 < total - 1) result.push('...');
    add(total);
    return result;
}

/**
 * Render the pull-address cell in the list
 * When multiple addresses exist: show the first + "+N" badge
 */
function _renderProxyUrlCell(urls) {
    if (!Array.isArray(urls) || urls.length === 0) return '<span class="text-white/30">-</span>';
    const first  = urls[0];
    const url    = first.url    || '';
    const params = first.params || {};
    const schema = params.schema || '';
    const schemaBadge = schema
        ? `<span class="inline-block px-1.5 py-0.5 rounded text-xs bg-blue-500/20 text-blue-300 mr-1 flex-shrink-0">${schema}</span>`
        : '';
    const extraBadge = urls.length > 1
        ? `<span class="inline-block px-1.5 py-0.5 rounded text-xs bg-white/10 text-white/40 ml-1 flex-shrink-0" title="${urls.map(u => u.url).join('\n')}">+${urls.length - 1}</span>`
        : '';
    const escaped = url.replace(/"/g, '&quot;');
    return `<div class="flex items-center gap-1 min-w-0">
        ${schemaBadge}
        <span class="truncate text-white/80 text-sm" title="${escaped}">${url || '-'}</span>
        ${extraBadge}
    </div>`;
}

// ==================== Add modal ====================

async function openAddPullProxyModal() {
    showPullProxyModal('Add Pull Proxy', null, {});
}

async function viewPullProxyDetail(id) {
    try {
        const result = await Api.getStreamProxy(id);
        if (result.code === 0 && result.data) {
            const proxy = result.data;
            let protocolParams = {};
            let customParams = {};
            try { protocolParams = JSON.parse(proxy.protocol_params || '{}'); } catch (e) {}
            try { customParams = JSON.parse(proxy.custom_params || '{}'); } catch (e) {}
            // retry_count / timeout_sec  still in  custom_params , promote to top level for  getValue use
            const mergedData = { ...proxy, ...protocolParams, ...customParams };
            // Exclude existing dedicated fields from the custom params area
            const knownKeys = new Set(['retry_count', 'timeout_sec']);
            const extraCustomParams = Object.fromEntries(
                Object.entries(customParams).filter(([k]) => !knownKeys.has(k))
            );
            // urls already includes  params  field (schema, rtp_type  etc.), passed through directly
            const proxyUrls = Array.isArray(proxy.urls) && proxy.urls.length > 0
                ? proxy.urls
                : [{ url: '', params: {} }];
            showPullProxyModal('Pull Proxy details (read-only)', mergedData, {}, true, extraCustomParams, proxyUrls);
        } else {
            showToast('Failed to get details: ' + (result.msg || 'Unknown error'), 'error');
        }
    } catch (e) {
        showToast('Failed to get details: ' + e.message, 'error');
    }
}

async function editPullProxy(id) {
    try {
        const result = await Api.getStreamProxy(id);
        if (result.code === 0 && result.data) {
            const proxy = result.data;
            let protocolParams = {};
            let customParams = {};
            try { protocolParams = JSON.parse(proxy.protocol_params || '{}'); } catch (e) {}
            try { customParams = JSON.parse(proxy.custom_params || '{}'); } catch (e) {}
            const mergedData = { ...proxy, ...protocolParams, ...customParams };
            const knownKeys = new Set(['retry_count', 'timeout_sec']);
            const extraCustomParams = Object.fromEntries(
                Object.entries(customParams).filter(([k]) => !knownKeys.has(k))
            );
            const proxyUrls = Array.isArray(proxy.urls) && proxy.urls.length > 0
                ? proxy.urls
                : [{ url: '', params: {} }];
            showPullProxyModal('Edit Pull Proxy', mergedData, {}, false, extraCustomParams, proxyUrls, true);
        } else {
            showToast('Failed to get proxy info: ' + (result.msg || 'Unknown error'), 'error');
        }
    } catch (e) {
        showToast('Failed to get proxy info: ' + e.message, 'error');
    }
}

function showPullProxyModal(title, data, serverConfig = {}, readOnly = false, initialCustomParams = {}, initialUrls = [], isEdit = false) {
    // Make sure the old modal is closed
    const oldModal = document.getElementById('pullProxyModalWrapper');
    if (oldModal) oldModal.remove();

    const getValue = (key, defaultValue = '') => {
        if (data && data[key] !== undefined && data[key] !== null) return data[key];
        if (serverConfig && serverConfig[key] !== undefined) return serverConfig[key];
        return defaultValue;
    };

    const disabledAttr = readOnly ? 'disabled' : '';
    const inputCls = readOnly
        ? 'w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2 text-white/60 cursor-not-allowed'
        : 'w-full bg-white/10 border border-white/20 rounded-lg px-4 py-2 text-white placeholder-white/50 focus:outline-none focus:ring-2 focus:ring-primary';

    const wrapper = document.createElement('div');
    wrapper.id = 'pullProxyModalWrapper';
    wrapper.className = 'absolute inset-0 bg-black/70 backdrop-blur-sm flex items-start justify-center pointer-events-auto overflow-y-auto py-8';
    wrapper.style.zIndex = '20';

    wrapper.innerHTML = `
        <div class="bg-gray-900 rounded-xl p-6 w-full max-w-3xl mx-4 border border-white/20 shadow-2xl" id="pullProxyModalContent">
            <div class="flex justify-between items-center mb-6">
                <h3 class="text-xl font-bold text-white">${title}</h3>
                <button id="pullProxyModalClose" class="text-white/60 hover:text-white transition-colors">
                    <i class="fa fa-times text-2xl"></i>
                </button>
            </div>

            <form id="pullProxyForm" class="space-y-5">
                <input type="hidden" id="proxyId" value="${data ? (data.id || '') : ''}">

                <!-- Basic info -->
                <div class="bg-white/5 rounded-lg p-4">
                    <h4 class="text-base font-semibold text-white mb-4 pb-2 border-b border-white/10">Basic info</h4>
                    <div class="space-y-4">
                        <!-- Multi-address manager -->
                        <div>
                            <div class="flex justify-between items-center mb-2">
                                <label class="text-white/80 text-sm font-semibold">
                                    Pull address <span class="text-red-400">*</span>
                                    <span class="text-white/40 font-normal ml-1">— You can add multiple backup addresses; the first is used by default</span>
                                </label>
                                ${!readOnly ? `
                                <button type="button" id="addUrlRowBtn"
                                    class="bg-primary/30 text-white px-3 py-1 rounded-lg text-xs font-semibold hover:bg-primary/50 transition-colors">
                                    <i class="fa fa-plus mr-1"></i>Add address
                                </button>` : ''}
                            </div>
                            <div id="urlListContainer" class="space-y-2"></div>
                        </div>
                        <div>
                            <label class="block text-white/80 text-sm font-semibold mb-1">Remark(remark)</label>
                            <input type="text" id="pullRemark" ${disabledAttr}
                                value="${getValue('remark')}"
                                placeholder="Optional, helps identify this proxy purpose"
                                class="${inputCls}">
                        </div>
                        <div class="grid grid-cols-3 gap-4">
                            <div>
                                <label class="block text-white/80 text-sm font-semibold mb-1">Virtual host(vhost)</label>
                                <input type="text" id="pullVhost" ${disabledAttr}
                                    value="${getValue('vhost', '__defaultVhost__')}"
                                    placeholder="__defaultVhost__"
                                    class="${inputCls}">
                            </div>
                            <div>
                                <label class="block text-white/80 text-sm font-semibold mb-1">
                                    App(app) <span class="text-red-400">*</span>
                                </label>
                                <input type="text" id="pullApp" ${disabledAttr}
                                    value="${getValue('app')}"
                                    placeholder="live"
                                    class="${inputCls}">
                            </div>
                            <div>
                                <label class="block text-white/80 text-sm font-semibold mb-1">
                                    Stream ID(stream) <span class="text-red-400">*</span>
                                </label>
                                <input type="text" id="pullStream" ${disabledAttr}
                                    value="${getValue('stream')}"
                                    placeholder="test"
                                    class="${inputCls}">
                            </div>
                        </div>
                        <div class="grid grid-cols-2 gap-4">
                            <div>
                                <label class="block text-white/80 text-sm font-semibold mb-1">Retry count(retry_count, -1=unlimited)</label>
                                <input type="number" id="retryCount" ${disabledAttr}
                                    value="${getValue('retry_count', '-1')}"
                                    placeholder="-1"
                                    class="${inputCls}">
                            </div>
                            <div>
                                <label class="block text-white/80 text-sm font-semibold mb-1">Timeout(timeout_sec, sec)</label>
                                <input type="number" id="timeoutSec" ${disabledAttr}
                                    value="${getValue('timeout_sec', '')}"
                                    placeholder="10"
                                    class="${inputCls}">
                            </div>
                        </div>
                        <div class="grid grid-cols-2 gap-4 items-end">
                            <div>
                                <label class="block text-white/80 text-sm font-semibold mb-1">
                                    On-demand pull(on_demand)
                                    <span class="text-white/40 font-normal ml-1">— pull only when someone plays</span>
                                </label>
                                <select id="onDemand" ${disabledAttr}
                                    class="${inputCls}" style="color:white;">
                                    <option value="0" ${!getValue('on_demand') || getValue('on_demand') == '0' ? 'selected' : ''}>Off (immediate pull)</option>
                                    <option value="1" ${getValue('on_demand') == '1' || getValue('on_demand') === true || getValue('on_demand') === 1 ? 'selected' : ''}>On (on-demand pull)</option>
                                </select>
                            </div>
                            ${(!readOnly && !isEdit) ? `
                            <div class="flex items-center h-[42px]">
                                <label class="flex items-center gap-3 cursor-pointer select-none">
                                    <div class="relative flex-shrink-0">
                                        <input type="checkbox" id="forceAdd" class="sr-only peer">
                                        <div class="w-10 h-6 bg-white/10 rounded-full peer-checked:bg-orange-500/70 transition-colors"></div>
                                        <div class="absolute top-1 left-1 w-4 h-4 bg-white/60 rounded-full peer-checked:translate-x-4 peer-checked:bg-white transition-all"></div>
                                    </div>
                                    <span class="text-white/80 text-sm font-semibold leading-tight">
                                        Force-add mode
                                        <span class="block text-white/40 font-normal text-xs mt-0.5">Force-add even if pull fails (force=1)</span>
                                    </span>
                                </label>
                            </div>` : '<div></div>'}
                        </div>
                    </div>
                </div>

                <!-- Remux params -->
                <div class="bg-white/5 rounded-lg p-4">
                    <div class="flex justify-between items-center mb-4 pb-2 border-b border-white/10">
                        <h4 class="text-base font-semibold text-white">Remux params</h4>
                        ${!readOnly ? `
                        <div class="flex space-x-2">
                            <button type="button" id="loadDefaultProtocolBtn"
                                class="bg-white/10 text-white px-3 py-1 rounded-lg text-xs font-semibold hover:bg-white/20 transition-colors">
                                <i class="fa fa-magic mr-1"></i>Load defaults
                            </button>
                            <button type="button" id="loadPresetProtocolBtn"
                                class="bg-primary/30 text-white px-3 py-1 rounded-lg text-xs font-semibold hover:bg-primary/50 transition-colors">
                                <i class="fa fa-list mr-1"></i>Load from preset
                            </button>
                            <button type="button" id="clearProtocolBtn"
                                class="bg-red-500/20 text-red-400 px-3 py-1 rounded-lg text-xs font-semibold hover:bg-red-500/30 transition-colors">
                                <i class="fa fa-eraser mr-1"></i>Clear
                            </button>
                        </div>` : ''}
                    </div>

                    <!-- General config -->
                    <div class="mb-4">
                        <h5 class="text-white/60 text-xs font-bold uppercase tracking-widest mb-3 border-b border-white/10 pb-1">General config</h5>
                        <div class="grid grid-cols-2 gap-4">
                            <div>
                                <label class="block text-white/80 text-sm font-semibold mb-1">Timestamp override(modify_stamp)</label>
                                <select id="modifyStamp" ${disabledAttr} class="${inputCls}" style="color:white;">
                                    <option value="" ${!getValue('modify_stamp') ? 'selected' : ''}>Default</option>
                                    <option value="0" ${getValue('modify_stamp') === '0' ? 'selected' : ''}>0 - Absolute timestamp</option>
                                    <option value="1" ${getValue('modify_stamp') === '1' ? 'selected' : ''}>1 - System timestamp</option>
                                    <option value="2" ${getValue('modify_stamp') === '2' ? 'selected' : ''}>2 - Relative timestamp</option>
                                </select>
                            </div>
                            <div>
                                <label class="block text-white/80 text-sm font-semibold mb-1">Enable audio(enable_audio)</label>
                                <select id="enableAudio" ${disabledAttr} class="${inputCls}" style="color:white;">
                                    <option value="" ${!getValue('enable_audio') ? 'selected' : ''}>Default</option>
                                    <option value="1" ${getValue('enable_audio') === '1' ? 'selected' : ''}>1 - On</option>
                                    <option value="0" ${getValue('enable_audio') === '0' ? 'selected' : ''}>0 - Off</option>
                                </select>
                            </div>
                            <div>
                                <label class="block text-white/80 text-sm font-semibold mb-1">Add silent audio(add_mute_audio)</label>
                                <select id="addMuteAudio" ${disabledAttr} class="${inputCls}" style="color:white;">
                                    <option value="" ${!getValue('add_mute_audio') ? 'selected' : ''}>Default</option>
                                    <option value="1" ${getValue('add_mute_audio') === '1' ? 'selected' : ''}>1 - On</option>
                                    <option value="0" ${getValue('add_mute_audio') === '0' ? 'selected' : ''}>0 - Off</option>
                                </select>
                            </div>
                            <div>
                                <label class="block text-white/80 text-sm font-semibold mb-1">Auto close(auto_close)</label>
                                <select id="autoClose" ${disabledAttr} class="${inputCls}" style="color:white;">
                                    <option value="" ${!getValue('auto_close') ? 'selected' : ''}>Default</option>
                                    <option value="1" ${getValue('auto_close') === '1' ? 'selected' : ''}>1 - On</option>
                                    <option value="0" ${getValue('auto_close') === '0' ? 'selected' : ''}>0 - Off</option>
                                </select>
                            </div>
                            <div>
                                <label class="block text-white/80 text-sm font-semibold mb-1">Smooth send interval(paced_sender_ms, ms)</label>
                                <input type="number" id="pacedSenderMs" ${disabledAttr}
                                    value="${getValue('paced_sender_ms')}"
                                    placeholder="0(off)"
                                    class="${inputCls}">
                            </div>
                        </div>
                    </div>

                    <!-- Remux toggles -->
                    <div class="mb-4">
                        <h5 class="text-white/60 text-xs font-bold uppercase tracking-widest mb-3 border-b border-white/10 pb-1">Remux toggles</h5>
                        <div class="grid grid-cols-2 gap-4">
                            <div>
                                <label class="block text-white/80 text-sm font-semibold mb-1">Enable HLS(enable_hls)</label>
                                <select id="enableHls" ${disabledAttr} class="${inputCls}" style="color:white;">
                                    <option value="" ${!getValue('enable_hls') ? 'selected' : ''}>Default</option>
                                    <option value="1" ${getValue('enable_hls') === '1' ? 'selected' : ''}>1 - On</option>
                                    <option value="0" ${getValue('enable_hls') === '0' ? 'selected' : ''}>0 - Off</option>
                                </select>
                            </div>
                            <div>
                                <label class="block text-white/80 text-sm font-semibold mb-1">Enable HLS-FMP4(enable_hls_fmp4)</label>
                                <select id="enableHlsFmp4" ${disabledAttr} class="${inputCls}" style="color:white;">
                                    <option value="" ${!getValue('enable_hls_fmp4') ? 'selected' : ''}>Default</option>
                                    <option value="1" ${getValue('enable_hls_fmp4') === '1' ? 'selected' : ''}>1 - On</option>
                                    <option value="0" ${getValue('enable_hls_fmp4') === '0' ? 'selected' : ''}>0 - Off</option>
                                </select>
                            </div>
                            <div>
                                <label class="block text-white/80 text-sm font-semibold mb-1">Enable MP4 recording(enable_mp4)</label>
                                <select id="enableMp4" ${disabledAttr} class="${inputCls}" style="color:white;">
                                    <option value="" ${!getValue('enable_mp4') ? 'selected' : ''}>Default</option>
                                    <option value="1" ${getValue('enable_mp4') === '1' ? 'selected' : ''}>1 - On</option>
                                    <option value="0" ${getValue('enable_mp4') === '0' ? 'selected' : ''}>0 - Off</option>
                                </select>
                            </div>
                            <div>
                                <label class="block text-white/80 text-sm font-semibold mb-1">Enable RTSP(enable_rtsp)</label>
                                <select id="enableRtsp" ${disabledAttr} class="${inputCls}" style="color:white;">
                                    <option value="" ${!getValue('enable_rtsp') ? 'selected' : ''}>Default</option>
                                    <option value="1" ${getValue('enable_rtsp') === '1' ? 'selected' : ''}>1 - On</option>
                                    <option value="0" ${getValue('enable_rtsp') === '0' ? 'selected' : ''}>0 - Off</option>
                                </select>
                            </div>
                            <div>
                                <label class="block text-white/80 text-sm font-semibold mb-1">Enable RTMP/FLV(enable_rtmp)</label>
                                <select id="enableRtmp" ${disabledAttr} class="${inputCls}" style="color:white;">
                                    <option value="" ${!getValue('enable_rtmp') ? 'selected' : ''}>Default</option>
                                    <option value="1" ${getValue('enable_rtmp') === '1' ? 'selected' : ''}>1 - On</option>
                                    <option value="0" ${getValue('enable_rtmp') === '0' ? 'selected' : ''}>0 - Off</option>
                                </select>
                            </div>
                            <div>
                                <label class="block text-white/80 text-sm font-semibold mb-1">Enable HTTP-TS(enable_ts)</label>
                                <select id="enableTs" ${disabledAttr} class="${inputCls}" style="color:white;">
                                    <option value="" ${!getValue('enable_ts') ? 'selected' : ''}>Default</option>
                                    <option value="1" ${getValue('enable_ts') === '1' ? 'selected' : ''}>1 - On</option>
                                    <option value="0" ${getValue('enable_ts') === '0' ? 'selected' : ''}>0 - Off</option>
                                </select>
                            </div>
                            <div>
                                <label class="block text-white/80 text-sm font-semibold mb-1">Enable FMP4(enable_fmp4)</label>
                                <select id="enableFmp4" ${disabledAttr} class="${inputCls}" style="color:white;">
                                    <option value="" ${!getValue('enable_fmp4') ? 'selected' : ''}>Default</option>
                                    <option value="1" ${getValue('enable_fmp4') === '1' ? 'selected' : ''}>1 - On</option>
                                    <option value="0" ${getValue('enable_fmp4') === '0' ? 'selected' : ''}>0 - Off</option>
                                </select>
                            </div>
                        </div>
                    </div>

                    <!-- On-demand remux -->
                    <div class="mb-4">
                        <h5 class="text-white/60 text-xs font-bold uppercase tracking-widest mb-3 border-b border-white/10 pb-1">On-demand remux</h5>
                        <div class="grid grid-cols-2 gap-4">
                            <div>
                                <label class="block text-white/80 text-sm font-semibold mb-1">HLS on-demand generation(hls_demand)</label>
                                <select id="hlsDemand" ${disabledAttr} class="${inputCls}" style="color:white;">
                                    <option value="" ${!getValue('hls_demand') ? 'selected' : ''}>Default</option>
                                    <option value="1" ${getValue('hls_demand') === '1' ? 'selected' : ''}>1 - On</option>
                                    <option value="0" ${getValue('hls_demand') === '0' ? 'selected' : ''}>0 - Off</option>
                                </select>
                            </div>
                            <div>
                                <label class="block text-white/80 text-sm font-semibold mb-1">RTSP on-demand generation(rtsp_demand)</label>
                                <select id="rtspDemand" ${disabledAttr} class="${inputCls}" style="color:white;">
                                    <option value="" ${!getValue('rtsp_demand') ? 'selected' : ''}>Default</option>
                                    <option value="1" ${getValue('rtsp_demand') === '1' ? 'selected' : ''}>1 - On</option>
                                    <option value="0" ${getValue('rtsp_demand') === '0' ? 'selected' : ''}>0 - Off</option>
                                </select>
                            </div>
                            <div>
                                <label class="block text-white/80 text-sm font-semibold mb-1">RTMP on-demand generation(rtmp_demand)</label>
                                <select id="rtmpDemand" ${disabledAttr} class="${inputCls}" style="color:white;">
                                    <option value="" ${!getValue('rtmp_demand') ? 'selected' : ''}>Default</option>
                                    <option value="1" ${getValue('rtmp_demand') === '1' ? 'selected' : ''}>1 - On</option>
                                    <option value="0" ${getValue('rtmp_demand') === '0' ? 'selected' : ''}>0 - Off</option>
                                </select>
                            </div>
                            <div>
                                <label class="block text-white/80 text-sm font-semibold mb-1">TS on-demand generation(ts_demand)</label>
                                <select id="tsDemand" ${disabledAttr} class="${inputCls}" style="color:white;">
                                    <option value="" ${!getValue('ts_demand') ? 'selected' : ''}>Default</option>
                                    <option value="1" ${getValue('ts_demand') === '1' ? 'selected' : ''}>1 - On</option>
                                    <option value="0" ${getValue('ts_demand') === '0' ? 'selected' : ''}>0 - Off</option>
                                </select>
                            </div>
                            <div>
                                <label class="block text-white/80 text-sm font-semibold mb-1">FMP4 on-demand generation(fmp4_demand)</label>
                                <select id="fmp4Demand" ${disabledAttr} class="${inputCls}" style="color:white;">
                                    <option value="" ${!getValue('fmp4_demand') ? 'selected' : ''}>Default</option>
                                    <option value="1" ${getValue('fmp4_demand') === '1' ? 'selected' : ''}>1 - On</option>
                                    <option value="0" ${getValue('fmp4_demand') === '0' ? 'selected' : ''}>0 - Off</option>
                                </select>
                            </div>
                        </div>
                    </div>

                    <!-- Recording config -->
                    <div>
                        <h5 class="text-white/60 text-xs font-bold uppercase tracking-widest mb-3 border-b border-white/10 pb-1">Recording config</h5>
                        <div class="grid grid-cols-2 gap-4">
                            <div>
                                <label class="block text-white/80 text-sm font-semibold mb-1">MP4 count as viewers(mp4_as_player)</label>
                                <select id="mp4AsPlayer" ${disabledAttr} class="${inputCls}" style="color:white;">
                                    <option value="" ${!getValue('mp4_as_player') ? 'selected' : ''}>Default</option>
                                    <option value="1" ${getValue('mp4_as_player') === '1' ? 'selected' : ''}>1 - On</option>
                                    <option value="0" ${getValue('mp4_as_player') === '0' ? 'selected' : ''}>0 - Off</option>
                                </select>
                            </div>
                            <div>
                                <label class="block text-white/80 text-sm font-semibold mb-1">MP4 segment size(mp4_max_second, sec)</label>
                                <input type="number" id="mp4MaxSecond" ${disabledAttr}
                                    value="${getValue('mp4_max_second')}"
                                    placeholder="3600"
                                    class="${inputCls}">
                            </div>
                            <div>
                                <label class="block text-white/80 text-sm font-semibold mb-1">MP4 save path(mp4_save_path)</label>
                                <input type="text" id="mp4SavePath" ${disabledAttr}
                                    value="${getValue('mp4_save_path')}"
                                    placeholder="./www"
                                    class="${inputCls}">
                            </div>
                            <div>
                                <label class="block text-white/80 text-sm font-semibold mb-1">HLS save path(hls_save_path)</label>
                                <input type="text" id="hlsSavePath" ${disabledAttr}
                                    value="${getValue('hls_save_path')}"
                                    placeholder="./www"
                                    class="${inputCls}">
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Custom params -->
                <div class="bg-white/5 rounded-lg p-4">
                    <div class="flex justify-between items-center mb-4 pb-2 border-b border-white/10">
                        <h4 class="text-base font-semibold text-white">Custom params (appended to ZLMediaKit addStreamProxy)</h4>
                        ${!readOnly ? `
                        <button type="button" id="addCustomParamBtn"
                            class="bg-primary/30 text-white px-3 py-1 rounded-lg text-xs font-semibold hover:bg-primary/50 transition-colors">
                            <i class="fa fa-plus mr-1"></i>Add param
                        </button>` : ''}
                    </div>
                    <div id="customParamsContainer" class="space-y-2">
                        <!-- Dynamically filled -->
                    </div>
                </div>

                ${!readOnly ? `
                <div class="flex justify-end space-x-3 pt-2">
                    <button type="button" id="pullProxyModalCancel"
                        class="bg-white/10 text-white px-6 py-2 rounded-lg font-semibold hover:bg-white/20 transition-colors">
                        Cancel
                    </button>
                    <button type="submit"
                        class="bg-gradient-primary text-white px-6 py-2 rounded-lg font-semibold hover:shadow-neon transition-all duration-300">
                        <i class="fa fa-save mr-2"></i>${isEdit ? 'Save changes' : 'Save and add proxy'}
                    </button>
                </div>` : `
                <div class="flex justify-end pt-2">
                    <button type="button" id="pullProxyModalCancel"
                        class="bg-white/10 text-white px-6 py-2 rounded-lg font-semibold hover:bg-white/20 transition-colors">
                        Close
                    </button>
                </div>`}
            </form>
        </div>
    `;

    // Mount to the dedicated container and activate mouse events
    const container = document.getElementById('pull-proxy-modal-container');
    if (container) {
        container.style.pointerEvents = 'auto';
        container.appendChild(wrapper);
    } else {
        // Fallback: mount directly to  body (fixed  positioning)
        wrapper.style.position = 'fixed';
        wrapper.style.zIndex = '9999';
        document.body.appendChild(wrapper);
    }

    // Fill the initial multi-address list
    const urlContainer = document.getElementById('urlListContainer');
    if (urlContainer) {
        const seedUrls = (initialUrls && initialUrls.length > 0)
            ? initialUrls
            : [{ url: '', params: {} }];
        seedUrls.forEach((item, idx) => addUrlRow(item.url || '', item.params || {}, readOnly, idx === 0));
    }

    // Fill the initial custom params
    Object.entries(initialCustomParams).forEach(([k, v]) => {
        addCustomParamRow(k, v, readOnly);
    });

    // ---- Event binding ----
    const closeModal = () => {
        wrapper.remove();
        const c = document.getElementById('pull-proxy-modal-container');
        if (c) c.style.pointerEvents = 'none';
    };

    wrapper.addEventListener('click', e => { if (e.target === wrapper) closeModal(); });
    document.getElementById('pullProxyModalClose').addEventListener('click', closeModal);
    const cancelBtn = document.getElementById('pullProxyModalCancel');
    if (cancelBtn) cancelBtn.addEventListener('click', closeModal);

    if (!readOnly) {
        document.getElementById('addUrlRowBtn')?.addEventListener('click', () => addUrlRow('', {}, false, false));
        document.getElementById('loadDefaultProtocolBtn').addEventListener('click', loadDefaultProtocolParams);
        document.getElementById('loadPresetProtocolBtn').addEventListener('click', loadPresetProtocolParams);
        document.getElementById('clearProtocolBtn').addEventListener('click', clearProtocolParams);
        document.getElementById('addCustomParamBtn').addEventListener('click', () => addCustomParamRow());

        document.getElementById('pullProxyForm').addEventListener('submit', async function (e) {
            e.preventDefault();
            if (isEdit) {
                await submitEditPullProxy(closeModal);
            } else {
                await submitAddPullProxy(closeModal);
            }
        });
    }
}

// ==================== Form submit ====================

async function submitAddPullProxy(closeModal) {
    // Collect multi-address list (url + params{schema, rtp_type})
    const urlsList = [];
    document.querySelectorAll('#urlListContainer .url-row').forEach(row => {
        const u        = row.querySelector('.url-row-url')?.value.trim();
        const schema   = row.querySelector('.url-row-schema')?.value   || '';
        const rtpType  = row.querySelector('.url-row-rtp-type')?.value || '';
        if (u) {
            const params = {};
            if (schema)  params.schema   = schema;
            if (rtpType) params.rtp_type = rtpType;
            urlsList.push({ url: u, params });
        }
    });
    if (urlsList.length === 0) {
        showToast('Fill in at least one pull address', 'error');
        return;
    }

    const vhost   = document.getElementById('pullVhost').value.trim() || '__defaultVhost__';
    const app     = document.getElementById('pullApp').value.trim();
    const stream  = document.getElementById('pullStream').value.trim();

    if (!app || !stream) {
        showToast('App name, stream ID cannot be empty', 'error');
        return;
    }

    // Collect remux params (only include non-empty)
    const protocolMap = {
        enable_hls:        'enableHls',
        enable_hls_fmp4:   'enableHlsFmp4',
        enable_mp4:        'enableMp4',
        enable_rtsp:       'enableRtsp',
        enable_rtmp:       'enableRtmp',
        enable_ts:         'enableTs',
        enable_fmp4:       'enableFmp4',
        enable_audio:      'enableAudio',
        add_mute_audio:    'addMuteAudio',
        auto_close:        'autoClose',
        hls_demand:        'hlsDemand',
        rtsp_demand:       'rtspDemand',
        rtmp_demand:       'rtmpDemand',
        ts_demand:         'tsDemand',
        fmp4_demand:       'fmp4Demand',
        mp4_as_player:     'mp4AsPlayer',
        modify_stamp:      'modifyStamp',
        paced_sender_ms:   'pacedSenderMs',
        mp4_max_second:    'mp4MaxSecond',
        mp4_save_path:     'mp4SavePath',
        hls_save_path:     'hlsSavePath',
    };
    const protocolParams = {};
    Object.entries(protocolMap).forEach(([apiKey, domId]) => {
        const el = document.getElementById(domId);
        if (el && el.value !== '') protocolParams[apiKey] = el.value;
    });

    // Custom params
    const customParams = {};
    document.querySelectorAll('#customParamsContainer .custom-param-row').forEach(row => {
        const k = row.querySelector('.custom-param-key').value.trim();
        const v = row.querySelector('.custom-param-value').value.trim();
        if (k) customParams[k] = v;
    });

    // Other ZLM Param
    const retryCount  = document.getElementById('retryCount').value;
    const timeoutSec  = document.getElementById('timeoutSec').value;
    const onDemand    = document.getElementById('onDemand').value;  // "0" or "1"
    const forceAdd    = document.getElementById('forceAdd')?.checked ? 1 : 0;
    if (retryCount !== '') customParams['retry_count'] = retryCount;
    if (timeoutSec !== '') customParams['timeout_sec'] = timeoutSec;
    // schema / rtp_type  is already in each address's  params  field, no longer written into  customParams

    const remark = (document.getElementById('pullRemark')?.value || '').trim();

    const formData = {
        urls: urlsList, // Multi-address list
        vhost,
        app,
        stream,
        remark,
        on_demand: onDemand,
        force: forceAdd,
        protocol_params: JSON.stringify(protocolParams),
        custom_params:   JSON.stringify(customParams),
    };

    // Button state
    const submitBtn = document.querySelector('#pullProxyForm button[type="submit"]');
    const origText  = submitBtn ? submitBtn.innerHTML : '';
    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<i class="fa fa-spinner fa-spin mr-2"></i>Submitting...';
    }

    try {
        const result = await Api.addStreamProxy(formData);
        if (result.code === 0) {
            showToast('Added successfully', 'success');
            closeModal();
            loadPullProxyList();
        } else {
            showToast('Add failed: ' + (result.msg || 'Unknown error'), 'error');
        }
    } catch (error) {
        showToast('Add failed: ' + error.message, 'error');
    } finally {
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.innerHTML = origText;
        }
    }
}

// ==================== Edit form submit ====================

async function submitEditPullProxy(closeModal) {
    const proxyId = parseInt(document.getElementById('proxyId')?.value || '0');
    if (!proxyId) {
        showToast('proxy ID invalid', 'error');
        return;
    }

    // Collect multi-address list
    const urlsList = [];
    document.querySelectorAll('#urlListContainer .url-row').forEach(row => {
        const u       = row.querySelector('.url-row-url')?.value.trim();
        const schema  = row.querySelector('.url-row-schema')?.value   || '';
        const rtpType = row.querySelector('.url-row-rtp-type')?.value || '';
        if (u) {
            const params = {};
            if (schema)  params.schema   = schema;
            if (rtpType) params.rtp_type = rtpType;
            urlsList.push({ url: u, params });
        }
    });
    if (urlsList.length === 0) {
        showToast('Fill in at least one pull address', 'error');
        return;
    }

    const vhost  = document.getElementById('pullVhost').value.trim() || '__defaultVhost__';
    const app    = document.getElementById('pullApp').value.trim();
    const stream = document.getElementById('pullStream').value.trim();
    if (!app || !stream) {
        showToast('App name, stream ID cannot be empty', 'error');
        return;
    }

    // Collect remux params (only include non-empty)
    const protocolMap = {
        enable_hls:        'enableHls',
        enable_hls_fmp4:   'enableHlsFmp4',
        enable_mp4:        'enableMp4',
        enable_rtsp:       'enableRtsp',
        enable_rtmp:       'enableRtmp',
        enable_ts:         'enableTs',
        enable_fmp4:       'enableFmp4',
        enable_audio:      'enableAudio',
        add_mute_audio:    'addMuteAudio',
        auto_close:        'autoClose',
        hls_demand:        'hlsDemand',
        rtsp_demand:       'rtspDemand',
        rtmp_demand:       'rtmpDemand',
        ts_demand:         'tsDemand',
        fmp4_demand:       'fmp4Demand',
        mp4_as_player:     'mp4AsPlayer',
        modify_stamp:      'modifyStamp',
        paced_sender_ms:   'pacedSenderMs',
        mp4_max_second:    'mp4MaxSecond',
        mp4_save_path:     'mp4SavePath',
        hls_save_path:     'hlsSavePath',
    };
    const protocolParams = {};
    Object.entries(protocolMap).forEach(([apiKey, domId]) => {
        const el = document.getElementById(domId);
        if (el && el.value !== '') protocolParams[apiKey] = el.value;
    });

    // Custom params
    const customParams = {};
    document.querySelectorAll('#customParamsContainer .custom-param-row').forEach(row => {
        const k = row.querySelector('.custom-param-key').value.trim();
        const v = row.querySelector('.custom-param-value').value.trim();
        if (k) customParams[k] = v;
    });

    const retryCount = document.getElementById('retryCount').value;
    const timeoutSec = document.getElementById('timeoutSec').value;
    const onDemand   = document.getElementById('onDemand').value;
    if (retryCount !== '') customParams['retry_count'] = retryCount;
    if (timeoutSec !== '') customParams['timeout_sec'] = timeoutSec;

    const remark = (document.getElementById('pullRemark')?.value || '').trim();

    const formData = {
        id: proxyId,
        urls: urlsList,
        vhost,
        app,
        stream,
        remark,
        on_demand: onDemand,
        protocol_params: JSON.stringify(protocolParams),
        custom_params:   JSON.stringify(customParams),
    };

    const submitBtn = document.querySelector('#pullProxyForm button[type="submit"]');
    const origText  = submitBtn ? submitBtn.innerHTML : '';
    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<i class="fa fa-spinner fa-spin mr-2"></i>Saving...';
    }

    try {
        const result = await Api.updateStreamProxy(formData);
        if (result.code === 0) {
            showToast('Updated successfully', 'success');
            closeModal();
            loadPullProxyList();
        } else {
            showToast('Update failed: ' + (result.msg || 'Unknown error'), 'error');
        }
    } catch (error) {
        showToast('Update failed: ' + error.message, 'error');
    } finally {
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.innerHTML = origText;
        }
    }
}

// ==================== Param helper functions ====================

// ==================== Multi-address row helpers ====================

/**
 *  to  #urlListContainer Append one address input row (url + schema  dropdown)
 * @param {string} urlVal   - Address initial value
 * @param {string} schemaVal - schema  initial value
 * @param {boolean} readOnly - whether read-only
 * @param {boolean} isFirst  - Whether it is the first one (the first gets a "Main" marker, cannot be deleted)
 */
function addUrlRow(urlVal = '', paramsVal = {}, readOnly = false, isFirst = false) {
    const container = document.getElementById('urlListContainer');
    if (!container) return;

    if (typeof paramsVal === 'string') {
        try { paramsVal = JSON.parse(paramsVal); } catch (e) { paramsVal = {}; }
    }
    const schemaVal  = paramsVal.schema   || '';
    const rtpTypeVal = paramsVal.rtp_type != null ? String(paramsVal.rtp_type) : '';

    const disabledAttr = readOnly ? 'disabled' : '';
    const inputBase = readOnly
        ? 'bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white/60 cursor-not-allowed text-sm'
        : 'bg-white/10 border border-white/20 rounded-lg px-3 py-2 text-white placeholder-white/50 focus:outline-none focus:ring-2 focus:ring-primary text-sm';
    const selectBase = inputBase + (readOnly ? '' : ' cursor-pointer');

    const schemaOptions = ['', 'hls', 'ts', 'flv'].map(v => {
        const label = v === '' ? 'Auto-detect' : v;
        return `<option value="${v}" ${v === schemaVal ? 'selected' : ''}>${label}</option>`;
    }).join('');

    const rtpTypeOptions = [
        ['', 'Default (TCP)'],
        ['0', '0 - TCP'],
        ['1', '1 - UDP'],
        ['2', '2 - Multicast'],
    ].map(([v, label]) =>
        `<option value="${v}" ${v === rtpTypeVal ? 'selected' : ''}>${label}</option>`
    ).join('');

    const row = document.createElement('div');
    row.className = 'url-row flex gap-2 items-center';
    row.innerHTML = `
        ${isFirst ? '<span class="text-xs text-primary font-bold flex-shrink-0 w-6 text-center">Main</span>' : '<span class="text-xs text-white/30 flex-shrink-0 w-6 text-center">Backup</span>'}
        <input type="text" ${disabledAttr}
            class="url-row-url flex-1 ${inputBase}"
            placeholder="Pull address (rtsp/rtmp/hls/http-ts/http-flv/srt/webrtc)"
            value="${urlVal.replace(/"/g, '&quot;')}">
        <select ${disabledAttr} class="url-row-schema w-28 flex-shrink-0 ${selectBase}" title="Pull protocol(schema)" style="color:white;">
            ${schemaOptions}
        </select>
        <select ${disabledAttr} class="url-row-rtp-type w-32 flex-shrink-0 ${selectBase}" title="RTSP pull mode(rtp_type)" style="color:white;">
            ${rtpTypeOptions}
        </select>
        ${(!readOnly && !isFirst) ? `
        <button type="button"
            class="bg-red-500/20 text-red-400 px-2 py-2 rounded-lg hover:bg-red-500/30 transition-colors flex-shrink-0"
            onclick="this.closest('.url-row').remove(); _refreshUrlRowLabels();">
            <i class="fa fa-times"></i>
        </button>` : '<span class="w-8 flex-shrink-0"></span>'}
    `;
    container.appendChild(row);
}

/** Recompute"Main/Backup"marker */
function _refreshUrlRowLabels() {
    const rows = document.querySelectorAll('#urlListContainer .url-row');
    rows.forEach((row, idx) => {
        const badge = row.querySelector('span:first-child');
        if (badge) {
            badge.textContent = idx === 0 ? 'Main' : 'Backup';
            badge.className = idx === 0
                ? 'text-xs text-primary font-bold flex-shrink-0 w-6 text-center'
                : 'text-xs text-white/30 flex-shrink-0 w-6 text-center';
        }
    });
}

function addCustomParamRow(key = '', value = '', readOnly = false) {
    const container = document.getElementById('customParamsContainer');
    if (!container) return;
    const disabledAttr = readOnly ? 'disabled' : '';
    const row = document.createElement('div');
    row.className = 'custom-param-row flex space-x-2';
    row.innerHTML = `
        <input type="text" ${disabledAttr}
            class="custom-param-key flex-1 bg-white/10 border border-white/20 rounded-lg px-3 py-2 text-white placeholder-white/50 focus:outline-none focus:ring-2 focus:ring-primary text-sm"
            placeholder="Param name (e.g. retry_count)" value="${key}">
        <input type="text" ${disabledAttr}
            class="custom-param-value flex-1 bg-white/10 border border-white/20 rounded-lg px-3 py-2 text-white placeholder-white/50 focus:outline-none focus:ring-2 focus:ring-primary text-sm"
            placeholder="Param value" value="${value}">
        ${!readOnly ? `<button type="button"
            class="bg-red-500/20 text-red-400 px-3 py-2 rounded-lg hover:bg-red-500/30 transition-colors flex-shrink-0"
            onclick="this.parentElement.remove()">
            <i class="fa fa-times"></i>
        </button>` : ''}
    `;
    container.appendChild(row);
}

async function loadDefaultProtocolParams() {
    // dom id  <-->  protocol.xxx Field-name mapping
    const fieldMap = {
        modifyStamp:   'modify_stamp',
        pacedSenderMs: 'paced_sender_ms',
        enableAudio:   'enable_audio',
        addMuteAudio:  'add_mute_audio',
        autoClose:     'auto_close',
        enableHls:     'enable_hls',
        enableHlsFmp4: 'enable_hls_fmp4',
        enableMp4:     'enable_mp4',
        enableRtsp:    'enable_rtsp',
        enableRtmp:    'enable_rtmp',
        enableTs:      'enable_ts',
        enableFmp4:    'enable_fmp4',
        hlsDemand:     'hls_demand',
        rtspDemand:    'rtsp_demand',
        rtmpDemand:    'rtmp_demand',
        tsDemand:      'ts_demand',
        fmp4Demand:    'fmp4_demand',
        mp4AsPlayer:   'mp4_as_player',
        mp4MaxSecond:  'mp4_max_second',
        mp4SavePath:   'mp4_save_path',
        hlsSavePath:   'hls_save_path',
    };

    try {
        const result = await Api.getServerConfig();
        if (result.code === 0 && result.data && result.data.length > 0) {
            const serverConfig = result.data[0] || {};
            let applied = 0;
            Object.entries(fieldMap).forEach(([domId, configKey]) => {
                const fullKey = `protocol.${configKey}`;
                const el = document.getElementById(domId);
                if (el && serverConfig[fullKey] !== undefined && serverConfig[fullKey] !== null) {
                    el.value = String(serverConfig[fullKey]);
                    applied++;
                }
            });
            showToast(`Loaded from server: ${applied} default remux params`, 'success');
        } else {
            showToast('Failed to get server config: ' + (result.msg || 'Unknown error'), 'error');
        }
    } catch (e) {
        showToast('Failed to get server config: ' + e.message, 'error');
    }
}

function clearProtocolParams() {
    const ids = [
        'modifyStamp', 'pacedSenderMs', 'enableAudio', 'addMuteAudio', 'autoClose',
        'enableHls', 'enableHlsFmp4', 'enableMp4', 'enableRtsp', 'enableRtmp',
        'enableTs', 'enableFmp4', 'hlsDemand', 'rtspDemand', 'rtmpDemand',
        'tsDemand', 'fmp4Demand', 'mp4AsPlayer', 'mp4MaxSecond', 'mp4SavePath',
        'hlsSavePath',
    ];
    ids.forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
    showToast('Remux params cleared', 'info');
}

async function loadPresetProtocolParams() {
    try {
        const result = await Api.getProtocolOptionsList();
        if (result.code !== 0 || !result.data || result.data.length === 0) {
            showToast('No presets available, please add one in "Protocol Config" first', 'warning');
            return;
        }
        const presetList = result.data;

        const presetModal = document.createElement('div');
        presetModal.id = 'presetPickerModal';
        presetModal.className = 'fixed inset-0 bg-black/80 flex items-center justify-center z-50';
        presetModal.innerHTML = `
            <div class="bg-gray-900 rounded-xl p-6 max-w-md w-full mx-4 border border-white/20" onclick="event.stopPropagation()">
                <div class="flex justify-between items-center mb-4">
                    <h3 class="text-xl font-bold text-white">Select protocol preset</h3>
                    <button onclick="document.getElementById('presetPickerModal').remove()" class="text-white/60 hover:text-white">
                        <i class="fa fa-times text-2xl"></i>
                    </button>
                </div>
                <select id="presetSelect" class="w-full bg-white/10 border border-white/20 rounded-lg px-4 py-2 text-white mb-4 focus:outline-none focus:ring-2 focus:ring-primary">
                    <option value="">-- Please select a preset --</option>
                    ${presetList.map(p => `<option value="${p.id}">${p.name}</option>`).join('')}
                </select>
                <div class="flex justify-end space-x-3">
                    <button onclick="document.getElementById('presetPickerModal').remove()"
                        class="bg-white/10 text-white px-5 py-2 rounded-lg font-semibold hover:bg-white/20 transition-colors">Cancel</button>
                    <button onclick="applyPreset()"
                        class="bg-gradient-primary text-white px-5 py-2 rounded-lg font-semibold hover:shadow-neon transition-all duration-300">OK</button>
                </div>
            </div>
        `;
        document.body.appendChild(presetModal);
        presetModal.addEventListener('click', e => { if (e.target === presetModal) presetModal.remove(); });
    } catch (e) {
        showToast('Failed to get preset list: ' + e.message, 'error');
    }
}

async function applyPreset() {
    const presetId = document.getElementById('presetSelect').value;
    if (!presetId) { showToast('Please select a preset first', 'warning'); return; }
    try {
        const result = await Api.getProtocolOptions(parseInt(presetId));
        if (result.code === 0 && result.data) {
            const p = result.data;
            const fieldMap = {
                modify_stamp:     'modifyStamp',
                paced_sender_ms:  'pacedSenderMs',
                enable_audio:     'enableAudio',
                add_mute_audio:   'addMuteAudio',
                auto_close:       'autoClose',
                enable_hls:       'enableHls',
                enable_hls_fmp4:  'enableHlsFmp4',
                enable_mp4:       'enableMp4',
                enable_rtsp:      'enableRtsp',
                enable_rtmp:      'enableRtmp',
                enable_ts:        'enableTs',
                enable_fmp4:      'enableFmp4',
                hls_demand:       'hlsDemand',
                rtsp_demand:      'rtspDemand',
                rtmp_demand:      'rtmpDemand',
                ts_demand:        'tsDemand',
                fmp4_demand:      'fmp4Demand',
                mp4_as_player:    'mp4AsPlayer',
                mp4_max_second:   'mp4MaxSecond',
                mp4_save_path:    'mp4SavePath',
                hls_save_path:    'hlsSavePath',
            };
            Object.entries(fieldMap).forEach(([apiKey, domId]) => {
                const el = document.getElementById(domId);
                if (el && p[apiKey] !== null && p[apiKey] !== undefined) el.value = p[apiKey];
            });
            document.getElementById('presetPickerModal').remove();
            showToast(`Loaded preset "${p.name}"`, 'success');
        } else {
            showToast('Failed to get preset details: ' + (result.msg || ''), 'error');
        }
    } catch (e) {
        showToast('Failed to load preset: ' + e.message, 'error');
    }
}

// ==================== Delete ====================

async function deletePullProxy(vhost, app, stream, dbId) {
    showConfirmModal(
        'Confirm delete Pull Proxy',
        `Are you sure you want to delete <b>${app}/${stream}</b> pull proxy?<br>This operation will remove it from both  ZLMediaKit  and the database.`,
        async function () {
            try {
                const result = await Api.delStreamProxy(dbId);
                if (result.code === 0) {
                    showToast('Deleted successfully', 'success');
                    loadPullProxyList();
                } else {
                    showToast('Delete failed: ' + (result.msg || 'Unknown error'), 'error');
                }
            } catch (error) {
                showToast('Delete failed: ' + error.message, 'error');
            }
        }
    );
}

/**
 * Toggle Pull Proxy mode
 * @param {number} id        database ID
 * @param {number} onDemand  Current mode: 1=on-demand, 0=Immediate
 */
async function togglePullProxyMode(id, onDemand) {
    const fromText = onDemand ? 'On-demand' : 'Immediate';
    const toText   = onDemand ? 'Immediate' : 'On-demand';
    const msg      = onDemand
        ? `Are you sure you want to switch this proxy to <b>immediate mode</b>?<br>will immediately ask  ZLMediaKit  will start a pull request.`
        : `Are you sure you want to switch this proxy to <b>on-demand mode</b>?<br>will stop the current pull and auto-resume when viewers arrive.`;

    showConfirmModal(
        `Switch mode: ${fromText} → ${toText}`,
        msg,
        async function () {
            try {
                const result = await Api.toggleStreamProxyMode(id);
                if (result.code === 0) {
                    showToast(result.msg || 'Switched successfully', 'success');
                    loadPullProxyList();
                } else {
                    showToast('Switch failed: ' + (result.msg || 'Unknown error'), 'error');
                }
            } catch (error) {
                showToast('Switch failed: ' + error.message, 'error');
            }
        }
    );
}

/**
 * Manually trigger a one-time pull for an offline proxy (directly calls  ZLM addStreamProxy)
 * force=0: do not overwrite if it exists; auto_close on-demand mode=1, otherwise =0
 */
async function startOfflineProxy(id) {
    // Find this proxy in the current list cache
    const proxy = (_pullProxyState.all || []).find(p => p.id === id);
    if (!proxy) {
        showToast('Proxy info not found, please refresh the list', 'error');
        return;
    }

    const vhost    = proxy.vhost  || '__defaultVhost__';
    const app      = proxy.app    || '';
    const stream   = proxy.stream || '';
    const onDemand = proxy.on_demand ? 1 : 0;
    const modeText = onDemand ? 'On-demand' : 'Immediate';

    showConfirmModal(
        'Re-pull',
        `Confirm: for <b>${app}/${stream}</b> to start a re-pull?<br>Current mode: ${modeText}`,
        async function () {
            try {
                // Parse the saved params
                let customParams = {};
                let protocolParams = {};
                try { customParams   = JSON.parse(proxy.custom_params   || '{}'); } catch (e) {}
                try { protocolParams = JSON.parse(proxy.protocol_params  || '{}'); } catch (e) {}

                // Take the first from the multi-address list url / params(incl.  schema, rtp_type  etc.)
                const firstUrl     = Array.isArray(proxy.urls) && proxy.urls.length > 0 ? proxy.urls[0] : {};
                const url          = firstUrl.url    || '';
                const urlParams    = (firstUrl.params && typeof firstUrl.params === 'object') ? firstUrl.params : {};
                const schema       = urlParams.schema   || '';
                const rtpType      = urlParams.rtp_type != null ? String(urlParams.rtp_type) : '';

                if (!url) {
                    showToast('This proxy has no valid pull address', 'error');
                    return;
                }

                // First expand  protocolParams / customParams, then force-override key fields
                const params = {
                    ...protocolParams,
                    ...customParams,
                    vhost,
                    app,
                    stream,
                    url,
                    force:      1,
                    auto_close: onDemand,   // On-demand=1(auto-close when no one is watching), immediate =0
                };
                if (schema)  params.schema   = schema;
                if (rtpType !== '') params.rtp_type = rtpType;

                const result = await Api.zlmAddStreamProxy(params);
                if (result.code === 0) {
                    showToast('Pull request sent', 'success');
                    // Refresh status after a one-second delay
                    setTimeout(() => loadPullProxyList(), 1500);
                } else {
                    showToast('Pull failed: ' + (result.msg || 'Unknown error'), 'error');
                }
            } catch (error) {
                showToast('Pull failed: ' + error.message, 'error');
            }
        }
    );
}

// ==================== Page cleanup ====================

function cleanupPullProxyPage() {
    const wrapper = document.getElementById('pullProxyModalWrapper');
    if (wrapper) wrapper.remove();
    const container = document.getElementById('pull-proxy-modal-container');
    if (container) {
        container.innerHTML = '';
        container.style.pointerEvents = 'none';
    }
}

// ==================== ZLM Status details modal ====================

function showProxyStatusDetail(cacheKey) {
    const data = _pullProxyStatusCache['__detail__' + cacheKey];
    if (!data) { showToast('Status data does not exist', 'warning'); return; }

    const statusMap = {
        'playing':    { label: 'Pulling', cls: 'bg-green-500/20 text-green-400'  },
        'idle':       { label: 'Idle',   cls: 'bg-white/10 text-white/50'       },
        'connecting': { label: 'Connecting', cls: 'bg-yellow-500/20 text-yellow-400'},
        'error':      { label: 'Error',   cls: 'bg-red-500/20 text-red-400'      },
    };
    const ss    = data.status_str || '';
    const sInfo = statusMap[ss] || { label: ss || 'Unknown', cls: 'bg-red-500/20 text-red-400' };

    // tracks Render
    const codecTypeMap = { 0: 'Video', 1: 'Audio' };
    let tracksHtml = '';
    if (Array.isArray(data.tracks) && data.tracks.length > 0) {
        data.tracks.forEach((t, i) => {
            const type = codecTypeMap[t.codec_type] ?? t.codec_type;
            const ready = t.ready
                ? '<span class="text-green-400">✓ Ready</span>'
                : '<span class="text-red-400">✗ Not ready</span>';
            let extraRows = '';
            if (t.codec_type === 0) {
                // Video
                extraRows = `
                    <tr><td class="text-white/50 pr-4 py-0.5">Resolution</td><td class="text-white">${t.width ?? '-'} × ${t.height ?? '-'}</td></tr>
                    <tr><td class="text-white/50 pr-4 py-0.5">FPS</td><td class="text-white">${t.fps ?? '-'} fps</td></tr>
                    <tr><td class="text-white/50 pr-4 py-0.5">GOP size</td><td class="text-white">${t.gop_size ?? '-'} frames / ${t.gop_interval_ms ?? '-'} ms</td></tr>
                    <tr><td class="text-white/50 pr-4 py-0.5">Keyframe count</td><td class="text-white">${t.key_frames ?? '-'}</td></tr>`;
            } else {
                // Audio
                extraRows = `
                    <tr><td class="text-white/50 pr-4 py-0.5">Channels</td><td class="text-white">${t.channels ?? '-'}</td></tr>
                    <tr><td class="text-white/50 pr-4 py-0.5">Sample rate</td><td class="text-white">${t.sample_rate ?? '-'} Hz</td></tr>
                    <tr><td class="text-white/50 pr-4 py-0.5">Sample bits</td><td class="text-white">${t.sample_bit ?? '-'} bit</td></tr>`;
            }
            tracksHtml += `
                <div class="bg-white/5 rounded-lg px-4 py-3">
                    <div class="text-white/50 text-xs font-bold uppercase tracking-widest mb-2">
                        Track ${i + 1} — ${type} / ${t.codec_id_name ?? '-'}
                    </div>
                    <table class="text-sm w-full">
                        <tr><td class="text-white/50 pr-4 py-0.5">Ready</td><td>${ready}</td></tr>
                        <tr><td class="text-white/50 pr-4 py-0.5">Total frames</td><td class="text-white">${t.frames ?? '-'}</td></tr>
                        <tr><td class="text-white/50 pr-4 py-0.5">Duration</td><td class="text-white">${t.duration != null ? (t.duration / 1000).toFixed(1) + ' sec' : '-'}</td></tr>
                        ${extraRows}
                    </table>
                </div>`;
        });
    } else {
        tracksHtml = `<div class="text-white/30 text-sm col-span-2">No Track info</div>`;
    }

    const modal = document.createElement('div');
    modal.id = 'proxyStatusDetailModal';
    modal.className = 'absolute inset-0 bg-black/80 backdrop-blur-sm flex items-start justify-center overflow-y-auto py-8 pointer-events-auto';
    modal.style.zIndex = '20';
    modal.innerHTML = `
        <div class="bg-gray-900 rounded-xl p-6 max-w-2xl w-full mx-4 border border-white/20 shadow-2xl" onclick="event.stopPropagation()">

            <!-- Title -->
            <div class="flex justify-between items-center mb-5">
                <div class="flex items-center gap-3">
                    <h3 class="text-xl font-bold text-white">Pull status details</h3>
                    <span class="px-3 py-1 rounded-full text-xs font-semibold ${sInfo.cls}">${sInfo.label}</span>
                </div>
                <button onclick="window._closeProxyStatusModal()" class="text-white/60 hover:text-white">
                    <i class="fa fa-times text-2xl"></i>
                </button>
            </div>

            <!-- Basic info -->
            <div class="mb-4">
                <h4 class="text-white/50 text-xs font-bold uppercase tracking-widest mb-2">Basic info</h4>
                <div class="grid grid-cols-2 gap-3">
                    <div class="bg-white/5 rounded-lg px-4 py-3 col-span-2">
                        <div class="text-white/50 text-xs mb-1">Key</div>
                        <div class="text-white text-sm font-mono break-all">${data.key ?? '-'}</div>
                    </div>
                    <div class="bg-white/5 rounded-lg px-4 py-3 col-span-2">
                        <div class="text-white/50 text-xs mb-1">Pull address (url)</div>
                        <div class="text-white/80 text-sm font-mono break-all">${data.url ?? '-'}</div>
                    </div>
                    <div class="bg-white/5 rounded-lg px-4 py-3">
                        <div class="text-white/50 text-xs mb-1">Status code (status)</div>
                        <div class="text-white text-sm">${data.status ?? '-'}</div>
                    </div>
                    <div class="bg-white/5 rounded-lg px-4 py-3">
                        <div class="text-white/50 text-xs mb-1">Status (status_str)</div>
                        <div class="text-sm font-semibold ${sInfo.cls.replace(/bg-\S+/,'').trim()}">${ss || '-'}</div>
                    </div>
                    <div class="bg-white/5 rounded-lg px-4 py-3">
                        <div class="text-white/50 text-xs mb-1">Online duration (liveSecs)</div>
                        <div class="text-white text-sm">${data.liveSecs != null ? data.liveSecs + ' sec' : '-'}</div>
                    </div>
                    <div class="bg-white/5 rounded-lg px-4 py-3">
                        <div class="text-white/50 text-xs mb-1">Re-pull count (rePullCount)</div>
                        <div class="text-white text-sm">${data.rePullCount ?? '-'}</div>
                    </div>
                    <div class="bg-white/5 rounded-lg px-4 py-3">
                        <div class="text-white/50 text-xs mb-1">Realtime rate (bytesSpeed)</div>
                        <div class="text-white text-sm">${data.bytesSpeed != null ? (data.bytesSpeed / 1024).toFixed(1) + ' KB/s' : '-'}</div>
                    </div>
                    <div class="bg-white/5 rounded-lg px-4 py-3">
                        <div class="text-white/50 text-xs mb-1">Total traffic (totalBytes)</div>
                        <div class="text-white text-sm">${data.totalBytes != null ? (data.totalBytes / 1024 / 1024).toFixed(2) + ' MB' : '-'}</div>
                    </div>
                    <div class="bg-white/5 rounded-lg px-4 py-3">
                        <div class="text-white/50 text-xs mb-1">Viewers (totalReaderCount)</div>
                        <div class="text-white text-sm">${data.totalReaderCount ?? '-'}</div>
                    </div>
                </div>
            </div>

            <!-- src info -->
            <div class="mb-4">
                <h4 class="text-white/50 text-xs font-bold uppercase tracking-widest mb-2">Source info (src)</h4>
                <div class="grid grid-cols-2 gap-3">
                    <div class="bg-white/5 rounded-lg px-4 py-3">
                        <div class="text-white/50 text-xs mb-1">vhost</div>
                        <div class="text-white text-sm font-mono">${data.src?.vhost ?? '-'}</div>
                    </div>
                    <div class="bg-white/5 rounded-lg px-4 py-3">
                        <div class="text-white/50 text-xs mb-1">app</div>
                        <div class="text-white text-sm font-mono">${data.src?.app ?? '-'}</div>
                    </div>
                    <div class="bg-white/5 rounded-lg px-4 py-3">
                        <div class="text-white/50 text-xs mb-1">stream</div>
                        <div class="text-white text-sm font-mono">${data.src?.stream ?? '-'}</div>
                    </div>
                    <div class="bg-white/5 rounded-lg px-4 py-3">
                        <div class="text-white/50 text-xs mb-1">params</div>
                        <div class="text-white text-sm font-mono break-all">${data.src?.params || '(empty)'}</div>
                    </div>
                </div>
            </div>

            <!-- Tracks -->
            <div class="mb-5">
                <h4 class="text-white/50 text-xs font-bold uppercase tracking-widest mb-2">Media tracks (tracks)</h4>
                <div class="grid grid-cols-2 gap-3">
                    ${tracksHtml}
                </div>
            </div>

            <div class="flex justify-between items-center">
                <button id="proxyStatusRefreshBtn"
                    class="flex items-center gap-2 bg-primary/30 text-white px-5 py-2 rounded-lg font-semibold hover:bg-primary/50 transition-colors">
                    <i class="fa fa-refresh"></i>Refresh
                </button>
                <button onclick="window._closeProxyStatusModal()"
                    class="bg-white/10 text-white px-5 py-2 rounded-lg font-semibold hover:bg-white/20 transition-colors">
                    Close
                </button>
            </div>
        </div>
    `;
    // Mount to the dedicated container (absolute positioning, covers only the current tab)
    const container = document.getElementById('pull-proxy-modal-container');
    if (container) {
        container.style.pointerEvents = 'auto';
        container.appendChild(modal);
    } else {
        modal.style.position = 'fixed';
        modal.style.zIndex = '9999';
        document.body.appendChild(modal);
    }

    // Unified close function: remove modal and restore container mouse events
    const closeStatusModal = () => {
        const el = document.getElementById('proxyStatusDetailModal');
        if (el) el.remove();
        const c = document.getElementById('pull-proxy-modal-container');
        if (c) c.style.pointerEvents = 'none';
    };
    // Expose to  window, for  innerHTML  in  onclick call
    window._closeProxyStatusModal = closeStatusModal;

    modal.addEventListener('click', e => { if (e.target === modal) closeStatusModal(); });

    // Refresh button: re-query  ZLM  status, then rebuild the modal
    document.getElementById('proxyStatusRefreshBtn').addEventListener('click', async function () {
        const btn = this;
        btn.disabled = true;
        btn.innerHTML = '<i class="fa fa-spinner fa-spin"></i> Refreshing...';
        try {
            const res = await Api.listStreamProxy(cacheKey);
            if (res && res.code === 0 && Array.isArray(res.data) && res.data.length > 0) {
                _pullProxyStatusCache[cacheKey] = res.data[0];
                _pullProxyStatusCache['__detail__' + cacheKey] = res.data[0];
            } else {
                _pullProxyStatusCache[cacheKey] = null;
                delete _pullProxyStatusCache['__detail__' + cacheKey];
            }
        } catch (e) {
            showToast('Refresh failed: ' + e.message, 'error');
        }
        closeStatusModal();
        // Reopen the modal (if data still exists)
        if (_pullProxyStatusCache['__detail__' + cacheKey]) {
            showProxyStatusDetail(cacheKey);
        } else {
            showToast('Proxy is offline', 'warning');
            _renderPullProxyPage(); // Sync the list status column
        }
    });
}

