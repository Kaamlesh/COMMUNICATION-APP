# CampusConnect 🚀

> **Peer-to-Peer Campus Intranet Communication Desktop App (.exe)**  
> Engineered for multi-subnet college campus networks (AI&DS ↔ ECE). Operates 100% offline over campus LAN/WAN without external internet credentials.

---

## 📥 Download Application (.exe)

[![Download Windows Setup](https://img.shields.io/badge/Download-CampusConnect--Setup.exe-0078D7?style=for-the-badge&logo=windows&logoColor=white)](https://github.com/Kaamlesh/COMMUNICATION-APP/releases/latest/download/CampusConnect-Setup.exe)

Direct download links for the Windows setup installer:
- **Download Latest Setup**: [📥 CampusConnect-Setup.exe](https://github.com/Kaamlesh/COMMUNICATION-APP/releases/latest/download/CampusConnect-Setup.exe)
- **All Releases & Versions**: [📦 View GitHub Releases](https://github.com/Kaamlesh/COMMUNICATION-APP/releases)

---

## 🌟 Key Features

1. **Passwordless Login**:
   - Quick one-click login with just your **Username** and **Department** (e.g. `Shiva` in `AI & DS`, `Friend` in `ECE`).
   - No passwords or central accounts needed.

2. **Cross-Department Intranet Discovery (AI&DS ↔ ECE)**:
   - Solves the college router boundary issue where broadcast packets (`255.255.255.255`) are blocked between department subnets.
   - **Local UDP Multicast & Broadcast**: Instant zero-config discovery within the same department.
   - **Gossip / Peer Exchange (PEX)**: Connecting to a single peer automatically merges and syncs everyone's known active peer directory across departments!
   - **Subnet Prober**: Fast asynchronous sweep of adjacent department ranges (e.g. `10.118.232.1-254` for ECE).
   - **Direct IP / PIN Connect**: 1-click connect to your friend's IP (`10.118.232.45:8765`).

3. **100% Local Encrypted Storage on Your Laptop**:
   - **Zero Cloud Storage**: No messages, logs, or user profiles are ever sent to the cloud or global servers.
   - **AES-256-GCM + DPAPI Device Encryption**: Stored in `vault.enc` on your own machine.
   - Completely unreadable if opened outside the app.

4. **Telegram-Desktop User Experience**:
   - Sleek Telegram dark theme (`#0e1621` / `#17212b`), glassmorphism, responsive two-column layout.
   - Outgoing & incoming animated chat bubbles with timestamps and read checkmarks.
   - Voice message recording with animated sound waveforms.
   - Drag-and-drop peer-to-peer file sharing with live transfer speed (`MB/s`) and progress bar.
   - Full-screen or floating Voice & Video calling overlay with pulsing radar animations.

5. **C++ High-Performance Native Core**:
   - Winsock2 asynchronous sockets, multi-threaded chunked TCP file streaming, and DPAPI cryptographic vault.
   - Compiled with MSVC C++20 (`cpp-core/bin/campus_core.exe` & `campus_core.dll`).

---

## 💻 Quick Start

### 1. Installing on Your PC (Like VLC)
Run the installable Setup Wizard:
```
d:\SHIVA CN\CampusConnect-Setup.exe
```
*(or from `d:\SHIVA CN\dist\CampusConnect-Setup-1.0.0.exe`)*

- Follow the setup wizard just like VLC Media Player.
- Automatically places a **Desktop Shortcut** and **Start Menu Shortcut**.
- Installs into your user profile with an official Windows uninstaller.

### 2. Quick Launch Without Installation
If you want to run directly without installing:
```cmd
run_app.bat
```

### 3. Re-building the Installer Anytime
To re-compile the C++ backend and rebuild the setup installer:
```cmd
build_exe.bat
```

---

## 📡 Multi-Medium & Multi-Server College Campus Architecture

CampusConnect is engineered to communicate across all network mediums and college server boundaries:

### Supported Communication Mediums
- **Wi-Fi ↔ Wi-Fi**: College Wi-Fi access points or personal mobile hotspot.
- **Ethernet ↔ Wi-Fi**: One laptop plugged into lab/hostel LAN, another on campus Wi-Fi.
- **Wi-Fi ↔ Ethernet**: Reverse of above, routed seamlessly through intranet switches.
- **Ethernet ↔ Ethernet**: Direct peer-to-peer LAN cables or switch/router ports in college labs.
- **Mobile Hotspot ↔ Mobile Hotspot**: Dedicated high-speed local sweep discovers peers in < 2 seconds even when phone AP isolation blocks UDP broadcast packets.

### Multi-Server Campus Zones Supported
1. **Boys Hostel Blocks** (Subnets `10.118.50.x` – `10.118.100.x`)
2. **Girls Hostel Blocks** (Subnets `10.118.101.x` – `10.118.150.x`)
3. **Academic Departments** (CSE, IT, AI&DS, ECE, ME, CE: `10.118.220.x` – `10.118.245.x`)
4. **Central Labs, Library & Server Zones** (`10.118.1.x` – `10.118.20.x`)
5. **Private Intranet & Hotspot Ranges** (`192.168.43.x`, `172.20.10.x`, `192.168.137.x`, `192.168.1.x`)

### How to Connect Across Servers & Mediums

1. **Automatic Continuous Discovery**:
   - The app detects your active network interface (Wi-Fi, Ethernet, or Hotspot) and displays your live IP in the titlebar.
   - **Local Priority Sweeper**: Scans your local Wi-Fi or Hotspot subnet every 8 seconds in parallel chunks.
   - **Campus Background Sweeper**: Crawls college server subnets sequentially without overloading Windows sockets.
2. **Method 1 (Instant IP Search Connect)**:
   - In the sidebar search bar, simply type your friend's IP (e.g. `192.168.43.50` or `10.118.65.10`).
   - Click **Connect Now** to connect instantly!
3. **Method 2 (Direct Connect & Campus Zone Scanner Modal)**:
   - Click the **🌐 Globe Connect** icon next to the search bar.
   - View your own IP address and click **Copy IP** to send to your friend.
   - Or click any Campus Zone preset:
     - **📱 Mobile Hotspot** (`192.168.43.x`, `172.20.10.x`)
     - **🏢 Boys Hostel** (Blocks 1-8)
     - **🏠 Girls Hostel** (Blocks 1-6)
     - **🎓 Departments** (CSE / AI / IT / ECE)
     - **💻 Central Labs** (Server Zone)
4. **Gossip Protocol (PEX)**:
   - Once connected to just ONE person in Boys Hostel or Girls Hostel, their laptop automatically shares their active peer directory with you, bringing in their whole hostel or department automatically!

## 🔒 Security & Local Vault Verification

To verify that your chat logs are encrypted:
1. Open the file `~/.campusconnect/vault.enc` in Notepad.
2. You will see only encrypted ciphertext, IV, and GCM authentication tag:
   ```json
   {
     "version": "1.0",
     "iv": "5917fca36a15755adf980cc3",
     "authTag": "f9704b3af6501f5eefc2f054769d5f21",
     "ciphertext": "8dfa27184bc...",
     "updatedAt": "2026-09-17T15:26:45.123Z"
   }
   ```
3. Run the automated test script anytime:
   ```cmd
   node test_vault.js
   ```

---

## 📁 Project Structure

```
d:/SHIVA CN/
├── cpp-core/               # C++20 High-Performance Native Core
│   ├── include/
│   │   └── campus_engine.hpp
│   ├── src/
│   │   ├── campus_engine.cpp
│   │   └── main.cpp
│   ├── bin/                # Compiled C++ binaries (campus_core.exe & dll)
│   └── build_core.bat      # MSVC build script
├── src/
│   ├── main/               # Electron Main Process
│   │   ├── main.js
│   │   ├── preload.js
│   │   ├── network.js      # Intranet P2P & Cross-Subnet Gossip Controller
│   │   └── storage.js      # Local AES-256-GCM Vault Manager
│   └── renderer/           # Telegram-Style Desktop Frontend
│       ├── index.html
│       ├── styles.css
│       └── renderer.js
├── run_app.bat             # Fast Launcher
├── build_exe.bat           # Standalone .EXE Packaging Script
├── test_vault.js           # Automated Encryption & Vault Unit Test
└── package.json
```
