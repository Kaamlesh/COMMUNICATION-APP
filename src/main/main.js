const { app, BrowserWindow, ipcMain, dialog, shell, session } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

// Enable WebRTC direct local IP gathering on LAN / Intranet (disable mDNS candidate hiding)
app.commandLine.appendSwitch('disable-features', 'WebRtcHideLocalIpsWithMdns');
// Allow autoplay of remote audio and video without user gesture
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
// Automatically grant media stream permissions for camera and mic
app.commandLine.appendSwitch('use-fake-ui-for-media-stream');

const StorageVault = require('./storage');
const NetworkController = require('./network');

let mainWindow = null;
let vault = null;
let network = null;
let cppProcess = null;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 780,
        minWidth: 850,
        minHeight: 560,
        frame: false, // Sleek modern Telegram frameless window
        backgroundColor: '#0e1621',
        title: 'CampusConnect - Intranet P2P Messenger',
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: false
        }
    });

    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));

    // Try starting C++ Native core daemon if available
    startCppEngine();
}

function startCppEngine() {
    const cppBin = path.join(__dirname, '../../cpp-core/bin/campus_core.exe');
    if (fs.existsSync(cppBin)) {
        try {
            cppProcess = spawn(cppBin, ['CampusClient', 'AI_DS', '8765'], {
                detached: false,
                stdio: 'ignore'
            });
            cppProcess.on('error', (err) => {
                console.log('[C++ Engine Daemon] Handled by internal native controller:', err.message);
            });
        } catch (e) {
            console.log('[C++ Engine Daemon] Handled by internal native controller');
        }
    }
}

app.whenReady().then(() => {
    // Automatically grant camera and microphone permissions for P2P calling
    session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
        if (['media', 'camera', 'microphone', 'notifications'].includes(permission)) {
            return callback(true);
        }
        callback(true);
    });

    session.defaultSession.setPermissionCheckHandler((webContents, permission) => {
        return true;
    });

    vault = new StorageVault();
    network = new NetworkController();

    // Wire network events to frontend
    network.on('network-ready', (netStatus) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('network:status-changed', {
                ip: network.localIp,
                port: network.tcpPort,
                subnet: network.localSubnet,
                networkType: network.networkType
            });
        }
    });

    network.on('peers-updated', (peers) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('peers:updated', peers);
        }
        // Persist and merge discovered peers in local encrypted vault without losing contacts
        try {
            const data = vault.load();
            if (!data.peers) data.peers = [];
            const peerMap = new Map();
            for (const p of data.peers) {
                if (p && p.uuid) peerMap.set(p.uuid, p);
            }
            for (const p of peers) {
                if (p && p.uuid) {
                    const prev = peerMap.get(p.uuid) || {};
                    peerMap.set(p.uuid, {
                        ...prev,
                        uuid: p.uuid,
                        username: p.username || prev.username || 'Classmate',
                        department: p.department || prev.department || '',
                        ip: p.ip || prev.ip || '',
                        port: p.port || prev.port || 8765,
                        connectionType: p.connectionType || prev.connectionType || 'Intranet Peer',
                        lastSeen: Math.max(prev.lastSeen || 0, p.lastSeen || 0)
                    });
                }
            }
            data.peers = Array.from(peerMap.values());
            vault.save(data);
        } catch (e) {}
    });

    network.on('message-received', (msg) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
            // Save to encrypted vault
            const data = vault.load();
            if (!data.conversations) data.conversations = {};
            const conversation = data.conversations[msg.senderUuid] || [];
            conversation.push(msg);
            data.conversations[msg.senderUuid] = conversation;

            // Ensure sender peer is saved in data.peers so receiver always has this chat in their list
            if (!data.peers) data.peers = [];
            const existingPeerIdx = data.peers.findIndex(p => p.uuid === msg.senderUuid);
            const peerInfo = {
                uuid: msg.senderUuid,
                username: msg.senderName || 'Classmate',
                department: msg.senderDept || '',
                ip: msg.senderIp || (existingPeerIdx >= 0 ? data.peers[existingPeerIdx].ip : ''),
                port: msg.senderPort || 8765,
                connectionType: msg.connectionType || (existingPeerIdx >= 0 ? data.peers[existingPeerIdx].connectionType : 'Intranet Peer'),
                lastSeen: msg.time || Date.now()
            };
            if (existingPeerIdx >= 0) {
                data.peers[existingPeerIdx] = { ...data.peers[existingPeerIdx], ...peerInfo };
            } else {
                data.peers.push(peerInfo);
            }

            vault.save(data);

            mainWindow.webContents.send('chat:message-received', msg);
        }
    });

    network.on('file-progress', (progress) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('file:progress', progress);
        }

        // WhatsApp-style: Automatically persist received file into chat conversation history
        if (progress.isComplete && !progress.isSender && progress.senderUuid) {
            try {
                const data = vault.load();
                if (!data.conversations) data.conversations = {};
                const conversation = data.conversations[progress.senderUuid] || [];

                // Deduplicate by fileId
                if (!conversation.some(m => m.file && m.file.id === progress.fileId)) {
                    const msg = {
                        msgId: progress.fileId,
                        senderUuid: progress.senderUuid,
                        senderName: progress.senderName || 'Classmate',
                        senderDept: progress.senderDept || '',
                        recipientUuid: network.profile.uuid,
                        time: Date.now(),
                        isOutgoing: false,
                        file: {
                            id: progress.fileId,
                            name: progress.fileName,
                            size: progress.totalBytes,
                            path: progress.savePath
                        }
                    };
                    conversation.push(msg);
                    data.conversations[progress.senderUuid] = conversation;

                    // Ensure sender is in data.peers
                    if (!data.peers) data.peers = [];
                    const pIdx = data.peers.findIndex(p => p.uuid === progress.senderUuid);
                    const peerInfo = {
                        uuid: progress.senderUuid,
                        username: progress.senderName || 'Classmate',
                        department: progress.senderDept || '',
                        ip: progress.remoteIp || '',
                        port: 8765,
                        connectionType: 'Intranet Peer',
                        lastSeen: Date.now()
                    };
                    if (pIdx >= 0) {
                        data.peers[pIdx] = { ...data.peers[pIdx], ...peerInfo };
                    } else {
                        data.peers.push(peerInfo);
                    }

                    vault.save(data);

                    if (mainWindow && !mainWindow.isDestroyed()) {
                        mainWindow.webContents.send('chat:message-received', msg);
                    }
                }
            } catch (e) {
                console.error('[Vault] Error saving received file:', e);
            }
        }
    });

    network.on('call-signal', (signal) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
            if (signal.signalType === 'call-offer') {
                if (mainWindow.isMinimized()) mainWindow.restore();
                mainWindow.show();
                mainWindow.focus();
            }
            mainWindow.webContents.send('call:signal-received', signal);
        }
    });

    setupIPC();
    createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

function setupIPC() {
    // Window Controls
    ipcMain.on('window:minimize', () => mainWindow?.minimize());
    ipcMain.on('window:maximize', () => {
        if (mainWindow?.isMaximized()) {
            mainWindow.unmaximize();
        } else {
            mainWindow?.maximize();
        }
    });
    ipcMain.on('window:close', () => mainWindow?.close());

    // Vault & User session
    ipcMain.handle('vault:load', async () => {
        const data = vault.load();
        if (!data.peers) data.peers = [];
        if (!data.conversations) data.conversations = {};

        // Auto-heal: Ensure every peer in conversations is also present in data.peers
        const peerMap = new Map();
        for (const p of data.peers) {
            if (p && p.uuid) peerMap.set(p.uuid, p);
        }
        for (const [peerUuid, msgs] of Object.entries(data.conversations)) {
            if (Array.isArray(msgs) && msgs.length > 0 && !peerMap.has(peerUuid)) {
                const incoming = msgs.find(m => !m.isOutgoing) || msgs[0];
                const peerName = (!incoming.isOutgoing ? incoming.senderName : incoming.recipientName) || 'Classmate';
                const peerDept = incoming.senderDept || incoming.recipientDept || '';
                peerMap.set(peerUuid, {
                    uuid: peerUuid,
                    username: peerName,
                    department: peerDept,
                    ip: '',
                    port: 8765,
                    connectionType: 'Intranet Peer',
                    lastSeen: msgs[msgs.length - 1]?.time || Date.now(),
                    isOnline: false
                });
            }
        }
        data.peers = Array.from(peerMap.values());
        vault.save(data);

        if (data.profile && data.profile.isLoggedIn) {
            network.start(data.profile);
            if (data.peers && data.peers.length > 0) {
                network.loadSavedPeers(data.peers);
            }
        }
        return data;
    });

    ipcMain.handle('vault:save', async (event, data) => {
        return vault.save(data);
    });

    ipcMain.handle('vault:login', async (event, { username, department }) => {
        const data = vault.load();
        if (!data.peers) data.peers = [];
        if (!data.conversations) data.conversations = {};

        data.profile.username = username;
        data.profile.department = department;
        data.profile.isLoggedIn = true;
        vault.save(data);

        network.start(data.profile);
        if (data.peers && data.peers.length > 0) {
            network.loadSavedPeers(data.peers);
        }
        return {
            success: true,
            profile: data.profile,
            conversations: data.conversations,
            peers: data.peers,
            networkStatus: { ip: network.localIp, port: network.tcpPort, subnet: network.localSubnet }
        };
    });

    ipcMain.handle('vault:logout', async () => {
        const data = vault.load();
        data.profile.isLoggedIn = false;
        vault.save(data);
        network.stop();
        return { success: true };
    });

    ipcMain.handle('vault:get-stats', async () => {
        return vault.getVaultStats();
    });

    // Network & Peer Discovery
    ipcMain.handle('network:get-status', async () => {
        return {
            ip: network.localIp,
            allInterfaces: network.activeInterfaces || [],
            networkType: network.networkType || 'Campus Intranet',
            port: network.tcpPort,
            subnet: network.localSubnet,
            peerCount: network.peers.size
        };
    });

    ipcMain.handle('network:connect-peer', async (event, { ip, port }) => {
        const cleanIp = (ip || '').trim();
        const targetPort = parseInt(port, 10) || 8765;
        const ok = await network.connectPeer(cleanIp, targetPort);
        const peer = Array.from(network.peers.values()).find(p => p.ip === cleanIp);
        return { success: ok, peer };
    });

    ipcMain.handle('network:check-peer-online', async (event, { ip, port, uuid }) => {
        if (!ip || ip === '127.0.0.1' || network.localIp === '127.0.0.1' || (network.networkType && network.networkType.includes('Offline'))) {
            if (uuid && network.peers.has(uuid)) {
                const p = network.peers.get(uuid);
                if (p.isOnline) {
                    p.isOnline = false;
                    network.peers.set(uuid, p);
                    network.emit('peers-updated', network.getPeerList());
                }
            }
            return { isOnline: false };
        }

        const isOnline = await network.probePeer(ip, port || 8765, 450);
        if (uuid && network.peers.has(uuid)) {
            const p = network.peers.get(uuid);
            if (p.isOnline !== isOnline) {
                p.isOnline = isOnline;
                if (isOnline) p.lastSeen = Date.now();
                network.peers.set(uuid, p);
                network.emit('peers-updated', network.getPeerList());
            }
        }
        return { isOnline };
    });

    ipcMain.handle('network:scan-category', async (event, { category }) => {
        const result = await network.scanCategory(category, (progress) => {
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('probe:progress', progress);
            }
        });
        return result;
    });

    ipcMain.handle('network:probe-subnet', async (event, { subnetPrefix }) => {
        network.probeSubnet(subnetPrefix, (progress) => {
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('probe:progress', progress);
            }
        });
        return { started: true };
    });

    // Messaging & Chats
    ipcMain.handle('chat:send-message', async (event, { targetIp, targetPort, messageData }) => {
        try {
            // Save to local encrypted storage first
            const data = vault.load();
            if (!data.conversations) data.conversations = {};
            const conversation = data.conversations[messageData.recipientUuid] || [];
            conversation.push(messageData);
            data.conversations[messageData.recipientUuid] = conversation;

            // Ensure recipient is saved in data.peers on sender side
            if (!data.peers) data.peers = [];
            const existingPeerIdx = data.peers.findIndex(p => p.uuid === messageData.recipientUuid);
            const peerInfo = {
                uuid: messageData.recipientUuid,
                username: messageData.recipientName || (existingPeerIdx >= 0 ? data.peers[existingPeerIdx].username : 'Classmate'),
                department: messageData.recipientDept || (existingPeerIdx >= 0 ? data.peers[existingPeerIdx].department : ''),
                ip: targetIp || (existingPeerIdx >= 0 ? data.peers[existingPeerIdx].ip : ''),
                port: targetPort || 8765,
                connectionType: existingPeerIdx >= 0 ? data.peers[existingPeerIdx].connectionType : 'Intranet Peer',
                lastSeen: messageData.time || Date.now()
            };
            if (existingPeerIdx >= 0) {
                data.peers[existingPeerIdx] = { ...data.peers[existingPeerIdx], ...peerInfo };
            } else {
                data.peers.push(peerInfo);
            }
            vault.save(data);

            // Send via network to recipient if reachable
            if (targetIp) {
                await network.sendMessage(targetIp, targetPort || 8765, messageData);
            }
            return { success: true };
        } catch (err) {
            console.error('[Chat Send Error]', err.message);
            return { success: false, error: err.message };
        }
    });

    ipcMain.handle('chat:save-message', async (event, { peerUuid, message }) => {
        const data = vault.load();
        if (!data.conversations) data.conversations = {};
        const conversation = data.conversations[peerUuid] || [];
        conversation.push(message);
        data.conversations[peerUuid] = conversation;

        if (!data.peers) data.peers = [];
        const existingPeerIdx = data.peers.findIndex(p => p.uuid === peerUuid);
        const peerInfo = {
            uuid: peerUuid,
            username: message.recipientName || message.senderName || (existingPeerIdx >= 0 ? data.peers[existingPeerIdx].username : 'Classmate'),
            department: message.recipientDept || message.senderDept || (existingPeerIdx >= 0 ? data.peers[existingPeerIdx].department : ''),
            ip: (existingPeerIdx >= 0 ? data.peers[existingPeerIdx].ip : ''),
            port: 8765,
            connectionType: existingPeerIdx >= 0 ? data.peers[existingPeerIdx].connectionType : 'Intranet Peer',
            lastSeen: message.time || Date.now()
        };
        if (existingPeerIdx >= 0) {
            data.peers[existingPeerIdx] = { ...data.peers[existingPeerIdx], ...peerInfo };
        } else {
            data.peers.push(peerInfo);
        }

        vault.save(data);
        return { success: true };
    });

    // File Sharing
    ipcMain.handle('file:select-and-send', async (event, { targetIp, targetPort }) => {
        const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
            title: 'Select File to Send Over Campus Intranet',
            properties: ['openFile']
        });

        if (canceled || !filePaths || filePaths.length === 0) {
            return { canceled: true };
        }

        const filePath = filePaths[0];
        try {
            const result = await network.sendFile(targetIp, targetPort || 8765, filePath);
            return { success: true, ...result, localPath: filePath };
        } catch (err) {
            return { success: false, error: err.message };
        }
    });

    ipcMain.handle('file:open', async (event, filePath) => {
        if (fs.existsSync(filePath)) {
            shell.openPath(filePath);
            return { success: true };
        }
        return { success: false, error: 'File not found' };
    });

    ipcMain.handle('file:open-folder', async () => {
        shell.openPath(network.downloadsDir);
        return { success: true, path: network.downloadsDir };
    });

    // WebRTC Calling
    ipcMain.handle('call:send-signal', async (event, { targetIp, targetPort, signalType, payload }) => {
        try {
            await network.sendCallSignal(targetIp, targetPort || 8765, signalType, payload);
            return { success: true };
        } catch (err) {
            return { success: false, error: err.message };
        }
    });
}

app.on('window-all-closed', () => {
    if (network) network.stop();
    if (cppProcess) cppProcess.kill();
    if (process.platform !== 'darwin') app.quit();
});
