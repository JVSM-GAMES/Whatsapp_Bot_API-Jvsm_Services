# 🚀 WhatsApp Bot API v0.5 (Unified Edition)

Uma API RESTful modular, resiliente e blindada contra banimentos para automação de WhatsApp, integração com Agentes de IA (LLMs), envio de códigos de verificação (2FA/OTP) e fluxos interativos. 

Construída sobre **Node.js**, **Whaileys (Baileys)**, **BullMQ (Redis)** e **SQLite3**, esta versão unifica alta proteção anti-spam com **100% de retrocompatibilidade** com sistemas legados.

---

## ✨ Principais Funcionalidades

* 🛡️ **Motor Anti-Ban & Simulação Humana:**
  * **Fila Estrita (`concurrency: 1`):** Nenhum disparo ocorre simultaneamente. Todas as requisições entram em fila no Redis e são processadas uma a uma.
  * **Presença e Digitação Proporcional:** O bot marca presença no chat (`available`), aguarda tempo de reação humano, envia o status `"digitando..."` (`composing`) por um tempo calculado dinamicamente com base na quantidade de caracteres da mensagem (com *jitter* aleatório) ou `"gravando áudio..."` (`recording` para PTT), faz uma breve pausa (`paused`) e encerra a presença (`unavailable`) após o envio.
  * **Rate Limiting & Cooldown:** Limite nativo no Worker de no máximo 10 mensagens por minuto, acrescido de um *cooldown* aleatório (2s a 5.5s) entre cada job concluído.
  * **Spintax Nativo para 2FA/OTP:** A rota de códigos de verificação alterna automaticamente entre múltiplos templates de texto para evitar que os filtros da Meta detectem *hashes* de mensagens repetidas.
  * **Stealth Connection:** Configurado com `markOnlineOnConnect: false` para evitar a flag de conta "Online 24/7" e camuflado com fingerprint de navegador desktop legítimo.
* 🇧🇷 **Resolução Inteligente do 9º Dígito (Brasil):**
  * Verifica automaticamente no servidor do WhatsApp (`onWhatsApp`) as variantes **com e sem o 9º dígito** para DDDs brasileiros antes do disparo, descobrindo o JID canônico real da conta e evitando envios para números inexistentes (principal causa de banimento em disparos ativos).
* 🔄 **100% Retrocompatível:**
  * Suporta nativamente as rotas legadas `/enviar-whatsapp`, `/enviar-mensagem`, `/send-text` e `/send-programmable`, mantendo os mesmos contratos JSON de entrada e saída, além de autenticação híbrida por **Whitelist de IPs**, Header (`x-api-key` / `Bearer`) ou Query String (`?api_key=`).
* 🧠 **Pronta para Agentes de IA (Contexto & Webhooks):**
  * Persistência automática de todo o histórico de conversas (texto e mídia) em banco local **SQLite** (`data/context.db`) e disparo em tempo real para o seu Agente de IA via `AI_WEBHOOK_URL`.
* 🎛️ **Recursos Ricos do WhatsApp:**
  * Envio de textos (com suporte a *quote/reply*), imagens, vídeos, documentos, áudios gravados na hora (PTT), reações com emojis, enquetes nativas (*Polls*), botões de link nativos (`cta_url`) e botões clássicos com máquina de estados (`reply`, `collect` de input do usuário e disparo de `webhook` dinâmico com variáveis `$Phone$`, `$NickName$` e `$Input$`).

---

## 🏗️ Arquitetura e Escolhas Técnicas

O projeto aplica princípios **SOLID** (especialmente *Single Responsibility Principle*), separando claramente cada camada da aplicação:

```text
whatsapp-bot-api/
├── data/
│   ├── auth_info_baileys/     # Credenciais de sessão Multi-Device
│   ├── media/                 # Mídias recebidas e enviadas
│   ├── context.db             # Banco SQLite com histórico de conversas
│   └── settings.json          # Configurações dinâmicas (grupos e bloqueios)
├── src/
│   ├── index.js               # Ponto de entrada HTTP (Express) e roteamento
│   ├── config.js              # Centralização de variáveis de ambiente e constantes
│   ├── auth.middleware.js     # Segurança (Whitelist de IP + API Key via Header/Query)
│   ├── message.controller.js  # Validação HTTP e enfileiramento de jobs
│   ├── queue.service.js       # Produtor de filas (BullMQ + QueueEvents)
│   ├── message.worker.js      # Consumidor assíncrono com Rate-Limiter e Cooldown
│   ├── whatsapp.service.js    # Core do socket Whaileys, Anti-Ban e 9º dígito
│   └── message.repository.js  # Camada de persistência (SQLite3)
├── Dockerfile
├── docker-compose.yml
└── package.json
```

### Por que essas tecnologias?
1. **Whaileys (Baileys WebSockets) em vez de Puppeteer/Selenium:** Consome ~80MB de RAM em vez de >1GB do Chromium headless, não sofre com *memory leaks* gráficos e opera diretamente sobre o protocolo WebSocket Multi-Device oficial.
2. **Forçamento IPv4 (`--dns-result-order=ipv4first` + `family: 4`):** Containers Docker frequentemente sofrem com *timeouts* (`status: 408`) ao tentar negociar WebSockets com os servidores da Meta via rotas IPv6 mal configuradas no host. O agente de rede força conexões IPv4 puras com `keepAlive`.
3. **BullMQ + Redis (In-Process Worker):** Garante que picos de requisições das IAs ou sistemas externos nunca sobrecarreguem o socket. O Worker roda no mesmo processo do Node.js para compartilhar a instância viva do socket em memória sem conflito de leitura/escrita nas chaves criptográficas da pasta `auth_info_baileys`.
4. **SQLite3 Embarcado:** Oferece armazenamento relacional rápido e zero-configuração para alimentar o histórico de contexto de LLMs (`GET /conversations/:jid`), sem exigir um container pesado de banco de dados relacional.

---

## ⚙️ Instalação e Execução

### Pré-requisitos
* **Docker** e **Docker Compose** (Recomendado)
* Ou **Node.js 20+** e **Redis Server** rodando localmente.

### 1. Configuração das Variáveis de Ambiente (`.env`)
Crie um arquivo `.env` na raiz do projeto:

```env
PORT=10000
APP_PORT=10000
APP_IP=0.0.0.0
API_KEY=sua_chave_secreta_aqui
MAX_MESSAGE_LENGTH=4096
REDIS_HOST=redis
REDIS_PORT=6379
REDIS_PASSWORD=
AI_WEBHOOK_URL=http://seu-servidor-ia/webhook
```

### 2. Subindo com Docker Compose
```bash
sudo docker compose up -d --build
sudo docker compose logs -f whatsapp-api
```
Escaneie o QR Code exibido diretamente no terminal ou acesse `http://SEU_IP:10000/qr` pelo navegador.

---

## 🔐 Autenticação

A API aceita 3 métodos de autenticação (além de *bypass* automático para IPs contidos na `WHITELIST_IPS` nas rotas legadas):

1. **Header `x-api-key`:** `x-api-key: sua_chave_secreta_aqui`
2. **Header `Authorization`:** `Authorization: Bearer sua_chave_secreta_aqui`
3. **Query Parameter:** `?api_key=sua_chave_secreta_aqui`

---

## 📡 Documentação Completa das Rotas

### 🖥️ 1. Painéis Visuais, Status e Utilitários

#### `GET /`
Healthcheck rápido da API.
* **Resposta:** `200 OK` (`ok`)

#### `GET /qr`
* Se acessado pelo **navegador** (`Accept: text/html`), renderiza uma página HTML exibindo a imagem do QR Code pronta para escanear.
* Se acessado via **API** (`Accept: application/json`), retorna o status da conexão e a string do QR Code.

#### `GET /settings` & `POST /settings`
Interface web visual (no `GET`) e endpoint JSON (no `POST`) para ativar/desativar respostas em grupos e gerenciar a *blacklist* de números ignorados.
```json
{
  "allowGroups": true,
  "blockedNumbers": ["5511999999999", "5594988888888"]
}
```

#### `GET /check-number/:phone`
Verifica se um número possui conta ativa no WhatsApp (testando com e sem o 9º dígito) e retorna o JID exato sem enviar mensagem.
* **Exemplo:** `GET /check-number/5594991234567`
* **Resposta (`200 OK`):**
```json
{
  "exists": true,
  "jid": "559491234567@s.whatsapp.net"
}
```

#### `GET /groups`
Lista todos os grupos dos quais o número conectado participa.

---

### 💬 2. Rotas Modernas (v0.5 — Para Agentes de IA e Sistemas Novos)

#### `POST /message`
Enfileira o envio de uma mensagem de texto com simulação de digitação humana. Suporta resposta direta a uma mensagem específica via `quotedMessageId`.
```json
{
  "to": "5594991234567",
  "text": "Fala mano! Tudo certo por aí?",
  "quotedMessageId": "BAE5F89A12C0"
}
```

#### `POST /message/verify-code`
Envia códigos de confirmação (2FA/OTP) utilizando **Spintax Anti-Spam** (sorteia estruturas frasais diferentes para evitar bloqueio por repetição de conteúdo).
```json
{
  "to": "5594991234567",
  "code": "849201",
  "appName": "JVSM Auth"
}
```

#### `POST /message/react`
Reage a uma mensagem específica com qualquer emoji.
```json
{
  "to": "5594991234567@s.whatsapp.net",
  "messageId": "3EB0A12B4C",
  "emoji": "🔥",
  "fromMe": false
}
```

#### `POST /message/poll`
Cria e envia uma enquete nativa (ideal para interações e brincadeiras em grupos).
```json
{
  "to": "1203630291823@g.us",
  "name": "Qual jogo vamos abrir no servidor hoje?",
  "values": ["Need for Speed Underground 2", "God of War II", "Guitar Hero", "Xadrez"],
  "selectableCount": 1
}
```

#### `POST /message/media`
Envia imagens, vídeos, áudios ou documentos (`multipart/form-data`).
* **Campos Form-Data:**
  * `to`: Número ou JID de destino (Obrigatório)
  * `file`: Arquivo binário (Obrigatório)
  * `mediaType`: `image` | `video` | `audio` | `document` (Padrão: `document`)
  * `caption`: Legenda opcional

#### `POST /message/audio`
Envia um arquivo de áudio como **Mensagem de Voz gravada na hora (PTT)**, simulando o status `"gravando áudio..."` antes do envio (`multipart/form-data`).
* **Campos Form-Data:**
  * `to`: Número ou JID de destino
  * `file`: Arquivo de áudio (`.ogg`, `.mp3`, `.mp4`, `.wav`)

---

### 🗄️ 3. Contexto, Mídia e Histórico (SQLite)

#### `GET /conversations`
Retorna a lista de todas as conversas ativas ordenadas pela última atividade, incluindo a última mensagem trocada.

#### `GET /conversations/:jid`
Retorna todo o histórico cronológico de mensagens de um contato ou grupo (`remote_jid`), já com os links locais para download de mídias (`media_url`).

#### `GET /media/:filename`
Serve os arquivos de mídia baixados automaticamente pelo bot (imagens, áudios, vídeos, PDFs) armazenados em `data/media/`.

---

### 🕰️ 4. Rotas Legadas (100% Retrocompatíveis)

#### `POST /enviar-whatsapp` e `POST /enviar-mensagem`
Totalmente compatíveis com os sistemas anteriores. Validam o 9º dígito, passam pela fila anti-ban com simulação de digitação, aguardam a conclusão do job no Worker e retornam o contrato clássico:
* **Payload:**
```json
{
  "telefone": "5594991234567",
  "mensagem": "Sua confirmação chegou!"
}
```
* **Resposta (`200 OK`):**
```json
{
  "success": true,
  "message": "Mensagem enviada com sucesso!",
  "jid": "559491234567@s.whatsapp.net",
  "jobId": "14"
}
```
*(Dica: envie `"async": true` no body caso queira que a rota responda imediatamente sem esperar o tempo de digitação humana terminar).*

#### `POST /send-text`
Rota simplificada legada.
* **Payload:** `{ "number": "5594991234567", "text": "Olá!" }`
* **Resposta:** `{ "status": "sent", "to": "559491234567@s.whatsapp.net" }`

#### `POST /send-programmable`
Envia mensagens interativas com botões de link nativo (`cta_url`) ou botões de ação (`reply`, `webhook`, `collect`) com substituição automática das variáveis `$Phone$`, `$NickName$` e `$Input$`.
```json
{
  "number": "5594991234567",
  "messageText": "Escolha uma opção abaixo:",
  "footerText": "JVSM Services",
  "buttons": [
    {
      "type": "link",
      "label": "Acessar Portal",
      "payload": "[https://jvsm.services](https://jvsm.services)"
    }
  ]
}
```

---

## 🛡️ Boas Práticas de Uso (Para Nunca Tomar Ban)

1. **Prefira o Fluxo Passivo (Click-to-Chat) para Confirmações:** Sempre que possível, faça o usuário enviar a primeira mensagem para o bot (via link `https://wa.me/SEUNUMERO?text=Confirmar%20CODIGO`). Quando o cliente inicia a conversa, a janela de interação é considerada 100% orgânica pela Meta.
2. **Não altere `concurrency: 1` no Worker:** Humanos só conseguem digitar em uma conversa por vez. Manter a concorrência em `1` garante que o bot nunca envie duas mensagens no mesmo milissegundo.
3. **Evite URLs encurtadas públicas em disparos frios:** Encurtadores gratuitos (`bit.ly`, `tinyurl`) costumam estar em *blacklists* de spam da Meta. Use sempre seus próprios domínios nas mensagens.

---

## 📄 Licença

Este projeto está licenciado sob a **MIT License** — consulte o arquivo [LICENSE](./LICENSE) para mais detalhes.

Copyright (c) 2026 **João Victor Silva Morais (JVSM SERVICES LTDA)**.