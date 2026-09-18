const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('campusAPI', {
    // Vault & User session
    loadVault: () => ipcRenderer.invoke('vault:load'),
    saveVault: (data) => ipcRenderer.invoke('vault:save', data),
    login: (username, department) => ipcRenderer.invoke('vault:login', { username, department }),
    logout: () => ipcRenderer.invoke('vault:logout'),
    getVaultStats: () => ipcRenderer.invoke('vault:get-stats'),

    // Network & Peer Discovery
    getNetworkStatus: () => ipcRenderer.invoke('network:get-status'),
    connectPeer: (ip, port) => ipcRenderer.invoke('network:connect-peer', { ip, port }),
    probeSubnet: (subnetPrefix) => ipcRenderer.invoke('network:probe-subnet', { subnetPrefix }),
    scanCategory: (category) => ipcRenderer.invoke('network:scan-category', { category }),

    // Messaging & Chats
    sendMessage: (targetIp, targetPort, messageData) => ipcRenderer.invoke('chat:send-message', { targetIp, targetPort, messageData }),
    saveMessageToVault: (peerUuid, message) => ipcRenderer.invoke('chat:save-message', { peerUuid, message }),

    // High-Speed File Sharing
    selectAndSendFile: (targetIp, targetPort) => ipcRenderer.invoke('file:select-and-send', { targetIp, targetPort }),
    openFile: (filePath) => ipcRenderer.invoke('file:open', filePath),
    openDownloadsFolder: () => ipcRenderer.invoke('file:open-folder'),

    // Voice & Video Calling (WebRTC Signaling)
    sendCallSignal: (targetIp, targetPort, signalType, payload) => ipcRenderer.invoke('call:send-signal', { targetIp, targetPort, signalType, payload }),

    // Window controls
    minimizeWindow: () => ipcRenderer.send('window:minimize'),
    maximizeWindow: () => ipcRenderer.send('window:maximize'),
    closeWindow: () => ipcRenderer.send('window:close'),

    // Event listeners from backend
    onPeersUpdated: (callback) => {
        const sub = (event, data) => callback(data);
        ipcRenderer.on('peers:updated', sub);
        return () => ipcRenderer.removeListener('peers:updated', sub);
    },
    onMessageReceived: (callback) => {
        const sub = (event, data) => callback(data);
        ipcRenderer.on('chat:message-received', sub);
        return () => ipcRenderer.removeListener('chat:message-received', sub);
    },
    onFileProgress: (callback) => {
        const sub = (event, data) => callback(data);
        ipcRenderer.on('file:progress', sub);
        return () => ipcRenderer.removeListener('file:progress', sub);
    },
    onCallSignal: (callback) => {
        const sub = (event, data) => callback(data);
        ipcRenderer.on('call:signal-received', sub);
        return () => ipcRenderer.removeListener('call:signal-received', sub);
    },
    onProbeProgress: (callback) => {
        const sub = (event, data) => callback(data);
        ipcRenderer.on('probe:progress', sub);
        return () => ipcRenderer.removeListener('probe:progress', sub);
    }
});
