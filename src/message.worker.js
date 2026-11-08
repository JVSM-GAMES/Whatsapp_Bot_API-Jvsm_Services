const { Worker } = require('bullmq');
const { REDIS_HOST, REDIS_PORT, REDIS_PASSWORD } = require('./config');
const whatsappService = require('./whatsapp.service');

const connection = {
    host: REDIS_HOST || '127.0.0.1',
    port: parseInt(REDIS_PORT, 10) || 6379,
    password: REDIS_PASSWORD || undefined
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const randomCooldown = (min = 2000, max = 5500) =>
    Math.floor(Math.random() * (max - min + 1)) + min;

const messageWorker = new Worker(
    'whatsapp-messages',
    async (job) => {
        const {
            type,
            to,
            text,
            quotedMessageId,
            fileData,
            caption,
            mediaType,
            messageText,
            footerText,
            buttons,
            messageId,
            emoji,
            fromMe,
            name,
            values,
            selectableCount
        } = job.data;

        let resData;

        switch (type) {
            case 'text':
                resData = await whatsappService.sendTextMessage(to, text, quotedMessageId);
                break;
            case 'programmable':
                resData = await whatsappService.sendProgrammableMessage(to, messageText, footerText, buttons);
                break;
            case 'reaction':
                resData = await whatsappService.sendReaction(to, messageId, emoji, fromMe);
                break;
            case 'poll':
                resData = await whatsappService.sendPoll(to, name, values, selectableCount);
                break;
            case 'media':
                resData = await whatsappService.sendMediaMessage(to, fileData, caption, mediaType);
                break;
            case 'voice':
                resData = await whatsappService.sendVoiceMessage(to, fileData);
                break;
            default:
                throw new Error(`Tipo de job não suportado: ${type}`);
        }

        // Pausa humana pós-envio antes de liberar o próximo job da fila
        await sleep(randomCooldown(2000, 5500));

        return {
            messageId: resData?.sent?.key?.id || resData?.id || null,
            jid: resData?.jid || resData?.to || to,
            mode: resData?.mode || 'standard'
        };
    },
    {
        connection,
        concurrency: 1,
        limiter: {
            max: 10,
            duration: 60000
        }
    }
);

messageWorker.on('completed', (job, returnvalue) => {
    console.log(`✅ [Worker] Job #${job.id} (${job.data.type}) entregue para ${returnvalue?.jid}`);
});

messageWorker.on('failed', (job, err) => {
    console.error(`❌ [Worker] Job #${job?.id} falhou:`, err.message);
});

module.exports = messageWorker;
