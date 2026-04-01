# ZxZ — Middleware Zendesk ↔ ZapSign

Middleware Node.js que conecta o **Zendesk** à **ZapSign**, criando documentos para assinatura eletrônica a partir de tickets.

```
Ticket Zendesk ──► Webhook ──► Middleware ──► API ZapSign ──► Documento criado
                                                                    │
Ticket atualizado ◄── Middleware ◄── Webhook ZapSign ◄── Assinado ◄─┘
```

**O que acontece na prática:**

1. Ticket criado no Zendesk com a tag `enviar_contrato`
2. Zendesk dispara um webhook com os dados do ticket
3. Middleware recebe os dados, valida, e chama a API da ZapSign
4. ZapSign cria o documento e envia o link por e-mail e WhatsApp
5. Middleware adiciona nota interna no ticket com o link de assinatura
6. Quando o cliente assina, a ZapSign notifica o middleware via webhook
7. Middleware adiciona nota interna e tag `contrato_assinado` no ticket
8. Se o cliente recusar, adiciona nota e tag `contrato_recusado`

---

## Funcionalidades

- **Envio por e-mail e WhatsApp** — automático quando o telefone está preenchido
- **Rate limiting** — 50 req/15min global, 20 req/min no webhook
- **Autenticação segura** — webhook secret (Zendesk) e HMAC SHA-256 com raw body (ZapSign)
- **Proteção contra duplicatas** — evita criar múltiplos documentos se o trigger disparar repetido
- **Audit logs** — logs estruturados em JSON com CPF mascarado
- **Validação de dados** — CPF com dígitos verificadores, e-mail, campos obrigatórios
- **Alertas via Slack** — notificação automática em caso de falhas
- **Suporte a múltiplos signatários** — só marca como assinado quando todos assinaram
- **Documento recusado** — detecta recusa e adiciona tag + nota no ticket

---

## Pré-requisitos

- **Node.js** v18+
- **Conta ZapSign** com plano de API ([sandbox para testes](https://sandbox.app.zapsign.com.br/acesso/entrar))
- **Conta Zendesk** com acesso administrativo
- Servidor com HTTPS (ex: Render, Railway)

---

## Instalação

```bash
git clone https://github.com/emixsd/ZxZ.git
cd ZxZ
npm install
cp .env.example .env    # edite com seus tokens reais
npm run dev
```

---

## Deploy no Render

1. Acesse https://render.com → **New → Web Service**
2. Conecte o repo `emixsd/ZxZ`
3. Configure: Build `npm install`, Start `node scr/index.js`, Plan **Free**
4. Adicione as variáveis de ambiente (veja abaixo)
5. Deploy

---

## Configuração

### Zendesk — Webhook

**Admin Center → Apps and Integrations → Webhooks → Create Webhook**

| Campo | Valor |
|-------|-------|
| Endpoint URL | `https://SEU-APP.onrender.com/webhook/zendesk` |
| Method | POST |
| Format | JSON |

Adicione o cabeçalho: `x-webhook-secret` → mesmo valor do `WEBHOOK_SECRET` no Render.

### Zendesk — Trigger

**Admin Center → Objects and rules → Triggers → Add Trigger**

**Condições (Meet ALL):**
- Tag contém `enviar_contrato`
- Tag **não contém** `contrato_enviado`

**Ações:** Notificar webhook → selecionar o webhook criado

**Body JSON:**
```json
{
  "ticket_id": "{{ticket.id}}",
  "name": "{{ticket.requester.name}}",
  "email": "{{ticket.requester.email}}",
  "cpf": "{{ticket.ticket_field_XXXXX}}",
  "phone": "{{ticket.ticket_field_YYYYY}}",
  "template_id": "TOKEN_DO_MODELO"
}
```

### ZapSign — Webhook

**Configurações → Integração → Webhooks**

| Campo | Valor |
|-------|-------|
| Tipo de evento | Documento assinado |
| URL | `https://SEU-APP.onrender.com/webhook/zapsign` |

---

## Endpoints

| Método | Rota | Descrição |
|--------|------|-----------|
| POST | `/webhook/zendesk` | Recebe evento do Zendesk → cria documento na ZapSign |
| POST | `/webhook/zapsign` | Recebe evento da ZapSign → atualiza ticket no Zendesk |
| GET | `/health` | Health check |

---

## Estrutura

```
ZxZ/
├── scr/
│   ├── index.js       # Servidor, rotas, segurança, dedup
│   ├── config.js      # Variáveis de ambiente
│   ├── zapsign.js     # API ZapSign (modelo + upload PDF)
│   ├── zendesk.js     # API Zendesk (notas internas, tags)
│   └── utils.js       # Log, validação CPF/email, Slack
├── .env.example
├── .gitignore
├── package.json
└── README.md
```

---

## Variáveis de Ambiente

| Variável | Obrigatória | Descrição |
|----------|:-----------:|-----------|
| `ZAPSIGN_API_TOKEN` | ✅ | Token de API da ZapSign |
| `ZAPSIGN_BASE_URL` | ❌ | Default: `https://api.zapsign.com.br/api/v1`. Use `https://sandbox.api.zapsign.com.br/api/v1` para testes |
| `ZAPSIGN_TEMPLATE_ID` | ❌ | Token do modelo DOCX (fallback se não vier no body) |
| `ZAPSIGN_PDF_URL` | ❌ | URL do PDF (fallback se não usar modelo) |
| `ZAPSIGN_WEBHOOK_SECRET` | ❌ | Secret HMAC da ZapSign (quando disponível) |
| `ZENDESK_SUBDOMAIN` | ✅ | Subdomínio do Zendesk |
| `ZENDESK_EMAIL` | ✅ | E-mail do agente com permissão de API |
| `ZENDESK_API_TOKEN` | ✅ | Token de API do Zendesk |
| `WEBHOOK_SECRET` | ✅ | Secret para validar webhooks do Zendesk |
| `SLACK_WEBHOOK_URL` | ❌ | Webhook Slack para alertas de erro |
| `PORT` | ❌ | Default: `3000` |

> **Atenção:** o `ZAPSIGN_BASE_URL` default é produção. Para testes, defina explicitamente a URL do sandbox.

---

## Segurança

- **Zendesk** — `x-webhook-secret` com `timingSafeEqual`
- **ZapSign** — HMAC SHA-256 com raw body (quando secret configurado)
- **CPF mascarado** em todos os logs
- **Rate limiting** por IP
- **Proteção contra duplicatas** em memória

---

## Links

- [Documentação API ZapSign](https://docs.zapsign.com.br/)
- [Sandbox ZapSign](https://sandbox.app.zapsign.com.br/)
- [Zendesk API](https://developer.zendesk.com/api-reference/)

---

## Licença

MIT
