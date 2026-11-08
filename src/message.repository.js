const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const { DB_PATH, DATA_DIR } = require('./config');

class MessageRepository {
    constructor() {
        if (!fs.existsSync(DATA_DIR)) {
            fs.mkdirSync(DATA_DIR, { recursive: true });
        }
        this.db = new sqlite3.Database(DB_PATH, (err) => {
            if (err) console.error('[SQLite] Erro ao conectar:', err.message);
            else console.log('[SQLite] MessageRepository conectado com sucesso.');
        });
        this.init();
    }

    init() {
        const query = `
            CREATE TABLE IF NOT EXISTS messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                message_id TEXT,
                remote_jid TEXT,
                sender TEXT,
                sender_name TEXT,
                participant TEXT,
                group_name TEXT,
                from_me INTEGER,
                text TEXT,
                media_type TEXT,
                media_path TEXT,
                mimetype TEXT,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `;
        this.db.run(query, (err) => {
            if (err) console.error('[SQLite] Erro ao inicializar tabela messages:', err.message);
        });
    }

    save({ messageId, remoteJid, sender, senderName = null, participant = null, groupName = null, fromMe = false, text = '', mediaType = null, mediaPath = null, mimetype = null }) {
        return new Promise((resolve, reject) => {
            const query = `
                INSERT INTO messages (message_id, remote_jid, sender, sender_name, participant, group_name, from_me, text, media_type, media_path, mimetype)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `;
            const params = [messageId, remoteJid, sender, senderName, participant, groupName, fromMe ? 1 : 0, text, mediaType, mediaPath, mimetype];
            this.db.run(query, params, function (err) {
                if (err) return reject(err);
                resolve({ id: this.lastID });
            });
        });
    }

    getConversations() {
        return new Promise((resolve, reject) => {
            const query = `
                SELECT 
                    m.remote_jid,
                    m.group_name,
                    COALESCE(m.group_name, m.sender_name, m.remote_jid) AS display_name,
                    m.text AS last_message,
                    m.media_type AS last_media_type,
                    m.from_me AS last_message_from_me,
                    m.timestamp AS last_activity
                FROM messages m
                INNER JOIN (
                    SELECT remote_jid, MAX(id) AS max_id
                    FROM messages
                    GROUP BY remote_jid
                ) latest ON m.id = latest.max_id
                ORDER BY m.timestamp DESC
            `;
            this.db.all(query, [], (err, rows) => {
                if (err) return reject(err);
                resolve(rows);
            });
        });
    }

    getMessagesByJid(jid) {
        return new Promise((resolve, reject) => {
            const query = `
                SELECT 
                    id,
                    message_id,
                    remote_jid,
                    sender,
                    sender_name,
                    participant,
                    group_name,
                    from_me,
                    text,
                    media_type,
                    media_path,
                    mimetype,
                    CASE 
                        WHEN media_path IS NOT NULL THEN '/media/' || media_path 
                        ELSE NULL 
                    END AS media_url,
                    timestamp
                FROM messages
                WHERE remote_jid = ?
                ORDER BY timestamp ASC
            `;
            this.db.all(query, [jid], (err, rows) => {
                if (err) return reject(err);
                resolve(rows);
            });
        });
    }
}

module.exports = new MessageRepository();
