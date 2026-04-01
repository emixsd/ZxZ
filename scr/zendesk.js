const axios = require('axios');
const { config } = require('./config');

const zendeskApi = axios.create({
  baseURL: `https://${config.zendesk.subdomain}.zendesk.com/api/v2`,
  timeout: 15000, // 15 segundos
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
        public: false,
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

module.exports = {
  atualizarTicket,
  updateTicket: atualizarTicket,
};
