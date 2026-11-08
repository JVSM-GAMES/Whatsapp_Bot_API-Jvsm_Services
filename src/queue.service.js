const { Queue, QueueEvents } = require('bullmq');
const { REDIS_HOST, REDIS_PORT, REDIS_PASSWORD } = require('./config');

const connection = {
    host: REDIS_HOST || '127.0.0.1',
    port: parseInt(REDIS_PORT, 10) || 6379,
    password: REDIS_PASSWORD || undefined
};

class MessageQueueService {
    constructor() {
        this.queue = new Queue('whatsapp-messages', {
            connection,
            defaultJobOptions: {
                attempts: 2,
                backoff: {
                    type: 'exponential',
                    delay: 3000
                },
                removeOnComplete: { age: 3600, count: 500 },
                removeOnFail: { age: 86400 }
            }
        });
        this.queueEvents = new QueueEvents('whatsapp-messages', { connection });
    }

    async addTextMessageJob(to, text, quotedMessageId = null) {
        return await this.queue.add('send-text', {
            type: 'text',
            to,
            text,
            quotedMessageId,
            createdAt: new Date().toISOString()
        });
    }

    async addProgrammableJob(number, messageText, footerText, buttons) {
        return await this.queue.add('send-programmable', {
            type: 'programmable',
            to: number,
            messageText,
            footerText,
            buttons,
            createdAt: new Date().toISOString()
        });
    }

    async addReactionJob(to, messageId, emoji, fromMe) {
        return await this.queue.add('send-reaction', {
            type: 'reaction',
            to,
            messageId,
            emoji,
            fromMe,
            createdAt: new Date().toISOString()
        });
    }

    async addPollJob(to, name, values, selectableCount) {
        return await this.queue.add('send-poll', {
            type: 'poll',
            to,
            name,
            values,
            selectableCount,
            createdAt: new Date().toISOString()
        });
    }

    async addMediaMessageJob(to, fileData, caption, mediaType) {
        return await this.queue.add('send-media', {
            type: 'media',
            to,
            fileData,
            caption,
            mediaType,
            createdAt: new Date().toISOString()
        });
    }

    async addVoiceMessageJob(to, fileData) {
        return await this.queue.add('send-voice', {
            type: 'voice',
            to,
            fileData,
            createdAt: new Date().toISOString()
        });
    }
}

module.exports = new MessageQueueService();
