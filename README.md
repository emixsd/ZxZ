# ZxZ — Middleware Zendesk ↔ ZapSign

Middleware Node.js que conecta o **Zendesk** à **ZapSign**, criando documentos para assinatura eletrônica a partir de tickets de reembolso.

```
Ticket Zendesk ──► Webhook ──► Middleware ──► API ZapSign ──► Documento criado
                                                                    │
Ticket atualizado ◄── Middleware ◄── Webhook ZapSign ◄── Assinado ◄─┘
```

**O que acontece na prática:**

1. Ticket de reembolso criado no Zendesk
2. Zendesk dispara um webhook com os dados do ticket
3. Este middleware recebe os dados, valida, e chama a API da ZapSign
4. A ZapSign cria o documento e envia o link de assinatura ao cliente por e-mail ou WhatsApp
5. Quando o cliente assina, a ZapSign notifica este middleware via webhook
6. O middleware atualiza o ticket no Zendesk com o status da assinatura e resolve o ticket

---

## Funcionalidades

- **Rate limiting** — proteção contra abuso (50 req/15min global, 20 req/min no webhook)
- **Autenticação segura** — validação de webhook secret (Zendesk) e HMAC SHA-256 (ZapSign) com `timingSafeEqual`
- **Audit logs** — logs estruturados em JSON com mascaramento de CPF
- **Validação de dados** — CPF (com dígitos verificadores), e-mail e campos obrigatórios
- **Alertas via Slack** — notificação automática em caso de falhas
- **Resposta assíncrona** — retorna 200 imediatamente ao Zendesk e processa em background

---

## Pré-requisitos

- **Node.js** v18+
- **Conta ZapSign** com plano de API ([sandbox para testes](https://sandbox.app.zapsign.com.br/acesso/entrar))
- **Conta Zendesk** com acesso administrativo
- Servidor com HTTPS (para receber webhooks)

---

## Instalação

```bash
git clone https://github.com/emixsd/ZxZ.git
cd ZxZ
npm install
cp .env.example .env
```

Edite o `.env` com suas credenciais (veja a seção [Variáveis de Ambiente](#variáveis-de-ambiente)).

```bash
# Desenvolvimento (com hot-reload)
npm run dev

# Produção
npm start
```

---

## Configuração

### 1. Zendesk — Criar Webhook

**Admin Center → Apps and Integrations → Webhooks → Create Webhook**

| Campo | Valor |
|-------|-------|
| Endpoint URL | `https://seu-servidor.com/webhook/zendesk` |
| Method | POST |
| Content-Type | application/json |

Adicione o header customizado:
```
x-webhook-secret: {valor do WEBHOOK_SECRET no .env}
```

### 2. Zendesk — Criar Trigger

**Admin Center → Objects and rules → Triggers → Add Trigger**

**Condições:**
- Tag contém `enviar_contrato` (ou a condição desejada)

**Ações:**
- Notificar webhook → selecionar o webhook criado

**Body JSON do trigger:**

```json
{
  "ticket_id": "{{ticket.id}}",
  "name": "{{ticket.requester.name}}",
  "email": "{{ticket.requester.email}}",
  "cpf": "{{ticket.ticket_field_XXXXX}}",
  "template_id": "TOKEN_DO_MODELO_ZAPSIGN"
}
```

> Substitua `XXXXX` pelo ID do campo customizado de CPF no seu Zendesk.
> Substitua `TOKEN_DO_MODELO_ZAPSIGN` pelo token do modelo cadastrado na ZapSign.

### 3. ZapSign — Configurar Webhook de Retorno

**Configurações → Integração → Webhooks** e adicione:

```
URL: https://seu-servidor.com/webhook/zapsign
```

---

## Endpoints

### `POST /webhook/zendesk`

Recebe o evento do Zendesk, valida os dados e cria o documento na ZapSign.

**Headers obrigatórios:**
```
x-webhook-secret: {WEBHOOK_SECRET}
Content-Type: application/json
```

**Body:**
```json
{
  "ticket_id": "12345",
  "name": "João da Silva",
  "email": "joao@email.com",
  "cpf": "12345678909",
  "template_id": "abc123-def456"
}
```

**Resposta (200):**
```json
{
  "status": "processing",
  "ticket_id": "12345"
}
```

**Validações aplicadas:**
- `ticket_id` — obrigatório
- `name` — obrigatório, mínimo 2 caracteres
- `email` — formato válido
- `cpf` — validado com algoritmo de dígitos verificadores
- `template_id` — obrigatório

Após o retorno, o middleware processa em background: cria o documento na ZapSign e adiciona uma nota interna no ticket com o link de assinatura.

---

### `POST /webhook/zapsign`

Recebe notificações da ZapSign quando um documento é assinado.

**Headers obrigatórios:**
```
x-zapsign-hmac-sha256: {assinatura HMAC do body}
```

**Eventos tratados:**
- `sign_doc` → atualiza o ticket no Zendesk com "✅ Documento assinado", adiciona tag `contrato_assinado` e resolve o ticket automaticamente

---

### `GET /health`

Health check do servidor.

```json
{ "status": "ok", "timestamp": "2026-03-27T12:00:00.000Z" }
```

---

## Estrutura do Projeto

```
ZxZ/
├── scr/
│   ├── index.js       # Servidor Express, rotas e middlewares de segurança
│   ├── config.js      # Carrega e valida variáveis de ambiente
│   ├── zapsign.js     # Integração com a API da ZapSign (modelo dinâmico + upload PDF)
│   ├── zendesk.js     # Integração com a API do Zendesk (notas internas, tags, status)
│   └── utils.js       # Audit log, validação de CPF/email, mascaramento, alerta Slack
├── .env.example
├── package.json
└── README.md
```

---

## Variáveis de Ambiente

| Variável | Obrigatória | Descrição |
|----------|:-----------:|-----------|
| `ZAPSIGN_API_TOKEN` | ✅ | Token de API da ZapSign (Configurações → Integração) |
| `ZAPSIGN_WEBHOOK_SECRET` | ✅ | Secret para validar HMAC dos webhooks da ZapSign |
| `ZAPSIGN_BASE_URL` | ❌ | URL base da API. Default: `https://api.zapsign.com.br/api/v1` |
| `ZAPSIGN_TEMPLATE_ID` | ❌ | Token do modelo DOCX padrão (usado se não vier no body) |
| `ZAPSIGN_PDF_URL` | ❌ | URL pública do PDF (fallback se não usar modelo) |
| `ZENDESK_SUBDOMAIN` | ✅ | Subdomínio (ex: `minhaempresa` → minhaempresa.zendesk.com) |
| `ZENDESK_EMAIL` | ✅ | E-mail do agente com permissão de API |
| `ZENDESK_API_TOKEN` | ✅ | Token de API do Zendesk |
| `WEBHOOK_SECRET` | ✅ | Secret para validar webhooks recebidos do Zendesk |
| `SLACK_WEBHOOK_URL` | ❌ | URL do webhook Slack para alertas de erro |
| `PORT` | ❌ | Porta do servidor. Default: `3000` |

---

## Ambiente de Testes

Use o **sandbox da ZapSign** para testar sem custos:

```env
ZAPSIGN_BASE_URL=https://sandbox.api.zapsign.com.br/api/v1
```

Para expor o servidor local e receber webhooks durante desenvolvimento:

```bash
npx ngrok http 3000
```

---

## Segurança

- **Webhook Zendesk** — validação via `x-webhook-secret` com `crypto.timingSafeEqual` (previne timing attacks)
- **Webhook ZapSign** — validação via `x-zapsign-hmac-sha256` com HMAC SHA-256
- **CPF mascarado** em todos os logs (`***.***. 789-09`)
- **Token do documento** não é exposto nos comentários do ticket
- **Rate limiting** por IP em todas as rotas

---

## Links Úteis

- [Documentação API ZapSign](https://docs.zapsign.com.br/)
- [Sandbox ZapSign](https://sandbox.app.zapsign.com.br/)
- [Postman Collection ZapSign](https://www.postman.com/zapsign/zapsign-workspace/)
- [Zendesk API Reference](https://developer.zendesk.com/api-reference/)
- [Zendesk Webhooks](https://developer.zendesk.com/documentation/webhooks/)

---

## Licença

MIT
