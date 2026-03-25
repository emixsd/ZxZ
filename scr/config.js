require("dotenv").config();

const REQUIRED = [
  "ZAPSIGN_API_TOKEN",
  "ZAPSIGN_WEBHOOK_SECRET",  // secret para validar webhooks recebidos da ZapSign
  "ZENDESK_SUBDOMAIN",
  "ZENDESK_EMAIL",
  "ZENDESK_API_TOKEN",
  "WEBHOOK_SECRET",
];

const OPTIONAL = [
  "SLACK_WEBHOOK_URL", // Para alertas de erro (opcional)
  "PORT",
];

const missing = REQUIRED.filter((key) => !process.env[key]);

if (missing.length > 0) {
  console.error(`❌ Variáveis de ambiente obrigatórias não definidas: ${missing.join(", ")}`);
  process.exit(1);
}

const config = {
  ZAPSIGN_API_TOKEN: process.env.ZAPSIGN_API_TOKEN,
  ZAPSIGN_WEBHOOK_SECRET: process.env.ZAPSIGN_WEBHOOK_SECRET,
  ZENDESK_SUBDOMAIN: process.env.ZENDESK_SUBDOMAIN,
  ZENDESK_EMAIL: process.env.ZENDESK_EMAIL,
  ZENDESK_API_TOKEN: process.env.ZENDESK_API_TOKEN,
  WEBHOOK_SECRET: process.env.WEBHOOK_SECRET,
  SLACK_WEBHOOK_URL: process.env.SLACK_WEBHOOK_URL || null,
  PORT: process.env.PORT || 3000,
};

module.exports = { config };
