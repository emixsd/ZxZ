const axios = require('axios');
const { config } = require('./config');

const zendeskApi = axios.create({
  baseURL: `https://${config.zendesk.subdomain}.zendesk.com/api/v2`,
  auth: {
    username: `${config.zendesk.email}/token`,
    password: config.zendesk.apiToken,
  },
  headers: { 'Content-Type': 'application/json' },
});

/**
 * Adiciona um comentário interno ao ticket e atualiza tags.
 */
async function atualizarTicket(ticketId, { mensagem, comment, tags = [], camposCustom = [], status }) {
  const body = mensagem || comment || '';
  const ticketUpdate = {
    ticket: {
      comment: {
        body,
        public: false, // nota interna — não visível ao cliente
      },
    },
  };

  if (tags.length > 0) {
    ticketUpdate.ticket.additional_tags = tags;
  }

  if (camposCustom.length > 0) {
    ticketUpdate.ticket.custom_fields = camposCustom;
  }

  if (status) {
    ticketUpdate.ticket.status = status;
  }

  const { data } = await zendeskApi.put(`/tickets/${ticketId}`, ticketUpdate);
  return data;
}

/**
 * Registra no ticket que o documento foi enviado para assinatura.
 */
async function registrarDocumentoEnviado(ticketId, { signUrl, docToken }) {
  const mensagem = [
    '📄 Documento enviado para assinatura via ZapSign.',
    '',
    `🔗 Link de assinatura: ${signUrl}`,
    `📋 Token do documento: ${docToken}`,
    '',
    'O cliente receberá o link por e-mail ou Wpp automaticamente.',
  ].join('\n');

  return atualizarTicket(ticketId, {
    mensagem,
    tags: ['contrato_enviado'],
  });
}

/**
 * Registra no ticket que o documento foi assinado.
 */
async function registrarDocumentoAssinado(ticketId, { signerName }) {
  const mensagem = [
    `✅ Documento assinado por ${signerName}.`,
    `📅 Data: ${new Date().toLocaleString('pt-BR')}`,
    '',
    'O arquivo assinado está disponível na plataforma ZapSign.',
  ].join('\n');

  return atualizarTicket(ticketId, {
    mensagem,
    tags: ['contrato_assinado'],
  });
}

/**
 * Registra no ticket que o documento foi recusado.
 */
async function registrarDocumentoRecusado(ticketId, { signerName, motivo }) {
  const mensagem = [
    `❌ Documento recusado por ${signerName}.`,
    motivo ? `📝 Motivo: ${motivo}` : '',
    `📅 Data: ${new Date().toLocaleString('pt-BR')}`,
  ].filter(Boolean).join('\n');

  return atualizarTicket(ticketId, {
    mensagem,
    tags: ['contrato_recusado'],
  });
}

module.exports = {
  atualizarTicket,
  registrarDocumentoEnviado,
  registrarDocumentoAssinado,
  registrarDocumentoRecusado,
  // alias usado em index.js
  updateTicket: atualizarTicket,
};
