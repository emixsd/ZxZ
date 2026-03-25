const express = require("express");
const crypto = require("crypto");
const rateLimit = require("express-rate-limit");
const { config } = require("./config");
const { createDocumentFromTemplate } = require("./zapsign");
const { updateTicket } = require("./zendesk");
const { auditLog, maskCPF, validateEmail, validateCPF, sendErrorAlert } = require("./utils");

const app = express();
app.use(express.json());

// ─── Rate Limiting ────────────────────────────────────────────────────────────
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 50,                   // máximo 50 requisições por IP
  message: { error: "Muitas requisições. Tente novamente em 15 minutos." },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(limiter);

// Rate limit mais restrito para o webhook do Zendesk
const webhookLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minuto
  max: 20,
  message: { error: "Rate limit excedido no webhook." },
});

// ─── Validação do Webhook Secret ─────────────────────────────────────────────
function validateWebhookSecret(req, res, next) {
  const incomingSecret = req.headers["x-webhook-secret"];
  if (!incomingSecret || incomingSecret !== config.WEBHOOK_SECRET) {
    auditLog("WARN", "webhook_rejected", {
      ip: req.ip,
      reason: "Invalid webhook secret",
    });
    return res.status(401).json({ error: "Não autorizado." });
  }
  next();
}

// ─── Rota principal: Zendesk → ZapSign ───────────────────────────────────────
app.post("/webhook/zendesk", webhookLimiter, validateWebhookSecret, async (req, res) => {
  const { ticket_id, name, email, cpf, template_id } = req.body;

  // 1. Validação de entrada
  const errors = [];
  if (!ticket_id) errors.push("ticket_id é obrigatório");
  if (!name || name.trim().length < 2) errors.push("name inválido");
  if (!email || !validateEmail(email)) errors.push("email inválido");
  if (!cpf || !validateCPF(cpf)) errors.push("CPF inválido");
  if (!template_id) errors.push("template_id é obrigatório");

  if (errors.length > 0) {
    auditLog("WARN", "validation_failed", { ticket_id, email, errors });
    return res.status(400).json({ error: "Dados inválidos", details: errors });
  }

  // 2. Log de auditoria (SEM CPF)
  auditLog("INFO", "request_received", {
    ticket_id,
    email,
    name,
    cpf: maskCPF(cpf), // ex: ***.***.789-09
  });

  // Responde imediatamente ao Zendesk (evita timeout de 5s)
  res.status(200).json({ status: "processing", ticket_id });

  // 3. Processamento assíncrono
  try {
    const doc = await createDocumentFromTemplate({ template_id, name, email, cpf, ticket_id });

    auditLog("INFO", "document_created", {
      ticket_id,
      email,
      doc_token: doc.token,
      sign_url: doc.signers?.[0]?.sign_url,
    });

    await updateTicket(ticket_id, {
      comment: `📄 Documento enviado para assinatura.\n🔗 Link: ${doc.signers?.[0]?.sign_url}\n📋 Token ZapSign: ${doc.token}`,
      tags: ["contrato_enviado"],
    });

    auditLog("INFO", "ticket_updated", { ticket_id, status: "contrato_enviado" });

  } catch (err) {
    auditLog("ERROR", "processing_failed", {
      ticket_id,
      email,
      error: err.message,
    });

    await sendErrorAlert({
      title: "❌ Falha ao enviar documento",
      ticket_id,
      email,
      error: err.message,
    });
  }
});

// ─── Rota: Webhook ZapSign (documento assinado) ───────────────────────────────
app.post("/webhook/zapsign", async (req, res) => {
  const { document, event_action } = req.body;

  if (event_action !== "sign_doc") {
    return res.status(200).json({ status: "ignored" });
  }

  const ticket_id = document?.external_id;
  const signer_email = document?.signers?.[0]?.email;

  auditLog("INFO", "document_signed", { ticket_id, signer_email, doc_token: document?.token });

  res.status(200).json({ status: "ok" });

  try {
    if (ticket_id) {
      await updateTicket(ticket_id, {
        comment: `✅ Documento assinado por ${signer_email}.\n📋 Token: ${document?.token}`,
        tags: ["contrato_assinado"],
        status: "solved",
      });

      auditLog("INFO", "ticket_solved", { ticket_id, signer_email });
    }
  } catch (err) {
    auditLog("ERROR", "zapsign_webhook_failed", { ticket_id, error: err.message });

    await sendErrorAlert({
      title: "❌ Falha ao processar assinatura",
      ticket_id,
      email: signer_email,
      error: err.message,
    });
  }
});

// ─── Health check ─────────────────────────────────────────────────────────────
app.get("/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// ─── Start ────────────────────────────────────────────────────────────────────
const PORT = config.PORT || 3000;
app.listen(PORT, () => {
  auditLog("INFO", "server_started", { port: PORT });
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
});
