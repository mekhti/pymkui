document.addEventListener('DOMContentLoaded', async function() {
    const isAuth = await checkAuth();
    if (!isAuth) {
        return;
    }

    initTabs();
    initNavigation();
    await initLogout();
    
    addTab('dashboard', 'Dashboard', 'fa-dashboard');
});

let tabs = [];
let activeTab = null;

const pageNames = {
    'dashboard': 'Dashboard',
    'streams': 'Streams',
    'pull-proxy': 'Pull Proxy',
    'settings': 'Service Config',
    'whip': 'Online Push',
    'network': 'Connections',
    'protocol-options': 'Protocol Config'
};

const pageIcons = {
    'dashboard': 'fa-dashboard',
    'streams': 'fa-video-camera',
    'pull-proxy': 'fa-cloud-download',
    'settings': 'fa-cog',
    'whip': 'fa-podcast',
    'network': 'fa-link',
    'protocol-options': 'fa-cogs'
};

function initTabs() {
    tabs = [];
    activeTab = null;
    renderTabs();
}

function addTab(pageName, title, icon) {
    const existingTab = tabs.find(tab => tab.pageName === pageName);
    if (existingTab) {
        switchTab(pageName);
        return;
    }
    
    tabs.push({
        pageName: pageName,
        title: title || pageNames[pageName] || pageName,
        icon: icon || pageIcons[pageName] || 'fa-file'
    });
    
    switchTab(pageName);
    renderTabs();
}

/**
 * Jump to Streams page and auto-apply vhost/app/stream filter
 * @param {string} vhost  virtual host, e.g. __defaultVhost__
 * @param {string} app    app name
 * @param {string} stream Stream ID
 */
function navigateToStreams(vhost, app, stream) {
    // Stash filter params; loadStreamsPage read after init completes
    window._pendingStreamsFilter = { vhost: vhost || '', app: app || '', stream: stream || '' };

    const existingTab = tabs.find(tab => tab.pageName === 'streams');
    if (existingTab) {
        // Page exists: switchTab will call loadPageData → loadStreamsPage reload content
        switchTab('streams');
    } else {
        // Page does not exist: addTab trigger switchTab → loadStreamsPage
        addTab('streams', 'Streams', 'fa-video-camera');
    }
}

function switchTab(pageName) {
    activeTab = pageName;
    
    const pages = document.querySelectorAll('.page');
    pages.forEach(page => {
        page.classList.add('hidden');
    });
    
    const targetPage = document.getElementById(pageName + '-page');
    if (targetPage) {
        targetPage.classList.remove('hidden');
    }
    
    const menuItems = document.querySelectorAll('nav ul li a');
    menuItems.forEach(menu => {
        const menuItemPage = menu.getAttribute('data-page');
        if (menuItemPage === pageName) {
            menu.classList.remove('border-transparent', 'text-white/80');
            menu.classList.add('border-primary', 'bg-white/5', 'text-white');
        } else {
            menu.classList.remove('border-primary', 'bg-white/5', 'text-white');
            menu.classList.add('border-transparent', 'text-white/80');
        }
    });
    
    loadPageData(pageName);
    renderTabs();
}

function closeTab(pageName, event) {
    if (event) {
        event.stopPropagation();
    }
    
    const tabIndex = tabs.findIndex(tab => tab.pageName === pageName);
    if (tabIndex === -1) return;
    
    // Clean up modals and players
    if (pageName === 'streams' && typeof cleanupStreamsPage === 'function') {
        cleanupStreamsPage();
    } else if (pageName === 'pull-proxy' && typeof cleanupPullProxyPage === 'function') {
        cleanupPullProxyPage();
    } else if (pageName === 'protocol-options') {
        const protocolOptionsModalContainer = document.getElementById('protocol-options-modal-container');
        if (protocolOptionsModalContainer) {
            protocolOptionsModalContainer.innerHTML = '';
        }
    } else if (pageName === 'plugins') {
        // Clean up lifted-to-body plugin popups
        ['bindingModal', 'paramsModal'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.remove();
        });
    } else if (pageName === 'whip' && typeof whipState !== 'undefined' && whipState.isStreaming) {
        console.log('Close whip tab, stop push...');
        stopWhipStream();
    } else if (pageName === 'dashboard' && typeof cleanupDashboard === 'function') {
        console.log('Close dashboard tab, clean up resources...');
        cleanupDashboard();
    }
    
    tabs.splice(tabIndex, 1);
    
    if (activeTab === pageName) {
        if (tabs.length > 0) {
            const newActiveIndex = Math.min(tabIndex, tabs.length - 1);
            switchTab(tabs[newActiveIndex].pageName);
        } else {
            activeTab = null;
        }
    }
    
    renderTabs();
}

function renderTabs() {
    const tabsContainer = document.getElementById('tabs');
    if (!tabsContainer) return;
    
    let html = '';
    tabs.forEach(tab => {
        const isActive = tab.pageName === activeTab;
        html += `
            <div class="flex items-center px-4 py-2 rounded-t-lg cursor-pointer transition-all duration-300 ${isActive ? 'bg-white/10 text-white border-b-2 border-primary' : 'text-white/60 hover:text-white hover:bg-white/5'}" 
                 onclick="switchTab('${tab.pageName}')">
                <i class="fa ${tab.icon} mr-2"></i>
                <span class="mr-2">${tab.title}</span>
                ${tabs.length > 1 ? `<button class="ml-1 hover:bg-white/20 rounded-full w-5 h-5 flex items-center justify-center" onclick="closeTab('${tab.pageName}', event)">
                    <i class="fa fa-times text-xs"></i>
                </button>` : ''}
            </div>
        `;
    });
    
    tabsContainer.innerHTML = html;
}

function loadPageData(pageName) {
    switch (pageName) {
        case 'dashboard':
            loadDashboardPage();
            break;
        case 'streams':
            loadStreamsPage();
            break;
        case 'pull-proxy':
            loadPullProxyPage();
            break;
        case 'settings':
            loadSettingsPage();
            break;
        case 'whip':
            loadWhipPage();
            break;
        case 'network':
            loadNetworkPage();
            break;
        case 'protocol-options':
            loadProtocolOptionsPage();
            break;
        case 'plugins':
            loadPluginsPage();
            break;
        case 'recordings':
            loadRecordingsPageWrapper();
            break;
        default:
            break;
    }
}

async function loadDashboardPage() {
    const content = document.getElementById('dashboard-content');
    console.log('Start loading dashboard page...');
    
    content.innerHTML = `
        <div class="flex justify-center items-center h-64">
            <div class="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary mx-auto mb-4"></div>
            <span class="text-white/60 font-semibold">Loading...</span>
        </div>
    `;
    
    try {
        console.log('Fetching dashboard.html file...');
        const response = await fetch('pages/dashboard.html');
        console.log('dashboard.html file fetched successfully, status:', response.status);
        
        if (response.ok) {
            const html = await response.text();
            console.log('dashboard.html file content length:', html.length);
            content.innerHTML = html;
            console.log('dashboard.html file content loaded into page');
            
            setTimeout(() => {
                console.log('Start initializing dashboard feature...');
                if (typeof initDashboard === 'function') {
                    initDashboard();
                } else {
                    console.error('initDashboard function not defined');
                }
            }, 100);
        } else {
            console.error('Load dashboard.html file failed, status:', response.status);
            content.innerHTML = `
                <div class="text-center p-10 text-white/60 font-semibold">
                    Failed to load Dashboard page
                </div>
            `;
        }
    } catch (error) {
        console.error('Load dashboard page error:', error);
        content.innerHTML = `
            <div class="text-center p-10 text-white/60 font-semibold">
                Network error: ${error.message}
            </div>
        `;
    }
}

async function loadStreamsPage() {
    const content = document.getElementById('streams-content');
    console.log('Start loading streams page...');
    
    content.innerHTML = `
        <div class="flex justify-center items-center h-64">
            <div class="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary mx-auto mb-4"></div>
            <span class="text-white/60 font-semibold">Loading...</span>
        </div>
    `;
    
    try {
        console.log('Fetching streams.html file...');
        const response = await fetch('pages/streams.html');
        console.log('streams.html file fetched successfully, status:', response.status);
        
        if (response.ok) {
            const html = await response.text();
            console.log('streams.html file content length:', html.length);
            content.innerHTML = html;
            console.log('streams.html file content loaded into page');
            
            setTimeout(() => {
                console.log('Start initializing streams feature...');
                if (typeof loadStreams === 'function') {
                    // If there are pending jump filter params, apply them first
                    if (window._pendingStreamsFilter) {
                        const f = window._pendingStreamsFilter;
                        window._pendingStreamsFilter = null;
                        const vhostEl = document.getElementById('vhostFilter');
                        const appEl = document.getElementById('appFilter');
                        const streamEl = document.getElementById('streamFilter');
                        if (vhostEl && f.vhost !== undefined) vhostEl.value = f.vhost;
                        if (appEl && f.app !== undefined) appEl.value = f.app;
                        if (streamEl && f.stream !== undefined) streamEl.value = f.stream;
                    }
                    loadStreams();
                    
                    const vhostFilter = document.getElementById('vhostFilter');
                    if (vhostFilter) {
                        vhostFilter.addEventListener('input', loadStreams);
                        console.log('Vhost filter event listener bound');
                    }
                    
                    const protocolFilter = document.getElementById('protocolFilter');
                    if (protocolFilter) {
                        protocolFilter.addEventListener('change', loadStreams);
                        console.log('Protocol filter event listener bound');
                    }
                    
                    const appFilter = document.getElementById('appFilter');
                    if (appFilter) {
                        appFilter.addEventListener('input', loadStreams);
                    }
                    
                    const streamFilter = document.getElementById('streamFilter');
                    if (streamFilter) {
                        streamFilter.addEventListener('input', loadStreams);
                    }
                    
                    const refreshButton = document.getElementById('refreshStreams');
                    if (refreshButton) {
                        refreshButton.addEventListener('click', loadStreams);
                        console.log('Refresh button event listener bound');
                    }
                } else {
                    console.error('loadStreams function not defined');
                }
            }, 100);
        } else {
            console.error('Load streams.html file failed, status:', response.status);
            content.innerHTML = `
                <div class="text-center p-10 text-white/60 font-semibold">
                    Failed to load Streams page
                </div>
            `;
        }
    } catch (error) {
        console.error('Load streams page error:', error);
        content.innerHTML = `
            <div class="text-center p-10 text-white/60 font-semibold">
                Network error: ${error.message}
            </div>
        `;
    }
}

async function loadPullProxyPage() {
    const content = document.getElementById('pull-proxy-content');
    console.log('Start loading pull-proxy page...');
    
    content.innerHTML = `
        <div class="flex justify-center items-center h-64">
            <div class="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary mx-auto mb-4"></div>
            <span class="text-white/60 font-semibold">Loading...</span>
        </div>
    `;
    
    try {
        console.log('Fetching pull-proxy.html file...');
        const response = await fetch('pages/pull-proxy.html');
        console.log('pull-proxy.html file fetched successfully, status:', response.status);
        
        if (response.ok) {
            const html = await response.text();
            console.log('pull-proxy.html file content length:', html.length);
            content.innerHTML = html;
            console.log('pull-proxy.html file content loaded into page');
            
            setTimeout(() => {
                console.log('Start initializing pull-proxy feature...');
                if (typeof loadPullProxyList === 'function') {
                    loadPullProxyList();
                } else {
                    console.error('loadPullProxyList function not defined');
                }
            }, 100);
        } else {
            console.error('Load pull-proxy.html file failed, status:', response.status);
            content.innerHTML = `
                <div class="text-center p-10 text-white/60 font-semibold">
                    Failed to load Pull Proxy page
                </div>
            `;
        }
    } catch (error) {
        console.error('Load pull-proxy page error:', error);
        content.innerHTML = `
            <div class="text-center p-10 text-white/60 font-semibold">
                Network error: ${error.message}
            </div>
        `;
    }
}


async function loadSettingsPage() {
    const content = document.getElementById('settings-content');
    console.log('Start loading settings page...');
    
    content.innerHTML = `
        <div class="flex justify-center items-center h-64">
            <div class="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary mx-auto mb-4"></div>
            <span class="text-white/60 font-semibold">Loading...</span>
        </div>
    `;
    
    try {
        console.log('Fetching settings.html file...');
        const response = await fetch('pages/settings.html');
        console.log('settings.html file fetched successfully, status:', response.status);
        
        if (response.ok) {
            const html = await response.text();
            console.log('settings.html file content length:', html.length);
            content.innerHTML = html;
            console.log('settings.html file content loaded into page');
            
            setTimeout(() => {
                console.log('Start initializing settings feature...');
                if (typeof initSettingsPage === 'function') {
                    initSettingsPage();
                } else {
                    console.error('initSettingsPage function not defined');
                }
            }, 100);
        } else {
            console.error('Load settings.html file failed, status:', response.status);
            content.innerHTML = `
                <div class="text-center p-10 text-white/60 font-semibold">
                    Failed to load Service Config page
                </div>
            `;
        }
    } catch (error) {
        console.error('Load settings page error:', error);
        content.innerHTML = `
            <div class="text-center p-10 text-white/60 font-semibold">
                Network error: ${error.message}
            </div>
        `;
    }
}

async function loadWhipPage() {
    const content = document.getElementById('whip-content');
    console.log('Start loading whip page...');
    
    if (typeof whipState !== 'undefined' && whipState.initialized) {
        console.log('whipPage already initialized, restoring state...');
        if (typeof restoreWhipState === 'function') {
            restoreWhipState();
        }
        return;
    }
    
    content.innerHTML = `
        <div class="flex justify-center items-center h-64">
            <div class="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary mx-auto mb-4"></div>
            <span class="text-white/60 font-semibold">Loading...</span>
        </div>
    `;
    
    try {
        console.log('Fetching whip.html file...');
        const response = await fetch('pages/whip.html');
        console.log('whip.html file fetched successfully, status:', response.status);
        
        if (response.ok) {
            const html = await response.text();
            console.log('whip.html file content length:', html.length);
            content.innerHTML = html;
            console.log('whip.html file content loaded into page');
            
            setTimeout(() => {
                console.log('Start initializing whip push feature...');
                if (typeof initWhipStreaming === 'function') {
                    initWhipStreaming();
                    if (typeof whipState !== 'undefined') {
                        whipState.initialized = true;
                    }
                } else {
                    console.error('initWhipStreaming function not defined');
                }
            }, 100);
        } else {
            console.error('Load whip.html file failed, status:', response.status);
            content.innerHTML = `
                <div class="text-center p-10 text-white/60 font-semibold">
                    Failed to load Online Push page
                </div>
            `;
        }
    } catch (error) {
        console.error('Load whip page error:', error);
        content.innerHTML = `
            <div class="text-center p-10 text-white/60 font-semibold">
                Network error: ${error.message}
            </div>
        `;
    }
}

async function loadNetworkPage() {
    const content = document.getElementById('network-content');
    console.log('Start loading network page...');
    
    content.innerHTML = `
        <div class="flex justify-center items-center h-64">
            <div class="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary mx-auto mb-4"></div>
            <span class="text-white/60 font-semibold">Loading...</span>
        </div>
    `;
    
    try {
        console.log('Fetching network.html file...');
        const response = await fetch('pages/network.html');
        console.log('network.html file fetched successfully, status:', response.status);
        
        if (response.ok) {
            const html = await response.text();
            console.log('network.html file content length:', html.length);
            content.innerHTML = html;
            console.log('network.html file content loaded into page');
            
            setTimeout(() => {
                console.log('Start initializing network feature...');
                if (typeof initNetwork === 'function') {
                    initNetwork();
                } else {
                    console.error('initNetwork function not defined');
                }
            }, 100);
        } else {
            console.error('Load network.html file failed, status:', response.status);
            content.innerHTML = `
                <div class="text-center p-10 text-white/60 font-semibold">
                    Failed to load Connections page
                </div>
            `;
        }
    } catch (error) {
        console.error('Load network page error:', error);
        content.innerHTML = `
            <div class="text-center p-10 text-white/60 font-semibold">
                Network error: ${error.message}
            </div>
        `;
    }
}

async function loadProtocolOptionsPage() {
    console.log('loadProtocolOptionsPage function called');
    const content = document.getElementById('protocol-options-content');
    console.log('Found protocol-options-content element:', content);
    if (!content) {
        console.error('protocol-options-content element does not exist');
        return;
    }
    console.log('Start loading protocol-options page...');
    
    content.innerHTML = `
        <div class="flex justify-center items-center h-64">
            <div class="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary mx-auto mb-4"></div>
            <span class="text-white/60 font-semibold">Loading...</span>
        </div>
    `;
    
    try {
        console.log('Fetching protocol-options.html file...');
        const response = await fetch('pages/protocol-options.html');
        console.log('protocol-options.html file fetched successfully, status:', response.status);
        
        if (response.ok) {
            const html = await response.text();
            console.log('protocol-options.html file content length:', html.length);
            content.innerHTML = html;
            console.log('protocol-options.html file content loaded into page');
            
            setTimeout(() => {
                console.log('Start initializing protocol-options feature...');
                console.log('loadProtocolOptions function exists?:', typeof loadProtocolOptions === 'function');
                if (typeof loadProtocolOptions === 'function') {
                    console.log('call loadProtocolOptions function');
                    loadProtocolOptions();
                } else {
                    console.error('loadProtocolOptions function not defined');
                }
            }, 100);
        } else {
            console.error('Load protocol-options.html file failed, status:', response.status);
            content.innerHTML = `
                <div class="text-center p-10 text-white/60 font-semibold">
                    Failed to load Protocol Config page
                </div>
            `;
        }
    } catch (error) {
        console.error('Load protocol-options page error:', error);
        content.innerHTML = `
            <div class="text-center p-10 text-white/60 font-semibold">
                Network error: ${error.message}
            </div>
        `;
    }
}

function initNavigation() {
    const menuItems = document.querySelectorAll('nav ul li a');

    menuItems.forEach(item => {
        if (item.id === 'logoutBtn') {
            return;
        }
        
        item.addEventListener('click', function(e) {
            e.preventDefault();
            
            const pageName = this.getAttribute('data-page');
            const title = this.querySelector('span').textContent;
            const iconClass = this.querySelector('i').className.split(' ').find(cls => cls.startsWith('fa-'));
            
            addTab(pageName, title, iconClass);
        });
    });
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

async function initLogout() {
    document.getElementById('logoutBtn').addEventListener('click', async function() {
        showConfirmModal(
            'Confirm log out',
            'Are you sure you want to log out?',
            async function() {
                try {
                    await Api.logout();
                    Api.clearAuth();
                    showToast('Logged out', 'info');
                    setTimeout(() => {
                        window.location.href = 'login.html';
                    }, 1000);
                } catch (error) {
                    showToast('Log out failed: ' + error.message, 'error');
                }
            }
        );
    });
}

function showToast(message, type = 'info') {
    const toast = document.getElementById('toast');
    const toastMessage = document.getElementById('toast-message');
    const toastIcon = toast.querySelector('i');
    
    toastMessage.textContent = message;
    
    switch (type) {
        case 'success':
            toastIcon.className = 'fa fa-check-circle';
            break;
        case 'error':
            toastIcon.className = 'fa fa-exclamation-circle';
            break;
        case 'warning':
            toastIcon.className = 'fa fa-exclamation-triangle';
            break;
        default:
            toastIcon.className = 'fa fa-info-circle';
    }
    
    toast.className = 'fixed top-4 right-4 z-50 transition-all duration-500 transform translate-x-full opacity-0';
    
    let bgClass = '';
    switch (type) {
        case 'success':
            bgClass = 'bg-gradient-to-r from-green-400 to-emerald-500';
            break;
        case 'error':
            bgClass = 'bg-gradient-to-r from-rose-500 to-red-500';
            break;
        case 'warning':
            bgClass = 'bg-gradient-to-r from-amber-400 to-yellow-500';
            break;
        default:
            bgClass = 'bg-gradient-primary';
    }
    
    toast.classList.add(...bgClass.split(' '));
    
    setTimeout(() => {
        toast.classList.remove('translate-x-full', 'opacity-0');
    }, 100);
    
    setTimeout(() => {
        toast.classList.add('translate-x-full', 'opacity-0');
    }, 3000);
}

async function loadPluginsPage() {
    const content = document.getElementById('plugins-content');
    if (!content) return;

    content.innerHTML = `
        <div class="flex justify-center items-center h-64">
            <div class="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary mx-auto"></div>
        </div>`;

    try {
        const response = await fetch('pages/plugins.html');
        if (response.ok) {
            const html = await response.text();
            content.innerHTML = html;
            // Lift all plugin popups to body, to avoid parent container pointer-events-none / overflow interference
            ['bindingModal', 'paramsModal'].forEach(id => {
                const el = document.getElementById(id);
                if (el) document.body.appendChild(el);
            });
            setTimeout(() => {
                if (typeof initPluginsPage === 'function') initPluginsPage();
            }, 100);
        } else {
            content.innerHTML = `<div class="text-center p-10 text-white/60">Failed to load Plugins page</div>`;
        }
    } catch (e) {
        content.innerHTML = `<div class="text-center p-10 text-white/60">Network error: ${e.message}</div>`;
    }
}

async function loadRecordingsPageWrapper() {
    const content = document.getElementById('recordings-content');
    if (!content) return;
    if (!content.dataset.loaded) {
        const resp = await fetch('pages/recordings.html');
        content.innerHTML = resp.ok ? await resp.text() : '<div class="text-white/40 p-10 text-center">Load failed</div>';
        content.dataset.loaded = '1';
    }
    if (typeof loadRecordingsPage === 'function') loadRecordingsPage();
}
