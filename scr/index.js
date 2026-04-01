const express = require("express");
const crypto = require("crypto"); // usado em validateWebhookSecret e validateZapSignSignature
const rateLimit = require("express-rate-limit");
const { config } = require("./config");
const { createDocumentFromTemplate } = require("./zapsign");
const { updateTicket } = require("./zendesk");
const { auditLog, maskCPF, validateEmail, validateCPF, sendErrorAlert } = require("./utils");

const app = express();
app.set("trust proxy", 1); // Render usa proxy reverso
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

// ─── Validação do Webhook Secret (Zendesk) ───────────────────────────────────
// Usa timingSafeEqual para evitar timing attacks (comparação de string comum
// pode vazar o tamanho do secret por diferença de tempo de resposta)
function validateWebhookSecret(req, res, next) {
  const incomingSecret = req.headers["x-webhook-secret"];
  if (!incomingSecret) {
    auditLog("WARN", "webhook_rejected", { ip: req.ip, reason: "Missing secret" });
    return res.status(401).json({ error: "Não autorizado." });
  }
  try {
    const a = Buffer.from(incomingSecret);
    const b = Buffer.from(config.WEBHOOK_SECRET);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      throw new Error("Secret mismatch");
    }
  } catch {
    auditLog("WARN", "webhook_rejected", { ip: req.ip, reason: "Invalid secret" });
    return res.status(401).json({ error: "Não autorizado." });
  }
  next();
}

// ─── Autenticação do Webhook ZapSign ─────────────────────────────────────────
// A ZapSign envia um header x-zapsign-hmac-sha256 com HMAC do body.
// Se ZAPSIGN_WEBHOOK_SECRET não estiver configurado, pula a validação.
function validateZapSignSignature(req, res, next) {
  // Se não tem secret configurado, pula validação (útil pra contas sem HMAC)
  if (!config.zapsign.webhookSecret) {
    auditLog("WARN", "zapsign_hmac_skipped", { ip: req.ip, reason: "No ZAPSIGN_WEBHOOK_SECRET configured" });
    return next();
  }

  const signature = req.headers["x-zapsign-hmac-sha256"];
  if (!signature) {
    auditLog("WARN", "zapsign_webhook_rejected", { ip: req.ip, reason: "Missing signature" });
    return res.status(401).json({ error: "Não autorizado." });
  }
  try {
    const rawBody = JSON.stringify(req.body);
    const expected = crypto
      .createHmac("sha256", config.zapsign.webhookSecret)
      .update(rawBody, "utf8")
      .digest("hex");
    const incomingBuf = Buffer.from(signature);
    const expectedBuf = Buffer.from(expected);
    if (incomingBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(incomingBuf, expectedBuf)) {
      throw new Error("Signature mismatch");
    }
  } catch {
    auditLog("WARN", "zapsign_webhook_rejected", { ip: req.ip, reason: "Invalid signature" });
    return res.status(401).json({ error: "Não autorizado." });
  }
  next();
}

// ─── Rota principal: Zendesk → ZapSign ───────────────────────────────────────
app.post("/webhook/zendesk", webhookLimiter, validateWebhookSecret, async (req, res) => {
  const { ticket_id, name, email, cpf, phone, template_id } = req.body;

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
    const doc = await createDocumentFromTemplate({ template_id, name, email, cpf, phone, ticket_id });

    auditLog("INFO", "document_created", {
      ticket_id,
      email,
      // doc_token e sign_url omitidos do log — dados sensíveis ficam só no Zendesk
    });

    const signUrl = doc.signers?.[0]?.sign_url;

    // Só o link de assinatura vai para o ticket (destinado ao agente/cliente)
    // O token interno da ZapSign NÃO é exposto no comentário
    await updateTicket(ticket_id, {
      comment: `📄 Documento enviado para assinatura.\n🔗 Link: ${signUrl}`,
      tags: ["contrato_enviado"],
    });

    auditLog("INFO", "ticket_updated", { ticket_id, status: "contrato_enviado" });

  } catch (err) {
    auditLog("ERROR", "processing_failed", {
      ticket_id,
      email,
      error: err.message,
      status: err.response?.status,
      response: err.response?.data,
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
app.post("/webhook/zapsign", validateZapSignSignature, async (req, res) => {
  // Log do payload completo pra debug
  auditLog("INFO", "zapsign_webhook_received", {
    event_type: req.body.event_type || req.body.event_action || "unknown",
    status: req.body.status || req.body.document?.status || "unknown",
    external_id: req.body.external_id || req.body.document?.external_id || "none",
  });

  // ZapSign pode enviar o evento como event_type ou event_action
  const eventType = req.body.event_type || req.body.event_action || "";
  const doc = req.body.document || req.body;

  // Aceitar variações do evento de assinatura
  const isSignEvent = ["sign_doc", "doc_signed", "signed"].includes(eventType)
    || doc.status === "signed";

  if (!isSignEvent) {
    auditLog("INFO", "zapsign_webhook_ignored", { event: eventType });
    return res.status(200).json({ status: "ignored" });
  }

  // Extrair ticket_id do external_id (formato: "zendesk-12345")
  const externalId = doc.external_id || "";
  const ticket_id = externalId.startsWith("zendesk-")
    ? externalId.replace("zendesk-", "")
    : externalId;
  const signer_email = doc.signers?.[0]?.email || "";

  auditLog("INFO", "document_signed", { ticket_id, signer_email });

  res.status(200).json({ status: "ok" });

  try {
    if (ticket_id) {
      await updateTicket(ticket_id, {
        // Token interno da ZapSign não vai para o comentário público do ticket
        comment: `✅ Documento assinado por ${signer_email}.`,
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
