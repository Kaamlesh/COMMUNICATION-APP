#pragma once

#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif

#include <windows.h>
#include <winsock2.h>
#include <ws2tcpip.h>
#include <wincrypt.h>

#include <iostream>
#include <string>
#include <vector>
#include <unordered_map>
#include <memory>
#include <thread>
#include <mutex>
#include <atomic>
#include <chrono>
#include <functional>
#include <fstream>
#include <sstream>

namespace CampusNet {

    // Default intranet communication ports
    constexpr int DEFAULT_TCP_PORT = 8765;
    constexpr int DEFAULT_UDP_PORT = 8766;
    constexpr int LOCAL_IPC_PORT   = 49876;
    constexpr int CHUNK_SIZE       = 65536; // 64 KB file chunks

    struct PeerInfo {
        std::string uuid;
        std::string username;
        std::string department;
        std::string ip;
        int port = DEFAULT_TCP_PORT;
        uint64_t lastSeenMs = 0;
        bool isOnline = true;
    };

    struct ChatMessage {
        std::string msgId;
        std::string senderUuid;
        std::string senderName;
        std::string senderDept;
        std::string recipientUuid;
        std::string text;
        uint64_t timestampMs = 0;
        bool isOutgoing = false;
        std::string fileId;
        std::string fileName;
        uint64_t fileSize = 0;
    };

    struct FileTransferProgress {
        std::string fileId;
        std::string fileName;
        uint64_t totalBytes = 0;
        uint64_t bytesTransferred = 0;
        double speedMBps = 0.0;
        bool isComplete = false;
        bool isSender = false;
        std::string remoteIp;
        std::string localFilePath;
    };

    // Callback signatures for events
    using PeerCallback = std::function<void(const PeerInfo&)>;
    using MessageCallback = std::function<void(const ChatMessage&)>;
    using FileProgressCallback = std::function<void(const FileTransferProgress&)>;
    using CallSignalCallback = std::function<void(const std::string& type, const std::string& senderUuid, const std::string& sdpOrCandidate)>;

    class StorageVault {
    public:
        StorageVault(const std::string& vaultPath);
        bool SaveVault(const std::string& plaintextJson);
        std::string LoadVault();

    private:
        std::string m_vaultPath;
        std::mutex m_vaultMutex;
        std::string EncryptString(const std::string& plain);
        std::string DecryptString(const std::string& cipherHex);
    };

    class Engine {
    public:
        Engine();
        ~Engine();

        bool Initialize(const std::string& username, const std::string& department, int tcpPort = DEFAULT_TCP_PORT);
        void Shutdown();

        // User Identity
        void UpdateProfile(const std::string& username, const std::string& department);
        PeerInfo GetLocalPeerInfo() const;

        // Peer Discovery & Gossip across subnets
        void BroadcastPresence();
        void ProbeSubnet(const std::string& subnetPrefix, int startHost = 1, int endHost = 254);
        bool ConnectToPeer(const std::string& ip, int port = DEFAULT_TCP_PORT);
        std::vector<PeerInfo> GetActivePeers();

        // Messaging
        bool SendMessageToPeer(const std::string& targetIp, int targetPort, const ChatMessage& msg);

        // File Sharing
        std::string SendFile(const std::string& targetIp, int targetPort, const std::string& filePath);

        // WebRTC / Call Signaling
        bool SendCallSignal(const std::string& targetIp, int targetPort, const std::string& signalType, const std::string& payload);

        // Event Callbacks
        void SetOnPeerDiscovered(PeerCallback cb) { m_onPeerDiscovered = cb; }
        void SetOnMessageReceived(MessageCallback cb) { m_onMessageReceived = cb; }
        void SetOnFileProgress(FileProgressCallback cb) { m_onFileProgress = cb; }
        void SetOnCallSignal(CallSignalCallback cb) { m_onCallSignal = cb; }

        // Local IPC Server for Desktop App
        bool StartLocalIPC(int ipcPort = LOCAL_IPC_PORT);

    private:
        std::atomic<bool> m_running{false};
        PeerInfo m_selfInfo;
        int m_tcpPort = DEFAULT_TCP_PORT;
        int m_udpPort = DEFAULT_UDP_PORT;

        SOCKET m_tcpListenSocket = INVALID_SOCKET;
        SOCKET m_udpSocket = INVALID_SOCKET;

        std::mutex m_peersMutex;
        std::unordered_map<std::string, PeerInfo> m_peers; // uuid -> PeerInfo

        std::unique_ptr<StorageVault> m_vault;

        std::thread m_tcpServerThread;
        std::thread m_udpListenerThread;
        std::thread m_beaconThread;
        std::thread m_ipcThread;

        PeerCallback m_onPeerDiscovered;
        MessageCallback m_onMessageReceived;
        FileProgressCallback m_onFileProgress;
        CallSignalCallback m_onCallSignal;

        void TCPListenLoop();
        void HandleTCPClient(SOCKET clientSock, std::string clientIp);
        void UDPListenLoop();
        void BeaconLoop();
        void IPCServerLoop(int port);

        std::string DetectLocalIP();
        void ExchangePEX(SOCKET sock, bool isInitiator);
        void HandleIncomingPacket(const std::string& jsonStr, const std::string& remoteIp, SOCKET sock);
    };

} // namespace CampusNet
