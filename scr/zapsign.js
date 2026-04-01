const axios = require('axios');
const { config } = require('./config');

const zapsignApi = axios.create({
  baseURL: config.zapsign.baseUrl,
  timeout: 30000, // 30 segundos
  headers: {
    'Authorization': `Bearer ${config.zapsign.apiToken}`,
    'Content-Type': 'application/json',
  },
});

/**
 * Cria um documento na ZapSign via modelo dinâmico DOCX.
 * Aceita nomes de campos em inglês (vindos do index.js) ou português.
 */
async function criarDocumentoViaModelo(params) {
  const nome = (params.name || params.nome || '').trim();
  const email = params.email || '';
  const telefone = params.phone || params.telefone || '';
  const cpf = params.cpf || '';
  const ticketId = params.ticket_id || params.ticketId || '';
  const templateId = params.template_id || config.zapsign.templateId;
  const organizacao = params.organizacao || '';
  const assunto = params.assunto || '';

  const phoneClean = limparTelefone(telefone);
  const hasPhone = phoneClean.length >= 10;

  const payload = {
    template_id: templateId,
    signer_name: nome,
    signer_email: email || '',
    signer_phone_country: '55',
    signer_phone_number: phoneClean,
    send_automatic_email: !!email,
    send_automatic_whatsapp: hasPhone,
    external_id: `zendesk-${ticketId}`,
    folder_path: '/zendesk/',
    lang: 'pt-br',
    custom_message: hasPhone
      ? `Olá ${nome}, segue o documento referente ao chamado #${ticketId} para sua assinatura. Atenciosamente, Equipe de Suporte`
      : `Olá ${nome},\nSegue o documento referente ao chamado #${ticketId} para sua assinatura.\nAtenciosamente, Equipe de Suporte`,
    data: [
      { de: '{{NOME_CLIENTE}}', para: nome },
      { de: '{{CPF}}', para: cpf },
      { de: '{{EMAIL}}', para: email },
      { de: '{{NUMERO_TICKET}}', para: String(ticketId) },
      { de: '{{DATA}}', para: new Date().toLocaleDateString('pt-BR') },
      { de: '{{ORGANIZACAO}}', para: organizacao },
      { de: '{{ASSUNTO}}', para: assunto },
    ],
  };

  const { data } = await zapsignApi.post('/models/create-doc/', payload);
  return data;
}

/**
 * Cria um documento na ZapSign via upload de PDF (URL pública ou base64).
 */
async function criarDocumentoViaUpload(params) {
  const nome = (params.name || params.nome || '').trim();
  const email = params.email || '';
  const telefone = params.phone || params.telefone || '';
  const cpf = params.cpf || '';
  const ticketId = params.ticket_id || params.ticketId || '';
  const assunto = params.assunto || '';

  const phoneClean = limparTelefone(telefone);
  const hasPhone = phoneClean.length >= 10;

  const payload = {
    name: `Contrato - Ticket #${ticketId} - ${assunto || 'Documento'}`,
    url_pdf: config.zapsign.pdfUrl,
    lang: 'pt-br',
    external_id: `zendesk-${ticketId}`,
    folder_path: '/zendesk/',
    send_automatic_email: !!email,
    signers: [
      {
        name: nome,
        email: email || '',
        phone_country: '55',
        phone_number: phoneClean,
        auth_mode: 'assinaturaTela',
        send_automatic_email: !!email,
        send_automatic_whatsapp: hasPhone,
        lock_name: true,
        lock_email: true,
        require_cpf: !!cpf,
        cpf: cpf || '',
        custom_message: hasPhone
          ? `Olá ${nome}, segue o documento do chamado #${ticketId} para assinatura.`
          : `Olá ${nome},\nSegue o documento do chamado #${ticketId} para assinatura.`,
      },
    ],
  };

  const { data } = await zapsignApi.post('/docs/', payload);
  return data;
}

/**
 * Função principal — decide entre modelo ou upload conforme configuração.
 */
async function criarDocumento(dadosTicket) {
  if (dadosTicket.template_id || config.zapsign.templateId) {
    return criarDocumentoViaModelo(dadosTicket);
  }

  if (config.zapsign.pdfUrl) {
    return criarDocumentoViaUpload(dadosTicket);
  }

  throw new Error(
    'Nenhuma origem de documento configurada. Defina ZAPSIGN_TEMPLATE_ID ou ZAPSIGN_PDF_URL no .env'
  );
}

/**
 * Consulta os detalhes de um documento na ZapSign.
 */
async function detalharDocumento(docToken) {
  const { data } = await zapsignApi.get(`/docs/${docToken}/`);
  return data;
}

/**
 * Remove caracteres não numéricos do telefone.
 */
function limparTelefone(telefone) {
  if (!telefone) return '';
  return telefone.replace(/\D/g, '').replace(/^55/, '');
}

module.exports = {
  criarDocumento,
  criarDocumentoViaModelo,
  criarDocumentoViaUpload,
  detalharDocumento,
  // alias usado em index.js — aponta pra função principal (com fallback PDF)
  createDocument: criarDocumento,
};
