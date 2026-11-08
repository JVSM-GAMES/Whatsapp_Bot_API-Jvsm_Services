const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');

const envLocalPath = path.resolve(process.cwd(), '.env.local');
if (fs.existsSync(envLocalPath)) {
    dotenv.config({ path: envLocalPath });
} else {
    dotenv.config();
}

const DEFAULT_WHITELIST = [
    '127.0.0.1',
    '::1',
    '::ffff:127.0.0.1',
    '162.120.186.85',
    '38.255.123.210',
    '38.255.123.211',
    '38.255.123.212',
    '38.255.123.213',
    '38.255.123.214',
    '38.255.123.215',
    '38.255.123.216',
    '38.255.123.217',
    '38.255.123.218',
    '38.255.123.219',
    '38.255.123.220',
    '38.255.123.221',
    '38.255.123.222'
];

module.exports = {
    PORT: parseInt(process.env.APP_PORT || process.env.PORT || '10000', 10),
    BIND_IP: process.env.APP_IP || '0.0.0.0',
    API_KEY: process.env.API_KEY || '#JvAv1308*Banana23',
    WHITELIST_IPS: process.env.WHITELIST_IPS ? process.env.WHITELIST_IPS.split(',').map(s => s.trim()) : DEFAULT_WHITELIST,
    MAX_MESSAGE_LENGTH: parseInt(process.env.MAX_MESSAGE_LENGTH, 10) || 4096,
    REDIS_HOST: process.env.REDIS_HOST || '127.0.0.1',
    REDIS_PORT: parseInt(process.env.REDIS_PORT, 10) || 6379,
    REDIS_PASSWORD: process.env.REDIS_PASSWORD || undefined,
    AI_WEBHOOK_URL: process.env.AI_WEBHOOK_URL || null,
    DATA_DIR: path.join(__dirname, '..', 'data'),
    MEDIA_DIR: path.join(__dirname, '..', 'data', 'media'),
    AUTH_DIR: path.join(__dirname, '..', 'data', 'auth_info_baileys'),
    DB_PATH: path.join(__dirname, '..', 'data', 'context.db'),
    SETTINGS_FILE: path.join(__dirname, '..', 'data', 'settings.json')
};
