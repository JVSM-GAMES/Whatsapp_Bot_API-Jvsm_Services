const { API_KEY, WHITELIST_IPS } = require('./config');

const PUBLIC_OR_WHITELIST_PATHS = [
    '/',
    '/qr',
    '/settings',
    '/enviar-mensagem',
    '/enviar-whatsapp',
    '/send-text',
    '/send-programmable'
];

function apiKeyAuth(req, res, next) {
    let clientIp = req.ip || req.socket?.remoteAddress || '';
    clientIp = clientIp.toString().replace('::ffff:', '');

    // Healthcheck público
    if (req.path === '/') return next();

    // Bypass por IP da sua Whitelist nas rotas legadas e de configuração
    if (PUBLIC_OR_WHITELIST_PATHS.includes(req.path) && WHITELIST_IPS.includes(clientIp)) {
        return next();
    }

    const authHeader = req.headers['x-api-key'] || req.headers['authorization'] || req.query['api_key'];
    if (!authHeader) {
        return res.status(401).json({
            status: 'error',
            error: 'Unauthorized',
            message: 'API Key ausente (use header "x-api-key", "Authorization: Bearer" ou query "?api_key=").'
        });
    }

    const token = String(authHeader).startsWith('Bearer ')
        ? String(authHeader).split(' ')[1]
        : String(authHeader);

    if (token !== API_KEY) {
        return res.status(403).json({
            status: 'error',
            error: 'Forbidden',
            message: 'API Key inválida.'
        });
    }

    next();
}

module.exports = { apiKeyAuth };
