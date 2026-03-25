require('dotenv').config();

const config = {
  // ZapSign
  zapsign: {
    apiToken: process.env.ZAPSIGN_API_TOKEN,
    baseUrl: process.env.ZAPSIGN_BASE_URL || 'https://api.zapsign.com.br/api/v1',
    templateId: process.env.ZAPSIGN_TEMPLATE_ID || '',
    pdfUrl: process.env.ZAPSIGN_PDF_URL || '',
  },

  // Zendesk
  zendesk: {
    subdomain: process.env.ZENDESK_SUBDOMAIN,
    email: process.env.ZENDESK_EMAIL,
    apiToken: process.env.ZENDESK_API_TOKEN,
  },

  // Servidor
  port: parseInt(process.env.PORT, 10) || 3000,
  webhookSecret: process.env.WEBHOOK_SECRET || '',
};

// Validação básica
const required = [
  ['ZAPSIGN_API_TOKEN', config.zapsign.apiToken],
  ['ZENDESK_SUBDOMAIN', config.zendesk.subdomain],
  ['ZENDESK_EMAIL', config.zendesk.email],
  ['ZENDESK_API_TOKEN', config.zendesk.apiToken],
];

for (const [name, value] of required) {
  if (!value) {
    console.error(`❌ Variável de ambiente obrigatória não definida: ${name}`);
    console.error('   Copie .env.example para .env e preencha as credenciais.');
    process.exit(1);
  }
}

module.exports = config;
