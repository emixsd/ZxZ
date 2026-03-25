const express = require('express');
const config = require('./config');
const zapsign = require('./zapsign');
const zendesk = require('./zendesk');

const app = express();
app.use(express.json());

// ─────────────────────────────────────────────
// Middleware de autenticação (webhooks do Zendesk)
// ─────────────────────────────────────────────
function autenticarWebhook(req, res, next) {
  if (!config.webhookSecret) return next();

  const authHeader = req.headers.authorization || '';
  const token = authHeader.replace('Bearer ', '');

  if (token !== config.webhookSecret) {
    console.warn('⚠️  Webhook recebido com token inválido');
    return res.status(401).json({ error: 'Token inválido' });
  }

  next();
}

// ─────────────────────────────────────────────
// POST /api/zendesk-to-zapsign
// Recebe webhook do Zendesk → cria documento na ZapSign
// ─────────────────────────────────────────────
app.post('/api/zendesk-to-zapsign', autenticarWebhook, async (req, res) => {
  const {
    ticket_id,
    ticket_subject,
    requester_name,
    requester_email,
    requester_phone,
    organization,
    custom_field_cpf,
  } = req.body;

  // Validação básica
  if (!ticket_id || !requester_name) {
    return res.status(400).json({
      error: 'Campos obrigatórios: ticket_id, requester_name',
    });
  }

  console.log(`\n🎫 Ticket #${ticket_id} recebido — criando documento para ${requester_name}`);

  try {
    // 1. Criar documento na ZapSign
    const doc = await zapsign.criarDocumento({
      ticketId: ticket_id,
      nome: requester_name,
      email: requester_email,
      telefone: requester_phone,
      cpf: custom_field_cpf,
      organizacao: organization,
      assunto: ticket_subject,
    });

    const signerToken = doc.signers[0].token;
    const signUrl = `https://app.zapsign.com.br/verificar/${signerToken}`;

    console.log(`✅ Documento criado — token: ${doc.token}`);
    console.log(`🔗 Link de assinatura: ${signUrl}`);

    // 2. Atualizar o ticket no Zendesk com nota interna
    try {
      await zendesk.registrarDocumentoEnviado(ticket_id, {
        signUrl,
        docToken: doc.token,
      });
      console.log(`📝 Ticket #${ticket_id} atualizado no Zendesk`);
    } catch (zendeskErr) {
      // Não falha a resposta se o Zendesk der erro — o documento já foi criado
      console.error('⚠️  Falha ao atualizar ticket no Zendesk:', zendeskErr.message);
    }

    // 3. Responder com sucesso
    res.status(200).json({
      success: true,
      document_token: doc.token,
      sign_url: signUrl,
    });
  } catch (error) {
    const detalhes = error.response?.data || error.message;
    console.error('❌ Erro ao criar documento:', detalhes);
    res.status(500).json({ error: 'Falha ao criar documento', detalhes });
  }
});

// ─────────────────────────────────────────────
// POST /api/zapsign-webhook
// Recebe webhook da ZapSign → atualiza ticket no Zendesk
// ─────────────────────────────────────────────
app.post('/api/zapsign-webhook', async (req, res) => {
  // Retornar 200 imediatamente — a ZapSign reenvia se não receber 200
  res.status(200).json({ received: true });

  const payload = req.body;
  const externalId = payload.external_id || '';
  const eventType = payload.event_type || '';

  console.log(`\n📩 Webhook ZapSign recebido — evento: ${eventType}, external_id: ${externalId}`);

  // Extrair ticket_id do external_id (formato: "zendesk-12345")
  if (!externalId.startsWith('zendesk-')) {
    console.log('ℹ️  Documento não vinculado ao Zendesk — ignorando');
    return;
  }

  const ticketId = externalId.replace('zendesk-', '');

  try {
    if (eventType === 'doc_signed') {
      const signerName = payload.signer?.name || 'Signatário';
      await zendesk.registrarDocumentoAssinado(ticketId, { signerName });
      console.log(`✅ Ticket #${ticketId} atualizado — documento assinado por ${signerName}`);
    }

    if (eventType === 'doc_refused') {
      const signerName = payload.signer?.name || 'Signatário';
      const motivo = payload.refusal_reason || '';
      await zendesk.registrarDocumentoRecusado(ticketId, { signerName, motivo });
      console.log(`❌ Ticket #${ticketId} atualizado — documento recusado por ${signerName}`);
    }
  } catch (error) {
    console.error(`⚠️  Falha ao atualizar ticket #${ticketId}:`, error.message);
  }
});

// ─────────────────────────────────────────────
// GET /health
// ─────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    zapsign_url: config.zapsign.baseUrl,
    zendesk_subdomain: config.zendesk.subdomain,
    modo: config.zapsign.templateId ? 'modelo_dinamico' : 'upload_pdf',
  });
});

// ─────────────────────────────────────────────
// Iniciar servidor
// ─────────────────────────────────────────────
app.listen(config.port, () => {
  console.log('');
  console.log('🚀 ZapSign ↔ Zendesk Middleware');
  console.log(`   Porta: ${config.port}`);
  console.log(`   ZapSign API: ${config.zapsign.baseUrl}`);
  console.log(`   Zendesk: ${config.zendesk.subdomain}.zendesk.com`);
  console.log(`   Modo: ${config.zapsign.templateId ? 'Modelo dinâmico' : 'Upload de PDF'}`);
  console.log('');
  console.log('   Endpoints:');
  console.log('   POST /api/zendesk-to-zapsign  ← webhook do Zendesk');
  console.log('   POST /api/zapsign-webhook     ← webhook da ZapSign');
  console.log('   GET  /health                  ← health check');
  console.log('');
});
