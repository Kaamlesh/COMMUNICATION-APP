/**
 * CampusConnect - Desktop Renderer Controller
 * Implements Telegram UI interactivity, WebRTC calling over LAN,
 * local encrypted vault syncing, voice notes, and file transfers.
 */

// Application State
const state = {
    profile: null,
    networkStatus: null,
    peers: [],              // Discovered peers
    activePeer: null,       // Currently selected peer
    conversations: {},      // { [peerUuid]: [messages] }
    
    // Calling State
    rtcPeerConnection: null,
    localMediaStream: null,
    currentCallPeer: null,
    callCandidatesQueue: [],
    pendingIncomingCall: null,
    isAudioMuted: false,
    isVideoOff: false,
    callActive: false,

    // Voice Note Recorder
    mediaRecorder: null,
    audioChunks: [],
    isRecordingVoice: false
};

// DOM Elements Cache
const DOM = {
    // Views
    viewLogin: document.getElementById('view-login'),
    viewChat: document.getElementById('view-chat'),

    // Titlebar
    titlebarNetBadge: document.getElementById('titlebar-net-badge'),
    titlebarIpInfo: document.getElementById('titlebar-ip-info'),
    btnMin: document.getElementById('btn-min'),
    btnMax: document.getElementById('btn-max'),
    btnClose: document.getElementById('btn-close'),

    // Login Form
    loginForm: document.getElementById('login-form'),
    inputUsername: document.getElementById('input-username'),
    loginDetectedIp: document.getElementById('login-detected-ip'),

    // Sidebar
    myAvatar: document.getElementById('my-avatar'),
    searchPeersInput: document.getElementById('search-peers-input'),
    peerList: document.getElementById('peer-list'),
    footerIpText: document.getElementById('footer-ip-text'),

    // Chat Area
    noChatSelected: document.getElementById('no-chat-selected'),
    activeChat: document.getElementById('active-chat'),
    chatPeerAvatar: document.getElementById('chat-peer-avatar'),
    chatPeerName: document.getElementById('chat-peer-name'),
    chatLinkBadge: document.getElementById('chat-link-badge'),
    chatPeerStatus: document.getElementById('chat-peer-status'),
    chatMessages: document.getElementById('chat-messages'),
    chatInputText: document.getElementById('chat-input-text'),
    btnSendMessage: document.getElementById('btn-send-message'),
    btnAttachFile: document.getElementById('btn-attach-file'),
    btnHeaderSendFile: document.getElementById('btn-header-send-file'),
    btnVoiceRecord: document.getElementById('btn-voice-record'),
    btnStartAudioCall: document.getElementById('btn-start-audio-call'),
    btnStartVideoCall: document.getElementById('btn-start-video-call'),

    // Banners
    transferBanner: document.getElementById('transfer-banner'),
    bannerFileName: document.getElementById('banner-file-name'),
    bannerFileSpeed: document.getElementById('banner-file-speed'),
    bannerProgressFill: document.getElementById('banner-progress-fill'),

    // Modals
    modalCalling: document.getElementById('modal-calling'),
    callAvatar: document.getElementById('call-avatar'),
    callPeerName: document.getElementById('call-peer-name'),
    callStatusText: document.getElementById('call-status-text'),
    callAudioView: document.getElementById('call-audio-view'),
    callVideoView: document.getElementById('call-video-view'),
    remoteVideo: document.getElementById('remote-video'),
    localVideo: document.getElementById('local-video'),
    remoteAudio: document.getElementById('remote-audio'),
    btnCallMuteMic: document.getElementById('btn-call-mute-mic'),
    btnCallToggleCam: document.getElementById('btn-call-toggle-cam'),
    btnCallEnd: document.getElementById('btn-call-end'),

    // Incoming Call Modal
    modalIncomingCall: document.getElementById('modal-incoming-call'),
    incomingCallAvatar: document.getElementById('incoming-call-avatar'),
    incomingCallName: document.getElementById('incoming-call-name'),
    incomingCallType: document.getElementById('incoming-call-type'),
    btnIncomingAccept: document.getElementById('btn-incoming-accept'),
    btnIncomingDecline: document.getElementById('btn-incoming-decline'),

    // Direct Connect & Subnet Scanner Modal
    btnOpenConnectModal: document.getElementById('btn-open-connect-modal'),
    modalDirectConnect: document.getElementById('modal-direct-connect'),
    btnCloseConnectModal: document.getElementById('btn-close-connect-modal'),
    directMyIp: document.getElementById('direct-my-ip'),
    directMyType: document.getElementById('direct-my-type'),
    btnCopyMyIp: document.getElementById('btn-copy-my-ip'),
    formDirectConnect: document.getElementById('form-direct-connect'),
    inputPeerIp: document.getElementById('input-peer-ip'),
    inputPeerPort: document.getElementById('input-peer-port'),
    btnSubmitDirectConnect: document.getElementById('btn-submit-direct-connect'),
    directConnectFeedback: document.getElementById('direct-connect-feedback'),
    zoneScanChips: document.querySelectorAll('.zone-scan-chip'),

    modalVault: document.getElementById('modal-vault'),
    btnCloseVaultModal: document.getElementById('btn-close-vault-modal'),
    vaultStatPath: document.getElementById('vault-stat-path'),
    vaultStatSize: document.getElementById('vault-stat-size'),
    btnOpenDownloads: document.getElementById('btn-open-downloads'),
    btnLogout: document.getElementById('btn-logout'),
    btnUserMenu: document.getElementById('btn-user-menu')
};

// ==========================================
// Initialization & Lifecycle
// ==========================================
document.addEventListener('DOMContentLoaded', async () => {
    setupWindowControls();
    setupDirectConnectModal();
    await loadInitialVaultData();
});

function setupWindowControls() {
    DOM.btnMin.addEventListener('click', () => window.campusAPI.minimizeWindow());
    DOM.btnMax.addEventListener('click', () => window.campusAPI.maximizeWindow());
    DOM.btnClose.addEventListener('click', () => window.campusAPI.closeWindow());
}

async function loadInitialVaultData() {
    try {
        const netStatus = await window.campusAPI.getNetworkStatus();
        state.networkStatus = netStatus;
        updateNetworkUI(netStatus);

        const vaultData = await window.campusAPI.loadVault();
        if (vaultData) {
            if (vaultData.conversations) {
                state.conversations = vaultData.conversations;
            }
            if (Array.isArray(vaultData.peers) && vaultData.peers.length > 0) {
                state.peers = vaultData.peers.map(p => ({
                    ...p,
                    isOnline: false
                }));
            }

            // If user has previously logged in with a username, automatically enter inside!
            if (vaultData.profile && vaultData.profile.username && vaultData.profile.isLoggedIn !== false) {
                state.profile = vaultData.profile;
                showChatView();
                return;
            } else if (vaultData.profile && vaultData.profile.username) {
                // If explicitly logged out, pre-fill their previous username
                DOM.inputUsername.value = vaultData.profile.username;
            }
        }
        showLoginView();
    } catch (err) {
        console.error('Initialization error:', err);
        showLoginView();
    }
}

function updateNetworkUI(net) {
    if (!net) return;
    const ip = net.ip || '127.0.0.1';
    const type = net.networkType || 'Campus Intranet';
    const port = net.port || 8765;

    DOM.titlebarIpInfo.textContent = `${ip}:${port} (${type})`;
    DOM.titlebarIpInfo.style.cursor = 'pointer';
    DOM.titlebarIpInfo.title = 'Click to copy your IP to share with friends';

    DOM.loginDetectedIp.textContent = `${type} Active • ${ip}`;
    DOM.footerIpText.textContent = `${ip} • ${type}`;

    if (DOM.directMyIp) DOM.directMyIp.textContent = `${ip}:${port}`;
    if (DOM.directMyType) DOM.directMyType.textContent = type;
}

function copyMyIpToClipboard() {
    if (state.networkStatus && state.networkStatus.ip) {
        const text = `${state.networkStatus.ip}:${state.networkStatus.port || 8765}`;
        navigator.clipboard.writeText(text).then(() => {
            playTone(880, 0.1);
            if (DOM.directConnectFeedback) {
                DOM.directConnectFeedback.textContent = `Copied ${text} to clipboard! Share it with your friend.`;
                DOM.directConnectFeedback.className = 'connect-feedback-text success';
            }
            const orig = DOM.footerIpText.textContent;
            DOM.footerIpText.textContent = 'IP Copied to Clipboard!';
            setTimeout(() => {
                DOM.footerIpText.textContent = orig;
            }, 1800);
        });
    }
}

function setupDirectConnectModal() {
    if (DOM.btnOpenConnectModal) {
        DOM.btnOpenConnectModal.addEventListener('click', () => {
            DOM.modalDirectConnect.classList.remove('hidden');
            if (DOM.directConnectFeedback) DOM.directConnectFeedback.textContent = '';
            if (state.networkStatus) {
                if (DOM.directMyIp) DOM.directMyIp.textContent = `${state.networkStatus.ip}:${state.networkStatus.port || 8765}`;
                if (DOM.directMyType) DOM.directMyType.textContent = state.networkStatus.networkType || 'Campus Intranet';
            }
        });
    }

    if (DOM.btnCloseConnectModal) {
        DOM.btnCloseConnectModal.addEventListener('click', () => {
            DOM.modalDirectConnect.classList.add('hidden');
        });
    }

    if (DOM.btnCopyMyIp) {
        DOM.btnCopyMyIp.addEventListener('click', copyMyIpToClipboard);
    }

    if (DOM.titlebarIpInfo) {
        DOM.titlebarIpInfo.addEventListener('click', copyMyIpToClipboard);
    }

    if (DOM.footerIpText) {
        DOM.footerIpText.addEventListener('click', copyMyIpToClipboard);
    }

    if (DOM.formDirectConnect) {
        DOM.formDirectConnect.addEventListener('submit', async (e) => {
            e.preventDefault();
            const ip = DOM.inputPeerIp.value.trim();
            const port = parseInt(DOM.inputPeerPort.value, 10) || 8765;

            if (!ip) return;

            DOM.btnSubmitDirectConnect.disabled = true;
            DOM.directConnectFeedback.textContent = `Connecting to ${ip}:${port}...`;
            DOM.directConnectFeedback.className = 'connect-feedback-text info';

            try {
                const res = await window.campusAPI.connectPeer(ip, port);
                if (res.success) {
                    DOM.directConnectFeedback.textContent = `Successfully connected to ${ip}! Classmate added.`;
                    DOM.directConnectFeedback.className = 'connect-feedback-text success';
                    setTimeout(() => {
                        DOM.modalDirectConnect.classList.add('hidden');
                        if (res.peer) selectPeer(res.peer);
                    }, 800);
                } else {
                    DOM.directConnectFeedback.textContent = `Could not reach ${ip}:${port}. Check IP address or network connection.`;
                    DOM.directConnectFeedback.className = 'connect-feedback-text error';
                }
            } catch (err) {
                DOM.directConnectFeedback.textContent = `Connection error: ${err.message}`;
                DOM.directConnectFeedback.className = 'connect-feedback-text error';
            } finally {
                DOM.btnSubmitDirectConnect.disabled = false;
            }
        });
    }

    if (DOM.zoneScanChips) {
        DOM.zoneScanChips.forEach(chip => {
            chip.addEventListener('click', async () => {
                const zone = chip.getAttribute('data-zone');
                const zoneName = chip.querySelector('.zone-name')?.textContent || zone;
                DOM.directConnectFeedback.textContent = `Scanning ${zoneName} subnet... Please wait.`;
                DOM.directConnectFeedback.className = 'connect-feedback-text info';

                try {
                    const result = await window.campusAPI.scanCategory(zone);
                    DOM.directConnectFeedback.textContent = `Scan complete for ${zoneName}: Found ${result.totalFound || 0} classmate(s).`;
                    DOM.directConnectFeedback.className = 'connect-feedback-text success';
                } catch (err) {
                    DOM.directConnectFeedback.textContent = `Scan error: ${err.message}`;
                    DOM.directConnectFeedback.className = 'connect-feedback-text error';
                }
            });
        });
    }
}

function showLoginView() {
    DOM.viewLogin.classList.remove('hidden');
    DOM.viewChat.classList.add('hidden');
}

function showChatView() {
    DOM.viewLogin.classList.add('hidden');
    DOM.viewChat.classList.remove('hidden');

    if (state.profile) {
        const initial = (state.profile.username || 'U').charAt(0).toUpperCase();
        DOM.myAvatar.textContent = initial;
        DOM.myAvatar.title = state.profile.username;
    }

    if (!state.activePeer) {
        DOM.noChatSelected.classList.remove('hidden');
        DOM.activeChat.classList.add('hidden');
    }

    renderPeerList();
}

// ==========================================
// Login Handler
// ==========================================
DOM.loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = DOM.inputUsername.value.trim();

    if (!username) return;

    try {
        const res = await window.campusAPI.login(username, '');
        if (res.success) {
            state.profile = res.profile;
            state.networkStatus = res.networkStatus;
            if (res.conversations) {
                state.conversations = res.conversations;
            }
            if (Array.isArray(res.peers) && res.peers.length > 0) {
                state.peers = res.peers.map(p => ({
                    ...p,
                    isOnline: false
                }));
            }
            updateNetworkUI(res.networkStatus);
            showChatView();
        }
    } catch (err) {
        alert('Login failed: ' + err.message);
    }
});

// ==========================================
// Peer Discovery & List Rendering
// ==========================================
window.campusAPI.onNetworkStatusChanged((netStatus) => {
    state.networkStatus = netStatus;
    updateNetworkUI(netStatus);
    if (state.activePeer && state.activePeer.ip) {
        window.campusAPI.checkPeerOnline(state.activePeer.ip, state.activePeer.port, state.activePeer.uuid).then((res) => {
            if (state.activePeer) {
                state.activePeer.isOnline = res.isOnline;
                const matchInState = state.peers.find(p => p.uuid === state.activePeer.uuid);
                if (matchInState) matchInState.isOnline = res.isOnline;
                updateActiveChatHeader(state.activePeer);
                renderPeerList();
            }
        }).catch(() => {});
    }
});

window.campusAPI.onPeersUpdated((peers) => {
    const peerMap = new Map();
    // Keep all existing peers in state (including offline chat contacts)
    for (const p of state.peers) {
        if (p && p.uuid) peerMap.set(p.uuid, { ...p, isOnline: false });
    }
    // Update/add newly received active peers
    for (const p of peers) {
        if (p && p.uuid) {
            const prev = peerMap.get(p.uuid) || {};
            peerMap.set(p.uuid, {
                ...prev,
                ...p,
                isOnline: Boolean(p.isOnline)
            });
        }
    }
    state.peers = Array.from(peerMap.values());
    renderPeerList();
    if (state.activePeer) {
        const updated = state.peers.find(p => p.uuid === state.activePeer.uuid);
        if (updated) {
            state.activePeer = updated;
            updateActiveChatHeader(updated);
        }
    }
});

function getConversation(peer) {
    if (!peer) return [];
    if (peer.uuid && state.conversations[peer.uuid]) {
        return state.conversations[peer.uuid];
    }
    if (peer.username) {
        const lower = peer.username.toLowerCase();
        for (const [key, msgs] of Object.entries(state.conversations || {})) {
            if (key.toLowerCase() === lower) return msgs;
            if (Array.isArray(msgs) && msgs.length > 0) {
                const match = msgs.some(m =>
                    (m.senderName && m.senderName.toLowerCase() === lower) ||
                    (m.recipientName && m.recipientName.toLowerCase() === lower)
                );
                if (match) return msgs;
            }
        }
    }
    return [];
}

function getLastMessageText(peer) {
    const conv = getConversation(peer);
    if (conv && conv.length > 0) {
        const last = conv[conv.length - 1];
        if (last.file) return `📎 File: ${last.file.name}`;
        if (last.audio) return `🎤 Voice Note`;
        return last.text || '';
    }
    return 'Tap to chat';
}

function getPeerLastActivityTime(peer) {
    const conv = getConversation(peer);
    if (conv && conv.length > 0) {
        return conv[conv.length - 1].time || peer.lastSeen || 0;
    }
    return peer.lastSeen || 0;
}

function renderPeerList() {
    const searchFilter = DOM.searchPeersInput.value.toLowerCase().trim();
    DOM.peerList.innerHTML = '';

    const filtered = state.peers.filter(peer => {
        // Search bar filter (classmate name or IP)
        if (searchFilter) {
            const matchName = peer.username.toLowerCase().includes(searchFilter);
            const matchIp = peer.ip && peer.ip.includes(searchFilter);
            return matchName || matchIp;
        }
        return true;
    });

    const ipPattern = /^(\d{1,3}\.){1,3}\d{0,3}$/;
    const looksLikeIp = ipPattern.test(searchFilter) && searchFilter.length >= 7;

    if (filtered.length === 0 && !looksLikeIp) {
        const emptyDiv = document.createElement('div');
        emptyDiv.className = 'radar-searching-box';
        emptyDiv.innerHTML = state.peers.length === 0 
            ? `<div class="radar-pulse-ring"></div>
               <div class="radar-title">Looking for Classmates...</div>
               <div class="radar-desc">Students across campus Wi-Fi, Hotspots & Hostels will appear here automatically.</div>
               <div class="connection-pills-row">
                   <span class="peer-link-badge conn-lan-lan">Wi-Fi • Hotspot</span>
                   <span class="peer-link-badge conn-lan-wan">Ethernet ↔ Wi-Fi</span>
                   <span class="peer-link-badge conn-wan-wan">Hostel ↔ Campus</span>
               </div>` 
            : `<div class="no-results-text">No matching classmates found. Click the globe button above to connect by IP.</div>`;
        DOM.peerList.appendChild(emptyDiv);
        return;
    }

    // If user entered an IP in search bar, render instant connect shortcut
    if (looksLikeIp) {
        const directItem = document.createElement('div');
        directItem.className = 'direct-connect-suggestion';
        directItem.innerHTML = `
            <div class="direct-connect-suggestion-text">Direct Connect to: <strong>${escapeHtml(searchFilter)}</strong></div>
            <span class="direct-connect-suggestion-badge">Connect Now</span>
        `;
        directItem.addEventListener('click', async () => {
            directItem.querySelector('.direct-connect-suggestion-badge').textContent = 'Connecting...';
            const res = await window.campusAPI.connectPeer(searchFilter, 8765);
            if (res.success && res.peer) {
                selectPeer(res.peer);
            } else if (!res.success) {
                alert(`Could not connect to ${searchFilter}:8765. Make sure your classmate's app is open.`);
                directItem.querySelector('.direct-connect-suggestion-badge').textContent = 'Connect Now';
            }
        });
        DOM.peerList.appendChild(directItem);
    }

    // Sort peers WhatsApp style: most recent chats first, then online status
    filtered.sort((a, b) => {
        const lastA = getPeerLastActivityTime(a);
        const lastB = getPeerLastActivityTime(b);
        if (lastA !== lastB) return lastB - lastA;
        if (a.isOnline !== b.isOnline) return a.isOnline ? -1 : 1;
        return (a.username || '').localeCompare(b.username || '');
    });

    filtered.forEach(peer => {
        const item = document.createElement('div');
        item.className = 'peer-list-item' + (state.activePeer?.uuid === peer.uuid ? ' active' : '');
        
        const initial = (peer.username || 'P').charAt(0).toUpperCase();
        const lastMsg = getLastMessageText(peer);
        const isOnline = !!peer.isOnline;
        const connType = isOnline ? (peer.connectionType || 'LAN ↔ LAN') : 'Offline';
        const connClass = isOnline ? getTopologyBadgeClass(connType) : 'conn-offline';

        item.innerHTML = `
            <div class="peer-avatar-wrapper">
                <div class="avatar-circle" style="background: ${getAvatarColor(peer.username)}">${initial}</div>
                ${isOnline ? '<div class="online-dot"></div>' : ''}
            </div>
            <div class="peer-details">
                <div class="peer-top-row">
                    <span class="peer-item-name">${escapeHtml(peer.username)}</span>
                    <span class="peer-link-badge ${connClass}">${connType}</span>
                </div>
                <div class="peer-bottom-row">
                    <span class="peer-last-msg">${escapeHtml(lastMsg)}</span>
                </div>
            </div>
        `;

        item.addEventListener('click', () => selectPeer(peer));
        DOM.peerList.appendChild(item);
    });
}

async function selectPeer(peer) {
    state.activePeer = peer;
    renderPeerList();

    DOM.noChatSelected.classList.add('hidden');
    DOM.activeChat.classList.remove('hidden');

    updateActiveChatHeader(peer);
    renderMessages(peer);

    // Live reachability check: immediately verify if classmate is genuinely reachable
    if (peer.ip) {
        try {
            const check = await window.campusAPI.checkPeerOnline(peer.ip, peer.port, peer.uuid);
            if (state.activePeer && state.activePeer.uuid === peer.uuid) {
                state.activePeer.isOnline = check.isOnline;
                const matchInState = state.peers.find(p => p.uuid === peer.uuid);
                if (matchInState) matchInState.isOnline = check.isOnline;
                updateActiveChatHeader(state.activePeer);
                renderPeerList();
            }
        } catch (e) {}
    }
}

function updateActiveChatHeader(peer) {
    const initial = (peer.username || 'P').charAt(0).toUpperCase();
    DOM.chatPeerAvatar.textContent = initial;
    DOM.chatPeerAvatar.style.background = getAvatarColor(peer.username);
    DOM.chatPeerName.textContent = peer.username;

    const isOnline = !!peer.isOnline;
    if (DOM.chatLinkBadge) {
        const connType = isOnline ? (peer.connectionType || 'LAN ↔ LAN') : 'Offline';
        const connClass = isOnline ? getTopologyBadgeClass(connType) : 'conn-offline';
        DOM.chatLinkBadge.textContent = connType;
        DOM.chatLinkBadge.className = `chat-link-badge ${connClass}`;
        DOM.chatLinkBadge.classList.remove('hidden');
    }

    if (isOnline) {
        DOM.chatPeerStatus.textContent = 'Online Now';
        DOM.chatPeerStatus.style.color = 'var(--online-green)';
    } else {
        DOM.chatPeerStatus.textContent = peer.lastSeen ? `Last seen ${formatTime(peer.lastSeen)}` : 'Offline';
        DOM.chatPeerStatus.style.color = 'var(--text-secondary)';
    }
}

// ==========================================
// Messaging & Chat View
// ==========================================
function renderMessages(peer) {
    DOM.chatMessages.innerHTML = '';
    const messages = getConversation(peer);

    if (messages.length === 0) {
        const welcome = document.createElement('div');
        welcome.className = 'date-divider';
        welcome.textContent = 'End-to-End Local Encrypted Intranet Chat';
        DOM.chatMessages.appendChild(welcome);
    }

    messages.forEach(msg => {
        appendMessageBubble(msg);
    });

    scrollToBottom();
}

function appendMessageBubble(msg) {
    const myUuid = state.profile?.uuid;
    const myName = (state.profile?.username || '').toLowerCase();

    // Accurately determine if the message was sent by me or received from a peer
    const isMe = (msg.senderUuid && myUuid && msg.senderUuid === myUuid) ||
                 (msg.senderName && myName && msg.senderName.toLowerCase() === myName) ||
                 (msg.isOutgoing === true && (!msg.recipientUuid || (myUuid && msg.recipientUuid !== myUuid)));

    const isOutgoing = Boolean(isMe);
    const senderDisplayName = isOutgoing ? 'You' : (msg.senderName || state.activePeer?.username || 'Classmate');
    const senderInitial = (senderDisplayName || 'P').charAt(0).toUpperCase();

    const row = document.createElement('div');
    row.className = `msg-row ${isOutgoing ? 'outgoing' : 'incoming'}`;

    const timeStr = formatTime(msg.time);
    let contentHtml = '';

    if (msg.file) {
        contentHtml = `
            <div class="msg-file-card">
                <div class="file-icon-box">${getFileIconExtension(msg.file.name)}</div>
                <div class="file-details">
                    <div class="file-name">${escapeHtml(msg.file.name)}</div>
                    <div class="file-size">${formatBytes(msg.file.size)}</div>
                </div>
                ${!isOutgoing ? `
                    <button class="btn-download-file" title="Open File" data-path="${msg.file.path || ''}">
                        <svg viewBox="0 0 24 24"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg>
                    </button>
                ` : ''}
            </div>
        `;
    } else if (msg.audio) {
        contentHtml = `
            <div class="voice-note-bubble">
                <button class="btn-play-voice" data-audio="${msg.audio}">
                    <svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
                </button>
                <div class="voice-wave-bars">
                    <div class="wave-bar"></div>
                    <div class="wave-bar"></div>
                    <div class="wave-bar"></div>
                    <div class="wave-bar"></div>
                    <div class="wave-bar"></div>
                </div>
                <span class="file-size">Voice Note</span>
            </div>
        `;
    } else {
        contentHtml = `<div class="msg-text">${escapeHtml(msg.text)}</div>`;
    }

    const checkmarks = isOutgoing ? `
        <span class="msg-ticks" title="Delivered">
            <svg viewBox="0 0 24 24"><path d="M18 7l-1.41-1.41-6.34 6.34 1.41 1.41L18 7zm4.24-1.41L11.66 16.17 7.41 11.93l-1.41 1.41 5.66 5.66 12-12-1.42-1.41zM.41 13.41L6.07 19.07l1.41-1.41L1.83 12 .41 13.41z"/></svg>
        </span>
    ` : '';

    const avatarHtml = !isOutgoing ? `
        <div class="msg-peer-avatar" style="background: ${getAvatarColor(senderDisplayName)}" title="${escapeHtml(senderDisplayName)}">
            ${senderInitial}
        </div>
    ` : '';

    const senderHeaderHtml = `
        <div class="msg-sender-name ${isOutgoing ? 'outgoing' : 'incoming'}">
            ${escapeHtml(senderDisplayName)}
        </div>
    `;

    row.innerHTML = `
        ${avatarHtml}
        <div class="msg-bubble">
            ${senderHeaderHtml}
            ${contentHtml}
            <div class="msg-meta">
                <span>${timeStr}</span>
                ${checkmarks}
            </div>
        </div>
    `;

    // Bind file open click if present
    const btnOpen = row.querySelector('.btn-download-file');
    if (btnOpen) {
        btnOpen.addEventListener('click', () => {
            const p = btnOpen.getAttribute('data-path');
            if (p) window.campusAPI.openFile(p);
            else window.campusAPI.openDownloadsFolder();
        });
    }

    // Bind voice note playback if present
    const btnVoice = row.querySelector('.btn-play-voice');
    if (btnVoice) {
        btnVoice.addEventListener('click', () => {
            const base64Audio = btnVoice.getAttribute('data-audio');
            playAudio(base64Audio);
        });
    }

    DOM.chatMessages.appendChild(row);
}

// Send Text Message
async function handleSendMessage() {
    const text = DOM.chatInputText.value.trim();
    if (!text || !state.activePeer) return;

    const msg = {
        msgId: crypto.randomUUID(),
        senderUuid: state.profile.uuid,
        senderName: state.profile.username,
        senderDept: state.profile.department,
        recipientUuid: state.activePeer.uuid,
        recipientName: state.activePeer.username,
        recipientDept: state.activePeer.department,
        text: text,
        time: Date.now(),
        isOutgoing: true
    };

    DOM.chatInputText.value = '';
    DOM.chatInputText.style.height = 'auto';

    // Store in local memory and UI
    if (!state.conversations[state.activePeer.uuid]) {
        state.conversations[state.activePeer.uuid] = [];
    }
    state.conversations[state.activePeer.uuid].push(msg);
    appendMessageBubble(msg);
    scrollToBottom();
    renderPeerList();

    // Play Telegram outgoing pop sound
    playTone(520, 0.08);

    // Send over intranet TCP if peer is online/reachable, and save to vault
    if (state.activePeer.isOnline && state.activePeer.ip) {
        await window.campusAPI.sendMessage(state.activePeer.ip, state.activePeer.port, msg);
    } else {
        await window.campusAPI.saveMessageToVault(state.activePeer.uuid, msg);
    }
}

DOM.btnSendMessage.addEventListener('click', handleSendMessage);
DOM.chatInputText.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSendMessage();
    }
});

// Incoming Message Listener
window.campusAPI.onMessageReceived((msg) => {
    if (!state.conversations[msg.senderUuid]) {
        state.conversations[msg.senderUuid] = [];
    }
    state.conversations[msg.senderUuid].push(msg);

    // Ensure peer exists in state.peers so contact is listed in chat list
    let peerInState = state.peers.find(p => p.uuid === msg.senderUuid);
    if (!peerInState) {
        peerInState = {
            uuid: msg.senderUuid,
            username: msg.senderName || 'Classmate',
            department: msg.senderDept || '',
            ip: msg.senderIp || '',
            port: msg.senderPort || 8765,
            connectionType: 'Intranet Peer',
            lastSeen: msg.time || Date.now(),
            isOnline: true
        };
        state.peers.unshift(peerInState);
    } else {
        peerInState.lastSeen = msg.time || Date.now();
        peerInState.isOnline = true;
    }

    // If currently chatting with this peer, append bubble directly
    if (state.activePeer && (state.activePeer.uuid === msg.senderUuid || (state.activePeer.username && msg.senderName && state.activePeer.username.toLowerCase() === msg.senderName.toLowerCase()))) {
        appendMessageBubble(msg);
        scrollToBottom();
    }

    renderPeerList();
    playTone(780, 0.12); // Incoming chime
});

// ==========================================
// High-Speed File Transfer
// ==========================================
async function handleSendFile() {
    if (!state.activePeer) return;

    try {
        const result = await window.campusAPI.selectAndSendFile(state.activePeer.ip, state.activePeer.port);
        if (result.success) {
            const msg = {
                msgId: crypto.randomUUID(),
                senderUuid: state.profile.uuid,
                senderName: state.profile.username,
                senderDept: state.profile.department,
                recipientUuid: state.activePeer.uuid,
                recipientName: state.activePeer.username,
                recipientDept: state.activePeer.department,
                time: Date.now(),
                isOutgoing: true,
                file: {
                    id: result.fileId,
                    name: result.fileName,
                    size: result.size,
                    path: result.localPath
                }
            };

            if (!state.conversations[state.activePeer.uuid]) {
                state.conversations[state.activePeer.uuid] = [];
            }
            state.conversations[state.activePeer.uuid].push(msg);
            await window.campusAPI.saveMessageToVault(state.activePeer.uuid, msg);

            appendMessageBubble(msg);
            scrollToBottom();
            renderPeerList();
        }
    } catch (err) {
        alert('File transfer failed: ' + err.message);
    }
}

DOM.btnAttachFile.addEventListener('click', handleSendFile);
DOM.btnHeaderSendFile.addEventListener('click', handleSendFile);

// File Progress Tracker
window.campusAPI.onFileProgress((prog) => {
    DOM.transferBanner.classList.remove('hidden');
    const speedMB = parseFloat(prog.speedMBps) || 0;
    const speedGbps = (speedMB * 8 / 1000).toFixed(2);
    const speedLabel = speedMB >= 125 
        ? `${speedMB.toFixed(1)} MB/s (${speedGbps} Gbps 🚀 Ultra Turbo)` 
        : speedMB >= 50
            ? `${speedMB.toFixed(1)} MB/s (${speedGbps} Gbps 🚀 High-Speed)`
            : `${speedMB.toFixed(1)} MB/s`;

    DOM.bannerFileName.textContent = `${prog.fileName} (${formatBytes(prog.bytesTransferred)} / ${formatBytes(prog.totalBytes)} - ${prog.percent}%)`;
    DOM.bannerFileSpeed.textContent = speedLabel;
    DOM.bannerProgressFill.style.width = `${prog.percent}%`;

    if (prog.isComplete) {
        DOM.bannerFileSpeed.textContent = `${speedLabel} • Complete!`;
        setTimeout(() => {
            DOM.transferBanner.classList.add('hidden');
        }, 4000);
    }
});

// ==========================================
// Voice Note Recorder (MediaRecorder)
// ==========================================
DOM.btnVoiceRecord.addEventListener('click', async () => {
    if (state.isRecordingVoice) {
        // Stop recording
        stopVoiceRecording();
    } else {
        // Start recording
        startVoiceRecording();
    }
});

async function startVoiceRecording() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        state.audioChunks = [];
        state.mediaRecorder = new MediaRecorder(stream);

        state.mediaRecorder.ondataavailable = (e) => {
            if (e.data.size > 0) state.audioChunks.push(e.data);
        };

        state.mediaRecorder.onstop = async () => {
            const audioBlob = new Blob(state.audioChunks, { type: 'audio/webm' });
            const reader = new FileReader();
            reader.readAsDataURL(audioBlob);
            reader.onloadend = async () => {
                const base64Audio = reader.result;
                sendVoiceMessage(base64Audio);
            };
            stream.getTracks().forEach(t => t.stop());
        };

        state.mediaRecorder.start();
        state.isRecordingVoice = true;
        DOM.btnVoiceRecord.style.color = 'var(--danger-red)';
        DOM.btnVoiceRecord.title = 'Click to finish and send voice note';
    } catch (err) {
        alert('Could not access microphone: ' + err.message);
    }
}

function stopVoiceRecording() {
    if (state.mediaRecorder && state.mediaRecorder.state !== 'inactive') {
        state.mediaRecorder.stop();
    }
    state.isRecordingVoice = false;
    DOM.btnVoiceRecord.style.color = '';
    DOM.btnVoiceRecord.title = 'Record Voice Note';
}

async function sendVoiceMessage(base64Audio) {
    if (!state.activePeer) return;

    const msg = {
        msgId: crypto.randomUUID(),
        senderUuid: state.profile.uuid,
        senderName: state.profile.username,
        senderDept: state.profile.department,
        recipientUuid: state.activePeer.uuid,
        recipientName: state.activePeer.username,
        recipientDept: state.activePeer.department,
        time: Date.now(),
        isOutgoing: true,
        audio: base64Audio
    };

    if (!state.conversations[state.activePeer.uuid]) {
        state.conversations[state.activePeer.uuid] = [];
    }
    state.conversations[state.activePeer.uuid].push(msg);
    await window.campusAPI.saveMessageToVault(state.activePeer.uuid, msg);

    appendMessageBubble(msg);
    scrollToBottom();
    renderPeerList();

    // Send over intranet TCP if online
    if (state.activePeer.isOnline && state.activePeer.ip) {
        await window.campusAPI.sendMessage(state.activePeer.ip, state.activePeer.port, msg);
    }
}

// ==========================================
// WebRTC Calling (Voice & Video over LAN)
// ==========================================
let ringtoneInterval = null;

function startRinging(isIncoming = false) {
    stopRinging();
    const playChime = () => {
        if (isIncoming) {
            playTone(587.33, 0.18); // D5
            setTimeout(() => playTone(880, 0.25), 160); // A5
        } else {
            playTone(440, 0.35); // A4
        }
    };
    playChime();
    ringtoneInterval = setInterval(playChime, isIncoming ? 2200 : 2800);
}

function stopRinging() {
    if (ringtoneInterval) {
        clearInterval(ringtoneInterval);
        ringtoneInterval = null;
    }
}

// Ensure ICE candidates have real LAN IPv4 addresses instead of obfuscated .local mDNS names
function sanitizeCandidate(candidateObj, senderIp) {
    if (!candidateObj || !candidateObj.candidate) return candidateObj;
    let sdp = candidateObj.candidate;
    if (senderIp && (sdp.includes('.local') || sdp.includes('.LOCAL'))) {
        sdp = sdp.replace(/[a-zA-Z0-9_-]+\.local/gi, senderIp);
        return {
            ...candidateObj,
            candidate: sdp
        };
    }
    return candidateObj;
}

async function addOrQueueIceCandidate(rawCandidate, senderIp) {
    const candidate = sanitizeCandidate(rawCandidate, senderIp);
    if (!state.rtcPeerConnection || !state.rtcPeerConnection.remoteDescription) {
        state.callCandidatesQueue.push(candidate);
        return;
    }
    try {
        await state.rtcPeerConnection.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (e) {
        console.warn('[WebRTC] addIceCandidate error:', e.message);
    }
}

async function drainIceCandidatesQueue() {
    if (!state.rtcPeerConnection || !state.rtcPeerConnection.remoteDescription) return;
    const queue = [...state.callCandidatesQueue];
    state.callCandidatesQueue = [];
    for (const cand of queue) {
        try {
            await state.rtcPeerConnection.addIceCandidate(new RTCIceCandidate(cand));
        } catch (e) {
            console.warn('[WebRTC] drain candidate error:', e.message);
        }
    }
}

function setupWebRTCPeer(isVideo, targetPeer) {
    // STUN configuration for cross-subnet NAT traversal on campus / home Wi-Fi + LAN host candidates
    const config = {
        iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
            { urls: 'stun:stun.services.mozilla.com' }
        ],
        iceCandidatePoolSize: 6
    };

    state.rtcPeerConnection = new RTCPeerConnection(config);

    if (state.localMediaStream) {
        state.localMediaStream.getTracks().forEach(track => {
            state.rtcPeerConnection.addTrack(track, state.localMediaStream);
        });
    }

    state.rtcPeerConnection.ontrack = (event) => {
        console.log('[WebRTC] Remote track received:', event.track.kind);
        stopRinging();

        const stream = (event.streams && event.streams[0]) 
            ? event.streams[0] 
            : new MediaStream([event.track]);

        if (DOM.remoteVideo) {
            DOM.remoteVideo.srcObject = stream;
            DOM.remoteVideo.play().catch(e => console.warn('Remote video playback warning:', e));
        }
        if (DOM.remoteAudio) {
            DOM.remoteAudio.srcObject = stream;
            DOM.remoteAudio.play().catch(e => console.warn('Remote audio playback warning:', e));
        }

        DOM.callStatusText.textContent = 'Connected • Call Active';
        DOM.callStatusText.style.color = 'var(--online-green)';
    };

    state.rtcPeerConnection.onicecandidate = (event) => {
        if (event.candidate && targetPeer) {
            window.campusAPI.sendCallSignal(
                targetPeer.ip,
                targetPeer.port,
                'ice-candidate',
                JSON.stringify(event.candidate)
            );
        }
    };

    state.rtcPeerConnection.oniceconnectionstatechange = () => {
        const s = state.rtcPeerConnection?.iceConnectionState;
        console.log('[WebRTC] ICE Connection State:', s);
        if (s === 'connected' || s === 'completed') {
            stopRinging();
            DOM.callStatusText.textContent = 'Connected • Call Active';
            DOM.callStatusText.style.color = 'var(--online-green)';
        } else if (s === 'disconnected') {
            DOM.callStatusText.textContent = 'Reconnecting...';
            DOM.callStatusText.style.color = 'var(--accent-orange, #ffb74d)';
        } else if (s === 'failed') {
            DOM.callStatusText.textContent = 'Connection failed';
            DOM.callStatusText.style.color = 'var(--danger-red)';
        }
    };
}

DOM.btnStartAudioCall.addEventListener('click', () => initiateCall(false));
DOM.btnStartVideoCall.addEventListener('click', () => initiateCall(true));

async function initiateCall(isVideo) {
    if (!state.activePeer) return;

    endCurrentCall(false); // Reset any lingering session

    state.currentCallPeer = {
        ip: state.activePeer.ip,
        port: state.activePeer.port || 8765,
        uuid: state.activePeer.uuid,
        username: state.activePeer.username,
        isVideo: isVideo
    };
    state.callCandidatesQueue = [];

    DOM.modalCalling.classList.remove('hidden');
    DOM.callPeerName.textContent = state.activePeer.username;
    DOM.callAvatar.textContent = (state.activePeer.username || 'P').charAt(0).toUpperCase();
    DOM.callAvatar.style.background = getAvatarColor(state.activePeer.username);
    DOM.callStatusText.textContent = `Connecting to ${state.activePeer.username}...`;
    DOM.callStatusText.style.color = '';

    if (isVideo) {
        DOM.callAudioView.classList.add('hidden');
        DOM.callVideoView.classList.remove('hidden');
    } else {
        DOM.callAudioView.classList.remove('hidden');
        DOM.callVideoView.classList.add('hidden');
    }

    try {
        try {
            state.localMediaStream = await navigator.mediaDevices.getUserMedia({
                audio: true,
                video: isVideo ? { width: { ideal: 640 }, height: { ideal: 480 } } : false
            });
        } catch (mediaErr) {
            if (isVideo) {
                console.warn('Camera failed to open, attempting audio-only fallback:', mediaErr);
                state.localMediaStream = await navigator.mediaDevices.getUserMedia({
                    audio: true,
                    video: false
                });
                isVideo = false;
                state.currentCallPeer.isVideo = false;
                DOM.callAudioView.classList.remove('hidden');
                DOM.callVideoView.classList.add('hidden');
            } else {
                throw mediaErr;
            }
        }

        if (isVideo && DOM.localVideo) {
            DOM.localVideo.srcObject = state.localMediaStream;
        }

        setupWebRTCPeer(isVideo, state.currentCallPeer);

        const offer = await state.rtcPeerConnection.createOffer({
            offerToReceiveAudio: true,
            offerToReceiveVideo: isVideo
        });
        await state.rtcPeerConnection.setLocalDescription(offer);

        await window.campusAPI.sendCallSignal(
            state.currentCallPeer.ip,
            state.currentCallPeer.port,
            'call-offer',
            JSON.stringify({ sdp: offer, isVideo: isVideo })
        );

        DOM.callStatusText.textContent = `Calling ${state.currentCallPeer.username}...`;
        startRinging(false);
    } catch (err) {
        DOM.callStatusText.textContent = 'Call Error: ' + err.message;
        DOM.callStatusText.style.color = 'var(--danger-red)';
        stopRinging();
    }
}

// Incoming Call Signaling Handler
window.campusAPI.onCallSignal(async (signal) => {
    const { signalType, senderUuid, senderName, senderDept, senderPort, senderIp, payload } = signal;

    if (signalType === 'call-offer') {
        const data = JSON.parse(payload);
        const effectivePort = senderPort || 8765;

        state.currentCallPeer = {
            ip: senderIp,
            port: effectivePort,
            uuid: senderUuid,
            username: senderName,
            department: senderDept,
            isVideo: !!data.isVideo
        };
        state.pendingIncomingCall = {
            data,
            senderIp,
            effectivePort,
            senderUuid,
            senderName
        };
        state.callCandidatesQueue = [];

        // Show Non-blocking Incoming Call Modal
        if (DOM.incomingCallAvatar) {
            DOM.incomingCallAvatar.textContent = (senderName || 'P').charAt(0).toUpperCase();
            DOM.incomingCallAvatar.style.background = getAvatarColor(senderName);
        }
        if (DOM.incomingCallName) DOM.incomingCallName.textContent = senderName;
        if (DOM.incomingCallType) DOM.incomingCallType.textContent = data.isVideo ? 'Incoming Video Call...' : 'Incoming Voice Call...';
        if (DOM.modalIncomingCall) DOM.modalIncomingCall.classList.remove('hidden');
        startRinging(true);
    }
    else if (signalType === 'call-answer') {
        stopRinging();
        const data = JSON.parse(payload);
        if (state.rtcPeerConnection) {
            await state.rtcPeerConnection.setRemoteDescription(new RTCSessionDescription(data.sdp));
            await drainIceCandidatesQueue();
            DOM.callStatusText.textContent = 'Connected • Call Active';
            DOM.callStatusText.style.color = 'var(--online-green)';
        }
    }
    else if (signalType === 'ice-candidate') {
        const candidate = JSON.parse(payload);
        await addOrQueueIceCandidate(candidate, senderIp);
    }
    else if (signalType === 'call-hangup') {
        stopRinging();
        endCurrentCall(false);
    }
});

// Incoming Call Accept / Decline Actions
if (DOM.btnIncomingAccept) {
    DOM.btnIncomingAccept.addEventListener('click', async () => {
        stopRinging();
        if (!state.pendingIncomingCall) return;
        const { data, senderIp, effectivePort, senderName } = state.pendingIncomingCall;
        DOM.modalIncomingCall.classList.add('hidden');

        DOM.modalCalling.classList.remove('hidden');
        DOM.callPeerName.textContent = senderName;
        DOM.callAvatar.textContent = (senderName || 'P').charAt(0).toUpperCase();
        DOM.callAvatar.style.background = getAvatarColor(senderName);
        DOM.callStatusText.textContent = 'Connecting...';
        DOM.callStatusText.style.color = '';

        let isVideo = !!data.isVideo;
        if (isVideo) {
            DOM.callAudioView.classList.add('hidden');
            DOM.callVideoView.classList.remove('hidden');
        } else {
            DOM.callAudioView.classList.remove('hidden');
            DOM.callVideoView.classList.add('hidden');
        }

        try {
            try {
                state.localMediaStream = await navigator.mediaDevices.getUserMedia({
                    audio: true,
                    video: isVideo ? { width: { ideal: 640 }, height: { ideal: 480 } } : false
                });
            } catch (mediaErr) {
                if (isVideo) {
                    console.warn('Camera failed to open on receiver, falling back to audio:', mediaErr);
                    state.localMediaStream = await navigator.mediaDevices.getUserMedia({
                        audio: true,
                        video: false
                    });
                    isVideo = false;
                    DOM.callAudioView.classList.remove('hidden');
                    DOM.callVideoView.classList.add('hidden');
                } else {
                    throw mediaErr;
                }
            }

            if (isVideo && DOM.localVideo) {
                DOM.localVideo.srcObject = state.localMediaStream;
            }

            setupWebRTCPeer(isVideo, state.currentCallPeer);

            await state.rtcPeerConnection.setRemoteDescription(new RTCSessionDescription(data.sdp));
            await drainIceCandidatesQueue();

            const answer = await state.rtcPeerConnection.createAnswer();
            await state.rtcPeerConnection.setLocalDescription(answer);

            await window.campusAPI.sendCallSignal(
                senderIp,
                effectivePort,
                'call-answer',
                JSON.stringify({ sdp: answer })
            );

            DOM.callStatusText.textContent = 'Connected • Call Active';
            DOM.callStatusText.style.color = 'var(--online-green)';
            state.pendingIncomingCall = null;
        } catch (err) {
            DOM.callStatusText.textContent = 'Call Error: ' + err.message;
            DOM.callStatusText.style.color = 'var(--danger-red)';
            state.pendingIncomingCall = null;
        }
    });
}

if (DOM.btnIncomingDecline) {
    DOM.btnIncomingDecline.addEventListener('click', () => {
        stopRinging();
        if (state.pendingIncomingCall) {
            const { senderIp, effectivePort } = state.pendingIncomingCall;
            window.campusAPI.sendCallSignal(senderIp, effectivePort, 'call-hangup', '{}').catch(() => {});
            state.pendingIncomingCall = null;
        }
        DOM.modalIncomingCall.classList.add('hidden');
        state.currentCallPeer = null;
    });
}

DOM.btnCallEnd.addEventListener('click', () => {
    endCurrentCall(true);
});

function endCurrentCall(sendSignal = true) {
    stopRinging();
    if (sendSignal && state.currentCallPeer) {
        window.campusAPI.sendCallSignal(state.currentCallPeer.ip, state.currentCallPeer.port, 'call-hangup', '{}').catch(() => {});
    }
    if (state.rtcPeerConnection) {
        try {
            state.rtcPeerConnection.ontrack = null;
            state.rtcPeerConnection.onicecandidate = null;
            state.rtcPeerConnection.close();
        } catch (e) {}
        state.rtcPeerConnection = null;
    }
    if (state.localMediaStream) {
        state.localMediaStream.getTracks().forEach(t => t.stop());
        state.localMediaStream = null;
    }
    if (DOM.remoteVideo) {
        DOM.remoteVideo.srcObject = null;
    }
    if (DOM.localVideo) {
        DOM.localVideo.srcObject = null;
    }
    if (DOM.remoteAudio) {
        DOM.remoteAudio.srcObject = null;
    }

    state.currentCallPeer = null;
    state.pendingIncomingCall = null;
    state.callCandidatesQueue = [];
    state.callActive = false;
    state.isAudioMuted = false;
    state.isVideoOff = false;

    DOM.btnCallMuteMic.style.background = '';
    DOM.btnCallToggleCam.style.background = '';
    DOM.modalCalling.classList.add('hidden');
    if (DOM.modalIncomingCall) {
        DOM.modalIncomingCall.classList.add('hidden');
    }
}

// Mute & Camera Toggles
DOM.btnCallMuteMic.addEventListener('click', () => {
    if (state.localMediaStream) {
        const audioTrack = state.localMediaStream.getAudioTracks()[0];
        if (audioTrack) {
            state.isAudioMuted = !state.isAudioMuted;
            audioTrack.enabled = !state.isAudioMuted;
            DOM.btnCallMuteMic.style.background = state.isAudioMuted ? 'var(--danger-red)' : '';
        }
    }
});

DOM.btnCallToggleCam.addEventListener('click', () => {
    if (state.localMediaStream) {
        const videoTrack = state.localMediaStream.getVideoTracks()[0];
        if (videoTrack) {
            state.isVideoOff = !state.isVideoOff;
            videoTrack.enabled = !state.isVideoOff;
            DOM.btnCallToggleCam.style.background = state.isVideoOff ? 'var(--danger-red)' : '';
        }
    }
});

// ==========================================
// Local Encrypted Vault Info Modal
// ==========================================
DOM.btnUserMenu.addEventListener('click', async () => {
    DOM.modalVault.classList.remove('hidden');
    const stats = await window.campusAPI.getVaultStats();
    DOM.vaultStatPath.textContent = stats.path;
    DOM.vaultStatSize.textContent = `${(stats.sizeBytes / 1024).toFixed(1)} KB`;
});

DOM.btnCloseVaultModal.addEventListener('click', () => DOM.modalVault.classList.add('hidden'));

DOM.btnOpenDownloads.addEventListener('click', () => {
    window.campusAPI.openDownloadsFolder();
});

DOM.btnLogout.addEventListener('click', async () => {
    if (confirm('Log out from this session? Your encrypted logs will stay safely stored on this laptop.')) {
        await window.campusAPI.logout();
        state.profile = null;
        DOM.modalVault.classList.add('hidden');
        showLoginView();
    }
});

// ==========================================
// Search Classmates Filter
// ==========================================
DOM.searchPeersInput.addEventListener('input', () => {
    renderPeerList();
});

// ==========================================
// UI Helpers
// ==========================================
function scrollToBottom() {
    DOM.chatMessages.scrollTop = DOM.chatMessages.scrollHeight;
}

function formatTime(timestamp) {
    const d = new Date(timestamp || Date.now());
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatBytes(bytes) {
    if (!bytes) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function getFileIconExtension(fileName) {
    if (!fileName) return 'FILE';
    const ext = fileName.split('.').pop().toUpperCase();
    return ext.length <= 4 ? ext : 'FILE';
}

function getAvatarColor(name) {
    const colors = [
        'linear-gradient(135deg, #e57373 0%, #d32f2f 100%)',
        'linear-gradient(135deg, #81c784 0%, #388e3c 100%)',
        'linear-gradient(135deg, #64b5f6 0%, #1976d2 100%)',
        'linear-gradient(135deg, #ba68c8 0%, #7b1fa2 100%)',
        'linear-gradient(135deg, #ffb74d 0%, #f57c00 100%)',
        'linear-gradient(135deg, #4dd0e1 0%, #0097a7 100%)'
    ];
    let hash = 0;
    for (let i = 0; i < (name || '').length; i++) {
        hash = name.charCodeAt(i) + ((hash << 5) - hash);
    }
    const index = Math.abs(hash) % colors.length;
    return colors[index];
}

function escapeHtml(str) {
    if (!str) return '';
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

// Synthesize Telegram notification chime using Web Audio API
function playTone(freq, duration) {
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.frequency.value = freq;
        osc.type = 'sine';
        gain.gain.setValueAtTime(0.1, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + duration);
    } catch (e) {}
}

function playAudio(base64) {
    try {
        const audio = new Audio(base64);
        audio.play();
    } catch (e) {}
}

function getTopologyBadgeClass(connType) {
    switch (connType) {
        case 'LAN ↔ LAN':
        case 'Hotspot ↔ Hotspot':
            return 'conn-lan-lan';
        case 'LAN ↔ WAN':
        case 'Ethernet ↔ Wi-Fi':
            return 'conn-lan-wan';
        case 'WAN ↔ LAN':
        case 'Wi-Fi ↔ Ethernet':
            return 'conn-wan-lan';
        case 'Hostel ↔ Campus':
        case 'WAN ↔ WAN':
            return 'conn-wan-wan';
        default:
            return (connType && (connType.includes('WAN') || connType.includes('Campus') || connType.includes('Hostel'))) ? 'conn-wan-wan' : 'conn-lan-lan';
    }
}
