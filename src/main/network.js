const net = require('net');
const dgram = require('dgram');
const os = require('os');
const fs = require('fs');
const path = require('path');
const EventEmitter = require('events');

const DEFAULT_TCP_PORT = 8765;
const DEFAULT_UDP_PORT = 8766;
const MULTICAST_ADDR = '239.255.43.21';
const CHUNK_SIZE = 2 * 1024 * 1024; // 2 MB ultra high-throughput chunks for >1 Gbps line rates

class NetworkController extends EventEmitter {
    constructor() {
        super();
        this.tcpServer = null;
        this.udpSocket = null;
        this.beaconInterval = null;

        this.activeInterfaces = [];
        this.allLocalIps = new Set();
        this.networkType = 'Detecting...';
        this.localIp = this._detectNetworkInterfaces();
        this.localSubnet = this._getSubnetPrefix(this.localIp);
        this.tcpPort = DEFAULT_TCP_PORT;
        this.udpPort = DEFAULT_UDP_PORT;

        this.profile = {
            uuid: '',
            username: 'Student',
            department: 'AI & DS'
        };

        // uuid -> { uuid, username, department, ip, port, lastSeen, isOnline }
        this.peers = new Map();
        this.activeTransfers = new Map(); // fileId -> transfer info

        // Downloads directory
        this.downloadsDir = path.join(os.homedir(), 'Downloads', 'CampusConnect');
        if (!fs.existsSync(this.downloadsDir)) {
            try {
                fs.mkdirSync(this.downloadsDir, { recursive: true });
            } catch (e) {}
        }
        this.running = false;
        this.localSweepInterval = null;
        this.autoSweepInterval = null;
        this.activeSockets = new Map(); // remoteIp -> net.Socket for bi-directional NAT traversal
    }

    classifyConnection(localIp, remoteIp, isOutbound = true, viaGossip = false) {
        if (!localIp || !remoteIp || remoteIp === 'unknown') return 'LAN ↔ LAN';
        
        const cleanLocal = localIp.replace(/^.*:/, '');
        const cleanRemote = remoteIp.replace(/^.*:/, '');
        
        if (cleanLocal === '127.0.0.1' || cleanRemote === '127.0.0.1') {
            return 'LAN ↔ LAN';
        }

        const isLocalHotspot = cleanLocal.startsWith('192.168.43.') || cleanLocal.startsWith('172.20.10.') || cleanLocal.startsWith('192.168.137.');
        const isRemoteHotspot = cleanRemote.startsWith('192.168.43.') || cleanRemote.startsWith('172.20.10.') || cleanRemote.startsWith('192.168.137.');

        if (isLocalHotspot && isRemoteHotspot) {
            return 'Hotspot ↔ Hotspot';
        }

        const localParts = cleanLocal.split('.');
        const remoteParts = cleanRemote.split('.');

        if (localParts.length >= 3 && remoteParts.length >= 3) {
            // Same /24 subnet (e.g., both on same Wi-Fi AP / switch / Hotspot)
            if (localParts[0] === remoteParts[0] && 
                localParts[1] === remoteParts[1] && 
                localParts[2] === remoteParts[2]) {
                if (isLocalHotspot || isRemoteHotspot) return 'Hotspot ↔ Hotspot';
                return 'LAN ↔ LAN';
            }

            // Both peers discovered via gossip / multi-hop routing across campus WAN
            if (viaGossip) {
                return 'WAN ↔ WAN';
            }

            const isDifferentMajor = (localParts[0] !== remoteParts[0] || localParts[1] !== remoteParts[1]);
            const localSubnetNum = parseInt(localParts[2], 10);
            const remoteSubnetNum = parseInt(remoteParts[2], 10);

            // Wide Area cross-zone (e.g., between distinct hostel blocks or different IP octets)
            if (isDifferentMajor || Math.abs(localSubnetNum - remoteSubnetNum) > 12) {
                return 'Hostel ↔ Campus';
            }

            // Connection between local department LAN and campus router/server/hostel gateway
            if (isOutbound) {
                return 'Ethernet ↔ Wi-Fi';
            } else {
                return 'Wi-Fi ↔ Ethernet';
            }
        }

        return isOutbound ? 'LAN ↔ WAN' : 'WAN ↔ LAN';
    }

    _detectNetworkInterfaces() {
        const physical = [];
        const virtual = [];

        try {
            const ifaces = os.networkInterfaces();
            for (const [name, list] of Object.entries(ifaces)) {
                const isVirtualName = /vbox|virtual|vmware|wsl|loopback|pseudo|teredo|isatap|hyper-v|vethernet/i.test(name);
                for (const iface of list) {
                    if (iface.family === 'IPv4' && !iface.internal) {
                        const addr = iface.address;
                        const isPrivate = addr.startsWith('10.') || addr.startsWith('172.') || addr.startsWith('192.168.');
                        if (isPrivate) {
                            const parts = addr.split('.');
                            const subnet = `${parts[0]}.${parts[1]}.${parts[2]}`;
                            const isHotspot = addr.startsWith('192.168.43.') || 
                                              addr.startsWith('172.20.10.') || 
                                              addr.startsWith('192.168.137.');
                            const isWifi = /wi-?fi|wlan|wireless|802\.11/i.test(name);
                            const isEthernet = /ethernet|eth|lan|local area/i.test(name);

                            let typeLabel = 'LAN';
                            if (isHotspot) typeLabel = 'Mobile Hotspot';
                            else if (isWifi) typeLabel = 'Wi-Fi';
                            else if (isEthernet) typeLabel = 'Ethernet';

                            const item = {
                                name,
                                ip: addr,
                                subnet,
                                broadcast: `${subnet}.255`,
                                netmask: iface.netmask,
                                isVirtual: isVirtualName,
                                isWifi,
                                isEthernet,
                                isHotspot,
                                typeLabel
                            };

                            if (isVirtualName) {
                                virtual.push(item);
                            } else {
                                physical.push(item);
                            }
                        }
                    }
                }
            }
        } catch (e) {}

        // Prioritize Hotspots and physical adapters before virtual adapters
        physical.sort((a, b) => {
            if (a.isHotspot && !b.isHotspot) return -1;
            if (!a.isHotspot && b.isHotspot) return 1;
            if (a.isWifi && !b.isWifi) return -1;
            return 0;
        });

        const all = physical.length > 0 ? [...physical, ...virtual] : (virtual.length > 0 ? virtual : [{
            name: 'Loopback',
            ip: '127.0.0.1',
            subnet: '127.0.0',
            broadcast: '127.0.0.255',
            typeLabel: 'Offline / Localhost'
        }]);

        this.activeInterfaces = all;
        this.allLocalIps = new Set(all.map(i => i.ip));
        const primary = all[0];
        this.localIp = primary.ip;
        this.localSubnet = primary.subnet;

        // Determine overall network medium description
        const hasWifi = physical.some(i => i.isWifi || i.isHotspot);
        const hasEth = physical.some(i => i.isEthernet);
        const hasHotspot = physical.some(i => i.isHotspot);

        if (hasHotspot) {
            this.networkType = 'Mobile Hotspot';
        } else if (hasWifi && hasEth) {
            this.networkType = 'Wi-Fi + Ethernet Mesh';
        } else if (hasWifi) {
            this.networkType = 'Campus Wi-Fi';
        } else if (hasEth) {
            this.networkType = 'Ethernet LAN';
        } else {
            this.networkType = primary.typeLabel || 'Campus Intranet';
        }

        return this.localIp;
    }

    _detectLocalIPv4() {
        return this._detectNetworkInterfaces();
    }

    _getSubnetPrefix(ip) {
        if (!ip || ip === '127.0.0.1') return '10.118.231';
        const parts = ip.split('.');
        if (parts.length >= 3) {
            return `${parts[0]}.${parts[1]}.${parts[2]}`;
        }
        return '10.118.231';
    }

    start(profile, tcpPort = DEFAULT_TCP_PORT) {
        this.running = true;
        this.profile = profile;
        this.tcpPort = tcpPort;
        this._detectNetworkInterfaces();
        this.localSubnet = this._getSubnetPrefix(this.localIp);

        this._startTCPServer();
        this._startUDPDiscovery();
        this._startAutoCampusDiscovery();
    }

    stop() {
        this.running = false;
        if (this.autoSweepInterval) clearInterval(this.autoSweepInterval);
        if (this.beaconInterval) clearInterval(this.beaconInterval);
        if (this.tcpServer) {
            this.tcpServer.close();
            this.tcpServer = null;
        }
        if (this.udpSocket) {
            this.udpSocket.close();
            this.udpSocket = null;
        }
    }

    loadSavedPeers(peersList) {
        if (Array.isArray(peersList)) {
            let loadedAny = false;
            for (const p of peersList) {
                if (p.uuid && p.uuid !== this.profile.uuid) {
                    if (!this.peers.has(p.uuid)) {
                        this.peers.set(p.uuid, {
                            uuid: p.uuid,
                            username: p.username || 'Classmate',
                            department: p.department || '',
                            ip: p.ip || '',
                            port: p.port || DEFAULT_TCP_PORT,
                            connectionType: p.connectionType || 'Intranet Peer',
                            lastSeen: p.lastSeen || 0,
                            isOnline: false
                        });
                        loadedAny = true;
                    }
                    // Probe saved peer in background; if active, probePeer updates isOnline to true
                    if (p.ip) {
                        this.probePeer(p.ip, p.port || DEFAULT_TCP_PORT, 400);
                    }
                }
            }
            if (loadedAny) {
                this.emit('peers-updated', this.getPeerList());
            }
        }
    }

    updateProfile(profile) {
        this.profile = { ...this.profile, ...profile };
        this.broadcastPresence();
    }

    // ==========================================
    // TCP Server (Messaging, Files, Signaling, PEX)
    // ==========================================
    _startTCPServer() {
        this.tcpServer = net.createServer((socket) => {
            socket.setNoDelay(true);
            socket.setKeepAlive(true, 10000);

            const remoteIp = socket.remoteAddress?.replace(/^.*:/, '') || 'unknown';
            if (remoteIp !== 'unknown') {
                this.activeSockets.set(remoteIp, socket);
            }

            let buffer = Buffer.alloc(0);
            let receivingFile = null;

            socket.on('data', (chunk) => {
                if (receivingFile) {
                    // Direct binary stream with strict backpressure to support >5GB files without memory exhaustion
                    const canContinue = receivingFile.writeStream.write(chunk);
                    receivingFile.receivedBytes += chunk.length;

                    const now = Date.now();
                    const isDone = receivingFile.receivedBytes >= receivingFile.totalBytes;

                    // Throttle IPC events to 10/sec to prevent freezing Electron process
                    if (now - (receivingFile.lastProgressEmitTime || 0) >= 100 || isDone) {
                        receivingFile.lastProgressEmitTime = now;
                        const elapsedSec = (now - receivingFile.startTime) / 1000;
                        const speedMBps = elapsedSec > 0 ? (receivingFile.receivedBytes / (1024 * 1024)) / elapsedSec : 0;
                        const percent = Math.min(100, Math.round((receivingFile.receivedBytes / receivingFile.totalBytes) * 100));

                        this.emit('file-progress', {
                            fileId: receivingFile.fileId,
                            fileName: receivingFile.fileName,
                            totalBytes: receivingFile.totalBytes,
                            bytesTransferred: receivingFile.receivedBytes,
                            percent: percent,
                            speedMBps: speedMBps.toFixed(2),
                            isComplete: isDone,
                            isSender: false,
                            savePath: receivingFile.savePath
                        });
                    }

                    // Apply socket backpressure: pause socket if disk write buffer is full
                    if (!canContinue) {
                        socket.pause();
                        receivingFile.writeStream.once('drain', () => {
                            socket.resume();
                        });
                    }

                    if (isDone) {
                        receivingFile.writeStream.end();
                        receivingFile = null;
                        socket.end();
                    }
                    return;
                }

                // Accumulate packet buffer
                buffer = Buffer.concat([buffer, chunk]);
                
                // Check if we have complete newline-delimited JSON
                const newlineIdx = buffer.indexOf('\n');
                if (newlineIdx !== -1) {
                    const line = buffer.subarray(0, newlineIdx).toString('utf8');
                    buffer = buffer.subarray(newlineIdx + 1);

                    try {
                        const packet = JSON.parse(line);
                        this._handleTCPPacket(packet, socket, remoteIp, (fileHandler) => {
                            receivingFile = fileHandler;
                            // Flush any leftover binary chunk in buffer to file stream
                            if (buffer.length > 0) {
                                const leftover = buffer;
                                buffer = Buffer.alloc(0);
                                const canCont = receivingFile.writeStream.write(leftover);
                                receivingFile.receivedBytes += leftover.length;
                                if (!canCont) {
                                    socket.pause();
                                    receivingFile.writeStream.once('drain', () => {
                                        socket.resume();
                                    });
                                }
                            }
                        });
                    } catch (err) {
                        console.error('[TCP] JSON parse error:', err);
                    }
                }
            });

            socket.on('close', () => {
                if (this.activeSockets.get(remoteIp) === socket) {
                    this.activeSockets.delete(remoteIp);
                }
            });

            socket.on('error', (err) => {
                if (this.activeSockets.get(remoteIp) === socket) {
                    this.activeSockets.delete(remoteIp);
                }
            });
        });

        this.tcpServer.listen(this.tcpPort, '0.0.0.0', () => {
            console.log(`[TCP Server] Listening on ${this.localIp}:${this.tcpPort}`);
            this.emit('network-ready', { ip: this.localIp, port: this.tcpPort, subnet: this.localSubnet });
        });

        this.tcpServer.on('error', (err) => {
            console.error('[TCP Server Error]', err);
        });
    }

    _handleTCPPacket(packet, socket, remoteIp, setFileHandler) {
        const { type } = packet;
        const incomingConnType = this.classifyConnection(this.localIp, remoteIp, false, false);

        if (type === 'pex_sync') {
            // Gossip / Peer Exchange from another node
            const { uuid, username, department, port, knownPeers } = packet;
            if (uuid && uuid !== this.profile.uuid) {
                this._registerPeer({
                    uuid,
                    username,
                    department,
                    ip: remoteIp,
                    port: port || DEFAULT_TCP_PORT,
                    connectionType: incomingConnType,
                    lastSeen: Date.now(),
                    isOnline: true
                });
            }

            // Also merge any transitive peers passed in Gossip
            if (Array.isArray(knownPeers)) {
                for (const p of knownPeers) {
                    if (p.uuid && p.uuid !== this.profile.uuid) {
                        this._registerPeer({
                            ...p,
                            viaGossip: true
                        });
                    }
                }
            }

            // Reply with our own peer directory
            const myPeers = Array.from(this.peers.values()).map(p => ({
                uuid: p.uuid,
                username: p.username,
                department: p.department,
                ip: p.ip,
                port: p.port,
                connectionType: p.connectionType
            }));

            const reply = JSON.stringify({
                type: 'pex_sync_reply',
                uuid: this.profile.uuid,
                username: this.profile.username,
                department: this.profile.department,
                port: this.tcpPort,
                knownPeers: myPeers
            }) + '\n';

            socket.write(reply);
        }
        else if (type === 'pex_sync_reply') {
            const { uuid, username, department, port, knownPeers } = packet;
            if (uuid && uuid !== this.profile.uuid) {
                this._registerPeer({
                    uuid,
                    username,
                    department,
                    ip: remoteIp,
                    port: port || DEFAULT_TCP_PORT,
                    connectionType: incomingConnType,
                    lastSeen: Date.now(),
                    isOnline: true
                });
            }
            if (Array.isArray(knownPeers)) {
                for (const p of knownPeers) {
                    if (p.uuid && p.uuid !== this.profile.uuid) {
                        this._registerPeer({
                            ...p,
                            viaGossip: true
                        });
                    }
                }
            }
        }
        else if (type === 'chat_msg') {
            this.emit('message-received', {
                msgId: packet.msgId,
                senderUuid: packet.senderUuid,
                senderName: packet.senderName,
                senderDept: packet.senderDept,
                recipientUuid: this.profile.uuid,
                text: packet.text,
                time: packet.time || Date.now(),
                isOutgoing: false,
                file: packet.file || null
            });

            socket.write(JSON.stringify({ status: 'delivered' }) + '\n');
        }
        else if (type === 'file_header') {
            const { fileId, fileName, fileSize } = packet;
            const safeName = path.basename(fileName);
            const savePath = path.join(this.downloadsDir, safeName);
            // 2MB highWaterMark for direct ultra-fast disk writing
            const writeStream = fs.createWriteStream(savePath, { highWaterMark: CHUNK_SIZE });

            setFileHandler({
                fileId,
                fileName: safeName,
                totalBytes: fileSize,
                receivedBytes: 0,
                startTime: Date.now(),
                lastProgressEmitTime: 0,
                savePath,
                writeStream
            });

            socket.write(JSON.stringify({ status: 'ready' }) + '\n');
        }
        else if (type === 'call_signal') {
            this.emit('call-signal', {
                signalType: packet.signalType,
                senderUuid: packet.senderUuid,
                senderName: packet.senderName,
                senderDept: packet.senderDept,
                senderPort: packet.senderPort || this.peers.get(packet.senderUuid)?.port || DEFAULT_TCP_PORT,
                senderIp: remoteIp,
                payload: packet.payload
            });
        }
    }

    // ==========================================
    // UDP Discovery & Heartbeat
    // ==========================================
    _startUDPDiscovery() {
        this.udpSocket = dgram.createSocket({ type: 'udp4', reuseAddr: true });

        this.udpSocket.on('message', (msg, rinfo) => {
            try {
                const packet = JSON.parse(msg.toString('utf8'));
                if (packet.type === 'beacon' && packet.uuid !== this.profile.uuid) {
                    const isNew = !this.peers.has(packet.uuid);
                    const connType = this.classifyConnection(this.localIp, rinfo.address, false, false);
                    const peer = {
                        uuid: packet.uuid,
                        username: packet.username,
                        department: packet.dept,
                        ip: rinfo.address,
                        port: packet.port || DEFAULT_TCP_PORT,
                        connectionType: connType,
                        lastSeen: Date.now(),
                        isOnline: true
                    };
                    this._registerPeer(peer);

                    // If newly discovered, initiate TCP PEX gossip sync
                    if (isNew) {
                        this.connectPeer(peer.ip, peer.port);
                    }
                }
            } catch (e) {}
        });

        this.udpSocket.bind(this.udpPort, () => {
            try {
                this.udpSocket.setBroadcast(true);
                this.udpSocket.addMembership(MULTICAST_ADDR);
            } catch (e) {}
            console.log(`[UDP Discovery] Listening on port ${this.udpPort}`);
        });

        // Periodic beacon every 3 seconds
        this.broadcastPresence();
        this.beaconInterval = setInterval(() => {
            this.broadcastPresence();
            this._checkPeerHealth();
        }, 3000);
    }

    broadcastPresence() {
        if (!this.udpSocket) return;

        const beacon = Buffer.from(JSON.stringify({
            type: 'beacon',
            uuid: this.profile.uuid,
            username: this.profile.username,
            dept: this.profile.department,
            port: this.tcpPort
        }));

        // 1. Global broadcast
        this.udpSocket.send(beacon, 0, beacon.length, this.udpPort, '255.255.255.255', () => {});
        // 2. Multicast group
        this.udpSocket.send(beacon, 0, beacon.length, this.udpPort, MULTICAST_ADDR, () => {});

        // 3. Multi-interface directed broadcasts to every active physical adapter (Wi-Fi, Ethernet, Hotspot)
        if (Array.isArray(this.activeInterfaces)) {
            for (const iface of this.activeInterfaces) {
                if (iface.broadcast) {
                    this.udpSocket.send(beacon, 0, beacon.length, this.udpPort, iface.broadcast, () => {});
                }
            }
        }
    }

    _checkPeerHealth() {
        const now = Date.now();
        let changed = false;
        for (const [uuid, peer] of this.peers.entries()) {
            if (peer.isOnline && now - peer.lastSeen > 25000) {
                peer.isOnline = false;
                changed = true;
            }
        }
        if (changed) {
            this.emit('peers-updated', this.getPeerList());
        }
    }

    _registerPeer(peer) {
        if (!peer || !peer.uuid || peer.uuid === this.profile.uuid) return;
        const existing = this.peers.get(peer.uuid);

        const connType = peer.connectionType || this.classifyConnection(
            this.localIp,
            peer.ip,
            peer.isOutbound !== undefined ? peer.isOutbound : true,
            peer.viaGossip || false
        );

        this.peers.set(peer.uuid, {
            ...existing,
            ...peer,
            connectionType: connType,
            lastSeen: Date.now(),
            isOnline: true
        });
        this.emit('peers-updated', this.getPeerList());
    }

    getPeerList() {
        return Array.from(this.peers.values());
    }

    // ==========================================
    // Cross-Subnet Direct Connect & Rapid Probing
    // ==========================================
    probePeer(targetIp, targetPort = DEFAULT_TCP_PORT, timeoutMs = 250) {
        return new Promise((resolve) => {
            const socket = new net.Socket();
            let finished = false;

            const finish = (result) => {
                if (finished) return;
                finished = true;
                socket.removeAllListeners();
                socket.destroy();
                resolve(result);
            };

            socket.setTimeout(timeoutMs);
            socket.once('timeout', () => finish(false));
            socket.once('error', () => finish(false));

            socket.connect(targetPort, targetIp, () => {
                const connType = this.classifyConnection(this.localIp, targetIp, true, false);
                const myPeers = Array.from(this.peers.values()).map(p => ({
                    uuid: p.uuid,
                    username: p.username,
                    department: p.department,
                    ip: p.ip,
                    port: p.port,
                    connectionType: p.connectionType
                }));

                const pexMsg = JSON.stringify({
                    type: 'pex_sync',
                    uuid: this.profile.uuid,
                    username: this.profile.username,
                    department: this.profile.department,
                    port: this.tcpPort,
                    knownPeers: myPeers
                }) + '\n';

                socket.write(pexMsg);
                socket.setTimeout(400);

                socket.once('data', (data) => {
                    try {
                        const reply = JSON.parse(data.toString('utf8').trim());
                        if (reply.type === 'pex_sync_reply') {
                            this._registerPeer({
                                uuid: reply.uuid,
                                username: reply.username,
                                department: reply.department,
                                ip: targetIp,
                                port: reply.port || DEFAULT_TCP_PORT,
                                connectionType: connType,
                                lastSeen: Date.now(),
                                isOnline: true
                            });
                            if (Array.isArray(reply.knownPeers)) {
                                for (const p of reply.knownPeers) {
                                    if (p.uuid && p.uuid !== this.profile.uuid) {
                                        this._registerPeer({
                                            ...p,
                                            viaGossip: true
                                        });
                                    }
                                }
                            }
                        }
                    } catch (e) {}
                    finish(true);
                });
            });
        });
    }

    connectPeer(targetIp, targetPort = DEFAULT_TCP_PORT) {
        return this.probePeer(targetIp, targetPort, 1500);
    }

    _buildCandidateSubnets() {
        const subnets = new Set();

        // 1. Inspect all physical and virtual interfaces
        try {
            const ifaces = os.networkInterfaces();
            for (const name of Object.keys(ifaces)) {
                for (const iface of ifaces[name]) {
                    if (iface.family === 'IPv4' && !iface.internal) {
                        const prefix = this._getSubnetPrefix(iface.address);
                        if (prefix) subnets.add(prefix);
                    }
                }
            }
        } catch (e) {}

        // 2. Local department and nearby department subnets (±15 C-blocks)
        const parts = this.localIp.split('.');
        if (parts.length >= 3 && this.localIp !== '127.0.0.1') {
            const prefix = `${parts[0]}.${parts[1]}`;
            const currentC = parseInt(parts[2], 10);

            subnets.add(`${prefix}.${currentC}`);

            for (let offset = 1; offset <= 15; offset++) {
                if (currentC + offset <= 254) subnets.add(`${prefix}.${currentC + offset}`);
                if (currentC - offset >= 1) subnets.add(`${prefix}.${currentC - offset}`);
            }
        }

        // 3. College Department Blocks (e.g. 10.118.220 to 10.118.245)
        for (let c = 220; c <= 245; c++) {
            subnets.add(`10.118.${c}`);
        }

        // 4. College Hostel Wi-Fi Subnets (Boys & Girls Hostels, Blocks 1-12)
        for (let c = 50; c <= 150; c += 2) {
            subnets.add(`10.118.${c}`);
        }

        // 5. College Central Labs, Library, and Server Zones
        const centralSubnets = [
            '10.118.1', '10.118.2', '10.118.10', '10.118.20', '10.118.100',
            '10.119.1', '10.119.2', '10.119.10', '10.119.231',
            '172.16.1', '172.16.2', '172.16.10', '172.16.20',
            '192.168.1', '192.168.0', '192.168.43', '172.20.10', '192.168.137'
        ];
        centralSubnets.forEach(s => subnets.add(s));

        return Array.from(subnets);
    }

    // ==========================================
    // Tiered Campus & Hotspot Discovery Engine
    // ==========================================
    _startAutoCampusDiscovery() {
        this.candidateSubnets = this._buildCandidateSubnets();

        // 1. Priority Local & Hotspot Sweeper (runs immediately, then every 8s)
        const sweepLocalSubnets = async () => {
            if (!this.running) return;
            const localSubs = new Set();
            if (this.localSubnet) localSubs.add(this.localSubnet);
            if (Array.isArray(this.activeInterfaces)) {
                this.activeInterfaces.forEach(i => i.subnet && localSubs.add(i.subnet));
            }
            // Common mobile hotspot subnets
            ['192.168.43', '172.20.10', '192.168.137'].forEach(s => localSubs.add(s));

            for (const sub of localSubs) {
                if (!this.running) break;
                await this.fastProbeSubnet(sub);
            }
        };

        // Run priority local/hotspot sweep right away
        setTimeout(sweepLocalSubnets, 200);
        this.localSweepInterval = setInterval(sweepLocalSubnets, 8000);

        // 2. Sequential Non-Overlapping Campus Background Sweeper
        const runCampusBackgroundLoop = async () => {
            while (this.running) {
                for (const subnet of this.candidateSubnets) {
                    if (!this.running) break;
                    // Skip subnets already continuously handled by priority sweeper
                    if (this.activeInterfaces?.some(i => i.subnet === subnet)) continue;
                    await this.fastProbeSubnet(subnet);
                    // 150ms resting gap between C-blocks to keep Windows socket pool healthy
                    await new Promise(r => setTimeout(r, 150));
                }
                // Rest 30 seconds before beginning next full campus rotation
                await new Promise(r => setTimeout(r, 30000));
            }
        };

        setTimeout(runCampusBackgroundLoop, 2500);
    }

    async fastProbeSubnet(subnetPrefix) {
        const total = 254;
        const batchSize = 64;
        for (let i = 1; i <= total && this.running; i += batchSize) {
            const batch = [];
            for (let h = i; h < i + batchSize && h <= total; h++) {
                const ip = `${subnetPrefix}.${h}`;
                if (this.allLocalIps && this.allLocalIps.has(ip)) continue;
                if (ip === this.localIp) continue;
                batch.push(this.probePeer(ip, this.tcpPort, 180));
            }
            await Promise.all(batch);
        }
    }

    // On-demand targeted category scanner (invoked by UI for specific campus zones)
    async scanCategory(category, onProgress) {
        let subnets = [];
        if (category === 'hotspot') {
            subnets = ['192.168.43', '172.20.10', '192.168.137', '192.168.49'];
        } else if (category === 'boys-hostel') {
            for (let c = 50; c <= 100; c += 2) subnets.push(`10.118.${c}`);
        } else if (category === 'girls-hostel') {
            for (let c = 101; c <= 150; c += 2) subnets.push(`10.118.${c}`);
        } else if (category === 'departments') {
            for (let c = 220; c <= 245; c++) subnets.push(`10.118.${c}`);
        } else if (category === 'labs') {
            subnets = ['10.118.1', '10.118.2', '10.118.10', '10.118.20', '10.118.100'];
        } else if (typeof category === 'string' && category.includes('.')) {
            subnets = [category];
        }

        let totalFound = 0;
        for (const sub of subnets) {
            if (!this.running) break;
            const res = await this.probeSubnet(sub, onProgress);
            totalFound += res.found;
        }
        return { totalFound, subnetsScanned: subnets.length };
    }

    async probeSubnet(subnetPrefix, onProgress) {
        const prefix = subnetPrefix || this.localSubnet;
        const total = 254;
        let checked = 0;
        let found = 0;

        const batchSize = 64;
        for (let i = 1; i <= total; i += batchSize) {
            const batch = [];
            for (let h = i; h < i + batchSize && h <= total; h++) {
                const ip = `${prefix}.${h}`;
                if (ip === this.localIp) continue;
                batch.push(this.probePeer(ip, this.tcpPort, 200).then(ok => {
                    checked++;
                    if (ok) found++;
                    if (onProgress) {
                        onProgress({ checked, total, found, currentIp: ip });
                    }
                }));
            }
            await Promise.all(batch);
        }
        return { total, found };
    }

    // ==========================================
    // Messaging & High-Speed File Transfer
    // ==========================================
    sendMessage(targetIp, targetPort, messageData) {
        return new Promise((resolve, reject) => {
            const cleanTarget = (targetIp || '').replace(/^.*:/, '');

            // 1. Check if we already hold an open bi-directional TCP socket to this peer (NAT/Firewall traversal)
            const cachedSocket = this.activeSockets?.get(cleanTarget);
            if (cachedSocket && !cachedSocket.destroyed && cachedSocket.writable) {
                try {
                    const payload = JSON.stringify({
                        type: 'chat_msg',
                        ...messageData
                    }) + '\n';
                    cachedSocket.write(payload);
                    return resolve(true);
                } catch (e) {
                    this.activeSockets.delete(cleanTarget);
                }
            }

            // 2. Direct outbound connection
            const client = new net.Socket();
            client.setTimeout(4000);

            client.connect(targetPort, targetIp, () => {
                const payload = JSON.stringify({
                    type: 'chat_msg',
                    ...messageData
                }) + '\n';
                client.write(payload);
            });

            client.on('data', (data) => {
                client.end();
                resolve(true);
            });

            client.on('error', (err) => {
                client.destroy();
                reject(err);
            });

            client.on('timeout', () => {
                client.destroy();
                reject(new Error('Connection timed out'));
            });
        });
    }

    sendFile(targetIp, targetPort, filePath, fileId = null) {
        return new Promise((resolve, reject) => {
            if (!fs.existsSync(filePath)) {
                return reject(new Error('File does not exist'));
            }

            const stat = fs.statSync(filePath);
            const fileName = path.basename(filePath);
            const id = fileId || crypto.randomUUID();

            const client = new net.Socket();
            // Turbo socket configuration for >1 Gbps line rates
            client.setNoDelay(true);
            client.setKeepAlive(true, 10000);

            let sentBytes = 0;
            let startTime = 0;
            let lastProgressEmitTime = 0;

            client.connect(targetPort, targetIp, () => {
                // Send file header with exact 64-bit byte size (supports >5GB, 10GB, 50GB+)
                const header = JSON.stringify({
                    type: 'file_header',
                    fileId: id,
                    fileName: fileName,
                    fileSize: stat.size
                }) + '\n';
                client.write(header);
            });

            client.once('data', (ackData) => {
                // Receiver confirmed ready, stream file with 2MB chunk buffer and full backpressure
                startTime = Date.now();
                const readStream = fs.createReadStream(filePath, { highWaterMark: CHUNK_SIZE });

                readStream.on('data', (chunk) => {
                    const canContinue = client.write(chunk);
                    sentBytes += chunk.length;

                    const now = Date.now();
                    const isDone = sentBytes >= stat.size;

                    // Throttle IPC events to 10/sec to eliminate Electron UI lag
                    if (now - lastProgressEmitTime >= 100 || isDone) {
                        lastProgressEmitTime = now;
                        const elapsedSec = (now - startTime) / 1000;
                        const speedMBps = elapsedSec > 0 ? (sentBytes / (1024 * 1024)) / elapsedSec : 0;
                        const percent = Math.min(100, Math.round((sentBytes / stat.size) * 100));

                        this.emit('file-progress', {
                            fileId: id,
                            fileName: fileName,
                            totalBytes: stat.size,
                            bytesTransferred: sentBytes,
                            percent: percent,
                            speedMBps: speedMBps.toFixed(2),
                            isComplete: isDone,
                            isSender: true,
                            remoteIp: targetIp
                        });
                    }

                    // Strict backpressure: pause disk reader when network socket buffer is full
                    if (!canContinue) {
                        readStream.pause();
                        client.once('drain', () => {
                            readStream.resume();
                        });
                    }
                });

                readStream.on('end', () => {
                    const elapsedSec = (Date.now() - startTime) / 1000;
                    const speedMBps = elapsedSec > 0 ? (sentBytes / (1024 * 1024)) / elapsedSec : 0;
                    this.emit('file-progress', {
                        fileId: id,
                        fileName: fileName,
                        totalBytes: stat.size,
                        bytesTransferred: sentBytes,
                        percent: 100,
                        speedMBps: speedMBps.toFixed(2),
                        isComplete: true,
                        isSender: true,
                        remoteIp: targetIp
                    });
                    client.end();
                    resolve({ fileId: id, fileName, size: stat.size });
                });

                readStream.on('error', (err) => {
                    client.destroy();
                    reject(err);
                });
            });

            client.on('error', (err) => {
                client.destroy();
                reject(err);
            });
        });
    }

    // ==========================================
    // WebRTC Calling Signal Relay
    // ==========================================
    sendCallSignal(targetIp, targetPort = DEFAULT_TCP_PORT, signalType, payload) {
        return new Promise((resolve, reject) => {
            const cleanTarget = (targetIp || '').replace(/^.*:/, '');

            const packet = JSON.stringify({
                type: 'call_signal',
                signalType: signalType,
                senderUuid: this.profile.uuid,
                senderName: this.profile.username,
                senderDept: this.profile.department,
                senderPort: this.tcpPort,
                payload: payload
            }) + '\n';

            // 1. Check if we already hold an open bi-directional TCP socket to this peer (NAT traversal)
            const cachedSocket = this.activeSockets?.get(cleanTarget);
            if (cachedSocket && !cachedSocket.destroyed && cachedSocket.writable) {
                try {
                    cachedSocket.write(packet);
                    return resolve(true);
                } catch (e) {
                    this.activeSockets.delete(cleanTarget);
                }
            }

            // 2. Direct outbound connection
            const client = new net.Socket();
            client.setTimeout(6000);

            client.connect(targetPort || DEFAULT_TCP_PORT, targetIp, () => {
                client.write(packet);
                client.end();
                resolve(true);
            });

            client.on('error', (err) => {
                client.destroy();
                reject(err);
            });

            client.on('timeout', () => {
                client.destroy();
                reject(new Error('Call signaling timeout'));
            });
        });
    }
}

module.exports = NetworkController;
