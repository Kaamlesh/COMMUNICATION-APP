#include "../include/campus_engine.hpp"
#include <iphlpapi.h>
#include <sstream>
#include <iomanip>
#include <random>

#pragma comment(lib, "ws2_32.lib")
#pragma comment(lib, "crypt32.lib")
#pragma comment(lib, "iphlpapi.lib")

namespace CampusNet {

    // Helper: Generate UUID
    std::string GenerateUUID() {
        static std::random_device rd;
        static std::mt19937_64 gen(rd());
        static std::uniform_int_distribution<uint64_t> dis;

        std::stringstream ss;
        ss << std::hex << std::setfill('0');
        ss << std::setw(8) << (dis(gen) & 0xFFFFFFFF) << "-";
        ss << std::setw(4) << (dis(gen) & 0xFFFF) << "-4";
        ss << std::setw(3) << (dis(gen) & 0x0FFF) << "-";
        ss << std::setw(4) << ((dis(gen) & 0x3FFF) | 0x8000) << "-";
        ss << std::setw(12) << (dis(gen) & 0xFFFFFFFFFFFF);
        return ss.str();
    }

    uint64_t GetCurrentTimeMs() {
        return std::chrono::duration_cast<std::chrono::milliseconds>(
            std::chrono::system_clock::now().time_since_epoch()
        ).count();
    }

    // Helper: Simple JSON field extraction (no external heavy JSON dependency needed in C++)
    std::string ExtractJsonField(const std::string& json, const std::string& key) {
        std::string searchKey = "\"" + key + "\"";
        size_t pos = json.find(searchKey);
        if (pos == std::string::npos) return "";

        pos = json.find(':', pos);
        if (pos == std::string::npos) return "";
        pos++;

        while (pos < json.size() && (json[pos] == ' ' || json[pos] == '\t' || json[pos] == '\r' || json[pos] == '\n')) {
            pos++;
        }

        if (pos >= json.size()) return "";

        if (json[pos] == '\"') {
            size_t end = json.find('\"', pos + 1);
            if (end == std::string::npos) return "";
            return json.substr(pos + 1, end - pos - 1);
        } else {
            size_t end = json.find_first_of(",}\r\n ", pos);
            if (end == std::string::npos) end = json.size();
            return json.substr(pos, end - pos);
        }
    }

    // ==========================================
    // StorageVault (Local DPAPI AES-256 Vault)
    // ==========================================
    StorageVault::StorageVault(const std::string& vaultPath) : m_vaultPath(vaultPath) {}

    std::string StorageVault::EncryptString(const std::string& plain) {
        DATA_BLOB dataIn;
        dataIn.pbData = (BYTE*)plain.data();
        dataIn.cbData = (DWORD)plain.size();

        DATA_BLOB dataOut;
        if (!CryptProtectData(&dataIn, L"CampusConnectLocalKey", NULL, NULL, NULL, 0, &dataOut)) {
            return "";
        }

        // Convert to hex string for safe storage
        std::stringstream ss;
        ss << std::hex << std::setfill('0');
        for (DWORD i = 0; i < dataOut.cbData; ++i) {
            ss << std::setw(2) << (int)dataOut.pbData[i];
        }

        LocalFree(dataOut.pbData);
        return ss.str();
    }

    std::string StorageVault::DecryptString(const std::string& cipherHex) {
        if (cipherHex.empty() || cipherHex.size() % 2 != 0) return "";

        std::vector<BYTE> cipherBytes;
        cipherBytes.reserve(cipherHex.size() / 2);

        for (size_t i = 0; i < cipherHex.size(); i += 2) {
            std::string byteString = cipherHex.substr(i, 2);
            BYTE b = (BYTE)strtol(byteString.c_str(), NULL, 16);
            cipherBytes.push_back(b);
        }

        DATA_BLOB dataIn;
        dataIn.pbData = cipherBytes.data();
        dataIn.cbData = (DWORD)cipherBytes.size();

        DATA_BLOB dataOut;
        if (!CryptUnprotectData(&dataIn, NULL, NULL, NULL, NULL, 0, &dataOut)) {
            return "";
        }

        std::string plain((char*)dataOut.pbData, dataOut.cbData);
        LocalFree(dataOut.pbData);
        return plain;
    }

    bool StorageVault::SaveVault(const std::string& plaintextJson) {
        std::lock_guard<std::mutex> lock(m_vaultMutex);
        std::string cipherHex = EncryptString(plaintextJson);
        if (cipherHex.empty()) return false;

        std::ofstream outFile(m_vaultPath, std::ios::binary | std::ios::trunc);
        if (!outFile.is_open()) return false;

        outFile.write(cipherHex.data(), cipherHex.size());
        outFile.close();
        return true;
    }

    std::string StorageVault::LoadVault() {
        std::lock_guard<std::mutex> lock(m_vaultMutex);
        std::ifstream inFile(m_vaultPath, std::ios::binary);
        if (!inFile.is_open()) return "";

        std::string cipherHex((std::istreambuf_iterator<char>(inFile)),
                               std::istreambuf_iterator<char>());
        inFile.close();

        return DecryptString(cipherHex);
    }

    // ==========================================
    // CampusNet Engine
    // ==========================================
    Engine::Engine() {
        m_selfInfo.uuid = GenerateUUID();
    }

    Engine::~Engine() {
        Shutdown();
    }

    std::string Engine::DetectLocalIP() {
        std::string localIP = "127.0.0.1";
        SOCKET sock = socket(AF_INET, SOCK_DGRAM, IPPROTO_UDP);
        if (sock != INVALID_SOCKET) {
            sockaddr_in loopback;
            loopback.sin_family = AF_INET;
            loopback.sin_port = htons(9); // Discard port
            inet_pton(AF_INET, "10.255.255.255", &loopback.sin_addr);

            // Connect UDP socket (does not transmit packets, but prompts OS to select interface)
            if (connect(sock, (sockaddr*)&loopback, sizeof(loopback)) == 0) {
                sockaddr_in localAddr;
                int addrLen = sizeof(localAddr);
                if (getsockname(sock, (sockaddr*)&localAddr, &addrLen) == 0) {
                    char ipBuf[INET_ADDRSTRLEN];
                    inet_ntop(AF_INET, &localAddr.sin_addr, ipBuf, sizeof(ipBuf));
                    localIP = ipBuf;
                }
            }
            closesocket(sock);
        }
        return localIP;
    }

    bool Engine::Initialize(const std::string& username, const std::string& department, int tcpPort) {
        WSADATA wsa;
        if (WSAStartup(MAKEWORD(2, 2), &wsa) != 0) {
            return false;
        }

        m_tcpPort = tcpPort;
        m_selfInfo.username = username;
        m_selfInfo.department = department;
        m_selfInfo.ip = DetectLocalIP();
        m_selfInfo.port = m_tcpPort;
        m_selfInfo.lastSeenMs = GetCurrentTimeMs();

        m_vault = std::make_unique<StorageVault>("vault.enc");
        m_running = true;

        // 1. Initialize TCP Listen Socket
        m_tcpListenSocket = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
        if (m_tcpListenSocket == INVALID_SOCKET) {
            WSACleanup();
            return false;
        }

        BOOL reuse = TRUE;
        setsockopt(m_tcpListenSocket, SOL_SOCKET, SO_REUSEADDR, (char*)&reuse, sizeof(reuse));

        sockaddr_in serverAddr{};
        serverAddr.sin_family = AF_INET;
        serverAddr.sin_addr.s_addr = INADDR_ANY;
        serverAddr.sin_port = htons(m_tcpPort);

        if (bind(m_tcpListenSocket, (sockaddr*)&serverAddr, sizeof(serverAddr)) == SOCKET_ERROR) {
            closesocket(m_tcpListenSocket);
            WSACleanup();
            return false;
        }

        if (listen(m_tcpListenSocket, SOMAXCONN) == SOCKET_ERROR) {
            closesocket(m_tcpListenSocket);
            WSACleanup();
            return false;
        }

        // 2. Initialize UDP Broadcast & Multicast Socket
        m_udpSocket = socket(AF_INET, SOCK_DGRAM, IPPROTO_UDP);
        if (m_udpSocket != INVALID_SOCKET) {
            BOOL bBroadcast = TRUE;
            setsockopt(m_udpSocket, SOL_SOCKET, SO_BROADCAST, (char*)&bBroadcast, sizeof(bBroadcast));
            setsockopt(m_udpSocket, SOL_SOCKET, SO_REUSEADDR, (char*)&reuse, sizeof(reuse));

            sockaddr_in udpAddr{};
            udpAddr.sin_family = AF_INET;
            udpAddr.sin_addr.s_addr = INADDR_ANY;
            udpAddr.sin_port = htons(m_udpPort);

            bind(m_udpSocket, (sockaddr*)&udpAddr, sizeof(udpAddr));
        }

        // Launch background threads
        m_tcpServerThread = std::thread(&Engine::TCPListenLoop, this);
        m_udpListenerThread = std::thread(&Engine::UDPListenLoop, this);
        m_beaconThread = std::thread(&Engine::BeaconLoop, this);

        // Immediate broadcast upon initialization
        BroadcastPresence();

        return true;
    }

    void Engine::Shutdown() {
        if (!m_running) return;
        m_running = false;

        if (m_tcpListenSocket != INVALID_SOCKET) {
            closesocket(m_tcpListenSocket);
            m_tcpListenSocket = INVALID_SOCKET;
        }

        if (m_udpSocket != INVALID_SOCKET) {
            closesocket(m_udpSocket);
            m_udpSocket = INVALID_SOCKET;
        }

        if (m_tcpServerThread.joinable()) m_tcpServerThread.join();
        if (m_udpListenerThread.joinable()) m_udpListenerThread.join();
        if (m_beaconThread.joinable()) m_beaconThread.join();
        if (m_ipcThread.joinable()) m_ipcThread.join();

        WSACleanup();
    }

    void Engine::UpdateProfile(const std::string& username, const std::string& department) {
        m_selfInfo.username = username;
        m_selfInfo.department = department;
        BroadcastPresence();
    }

    PeerInfo Engine::GetLocalPeerInfo() const {
        return m_selfInfo;
    }

    // ==========================================
    // Cross-Subnet Discovery & Gossip Protocol
    // ==========================================
    void Engine::BroadcastPresence() {
        if (m_udpSocket == INVALID_SOCKET) return;

        std::stringstream ss;
        ss << "{\"type\":\"beacon\","
           << "\"uuid\":\"" << m_selfInfo.uuid << "\","
           << "\"username\":\"" << m_selfInfo.username << "\","
           << "\"dept\":\"" << m_selfInfo.department << "\","
           << "\"port\":" << m_selfInfo.port << "}";
        std::string payload = ss.str();

        // 1. Send to Global Broadcast
        sockaddr_in bcastAddr{};
        bcastAddr.sin_family = AF_INET;
        bcastAddr.sin_port = htons(m_udpPort);
        inet_pton(AF_INET, "255.255.255.255", &bcastAddr.sin_addr);
        sendto(m_udpSocket, payload.c_str(), (int)payload.size(), 0, (sockaddr*)&bcastAddr, sizeof(bcastAddr));

        // 2. Send to Campus Multicast Group
        sockaddr_in mcastAddr{};
        mcastAddr.sin_family = AF_INET;
        mcastAddr.sin_port = htons(m_udpPort);
        inet_pton(AF_INET, "239.255.43.21", &mcastAddr.sin_addr);
        sendto(m_udpSocket, payload.c_str(), (int)payload.size(), 0, (sockaddr*)&mcastAddr, sizeof(mcastAddr));

        // 3. Send to Local Subnet Directed Broadcast (e.g. 10.118.231.255)
        std::string ip = m_selfInfo.ip;
        size_t lastDot = ip.find_last_of('.');
        if (lastDot != std::string::npos) {
            std::string subnetBcast = ip.substr(0, lastDot) + ".255";
            sockaddr_in subAddr{};
            subAddr.sin_family = AF_INET;
            subAddr.sin_port = htons(m_udpPort);
            inet_pton(AF_INET, subnetBcast.c_str(), &subAddr.sin_addr);
            sendto(m_udpSocket, payload.c_str(), (int)payload.size(), 0, (sockaddr*)&subAddr, sizeof(subAddr));
        }
    }

    void Engine::BeaconLoop() {
        while (m_running) {
            BroadcastPresence();

            // Heartbeat check for active peers (mark inactive if not seen for 30s)
            uint64_t now = GetCurrentTimeMs();
            {
                std::lock_guard<std::mutex> lock(m_peersMutex);
                for (auto& [uuid, peer] : m_peers) {
                    if (now - peer.lastSeenMs > 30000) {
                        peer.isOnline = false;
                    }
                }
            }

            std::this_thread::sleep_for(std::chrono::seconds(3));
        }
    }

    void Engine::UDPListenLoop() {
        char buffer[2048];
        sockaddr_in senderAddr;
        int senderLen = sizeof(senderAddr);

        while (m_running) {
            int bytesReceived = recvfrom(m_udpSocket, buffer, sizeof(buffer) - 1, 0,
                                         (sockaddr*)&senderAddr, &senderLen);
            if (bytesReceived > 0) {
                buffer[bytesReceived] = '\0';
                char senderIpBuf[INET_ADDRSTRLEN];
                inet_ntop(AF_INET, &senderAddr.sin_addr, senderIpBuf, sizeof(senderIpBuf));
                std::string senderIp = senderIpBuf;

                std::string packet(buffer);
                std::string type = ExtractJsonField(packet, "type");

                if (type == "beacon") {
                    std::string uuid = ExtractJsonField(packet, "uuid");
                    if (uuid != m_selfInfo.uuid && !uuid.empty()) {
                        PeerInfo peer;
                        peer.uuid = uuid;
                        peer.username = ExtractJsonField(packet, "username");
                        peer.department = ExtractJsonField(packet, "dept");
                        peer.ip = senderIp;
                        std::string portStr = ExtractJsonField(packet, "port");
                        peer.port = portStr.empty() ? DEFAULT_TCP_PORT : std::stoi(portStr);
                        peer.lastSeenMs = GetCurrentTimeMs();
                        peer.isOnline = true;

                        bool isNew = false;
                        {
                            std::lock_guard<std::mutex> lock(m_peersMutex);
                            if (m_peers.find(uuid) == m_peers.end()) {
                                isNew = true;
                            }
                            m_peers[uuid] = peer;
                        }

                        if (m_onPeerDiscovered) {
                            m_onPeerDiscovered(peer);
                        }

                        // If newly discovered, trigger cross-peer handshake & gossip sync!
                        if (isNew) {
                            std::thread([this, peer]() {
                                ConnectToPeer(peer.ip, peer.port);
                            }).detach();
                        }
                    }
                }
            }
        }
    }

    // Probing cross-department subnets (e.g. AI&DS 10.118.231.x -> ECE 10.118.232.x)
    void Engine::ProbeSubnet(const std::string& subnetPrefix, int startHost, int endHost) {
        std::thread([this, subnetPrefix, startHost, endHost]() {
            for (int host = startHost; host <= endHost && m_running; ++host) {
                std::string targetIp = subnetPrefix + "." + std::to_string(host);
                if (targetIp == m_selfInfo.ip) continue;

                // Fast non-blocking connect probe
                SOCKET probeSock = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
                if (probeSock == INVALID_SOCKET) continue;

                // 200ms timeout for fast campus LAN sweep
                DWORD timeoutMs = 250;
                setsockopt(probeSock, SOL_SOCKET, SO_RCVTIMEO, (char*)&timeoutMs, sizeof(timeoutMs));
                setsockopt(probeSock, SOL_SOCKET, SO_SNDTIMEO, (char*)&timeoutMs, sizeof(timeoutMs));

                sockaddr_in targetAddr{};
                targetAddr.sin_family = AF_INET;
                targetAddr.sin_port = htons(m_tcpPort);
                inet_pton(AF_INET, targetIp.c_str(), &targetAddr.sin_addr);

                if (connect(probeSock, (sockaddr*)&targetAddr, sizeof(targetAddr)) == 0) {
                    // Node is alive! Initiate PEX handshake
                    ExchangePEX(probeSock, true);
                }
                closesocket(probeSock);
            }
        }).detach();
    }

    bool Engine::ConnectToPeer(const std::string& ip, int port) {
        SOCKET sock = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
        if (sock == INVALID_SOCKET) return false;

        sockaddr_in targetAddr{};
        targetAddr.sin_family = AF_INET;
        targetAddr.sin_port = htons(port);
        inet_pton(AF_INET, ip.c_str(), &targetAddr.sin_addr);

        DWORD timeoutMs = 1500;
        setsockopt(sock, SOL_SOCKET, SO_RCVTIMEO, (char*)&timeoutMs, sizeof(timeoutMs));
        setsockopt(sock, SOL_SOCKET, SO_SNDTIMEO, (char*)&timeoutMs, sizeof(timeoutMs));

        if (connect(sock, (sockaddr*)&targetAddr, sizeof(targetAddr)) != 0) {
            closesocket(sock);
            return false;
        }

        ExchangePEX(sock, true);
        closesocket(sock);
        return true;
    }

    void Engine::ExchangePEX(SOCKET sock, bool isInitiator) {
        // Send our local peer info + known peer directory
        std::stringstream ss;
        ss << "{\"type\":\"pex_sync\","
           << "\"uuid\":\"" << m_selfInfo.uuid << "\","
           << "\"username\":\"" << m_selfInfo.username << "\","
           << "\"dept\":\"" << m_selfInfo.department << "\","
           << "\"port\":" << m_selfInfo.port << "}\n";

        std::string msg = ss.str();
        send(sock, msg.c_str(), (int)msg.size(), 0);

        // Read response
        char buf[4096];
        int bytes = recv(sock, buf, sizeof(buf) - 1, 0);
        if (bytes > 0) {
            buf[bytes] = '\0';
            std::string reply(buf);
            std::string type = ExtractJsonField(reply, "type");
            if (type == "pex_sync") {
                std::string uuid = ExtractJsonField(reply, "uuid");
                if (!uuid.empty() && uuid != m_selfInfo.uuid) {
                    PeerInfo peer;
                    peer.uuid = uuid;
                    peer.username = ExtractJsonField(reply, "username");
                    peer.department = ExtractJsonField(reply, "dept");

                    sockaddr_in peerAddr;
                    int peerLen = sizeof(peerAddr);
                    getpeername(sock, (sockaddr*)&peerAddr, &peerLen);
                    char ipBuf[INET_ADDRSTRLEN];
                    inet_ntop(AF_INET, &peerAddr.sin_addr, ipBuf, sizeof(ipBuf));
                    peer.ip = ipBuf;

                    std::string portStr = ExtractJsonField(reply, "port");
                    peer.port = portStr.empty() ? DEFAULT_TCP_PORT : std::stoi(portStr);
                    peer.lastSeenMs = GetCurrentTimeMs();
                    peer.isOnline = true;

                    {
                        std::lock_guard<std::mutex> lock(m_peersMutex);
                        m_peers[uuid] = peer;
                    }

                    if (m_onPeerDiscovered) {
                        m_onPeerDiscovered(peer);
                    }
                }
            }
        }
    }

    std::vector<PeerInfo> Engine::GetActivePeers() {
        std::lock_guard<std::mutex> lock(m_peersMutex);
        std::vector<PeerInfo> result;
        for (const auto& [uuid, peer] : m_peers) {
            result.push_back(peer);
        }
        return result;
    }

    // ==========================================
    // TCP Server Loop & Client Dispatcher
    // ==========================================
    void Engine::TCPListenLoop() {
        while (m_running) {
            sockaddr_in clientAddr;
            int clientLen = sizeof(clientAddr);
            SOCKET clientSock = accept(m_tcpListenSocket, (sockaddr*)&clientAddr, &clientLen);

            if (clientSock == INVALID_SOCKET) {
                if (!m_running) break;
                continue;
            }

            char ipBuf[INET_ADDRSTRLEN];
            inet_ntop(AF_INET, &clientAddr.sin_addr, ipBuf, sizeof(ipBuf));
            std::string clientIp = ipBuf;

            // Handle client connection in a separate detached worker thread
            std::thread([this, clientSock, clientIp]() {
                HandleTCPClient(clientSock, clientIp);
            }).detach();
        }
    }

    void Engine::HandleTCPClient(SOCKET clientSock, std::string clientIp) {
        char buffer[8192];
        int bytes = recv(clientSock, buffer, sizeof(buffer) - 1, 0);
        if (bytes <= 0) {
            closesocket(clientSock);
            return;
        }
        buffer[bytes] = '\0';
        std::string packet(buffer);

        std::string type = ExtractJsonField(packet, "type");

        if (type == "pex_sync") {
            // Register remote peer
            std::string uuid = ExtractJsonField(packet, "uuid");
            if (!uuid.empty() && uuid != m_selfInfo.uuid) {
                PeerInfo peer;
                peer.uuid = uuid;
                peer.username = ExtractJsonField(packet, "username");
                peer.department = ExtractJsonField(packet, "dept");
                peer.ip = clientIp;
                std::string portStr = ExtractJsonField(packet, "port");
                peer.port = portStr.empty() ? DEFAULT_TCP_PORT : std::stoi(portStr);
                peer.lastSeenMs = GetCurrentTimeMs();
                peer.isOnline = true;

                {
                    std::lock_guard<std::mutex> lock(m_peersMutex);
                    m_peers[uuid] = peer;
                }

                if (m_onPeerDiscovered) {
                    m_onPeerDiscovered(peer);
                }
            }

            // Reply with our own peer info
            std::stringstream ss;
            ss << "{\"type\":\"pex_sync\","
               << "\"uuid\":\"" << m_selfInfo.uuid << "\","
               << "\"username\":\"" << m_selfInfo.username << "\","
               << "\"dept\":\"" << m_selfInfo.department << "\","
               << "\"port\":" << m_selfInfo.port << "}\n";
            std::string reply = ss.str();
            send(clientSock, reply.c_str(), (int)reply.size(), 0);
        }
        else if (type == "chat_msg") {
            ChatMessage msg;
            msg.msgId = ExtractJsonField(packet, "msgId");
            msg.senderUuid = ExtractJsonField(packet, "senderUuid");
            msg.senderName = ExtractJsonField(packet, "senderName");
            msg.senderDept = ExtractJsonField(packet, "senderDept");
            msg.recipientUuid = m_selfInfo.uuid;
            msg.text = ExtractJsonField(packet, "text");
            std::string timeStr = ExtractJsonField(packet, "time");
            msg.timestampMs = timeStr.empty() ? GetCurrentTimeMs() : std::stoull(timeStr);
            msg.isOutgoing = false;

            msg.fileId = ExtractJsonField(packet, "fileId");
            msg.fileName = ExtractJsonField(packet, "fileName");
            std::string sizeStr = ExtractJsonField(packet, "fileSize");
            msg.fileSize = sizeStr.empty() ? 0 : std::stoull(sizeStr);

            if (m_onMessageReceived) {
                m_onMessageReceived(msg);
            }

            std::string ack = "{\"status\":\"ok\"}\n";
            send(clientSock, ack.c_str(), (int)ack.size(), 0);
        }
        else if (type == "file_header") {
            // High-speed chunked file receive
            std::string fileId = ExtractJsonField(packet, "fileId");
            std::string fileName = ExtractJsonField(packet, "fileName");
            std::string sizeStr = ExtractJsonField(packet, "fileSize");
            uint64_t totalSize = sizeStr.empty() ? 0 : std::stoull(sizeStr);

            std::string outPath = "received_" + fileName;
            std::ofstream outFile(outPath, std::ios::binary | std::ios::trunc);

            std::string ack = "{\"status\":\"ready\"}\n";
            send(clientSock, ack.c_str(), (int)ack.size(), 0);

            uint64_t receivedBytes = 0;
            auto startTime = std::chrono::steady_clock::now();
            char chunkBuf[CHUNK_SIZE];

            while (receivedBytes < totalSize && m_running) {
                int toRead = (int)std::min<uint64_t>(CHUNK_SIZE, totalSize - receivedBytes);
                int r = recv(clientSock, chunkBuf, toRead, 0);
                if (r <= 0) break;

                outFile.write(chunkBuf, r);
                receivedBytes += r;

                auto now = std::chrono::steady_clock::now();
                double elapsedSec = std::chrono::duration<double>(now - startTime).count();
                double speedMB = elapsedSec > 0 ? (receivedBytes / (1024.0 * 1024.0)) / elapsedSec : 0.0;

                if (m_onFileProgress) {
                    FileTransferProgress prog;
                    prog.fileId = fileId;
                    prog.fileName = fileName;
                    prog.totalBytes = totalSize;
                    prog.bytesTransferred = receivedBytes;
                    prog.speedMBps = speedMB;
                    prog.isComplete = (receivedBytes >= totalSize);
                    prog.isSender = false;
                    prog.remoteIp = clientIp;
                    prog.localFilePath = outPath;
                    m_onFileProgress(prog);
                }
            }
            outFile.close();
        }
        else if (type == "call_signal") {
            std::string signalType = ExtractJsonField(packet, "signalType");
            std::string senderUuid = ExtractJsonField(packet, "senderUuid");
            std::string payload = ExtractJsonField(packet, "payload");

            if (m_onCallSignal) {
                m_onCallSignal(signalType, senderUuid, payload);
            }
        }

        closesocket(clientSock);
    }

    // ==========================================
    // Messaging & File Sending APIs
    // ==========================================
    bool Engine::SendMessageToPeer(const std::string& targetIp, int targetPort, const ChatMessage& msg) {
        SOCKET sock = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
        if (sock == INVALID_SOCKET) return false;

        sockaddr_in targetAddr{};
        targetAddr.sin_family = AF_INET;
        targetAddr.sin_port = htons(targetPort);
        inet_pton(AF_INET, targetIp.c_str(), &targetAddr.sin_addr);

        if (connect(sock, (sockaddr*)&targetAddr, sizeof(targetAddr)) != 0) {
            closesocket(sock);
            return false;
        }

        std::stringstream ss;
        ss << "{\"type\":\"chat_msg\","
           << "\"msgId\":\"" << msg.msgId << "\","
           << "\"senderUuid\":\"" << m_selfInfo.uuid << "\","
           << "\"senderName\":\"" << m_selfInfo.username << "\","
           << "\"senderDept\":\"" << m_selfInfo.department << "\","
           << "\"text\":\"" << msg.text << "\","
           << "\"time\":\"" << msg.timestampMs << "\","
           << "\"fileId\":\"" << msg.fileId << "\","
           << "\"fileName\":\"" << msg.fileName << "\","
           << "\"fileSize\":\"" << msg.fileSize << "\"}\n";

        std::string jsonStr = ss.str();
        send(sock, jsonStr.c_str(), (int)jsonStr.size(), 0);

        closesocket(sock);
        return true;
    }

    std::string Engine::SendFile(const std::string& targetIp, int targetPort, const std::string& filePath) {
        std::ifstream inFile(filePath, std::ios::binary | std::ios::ate);
        if (!inFile.is_open()) return "";

        uint64_t fileSize = inFile.tellg();
        inFile.seekg(0, std::ios::beg);

        std::string fileName = filePath;
        size_t sep = fileName.find_last_of("\\/");
        if (sep != std::string::npos) fileName = fileName.substr(sep + 1);

        std::string fileId = GenerateUUID();

        // Send in background worker
        std::thread([this, targetIp, targetPort, filePath, fileName, fileId, fileSize]() {
            SOCKET sock = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
            if (sock == INVALID_SOCKET) return;

            sockaddr_in targetAddr{};
            targetAddr.sin_family = AF_INET;
            targetAddr.sin_port = htons(targetPort);
            inet_pton(AF_INET, targetIp.c_str(), &targetAddr.sin_addr);

            if (connect(sock, (sockaddr*)&targetAddr, sizeof(targetAddr)) != 0) {
                closesocket(sock);
                return;
            }

            std::stringstream ss;
            ss << "{\"type\":\"file_header\","
               << "\"fileId\":\"" << fileId << "\","
               << "\"fileName\":\"" << fileName << "\","
               << "\"fileSize\":\"" << fileSize << "\"}\n";
            std::string header = ss.str();
            send(sock, header.c_str(), (int)header.size(), 0);

            // Wait for receiver readiness
            char ackBuf[256];
            recv(sock, ackBuf, sizeof(ackBuf) - 1, 0);

            std::ifstream file(filePath, std::ios::binary);
            char chunk[CHUNK_SIZE];
            uint64_t sentBytes = 0;
            auto startTime = std::chrono::steady_clock::now();

            while (sentBytes < fileSize && m_running) {
                file.read(chunk, CHUNK_SIZE);
                std::streamsize bytesRead = file.gcount();
                if (bytesRead <= 0) break;

                send(sock, chunk, (int)bytesRead, 0);
                sentBytes += bytesRead;

                auto now = std::chrono::steady_clock::now();
                double elapsedSec = std::chrono::duration<double>(now - startTime).count();
                double speedMB = elapsedSec > 0 ? (sentBytes / (1024.0 * 1024.0)) / elapsedSec : 0.0;

                if (m_onFileProgress) {
                    FileTransferProgress prog;
                    prog.fileId = fileId;
                    prog.fileName = fileName;
                    prog.totalBytes = fileSize;
                    prog.bytesTransferred = sentBytes;
                    prog.speedMBps = speedMB;
                    prog.isComplete = (sentBytes >= fileSize);
                    prog.isSender = true;
                    prog.remoteIp = targetIp;
                    prog.localFilePath = filePath;
                    m_onFileProgress(prog);
                }
            }
            file.close();
            closesocket(sock);
        }).detach();

        return fileId;
    }

    bool Engine::SendCallSignal(const std::string& targetIp, int targetPort, const std::string& signalType, const std::string& payload) {
        SOCKET sock = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
        if (sock == INVALID_SOCKET) return false;

        sockaddr_in targetAddr{};
        targetAddr.sin_family = AF_INET;
        targetAddr.sin_port = htons(targetPort);
        inet_pton(AF_INET, targetIp.c_str(), &targetAddr.sin_addr);

        if (connect(sock, (sockaddr*)&targetAddr, sizeof(targetAddr)) != 0) {
            closesocket(sock);
            return false;
        }

        std::stringstream ss;
        ss << "{\"type\":\"call_signal\","
           << "\"signalType\":\"" << signalType << "\","
           << "\"senderUuid\":\"" << m_selfInfo.uuid << "\","
           << "\"payload\":\"" << payload << "\"}\n";

        std::string jsonStr = ss.str();
        send(sock, jsonStr.c_str(), (int)jsonStr.size(), 0);
        closesocket(sock);
        return true;
    }

    // ==========================================
    // Local IPC Server for Desktop App
    // ==========================================
    bool Engine::StartLocalIPC(int ipcPort) {
        m_ipcThread = std::thread(&Engine::IPCServerLoop, this, ipcPort);
        return true;
    }

    void Engine::IPCServerLoop(int port) {
        SOCKET ipcSock = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
        if (ipcSock == INVALID_SOCKET) return;

        BOOL reuse = TRUE;
        setsockopt(ipcSock, SOL_SOCKET, SO_REUSEADDR, (char*)&reuse, sizeof(reuse));

        sockaddr_in ipcAddr{};
        ipcAddr.sin_family = AF_INET;
        inet_pton(AF_INET, "127.0.0.1", &ipcAddr.sin_addr);
        ipcAddr.sin_port = htons(port);

        if (bind(ipcSock, (sockaddr*)&ipcAddr, sizeof(ipcAddr)) == SOCKET_ERROR) {
            closesocket(ipcSock);
            return;
        }

        listen(ipcSock, SOMAXCONN);

        while (m_running) {
            sockaddr_in clientAddr;
            int clientLen = sizeof(clientAddr);
            SOCKET client = accept(ipcSock, (sockaddr*)&clientAddr, &clientLen);
            if (client == INVALID_SOCKET) {
                if (!m_running) break;
                continue;
            }

            // IPC Connection handler
            std::thread([this, client]() {
                char buffer[16384];
                while (m_running) {
                    int bytes = recv(client, buffer, sizeof(buffer) - 1, 0);
                    if (bytes <= 0) break;
                    buffer[bytes] = '\0';

                    std::string cmd(buffer);
                    std::string action = ExtractJsonField(cmd, "action");

                    if (action == "get_self") {
                        std::stringstream ss;
                        ss << "{\"uuid\":\"" << m_selfInfo.uuid << "\","
                           << "\"username\":\"" << m_selfInfo.username << "\","
                           << "\"dept\":\"" << m_selfInfo.department << "\","
                           << "\"ip\":\"" << m_selfInfo.ip << "\","
                           << "\"port\":" << m_selfInfo.port << "}\n";
                        std::string reply = ss.str();
                        send(client, reply.c_str(), (int)reply.size(), 0);
                    }
                    else if (action == "get_peers") {
                        auto peers = GetActivePeers();
                        std::stringstream ss;
                        ss << "[";
                        for (size_t i = 0; i < peers.size(); ++i) {
                            if (i > 0) ss << ",";
                            ss << "{\"uuid\":\"" << peers[i].uuid << "\","
                               << "\"username\":\"" << peers[i].username << "\","
                               << "\"dept\":\"" << peers[i].department << "\","
                               << "\"ip\":\"" << peers[i].ip << "\","
                               << "\"port\":" << peers[i].port << ","
                               << "\"online\":" << (peers[i].isOnline ? "true" : "false") << "}";
                        }
                        ss << "]\n";
                        std::string reply = ss.str();
                        send(client, reply.c_str(), (int)reply.size(), 0);
                    }
                    else if (action == "probe_subnet") {
                        std::string prefix = ExtractJsonField(cmd, "prefix");
                        ProbeSubnet(prefix.empty() ? "10.118.232" : prefix);
                        std::string reply = "{\"status\":\"probing_started\"}\n";
                        send(client, reply.c_str(), (int)reply.size(), 0);
                    }
                    else if (action == "connect_peer") {
                        std::string ip = ExtractJsonField(cmd, "ip");
                        std::string portStr = ExtractJsonField(cmd, "port");
                        int port = portStr.empty() ? DEFAULT_TCP_PORT : std::stoi(portStr);
                        bool ok = ConnectToPeer(ip, port);
                        std::string reply = ok ? "{\"status\":\"connected\"}\n" : "{\"status\":\"failed\"}\n";
                        send(client, reply.c_str(), (int)reply.size(), 0);
                    }
                    else if (action == "save_vault") {
                        std::string data = ExtractJsonField(cmd, "data");
                        bool ok = m_vault->SaveVault(data);
                        std::string reply = ok ? "{\"status\":\"saved\"}\n" : "{\"status\":\"error\"}\n";
                        send(client, reply.c_str(), (int)reply.size(), 0);
                    }
                    else if (action == "load_vault") {
                        std::string data = m_vault->LoadVault();
                        std::string reply = "{\"vault\":\"" + data + "\"}\n";
                        send(client, reply.c_str(), (int)reply.size(), 0);
                    }
                }
                closesocket(client);
            }).detach();
        }

        closesocket(ipcSock);
    }

} // namespace CampusNet
