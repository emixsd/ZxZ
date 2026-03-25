# 🔗 ZapSign + Zendesk Middleware

Middleware Node.js que conecta o **Zendesk** à **ZapSign**, permitindo criar e enviar documentos para assinatura eletrônica diretamente a partir de tickets.

## Fluxo

```
Ticket Zendesk ──► Webhook ──► Middleware ──► API ZapSign ──► Documento criado
                                                                    │
Ticket atualizado ◄── Middleware ◄── Webhook ZapSign ◄── Assinado ◄─┘
```

**O que acontece na prática:**

1. Um agente adiciona a tag `enviar_contrato` no ticket (ou qualquer trigger configurado)
2. O Zendesk dispara um webhook com os dados do ticket
3. Este middleware recebe os dados, monta o payload e chama a API da ZapSign
4. A ZapSign cria o documento e envia o link de assinatura ao cliente por e-mail
5. Quando o cliente assina, a ZapSign notifica este middleware via webhook
6. O middleware atualiza o ticket no Zendesk com o status da assinatura

---

## Pré-requisitos

- **Node.js** v18+
- **Conta ZapSign** com plano de API ([criar conta sandbox](https://sandbox.app.zapsign.com.br/acesso/entrar))
- **Conta Zendesk** com acesso administrativo
- Servidor com HTTPS (para receber webhooks)

---

## Instalação

```bash
git clone https://github.com/SEU_USUARIO/zapsign-zendesk-middleware.git
cd zapsign-zendesk-middleware
npm install
cp .env.example .env
```

Edite o `.env` com suas credenciais:

```env
# ZapSign
ZAPSIGN_API_TOKEN=seu_token_aqui
ZAPSIGN_BASE_URL=https://api.zapsign.com.br/api/v1
ZAPSIGN_TEMPLATE_ID=token_do_modelo

# Zendesk
ZENDESK_SUBDOMAIN=sua-empresa
ZENDESK_EMAIL=agente@empresa.com
ZENDESK_API_TOKEN=seu_token_zendesk

# Servidor
PORT=3000
WEBHOOK_SECRET=sua_chave_secreta
```

Inicie o servidor:

```bash
# Desenvolvimento
npm run dev

# Produção
npm start
```

---

## Configuração no Zendesk

### 1. Criar o Webhook

**Admin Center → Apps and Integrations → Webhooks → Create Webhook**

| Campo | Valor |
|-------|-------|
| Endpoint URL | `https://seu-servidor.com/api/zendesk-to-zapsign` |
| Method | POST |
| Authentication | Bearer Token → valor do `WEBHOOK_SECRET` |
| Content-Type | application/json |

### 2. Criar o Trigger

**Admin Center → Objects and rules → Triggers → Add Trigger**

**Condições (atenda TODAS):**
- Tag contém `enviar_contrato`
- Status é `Open` ou `Pending`

**Ações:**
- Notificar webhook → selecionar o webhook criado

**Body do JSON:**

```json
{
  "ticket_id": "{{ticket.id}}",
  "ticket_subject": "{{ticket.title}}",
  "requester_name": "{{ticket.requester.name}}",
  "requester_email": "{{ticket.requester.email}}",
  "requester_phone": "{{ticket.requester.phone}}",
  "organization": "{{ticket.organization.name}}",
  "custom_field_cpf": "{{ticket.ticket_field_XXXXX}}"
}
```

> Substitua `XXXXX` pelo ID do campo customizado de CPF no seu Zendesk.

### 3. Configurar Webhook da ZapSign (retorno)

Na ZapSign, vá em **Configurações → Integração → Webhooks** e adicione:

```
URL: https://seu-servidor.com/api/zapsign-webhook
```

---

## Endpoints da API

### `POST /api/zendesk-to-zapsign`

Recebe o webhook do Zendesk e cria o documento na ZapSign.

**Headers:**
```
Authorization: Bearer {WEBHOOK_SECRET}
Content-Type: application/json
```

**Body:**
```json
{
  "ticket_id": "12345",
  "ticket_subject": "Solicitação de contrato",
  "requester_name": "João da Silva",
  "requester_email": "joao@email.com",
  "requester_phone": "+5511999998888",
  "organization": "Empresa XPTO",
  "custom_field_cpf": "12345678900"
}
```

**Resposta (200):**
```json
{
  "success": true,
  "document_token": "eb9c367a-e62f-4992-8360-b0219deaeecc",
  "sign_url": "https://app.zapsign.com.br/verificar/921c115d-..."
}
```

---

### `POST /api/zapsign-webhook`

Recebe notificações da ZapSign (documento assinado, recusado, etc.) e atualiza o ticket no Zendesk.

**Eventos tratados:**
- `doc_signed` → adiciona nota interna "✅ Documento assinado" + tag `contrato_assinado`
- `doc_refused` → adiciona nota interna "❌ Documento recusado" + tag `contrato_recusado`

---

### `GET /health`

Health check do servidor.

---

## Modos de Criação de Documento

### Via Modelo Dinâmico (padrão)

Usa um modelo DOCX pré-cadastrado na ZapSign com variáveis como `{{NOME_CLIENTE}}`, `{{CPF}}`, etc. Os dados do ticket preenchem automaticamente.

Para usar, defina `ZAPSIGN_TEMPLATE_ID` no `.env`.

### Via Upload de PDF

Se `ZAPSIGN_TEMPLATE_ID` não estiver definido, o middleware usa `ZAPSIGN_PDF_URL` para enviar um PDF fixo.

```env
ZAPSIGN_PDF_URL=https://seu-servidor.com/contratos/modelo.pdf
```

---

## Estrutura do Projeto

```
├── src/
│   ├── index.js              # Servidor Express + rotas
│   ├── zapsign.js             # Funções de integração com a ZapSign
│   ├── zendesk.js             # Funções de integração com o Zendesk
│   └── config.js              # Carrega variáveis de ambiente
├── .env.example
├── package.json
└── README.md
```

---

## Ambiente de Testes

Para testar sem custos, use o **sandbox da ZapSign**:

```env
ZAPSIGN_BASE_URL=https://sandbox.api.zapsign.com.br/api/v1
```

Para expor o servidor local e receber webhooks, use o [ngrok](https://ngrok.com):

```bash
ngrok http 3000
```

---

## Variáveis de Ambiente

| Variável | Obrigatória | Descrição |
|----------|:-----------:|-----------|
| `ZAPSIGN_API_TOKEN` | ✅ | Token de API da ZapSign |
| `ZAPSIGN_BASE_URL` | ✅ | URL base da API (`https://api.zapsign.com.br/api/v1`) |
| `ZAPSIGN_TEMPLATE_ID` | ❌ | Token do modelo DOCX (se não definido, usa `PDF_URL`) |
| `ZAPSIGN_PDF_URL` | ❌ | URL pública do PDF (fallback quando não usa modelo) |
| `ZENDESK_SUBDOMAIN` | ✅ | Subdomínio do Zendesk (ex: `minhaempresa`) |
| `ZENDESK_EMAIL` | ✅ | E-mail do agente com permissão de API |
| `ZENDESK_API_TOKEN` | ✅ | Token de API do Zendesk |
| `PORT` | ❌ | Porta do servidor (padrão: `3000`) |
| `WEBHOOK_SECRET` | ❌ | Chave para validar webhooks do Zendesk |

---

## Licença

MIT
