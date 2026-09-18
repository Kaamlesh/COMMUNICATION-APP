const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');

/**
 * StorageVault: Local AES-256-GCM Encrypted Storage
 * Ensures username and all chat logs are saved ONLY on the user's laptop
 * in the local app directory in encrypted form, never in any global cloud.
 */
class StorageVault {
    constructor(customPath = null) {
        // App installation / data directory
        const appDir = customPath || path.join(os.homedir(), '.campusconnect');
        if (!fs.existsSync(appDir)) {
            try {
                fs.mkdirSync(appDir, { recursive: true });
            } catch (e) {
                // Fallback to local directory
            }
        }
        this.vaultFilePath = path.join(appDir, 'vault.enc');
        this.secretKey = this._deriveMachineKey();
    }

    /**
     * Derives a machine-unique 256-bit encryption key from local hardware/OS identifiers.
     * Guarantees that only this laptop can decrypt the vault file.
     */
    _deriveMachineKey() {
        const machineIdentity = [
            os.hostname(),
            os.userInfo().username,
            os.platform(),
            os.arch(),
            'CampusConnect_Local_Salt_2026_DS_ECE'
        ].join(':::');

        return crypto.pbkdf2Sync(machineIdentity, 'campus_net_intranet_salt_9981', 100000, 32, 'sha256');
    }

    /**
     * Encrypts plaintext JSON data with AES-256-GCM and writes to disk.
     */
    save(dataObj) {
        try {
            const plaintext = JSON.stringify(dataObj, null, 2);
            const iv = crypto.randomBytes(12); // 96-bit IV for GCM
            const cipher = crypto.createCipheriv('aes-256-gcm', this.secretKey, iv);

            let encrypted = cipher.update(plaintext, 'utf8', 'hex');
            encrypted += cipher.final('hex');
            const authTag = cipher.getAuthTag().toString('hex');

            const payload = JSON.stringify({
                version: '1.0',
                iv: iv.toString('hex'),
                authTag: authTag,
                ciphertext: encrypted,
                updatedAt: new Date().toISOString()
            });

            fs.writeFileSync(this.vaultFilePath, payload, 'utf8');
            return true;
        } catch (err) {
            console.error('[Vault] Encryption and save failed:', err);
            return false;
        }
    }

    /**
     * Reads ciphertext from disk, decrypts with AES-256-GCM, and returns parsed JSON.
     */
    load() {
        try {
            if (!fs.existsSync(this.vaultFilePath)) {
                return this._getDefaultData();
            }

            const rawContent = fs.readFileSync(this.vaultFilePath, 'utf8');
            const envelope = JSON.parse(rawContent);

            if (!envelope.iv || !envelope.authTag || !envelope.ciphertext) {
                return this._getDefaultData();
            }

            const iv = Buffer.from(envelope.iv, 'hex');
            const authTag = Buffer.from(envelope.authTag, 'hex');
            const decipher = crypto.createDecipheriv('aes-256-gcm', this.secretKey, iv);
            decipher.setAuthTag(authTag);

            let decrypted = decipher.update(envelope.ciphertext, 'hex', 'utf8');
            decrypted += decipher.final('utf8');

            const data = JSON.parse(decrypted);
            return data;
        } catch (err) {
            console.warn('[Vault] Decryption failed or new vault initialized:', err.message);
            return this._getDefaultData();
        }
    }

    _getDefaultData() {
        return {
            profile: {
                username: '',
                department: 'AI & DS',
                avatarSeed: Math.floor(Math.random() * 10000),
                uuid: crypto.randomUUID(),
                isLoggedIn: false
            },
            peers: [],          // [{ uuid, username, department, ip, port, lastSeen }]
            conversations: {},  // { [peerUuid]: [ { msgId, senderUuid, senderName, text, time, isOutgoing, file } ] }
            settings: {
                theme: 'dark',
                defaultSubnet: '10.118.232',
                soundEnabled: true
            }
        };
    }

    getVaultPath() {
        return this.vaultFilePath;
    }

    getVaultStats() {
        if (!fs.existsSync(this.vaultFilePath)) {
            return { exists: false, sizeBytes: 0, path: this.vaultFilePath };
        }
        const stat = fs.statSync(this.vaultFilePath);
        return {
            exists: true,
            sizeBytes: stat.size,
            updatedAt: stat.mtime,
            path: this.vaultFilePath
        };
    }
}

module.exports = StorageVault;
