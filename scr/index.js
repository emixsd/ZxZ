const express = require("express");
const crypto = require("crypto");
const rateLimit = require("express-rate-limit");
const { config } = require("./config");
const { createDocument } = require("./zapsign");
const { updateTicket } = require("./zendesk");
const { auditLog, maskCPF, validateEmail, validateCPF, sendErrorAlert } = require("./utils");

const app = express();
app.set("trust proxy", 1); // Render usa proxy reverso

// ─── Raw body para validação HMAC ────────────────────────────────────────────
// Captura o body bruto antes do JSON.parse — necessário para validar
// HMAC corretamente (JSON.stringify pode reordenar/alterar o corpo)
app.use(express.json({
  verify: (req, _res, buf) => {
    req.rawBody = buf;
  },
}));

// ─── Rate Limiting ────────────────────────────────────────────────────────────
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  message: { error: "Muitas requisições. Tente novamente em 15 minutos." },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(limiter);

const webhookLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 20,
  message: { error: "Rate limit excedido no webhook." },
});

// ─── Proteção contra duplicatas ──────────────────────────────────────────────
// Evita criar 2+ documentos se o Zendesk disparar o trigger múltiplas vezes
const processando = new Set();

// ─── Validação do Webhook Secret (Zendesk) ───────────────────────────────────
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

// ─── Autenticação do Webhook ZapSign (HMAC SHA-256) ──────────────────────────
// Usa raw body para calcular o HMAC — mais seguro que JSON.stringify
function validateZapSignSignature(req, res, next) {
  if (!config.zapsign.webhookSecret) {
    auditLog("INFO", "zapsign_hmac_skipped", { ip: req.ip });
    return next();
  }

  const signature = req.headers["x-zapsign-hmac-sha256"];
  if (!signature) {
    auditLog("WARN", "zapsign_webhook_rejected", { ip: req.ip, reason: "Missing signature" });
    return res.status(401).json({ error: "Não autorizado." });
  }
  try {
    const expected = crypto
      .createHmac("sha256", config.zapsign.webhookSecret)
      .update(req.rawBody)
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

  // 1. Proteção contra duplicatas
  if (processando.has(ticket_id)) {
    auditLog("INFO", "duplicate_ignored", { ticket_id });
    return res.status(200).json({ status: "already_processing", ticket_id });
  }
  processando.add(ticket_id);

  // 2. Validação de entrada
  const errors = [];
  if (!ticket_id) errors.push("ticket_id é obrigatório");
  if (!name || name.trim().length < 2) errors.push("name inválido");
  if (!email || !validateEmail(email)) errors.push("email inválido");
  if (!cpf || !validateCPF(cpf)) errors.push("CPF inválido");
  if (!template_id) errors.push("template_id é obrigatório");

  if (errors.length > 0) {
    processando.delete(ticket_id);
    auditLog("WARN", "validation_failed", { ticket_id, email, errors });
    return res.status(400).json({ error: "Dados inválidos", details: errors });
  }

  // 3. Log de auditoria (CPF mascarado)
  auditLog("INFO", "request_received", {
    ticket_id,
    email,
    name: name.trim(),
    cpf: maskCPF(cpf),
  });

  // Responde imediatamente ao Zendesk (evita timeout de 5s)
  res.status(200).json({ status: "processing", ticket_id });

  // 4. Processamento assíncrono
  try {
    const doc = await createDocument({ template_id, name, email, cpf, phone, ticket_id });

    auditLog("INFO", "document_created", { ticket_id, email });

    const signUrl = doc.signers?.[0]?.sign_url;

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
  } finally {
    processando.delete(ticket_id);
  }
});

// ─── Rota: Webhook ZapSign ───────────────────────────────────────────────────
app.post("/webhook/zapsign", validateZapSignSignature, async (req, res) => {
  const eventType = req.body.event_type || req.body.event_action || "";
  const doc = req.body.document || req.body;

  auditLog("INFO", "zapsign_webhook_received", {
    event_type: eventType,
    status: doc.status || "unknown",
    external_id: doc.external_id || "none",
  });

  // Extrair ticket_id do external_id (formato: "zendesk-12345")
  const externalId = doc.external_id || "";
  const ticket_id = externalId.startsWith("zendesk-")
    ? externalId.replace("zendesk-", "")
    : externalId;

  // ── Documento assinado ──
  // Verifica doc.status === "signed" para garantir que TODOS os signatários
  // assinaram (não apenas 1 de N). Isso protege cenários com múltiplos signatários.
  const isFullySigned = ["doc_signed", "sign_doc", "signed"].includes(eventType)
    && doc.status === "signed";

  if (isFullySigned && ticket_id) {
    const signer_email = doc.signers?.[0]?.email || "";
    auditLog("INFO", "document_signed", { ticket_id, signer_email });
    res.status(200).json({ status: "ok" });

    try {
      await updateTicket(ticket_id, {
        comment: `✅ Documento assinado por ${signer_email}.`,
        tags: ["contrato_assinado"],
      });
      auditLog("INFO", "ticket_updated_signed", { ticket_id, signer_email });
    } catch (err) {
      auditLog("ERROR", "zapsign_webhook_failed", {
        ticket_id,
        error: err.message,
        status: err.response?.status,
        response: err.response?.data,
      });
      await sendErrorAlert({
        title: "❌ Falha ao processar assinatura",
        ticket_id,
        email: signer_email,
        error: err.message,
      });
    }
    return;
  }

  // ── Documento recusado ──
  const isRefused = ["doc_refused", "refused"].includes(eventType)
    || doc.status === "refused";

  if (isRefused && ticket_id) {
    const signer_email = doc.signers?.[0]?.email || "";
    const motivo = doc.refusal_reason || req.body.refusal_reason || "";
    auditLog("INFO", "document_refused", { ticket_id, signer_email, motivo });
    res.status(200).json({ status: "ok" });

    try {
      await updateTicket(ticket_id, {
        comment: `❌ Documento recusado por ${signer_email}.${motivo ? `\n📝 Motivo: ${motivo}` : ""}`,
        tags: ["contrato_recusado"],
      });
      auditLog("INFO", "ticket_updated_refused", { ticket_id, signer_email });
    } catch (err) {
      auditLog("ERROR", "zapsign_webhook_refused_failed", {
        ticket_id,
        error: err.message,
        status: err.response?.status,
        response: err.response?.data,
      });
    }
    return;
  }

  // ── Outros eventos (ignorados) ──
  auditLog("INFO", "zapsign_webhook_ignored", { event: eventType, status: doc.status });
  res.status(200).json({ status: "ignored" });
});

// ─── Health check ─────────────────────────────────────────────────────────────
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    version: "1.2.0",
  });
});

// ─── Start ────────────────────────────────────────────────────────────────────
const PORT = config.PORT || 3000;
app.listen(PORT, () => {
  auditLog("INFO", "server_started", { port: PORT, version: "1.2.0" });
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
});
