const express = require('express');
const multer = require('multer');
const path = require('path');
const { MEDIA_DIR, PORT, BIND_IP, WHITELIST_IPS } = require('./config');
const { apiKeyAuth } = require('./auth.middleware');
const messageController = require('./message.controller');
const whatsappService = require('./whatsapp.service');

// Inicializa o Worker BullMQ no mesmo processo
require('./message.worker');

const app = express();
app.use(express.json());
app.set('trust proxy', true);

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, MEDIA_DIR),
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
        const ext = path.extname(file.originalname) || '';
        cb(null, `${uniqueSuffix}${ext}`);
    }
});
const upload = multer({ storage });

// Autenticação Inteligente (Whitelist IP + Header/Query API Key)
app.use(apiKeyAuth);

// --- ROTAS LEGADAS (100% Retrocompatíveis com suas APIs antigas) ---
app.get('/', (_, res) => res.send('ok'));
app.post('/enviar-whatsapp', (req, res) => messageController.sendLegacyMessage(req, res));
app.post('/enviar-mensagem', (req, res) => messageController.sendLegacyMessage(req, res));
app.post('/send-text', (req, res) => messageController.sendLegacySimpleText(req, res));
app.post('/send-programmable', (req, res) => messageController.sendProgrammable(req, res));
app.get('/settings', (req, res) => messageController.getSettingsPage(req, res));
app.post('/settings', (req, res) => messageController.updateSettings(req, res));

// --- ROTAS MODERNAS (v0.5 - IA, Mídia, Enquetes, Reações e Histórico SQLite) ---
app.get('/qr', (req, res) => messageController.getQrCode(req, res));
app.get('/check-number/:phone', (req, res) => messageController.checkNumber(req, res));
app.get('/groups', (req, res) => messageController.listGroups(req, res));
app.post('/message', (req, res) => messageController.sendTextMessage(req, res));
app.post('/message/verify-code', (req, res) => messageController.sendVerificationCode(req, res));
app.post('/message/react', (req, res) => messageController.sendReaction(req, res));
app.post('/message/poll', (req, res) => messageController.sendPoll(req, res));
app.post('/message/media', upload.single('file'), (req, res) => messageController.sendMediaMessage(req, res));
app.post('/message/audio', upload.single('file'), (req, res) => messageController.sendVoiceMessage(req, res));
app.post('/webhook', (req, res) => messageController.handleWebhook(req, res));
app.get('/media/:filename', (req, res) => messageController.serveMedia(req, res));
app.get('/conversations', (req, res) => messageController.listConversations(req, res));
app.get('/conversations/:jid', (req, res) => messageController.getHistory(req, res));

whatsappService.init();

const host = BIND_IP !== '0.0.0.0' ? BIND_IP : '0.0.0.0';
app.listen(PORT, host, () => {
    console.log(`🚀 [API] WhatsApp Bot API v0.5 Unified ouvindo em http://${host}:${PORT}`);
    console.log(`🛡️ [Whitelist IPs]: ${WHITELIST_IPS.join(', ')}`);
});

module.exports = app;
