#include "../include/campus_engine.hpp"
#include <iostream>
#include <string>

int main(int argc, char* argv[]) {
    std::cout << "=================================================" << std::endl;
    std::cout << "   CampusConnect C++ Intranet Native Engine v1.0 " << std::endl;
    std::cout << "   Cross-Subnet Peer-to-Peer Campus Network       " << std::endl;
    std::cout << "=================================================" << std::endl;

    std::string username = "Student";
    std::string department = "AI & DS";
    int port = CampusNet::DEFAULT_TCP_PORT;

    if (argc >= 2) username = argv[1];
    if (argc >= 3) department = argv[2];
    if (argc >= 4) port = std::stoi(argv[3]);

    CampusNet::Engine engine;

    engine.SetOnPeerDiscovered([](const CampusNet::PeerInfo& peer) {
        std::cout << "[PEER DISCOVERED] " << peer.username 
                  << " (" << peer.department << ") at " 
                  << peer.ip << ":" << peer.port << std::endl;
    });

    engine.SetOnMessageReceived([](const CampusNet::ChatMessage& msg) {
        std::cout << "[MESSAGE] From " << msg.senderName << ": " << msg.text << std::endl;
    });

    engine.SetOnFileProgress([](const CampusNet::FileTransferProgress& prog) {
        std::cout << "[FILE " << (prog.isSender ? "TX" : "RX") << "] " 
                  << prog.fileName << " " 
                  << (prog.bytesTransferred * 100 / (prog.totalBytes ? prog.totalBytes : 1)) << "% "
                  << "(" << prog.speedMBps << " MB/s)" << std::endl;
    });

    if (!engine.Initialize(username, department, port)) {
        std::cerr << "[ERROR] Failed to initialize Winsock / Campus Engine on port " << port << std::endl;
        return 1;
    }

    engine.StartLocalIPC(CampusNet::LOCAL_IPC_PORT);

    auto self = engine.GetLocalPeerInfo();
    std::cout << "[ACTIVE] Campus Node running as: " << self.username << " (" << self.department << ")" << std::endl;
    std::cout << "[NETWORK] Intranet IP: " << self.ip << " | Port: " << self.port << std::endl;
    std::cout << "[IPC] Local bridge listening on 127.0.0.1:" << CampusNet::LOCAL_IPC_PORT << std::endl;
    std::cout << "[READY] Press Enter or Ctrl+C to shutdown engine..." << std::endl;

    std::string line;
    std::getline(std::cin, line);

    std::cout << "[SHUTDOWN] Terminating Campus Engine..." << std::endl;
    engine.Shutdown();
    return 0;
}
