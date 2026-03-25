require("dotenv").config();

const REQUIRED = [
  "ZAPSIGN_API_TOKEN",
  "ZAPSIGN_WEBHOOK_SECRET",
  "ZENDESK_SUBDOMAIN",
  "ZENDESK_EMAIL",
  "ZENDESK_API_TOKEN",
  "WEBHOOK_SECRET",
];

const missing = REQUIRED.filter((key) => !process.env[key]);

if (missing.length > 0) {
  console.error(`Variáveis obrigatórias ausentes: ${missing.join(", ")}`);
  process.exit(1);
}

module.exports = {
  zapsign: {
    apiToken: process.env.ZAPSIGN_API_TOKEN,
    webhookSecret: process.env.ZAPSIGN_WEBHOOK_SECRET,
    baseUrl: process.env.ZAPSIGN_BASE_URL || "https://api.zapsign.com.br/api/v1",
    templateId: process.env.ZAPSIGN_TEMPLATE_ID || "",
    pdfUrl: process.env.ZAPSIGN_PDF_URL || "",
  },
  zendesk: {
    subdomain: process.env.ZENDESK_SUBDOMAIN,
    email: process.env.ZENDESK_EMAIL,
    apiToken: process.env.ZENDESK_API_TOKEN,
  },
  webhookSecret: process.env.WEBHOOK_SECRET,
  slackWebhookUrl: process.env.SLACK_WEBHOOK_URL || null,
  port: Number(process.env.PORT || 3000),
};

module.exports = { config };
