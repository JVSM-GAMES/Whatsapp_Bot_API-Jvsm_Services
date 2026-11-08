const path = require('path');
const fs = require('fs');
const whatsappService = require('./whatsapp.service');
const messageRepository = require('./message.repository');
const queueService = require('./queue.service');
const { MEDIA_DIR } = require('./config');

class MessageController {
    /**
     * GET /qr
     * Se chamado pelo navegador (Accept: text/html), renderiza a página com a imagem do QR Code (igual à sua API 2).
     * Se chamado via cliente API (Accept: application/json), retorna JSON.
     */
    getQrCode(req, res) {
        const { qr, qrDataUrl } = whatsappService.getQrCode();
        const status = whatsappService.getStatus();
        const acceptsHtml = req.headers.accept && req.headers.accept.includes('text/html');

        if (acceptsHtml) {
            if (!qrDataUrl) {
                return res.send('<html><body style="font-family:Arial;display:flex;justify-content:center;align-items:center;height:100vh;"><h2>✅ WhatsApp já conectado (ou aguardando geração de QR).</h2></body></html>');
            }
            return res.send(`
                <html><body style="display:flex;justify-content:center;align-items:center;height:100vh;flex-direction:column;font-family:Arial;">
                  <h2>Escaneie o QR abaixo:</h2>
                  <img src="${qrDataUrl}" style="width:300px;height:300px" />
                </body></html>
            `);
        }

        if (qr) {
            return res.status(200).json({ status, qr, qrDataUrl });
        }
        return res.status(200).json({
            status,
            message: 'QR Code indisponível ou sessão já conectada.'
        });
    }

    /**
     * GET /settings & POST /settings (Herdado da sua API 2)
     */
    getSettingsPage(req, res) {
        const settings = whatsappService.settings;
        res.send(`
            <html>
              <head>
                <title>Configurações do Bot</title>
                <style>
                  body { font-family: Arial; margin: 20px; background: #f9f9f9; }
                  .container { max-width: 500px; margin: auto; background: #fff; padding: 20px; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
                  textarea { width: 100%; height: 80px; margin-top: 8px; }
                  button { margin-top: 12px; padding: 10px 18px; cursor: pointer; background: #25D366; color: #fff; border: none; border-radius: 4px; font-weight: bold; }
                </style>
              </head>
              <body>
                <div class="container">
                  <h2>⚙️ Configurações do WhatsApp Bot</h2>
                  <label>
                    <input type="checkbox" id="allowGroups" ${settings.allowGroups ? 'checked' : ''}>
                    Processar mensagens de grupos
                  </label>
                  <br><br>
                  <label>Números bloqueados (separados por vírgula):</label>
                  <textarea id="blockedNumbers">${settings.blockedNumbers.join(', ')}</textarea>
                  <br>
                  <button onclick="saveSettings()">Salvar</button>
                  <p id="status" style="color: green; font-weight: bold;"></p>
                </div>
                <script>
                  async function saveSettings() {
                    const allowGroups = document.getElementById('allowGroups').checked;
                    const blockedNumbers = document.getElementById('blockedNumbers').value.split(',').map(n => n.trim()).filter(n => n);
                    const res = await fetch('/settings', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ allowGroups, blockedNumbers })
                    });
                    if (res.ok) document.getElementById('status').innerText = 'Configurações salvas com sucesso!';
                  }
                </script>
              </body>
            </html>
        `);
    }

    updateSettings(req, res) {
        const updated = whatsappService.saveSettings(req.body || {});
        return res.json({ success: true, settings: updated });
    }

    /**
     * ROTAS LEGADAS RETROCOMPATÍVEIS:
     * POST /enviar-whatsapp e POST /enviar-mensagem
     * Aceita { telefone, mensagem } (ou { to, text }), valida o número (com/sem 9º dígito),
     * passa pela fila Anti-Ban com simulação de digitação humana e retorna o exato JSON legado!
     */
    async sendLegacyMessage(req, res) {
        const telefone = req.body.telefone || req.body.number || req.body.to;
        const mensagem = req.body.mensagem || req.body.text || req.body.message;
        const waitQueue = req.body.async === true ? false : true;

        if (!telefone || !mensagem) {
            return res.status(400).json({
                success: false,
                message: 'Os campos "telefone" e "mensagem" são obrigatórios.'
            });
        }

        const status = whatsappService.getStatus();
        if (!status.connected) {
            return res.status(503).json({
                success: false,
                message: 'Bot offline ou não pareado.'
            });
        }

        try {
            // 1. Verifica o número antes (com 9º dígito e sem 9º dígito) para retornar 404 imediato se não existir
            const finalJid = await whatsappService.resolveJid(telefone);

            // 2. Enfileira no BullMQ para garantir concurrency: 1 e digitação humana anti-ban
            const job = await queueService.addTextMessageJob(finalJid, mensagem);

            if (waitQueue) {
                await job.waitUntilFinished(queueService.queueEvents, 45000);
            }

            return res.status(200).json({
                success: true,
                message: 'Mensagem enviada com sucesso!',
                jid: finalJid,
                jobId: job.id
            });
        } catch (error) {
            if (error.statusCode === 404) {
                return res.status(404).json({
                    success: false,
                    message: 'O número de telefone não possui conta no WhatsApp.'
                });
            }
            console.error('[Legacy Endpoint] Erro:', error.message);
            return res.status(500).json({
                success: false,
                message: 'Ocorreu um erro interno na API do WhatsApp.',
                details: error.message
            });
        }
    }

    /**
     * ROTA LEGADA: POST /send-text ({ number, text })
     */
    async sendLegacySimpleText(req, res) {
        const number = req.body.number || req.body.telefone || req.body.to;
        const text = req.body.text || req.body.mensagem;
        if (!number || !text) {
            return res.status(400).json({ error: 'Campos "number" e "text" são obrigatórios.' });
        }
        if (!whatsappService.getStatus().connected) {
            return res.status(503).json({ error: 'Bot offline' });
        }
        try {
            const finalJid = await whatsappService.resolveJid(number);
            await queueService.addTextMessageJob(finalJid, text);
            return res.json({ status: 'sent', to: finalJid });
        } catch (e) {
            return res.status(500).json({ error: 'Fail', details: e.message });
        }
    }

    /**
     * ROTA LEGADA: POST /send-programmable (Botões CTA URL e Clássicos com Webhook/Collect)
     */
    async sendProgrammable(req, res) {
        const { number, messageText, footerText, buttons } = req.body;
        if (!number || !messageText || !Array.isArray(buttons)) {
            return res.status(400).json({ error: 'Parâmetros "number", "messageText" e "buttons" são obrigatórios.' });
        }
        if (!whatsappService.getStatus().connected) {
            return res.status(503).json({ error: 'Bot offline' });
        }
        try {
            const finalJid = await whatsappService.resolveJid(number);
            const job = await queueService.addProgrammableJob(finalJid, messageText, footerText, buttons);
            const result = await job.waitUntilFinished(queueService.queueEvents, 45000);
            return res.json({ status: 'success', mode: result.mode, to: result.jid });
        } catch (e) {
            return res.status(500).json({ error: 'Erro interno', details: e.message });
        }
    }

    /**
     * POST /message (Padrão v0.4/v0.5 para Agentes de IA)
     */
    async sendTextMessage(req, res) {
        const { to, text, quotedMessageId } = req.body;
        if (!to || !text) {
            return res.status(400).json({ error: 'Parâmetros "to" e "text" são obrigatórios.' });
        }
        try {
            const job = await queueService.addTextMessageJob(to, text, quotedMessageId);
            return res.status(202).json({
                message: 'Mensagem de texto enfileirada para envio seguro.',
                jobId: job.id
            });
        } catch (e) {
            return res.status(500).json({ error: 'Erro ao enfileirar mensagem.', details: e.message });
        }
    }

    /**
     * POST /message/verify-code (Envio de 2FA/OTP com Spintax Anti-Ban)
     */
    async sendVerificationCode(req, res) {
        const { to, code, appName = 'Sistema' } = req.body;
        if (!to || !code) {
            return res.status(400).json({ error: 'Parâmetros "to" e "code" são obrigatórios.' });
        }

        const templates = [
            `Olá! Seu código de verificação para o *${appName}* é: *${code}*. Não compartilhe este código com ninguém.`,
            `🔐 *${appName}*: Use o código *${code}* para confirmar seu número. Se não foi você, ignore esta mensagem.`,
            `Aqui está o seu código de acesso do *${appName}*: *${code}* (válido por alguns minutos).`,
            `Opa! Para concluir sua verificação no *${appName}*, digite o código: *${code}*.`
        ];
        const randomTemplate = templates[Math.floor(Math.random() * templates.length)];

        try {
            const finalJid = await whatsappService.resolveJid(to);
            const job = await queueService.addTextMessageJob(finalJid, randomTemplate);
            return res.status(202).json({
                success: true,
                message: 'Código de verificação enfileirado com sucesso.',
                jid: finalJid,
                jobId: job.id
            });
        } catch (e) {
            return res.status(e.statusCode || 500).json({
                success: false,
                error: 'Erro ao enviar código de verificação.',
                details: e.message
            });
        }
    }

    /**
     * POST /message/react (Reagir com emoji em mensagens)
     */
    async sendReaction(req, res) {
        const { to, messageId, emoji = '👍', fromMe = false } = req.body;
        if (!to || !messageId) {
            return res.status(400).json({ error: 'Parâmetros "to" e "messageId" são obrigatórios.' });
        }
        try {
            const job = await queueService.addReactionJob(to, messageId, emoji, fromMe);
            return res.status(202).json({ message: 'Reação enfileirada.', jobId: job.id });
        } catch (e) {
            return res.status(500).json({ error: 'Erro ao enfileirar reação.', details: e.message });
        }
    }

    /**
     * POST /message/poll (Criar enquetes para grupos/amigos)
     */
    async sendPoll(req, res) {
        const { to, name, values, selectableCount = 1 } = req.body;
        if (!to || !name || !Array.isArray(values) || values.length < 2) {
            return res.status(400).json({ error: 'Informe "to", "name" e um array "values" com pelo menos 2 opções.' });
        }
        try {
            const job = await queueService.addPollJob(to, name, values, selectableCount);
            return res.status(202).json({ message: 'Enquete enfileirada.', jobId: job.id });
        } catch (e) {
            return res.status(500).json({ error: 'Erro ao enfileirar enquete.', details: e.message });
        }
    }

    async sendMediaMessage(req, res) {
        const { to, caption, mediaType = 'document' } = req.body;
        const file = req.file;
        if (!to || !file) {
            return res.status(400).json({ error: 'Parâmetro "to" e arquivo "file" são obrigatórios.' });
        }
        try {
            const job = await queueService.addMediaMessageJob(to, file, caption, mediaType);
            return res.status(202).json({
                message: 'Mídia enfileirada para envio seguro.',
                jobId: job.id,
                mediaUrl: `/media/${file.filename}`
            });
        } catch (e) {
            return res.status(500).json({ error: 'Erro ao enfileirar mídia.', details: e.message });
        }
    }

    async sendVoiceMessage(req, res) {
        const { to } = req.body;
        const file = req.file;
        if (!to || !file) {
            return res.status(400).json({ error: 'Parâmetro "to" e arquivo de áudio "file" são obrigatórios.' });
        }
        try {
            const job = await queueService.addVoiceMessageJob(to, file);
            return res.status(202).json({
                message: 'Mensagem de voz (PTT) enfileirada para envio seguro.',
                jobId: job.id,
                mediaUrl: `/media/${file.filename}`
            });
        } catch (e) {
            return res.status(500).json({ error: 'Erro ao enfileirar mensagem de voz.', details: e.message });
        }
    }

    /**
     * GET /check-number/:phone (Valida se um número existe no WhatsApp sem enviar mensagem)
     */
    async checkNumber(req, res) {
        try {
            const jid = await whatsappService.resolveJid(req.params.phone);
            return res.json({ exists: true, jid });
        } catch (e) {
            return res.status(404).json({ exists: false, message: e.message });
        }
    }

    async listGroups(req, res) {
        try {
            const groups = await whatsappService.listGroups();
            return res.json({ groups });
        } catch (e) {
            return res.status(500).json({ error: e.message });
        }
    }

    async handleWebhook(req, res) {
        const { sender, message } = req.body || {};
        const senderId = sender?.id || sender?.jid;
        if (!senderId || !message) {
            return res.status(400).json({ error: 'Payload inválido.' });
        }
        try {
            await messageRepository.save({
                messageId: message.id || `webhook_${Date.now()}`,
                remoteJid: senderId,
                sender: senderId,
                senderName: sender.name || null,
                participant: sender.participant || null,
                groupName: req.body.groupName || null,
                fromMe: false,
                text: message.text || '',
                mediaType: message.mediaType || null,
                mediaPath: message.mediaPath || null,
                mimetype: message.mimetype || null
            });
            return res.status(200).json({ success: true });
        } catch (e) {
            return res.status(500).json({ error: e.message });
        }
    }

    serveMedia(req, res) {
        const { filename } = req.params;
        const filePath = path.join(MEDIA_DIR, path.basename(filename));
        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ error: 'Arquivo de mídia não encontrado.' });
        }
        return res.sendFile(filePath);
    }

    async listConversations(req, res) {
        try {
            const conversations = await messageRepository.getConversations();
            return res.status(200).json({ conversations });
        } catch (e) {
            return res.status(500).json({ error: 'Erro ao listar conversas.', details: e.message });
        }
    }

    async getHistory(req, res) {
        const { jid } = req.params;
        try {
            const messages = await messageRepository.getMessagesByJid(jid);
            return res.status(200).json({
                remote_jid: jid,
                total_messages: messages.length,
                messages
            });
        } catch (e) {
            return res.status(500).json({ error: 'Erro ao buscar histórico.', details: e.message });
        }
    }
}

module.exports = new MessageController();
