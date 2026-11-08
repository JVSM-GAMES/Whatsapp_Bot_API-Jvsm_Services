const whaileys = require('whaileys');
const makeWASocket = whaileys.default || whaileys.makeWASocket || whaileys;
const {
    useMultiFileAuthState,
    DisconnectReason,
    downloadMediaMessage,
    generateWAMessageFromContent
} = whaileys;
const https = require('https');
const pino = require('pino');
const qrcodeTerminal = require('qrcode-terminal');
const QRCode = require('qrcode');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { AUTH_DIR, MEDIA_DIR, MAX_MESSAGE_LENGTH, AI_WEBHOOK_URL, SETTINGS_FILE, BIND_IP } = require('./config');
const messageRepository = require('./message.repository');

const networkAgent =
    BIND_IP && BIND_IP !== '0.0.0.0'
        ? new https.Agent({
              localAddress: BIND_IP,
              keepAlive: true,
              family: 4
          })
        : new https.Agent({
              keepAlive: true,
              family: 4
          });

class WhatsAppService {
    constructor() {
        this.sock = null;
        this.qrCode = null;
        this.qrCodeDataUrl = null;
        this.isConnected = false;
        this.isReconnecting = false;

        this.actionMap = new Map();
        this.userState = new Map();

        this.settings = { allowGroups: true, blockedNumbers: [] };
        this._loadSettings();

        if (!fs.existsSync(AUTH_DIR)) fs.mkdirSync(AUTH_DIR, { recursive: true });
        if (!fs.existsSync(MEDIA_DIR)) fs.mkdirSync(MEDIA_DIR, { recursive: true });
    }

    _loadSettings() {
        if (fs.existsSync(SETTINGS_FILE)) {
            try {
                this.settings = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8'));
            } catch (e) {
                console.warn('[Settings] Falha ao carregar settings.json, usando padrão.');
            }
        }
    }

    saveSettings(newSettings) {
        if (typeof newSettings.allowGroups === 'boolean') {
            this.settings.allowGroups = newSettings.allowGroups;
        }
        if (Array.isArray(newSettings.blockedNumbers)) {
            this.settings.blockedNumbers = newSettings.blockedNumbers;
        }
        fs.writeFileSync(SETTINGS_FILE, JSON.stringify(this.settings, null, 2));
        return this.settings;
    }

    _sleep(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    _randomDelay(min = 1000, max = 3000) {
        return Math.floor(Math.random() * (max - min + 1)) + min;
    }

    _processVariables(data, phone, nickname, input = '') {
        if (!data) return data;
        let jsonString = JSON.stringify(data);
        const safeInput = input ? input.toString() : '';
        jsonString = jsonString
            .replace(/\$Phone\$/g, phone)
            .replace(/\$NickName\$/g, nickname || 'Cliente')
            .replace(/\$Input\$/g, safeInput);
        return JSON.parse(jsonString);
    }

    _replaceStringVars(text, phone, nickname, input = '') {
        const safeInput = input ? input.toString() : '';
        return String(text)
            .replace(/\$Phone\$/g, phone)
            .replace(/\$NickName\$/g, nickname || 'Cliente')
            .replace(/\$Input\$/g, safeInput);
    }

    async _triggerDynamicWebhook(config, remoteJid, phone, name, input = '') {
        const finalHeaders = this._processVariables(config.headers, phone, name, input);
        const finalBody = this._processVariables(config.body, phone, name, input);

        try {
            const response = await fetch(config.url, {
                method: config.method || 'POST',
                headers: { 'Content-Type': 'application/json', ...finalHeaders },
                body: config.method !== 'GET' ? JSON.stringify(finalBody) : undefined
            });

            if (config.feedback && this.sock) {
                let finalText = config.feedbackText || `✅ Status: ${response.status}`;
                finalText = this._replaceStringVars(finalText, phone, name, input);
                await this.sendTextMessage(remoteJid, finalText);
            }
        } catch (err) {
            if (config.feedback && this.sock) {
                await this.sendTextMessage(remoteJid, '❌ Erro no processamento.');
            }
        }
    }

    async resolveJid(to) {
        if (!this.sock || !this.isConnected) {
            throw new Error('Bot offline ou não pareado.');
        }

        const cleanInput = String(to).trim();
        if (cleanInput.endsWith('@g.us')) {
            return cleanInput;
        }

        let numeroLimpo = cleanInput.replace(/@s\.whatsapp\.net$/, '').replace(/\D/g, '');
        if (!numeroLimpo || numeroLimpo.length < 10) {
            throw new Error(`Número de telefone inválido: ${to}`);
        }

        let numeroSemNove = numeroLimpo;
        if (numeroLimpo.length === 13 && numeroLimpo.startsWith('55') && numeroLimpo[4] === '9') {
            numeroSemNove = numeroLimpo.slice(0, 4) + numeroLimpo.slice(5);
        } else if (numeroLimpo.length === 12 && numeroLimpo.startsWith('55')) {
            numeroLimpo = numeroLimpo.slice(0, 4) + '9' + numeroLimpo.slice(4);
        }

        const jidSemNove = `${numeroSemNove}@s.whatsapp.net`;
        const jidComNove = `${numeroLimpo}@s.whatsapp.net`;

        let finalJid = null;
        try {
            const [resultSem] = await this.sock.onWhatsApp(jidSemNove);
            if (resultSem?.exists) {
                finalJid = resultSem.jid;
            } else {
                const [resultCom] = await this.sock.onWhatsApp(jidComNove);
                if (resultCom?.exists) {
                    finalJid = resultCom.jid;
                }
            }
        } catch (waError) {
            console.warn(`[WhatsApp] Aviso: Timeout no onWhatsApp. Usando fallback: ${jidComNove}`);
            finalJid = jidComNove;
        }

        if (!finalJid) {
            const err = new Error('O número de telefone não possui conta ativa no WhatsApp.');
            err.statusCode = 404;
            throw err;
        }

        return finalJid;
    }

    async simulateHumanPresence(jid, state = 'composing', textLength = 0) {
        if (!this.sock || !this.isConnected) return;

        try {
            await this.sock.sendPresenceUpdate('available', jid);
            await this._sleep(this._randomDelay(800, 1900));
            await this.sock.sendPresenceUpdate(state, jid);

            let duration;
            if (state === 'composing' && textLength > 0) {
                const baseTypingMs = Math.min(Math.max(textLength * 50, 1600), 10000);
                const jitter = this._randomDelay(-300, 1100);
                duration = Math.max(1400, baseTypingMs + jitter);
            } else if (state === 'recording') {
                duration = this._randomDelay(3000, 6000);
            } else {
                duration = this._randomDelay(1800, 3500);
            }

            await this._sleep(duration);
            await this.sock.sendPresenceUpdate('paused', jid);
            await this._sleep(this._randomDelay(250, 650));
        } catch (e) {}
    }

    async init() {
        try {
            // Limpa listeners de socket antigo caso esteja reconectando
            if (this.sock) {
                try {
                    this.sock.ev.removeAllListeners();
                    this.sock.ws?.close();
                } catch (e) {}
                this.sock = null;
            }

            const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);

            this.sock = makeWASocket({
                auth: state,
                logger: pino({ level: 'silent' }),
                printQRInTerminal: false,
                syncFullHistory: false,
                markOnlineOnConnect: false,
                connectTimeoutMs: 60000,
                defaultQueryTimeoutMs: 60000,
                keepAliveIntervalMs: 15000,
                emitOwnEvents: false,
                retryRequestDelayMs: 350,
                browser: ['Jvsm Services Site', 'Chrome', '10.1'],
                agent: networkAgent,
                fetchAgent: networkAgent
            });

            this.sock.ev.on('creds.update', saveCreds);

            this.sock.ev.on('connection.update', async (update) => {
                const { connection, lastDisconnect, qr } = update;

                if (qr) {
                    this.qrCode = qr;
                    this.qrCodeDataUrl = await QRCode.toDataURL(qr).catch(() => null);
                    console.log('\n📱 [WhatsApp] Escaneie o QR Code abaixo ou acesse GET /qr no navegador:');
                    qrcodeTerminal.generate(qr, { small: true });
                }

                if (connection === 'close') {
                    this.isConnected = false;
                    const statusCode = lastDisconnect?.error?.output?.statusCode;
                    const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
                    console.warn(`🔴 [WhatsApp] Conexão fechada (status: ${statusCode}). Reconectar: ${shouldReconnect}`);

                    if (!shouldReconnect) {
                        console.log('⚠️ Sessão encerrada pelo celular. Limpando credenciais para gerar novo QR...');
                        fs.rmSync(AUTH_DIR, { recursive: true, force: true });
                        fs.mkdirSync(AUTH_DIR, { recursive: true });
                    }

                    if (!this.isReconnecting) {
                        this.isReconnecting = true;
                        setTimeout(() => {
                            this.isReconnecting = false;
                            this.init();
                        }, 5000);
                    }
                } else if (connection === 'open') {
                    this.qrCode = null;
                    this.qrCodeDataUrl = null;
                    this.isConnected = true;
                    this.isReconnecting = false;
                    console.log('✅ [WhatsApp] Conectado com sucesso (Anti-Ban + Retrocompatibilidade Ativa).');
                }
            });

            this.sock.ev.on('messages.upsert', async ({ messages, type }) => {
                if (type !== 'notify') return;
                for (const msg of messages) {
                    if (!msg || !msg.message || msg.key.fromMe || msg.key.remoteJid === 'status@broadcast') continue;
                    await this._handleIncomingMessage(msg);
                }
            });
        } catch (err) {
            console.error('[WhatsApp] Erro na inicialização do socket:', err.message);
            if (!this.isReconnecting) {
                this.isReconnecting = true;
                setTimeout(() => {
                    this.isReconnecting = false;
                    this.init();
                }, 5000);
            }
        }
    }

    async _handleIncomingMessage(msg) {
        const remoteJid = msg.key.remoteJid;
        const isGroup = remoteJid.endsWith('@g.us');
        const phoneNumber = remoteJid.replace(/@.*$/, '');
        const senderName = msg.pushName || 'User';

        if ((isGroup && !this.settings.allowGroups) || this.settings.blockedNumbers.includes(phoneNumber)) {
            return;
        }

        const messageContent = msg.message;
        let text =
            messageContent.conversation ||
            messageContent.extendedTextMessage?.text ||
            '';
        let mediaType = null;
        let mediaPath = null;
        let mimetype = null;

        if (messageContent.imageMessage) {
            mediaType = 'image';
            text = messageContent.imageMessage.caption || '';
            mimetype = messageContent.imageMessage.mimetype;
        } else if (messageContent.documentMessage) {
            mediaType = 'document';
            text = messageContent.documentMessage.caption || messageContent.documentMessage.fileName || '';
            mimetype = messageContent.documentMessage.mimetype;
        } else if (messageContent.audioMessage) {
            mediaType = messageContent.audioMessage.ptt ? 'voice' : 'audio';
            mimetype = messageContent.audioMessage.mimetype;
        } else if (messageContent.videoMessage) {
            mediaType = 'video';
            text = messageContent.videoMessage.caption || '';
            mimetype = messageContent.videoMessage.mimetype;
        }

        if (text && this.userState.has(remoteJid)) {
            const state = this.userState.get(remoteJid);
            this.userState.delete(remoteJid);
            if (state?.action) {
                await this._triggerDynamicWebhook(state.action, remoteJid, phoneNumber, senderName, text);
            }
        }

        let selectedId = null;
        try {
            const responseJSON = JSON.parse(
                messageContent.interactiveResponseMessage?.nativeFlowResponseMessage?.paramsJson || '{}'
            );
            selectedId = responseJSON.id;
        } catch (e) {}

        if (!selectedId) {
            selectedId =
                messageContent.buttonsResponseMessage?.selectedButtonId ||
                messageContent.templateButtonReplyMessage?.selectedId;
        }

        if (selectedId && this.actionMap.has(selectedId)) {
            const action = this.actionMap.get(selectedId);
            if (action.type === 'reply') {
                await this.sendTextMessage(remoteJid, String(action.payload));
            } else if (action.type === 'webhook') {
                await this._triggerDynamicWebhook(action.payload, remoteJid, phoneNumber, senderName);
            } else if (action.type === 'collect') {
                await this.sendTextMessage(remoteJid, String(action.payload));
                if (action.nextAction) {
                    this.userState.set(remoteJid, { action: action.nextAction });
                }
            }
        }

        if (mediaType) {
            try {
                const buffer = await downloadMediaMessage(msg, 'buffer', {});
                const ext = mimetype ? mimetype.split('/')[1]?.split(';')[0] || 'bin' : 'bin';
                const filename = `${msg.key.id}_${Date.now()}.${ext}`;
                const targetPath = path.join(MEDIA_DIR, filename);
                fs.writeFileSync(targetPath, buffer);
                mediaPath = filename;
            } catch (err) {
                console.error('[WhatsApp] Falha ao salvar mídia recebida:', err.message);
            }
        }

        const isTooLong = text && text.length > MAX_MESSAGE_LENGTH;
        if (!isTooLong) {
            try {
                await this._sleep(this._randomDelay(1200, 3000));
                await this.sock.readMessages([msg.key]);
            } catch (err) {}
        }

        const participant = isGroup ? msg.key.participant : null;
        let groupName = null;
        if (isGroup) {
            try {
                const metadata = await this.sock.groupMetadata(remoteJid);
                groupName = metadata.subject;
            } catch (err) {}
        }

        const savedRecord = {
            messageId: msg.key.id,
            remoteJid,
            sender: remoteJid,
            senderName,
            participant,
            groupName,
            fromMe: false,
            text,
            mediaType,
            mediaPath,
            mimetype
        };

        await messageRepository.save(savedRecord);

        if (AI_WEBHOOK_URL) {
            fetch(AI_WEBHOOK_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(savedRecord)
            }).catch((err) => console.error('[Webhook IA] Erro ao notificar IA:', err.message));
        }
    }

    getQrCode() {
        return { qr: this.qrCode, qrDataUrl: this.qrCodeDataUrl };
    }

    getStatus() {
        return {
            connected: this.isConnected,
            user: this.sock?.user || null,
            qrAvailable: Boolean(this.qrCode)
        };
    }

    async sendTextMessage(to, text, quotedMessageId = null) {
        const jid = await this.resolveJid(to);
        await this.simulateHumanPresence(jid, 'composing', String(text).length);

        const options = {};
        if (quotedMessageId) {
            options.quoted = {
                key: { remoteJid: jid, id: quotedMessageId, fromMe: false },
                message: { conversation: '' }
            };
        }

        const sent = await this.sock.sendMessage(jid, { text: String(text) }, options);
        await this.sock.sendPresenceUpdate('unavailable', jid);

        await messageRepository.save({
            messageId: sent.key.id,
            remoteJid: jid,
            sender: 'me',
            senderName: 'Bot',
            fromMe: true,
            text: String(text)
        });
        return { sent, jid };
    }

    async sendProgrammableMessage(number, messageText, footerText, buttons = []) {
        const remoteJid = await this.resolveJid(number);
        await this.simulateHumanPresence(remoteJid, 'composing', String(messageText).length);

        const linkButton = buttons.find((b) => b.type === 'link');
        if (linkButton) {
            const msg = generateWAMessageFromContent(
                remoteJid,
                {
                    viewOnceMessage: {
                        message: {
                            messageContextInfo: { deviceListMetadata: {}, deviceListMetadataVersion: 2 },
                            interactiveMessage: {
                                body: { text: messageText },
                                footer: { text: footerText || 'Acesse:' },
                                header: { hasMediaAttachment: false },
                                nativeFlowMessage: {
                                    buttons: [
                                        {
                                            name: 'cta_url',
                                            buttonParamsJson: JSON.stringify({
                                                display_text: linkButton.label,
                                                url: linkButton.payload,
                                                merchant_url: linkButton.payload
                                            })
                                        }
                                    ]
                                }
                            }
                        }
                    }
                },
                { userJid: this.sock.user.id }
            );
            await this.sock.relayMessage(remoteJid, msg.message, { messageId: msg.key.id });
            await this.sock.sendPresenceUpdate('unavailable', remoteJid);
            return { status: 'success', mode: 'native_link', to: remoteJid, id: msg.key.id };
        }

        const classicButtons = buttons.map((btn) => {
            const uniqueId = `btn_${crypto.randomBytes(4).toString('hex')}`;
            const actionData = { type: btn.type || 'reply', payload: btn.payload };
            if (btn.type === 'collect') {
                actionData.payload = btn.prompt || 'Digite:';
                actionData.nextAction = btn.on_input;
            }
            this.actionMap.set(uniqueId, actionData);
            return { buttonId: uniqueId, buttonText: { displayText: btn.label }, type: 1 };
        });

        const sent = await this.sock.sendMessage(remoteJid, {
            text: messageText,
            footer: footerText || '',
            buttons: classicButtons,
            headerType: 1
        });
        await this.sock.sendPresenceUpdate('unavailable', remoteJid);
        return { status: 'success', mode: 'classic_buttons', to: remoteJid, id: sent?.key?.id };
    }

    async sendReaction(to, messageId, emoji = '👍', fromMe = false) {
        const jid = await this.resolveJid(to);
        await this._sleep(this._randomDelay(600, 1500));
        return await this.sock.sendMessage(jid, {
            react: {
                text: emoji,
                key: { remoteJid: jid, id: messageId, fromMe: Boolean(fromMe) }
            }
        });
    }

    async sendPoll(to, name, values = [], selectableCount = 1) {
        const jid = await this.resolveJid(to);
        await this.simulateHumanPresence(jid, 'composing', name.length);
        const sent = await this.sock.sendMessage(jid, {
            poll: {
                name,
                values,
                selectableCount
            }
        });
        await this.sock.sendPresenceUpdate('unavailable', jid);
        return { sent, jid };
    }

    async sendMediaMessage(to, file, caption, mediaType = 'document') {
        const jid = await this.resolveJid(to);
        await this.simulateHumanPresence(jid, 'composing', (caption || '').length);

        let messagePayload = {};
        const fileBuffer = fs.readFileSync(file.path);

        if (mediaType === 'image') {
            messagePayload = { image: fileBuffer, caption: caption || '' };
        } else if (mediaType === 'video') {
            messagePayload = { video: fileBuffer, caption: caption || '' };
        } else if (mediaType === 'audio') {
            messagePayload = { audio: fileBuffer, mimetype: file.mimetype || 'audio/mp4' };
        } else {
            messagePayload = {
                document: fileBuffer,
                mimetype: file.mimetype,
                fileName: file.originalname,
                caption: caption || ''
            };
        }

        const sent = await this.sock.sendMessage(jid, messagePayload);
        await this.sock.sendPresenceUpdate('unavailable', jid);

        await messageRepository.save({
            messageId: sent.key.id,
            remoteJid: jid,
            sender: 'me',
            senderName: 'Bot',
            fromMe: true,
            text: caption || file.originalname,
            mediaType,
            mediaPath: file.filename,
            mimetype: file.mimetype
        });
        return { sent, jid };
    }

    async sendVoiceMessage(to, file) {
        const jid = await this.resolveJid(to);
        await this.simulateHumanPresence(jid, 'recording');

        const fileBuffer = fs.readFileSync(file.path);
        const sent = await this.sock.sendMessage(jid, {
            audio: fileBuffer,
            mimetype: file.mimetype || 'audio/ogg; codecs=opus',
            ptt: true
        });
        await this.sock.sendPresenceUpdate('unavailable', jid);

        await messageRepository.save({
            messageId: sent.key.id,
            remoteJid: jid,
            sender: 'me',
            senderName: 'Bot',
            fromMe: true,
            text: '[Mensagem de Voz]',
            mediaType: 'voice',
            mediaPath: file.filename,
            mimetype: file.mimetype || 'audio/ogg; codecs=opus'
        });
        return { sent, jid };
    }

    async listGroups() {
        if (!this.sock || !this.isConnected) throw new Error('Bot offline');
        const groups = await this.sock.groupFetchAllParticipating();
        return Object.values(groups).map((g) => ({
            jid: g.id,
            subject: g.subject,
            participantsCount: g.participants?.length || 0
        }));
    }
}

module.exports = new WhatsAppService();
