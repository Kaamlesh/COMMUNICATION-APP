const path = require('path');
const fs = require('fs');
const StorageVault = require('./src/main/storage');

console.log('====================================================');
console.log('  Testing CampusConnect Local Encrypted Storage');
console.log('====================================================');

const testDir = path.join(__dirname, 'test_vault_dir');
const vault = new StorageVault(testDir);

console.log('[1] Initializing fresh vault...');
const initialData = vault.load();
console.log('    Default Profile:', initialData.profile);

console.log('[2] Saving user profile and sample encrypted chat logs...');
const testData = {
    profile: {
        username: 'Shiva',
        department: 'AI & DS',
        uuid: 'test-uuid-ai-ds-001',
        isLoggedIn: true
    },
    peers: [
        {
            uuid: 'peer-ece-002',
            username: 'Karthik',
            department: 'ECE',
            ip: '10.118.232.45',
            port: 8765,
            isOnline: true
        }
    ],
    conversations: {
        'peer-ece-002': [
            {
                msgId: 'msg-001',
                senderUuid: 'test-uuid-ai-ds-001',
                senderName: 'Shiva',
                text: 'Hey Karthik! Are you in ECE lab right now?',
                time: Date.now() - 60000,
                isOutgoing: true
            },
            {
                msgId: 'msg-002',
                senderUuid: 'peer-ece-002',
                senderName: 'Karthik',
                text: 'Yes! In DSP lab on 3rd floor. Connected via college LAN.',
                time: Date.now() - 30000,
                isOutgoing: false
            }
        ]
    }
};

const saveOk = vault.save(testData);
console.log('    Save success:', saveOk);

console.log('[3] Inspecting encrypted file on disk...');
const rawFileContent = fs.readFileSync(vault.getVaultPath(), 'utf8');
const parsedEnvelope = JSON.parse(rawFileContent);
console.log('    Ciphertext length:', parsedEnvelope.ciphertext.length);
console.log('    IV:', parsedEnvelope.iv);
console.log('    AuthTag:', parsedEnvelope.authTag);

const containsPlaintext = rawFileContent.includes('Karthik') || rawFileContent.includes('DSP lab');
console.log('    Contains plaintext words ("Karthik", "DSP lab")?:', containsPlaintext ? 'FAIL - INSECURE!' : 'PASS - PROPERLY ENCRYPTED!');

console.log('[4] Loading & Decrypting vault from disk...');
const loadedData = vault.load();
console.log('    Decrypted Username:', loadedData.profile.username);
console.log('    Decrypted Department:', loadedData.profile.department);
console.log('    Messages count in ECE conversation:', loadedData.conversations['peer-ece-002'].length);
console.log('    Last message text:', loadedData.conversations['peer-ece-002'][1].text);

if (loadedData.profile.username === 'Shiva' && 
    loadedData.conversations['peer-ece-002'][1].text.includes('DSP lab') &&
    !containsPlaintext) {
    console.log('\n[RESULT] ALL ENCRYPTION & LOCAL STORAGE TESTS PASSED SUCCESSFULLY! ✅');
} else {
    console.error('\n[RESULT] TESTS FAILED ❌');
    process.exit(1);
}

// Clean up test directory
fs.rmSync(testDir, { recursive: true, force: true });
console.log('Cleaned up test vault directory.');
