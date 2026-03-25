const { config } = require("./config");

// ─── Audit Log ────────────────────────────────────────────────────────────────
/**
 * Gera log estruturado com timestamp, nível e dados (sem CPF em texto puro).
 * @param {"INFO"|"WARN"|"ERROR"} level
 * @param {string} event
 * @param {object} data
 */
function auditLog(level, event, data = {}) {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    event,
    ...data,
  };
  const line = JSON.stringify(entry);

  if (level === "ERROR") {
    console.error(line);
  } else if (level === "WARN") {
    console.warn(line);
  } else {
    console.log(line);
  }
}

// ─── CPF Masking ──────────────────────────────────────────────────────────────
/**
 * Mascara CPF para logs: 123.456.789-09 → ***.***.789-09
 * @param {string} cpf
 * @returns {string}
 */
function maskCPF(cpf) {
  if (!cpf) return "***";
  const clean = cpf.replace(/\D/g, "");
  if (clean.length !== 11) return "***";
  return `***.***. ${clean.slice(6, 9)}-${clean.slice(9)}`;
}

// ─── Validação de Email ───────────────────────────────────────────────────────
/**
 * Valida formato básico de email.
 * @param {string} email
 * @returns {boolean}
 */
function validateEmail(email) {
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return re.test(String(email).toLowerCase());
}

// ─── Validação de CPF ─────────────────────────────────────────────────────────
/**
 * Valida CPF com dígitos verificadores (algoritmo oficial).
 * @param {string} cpf
 * @returns {boolean}
 */
function validateCPF(cpf) {
  const clean = String(cpf).replace(/\D/g, "");
  if (clean.length !== 11) return false;

  // Rejeita sequências repetidas (111.111.111-11, etc.)
  if (/^(\d)\1{10}$/.test(clean)) return false;

  // Valida primeiro dígito verificador
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += parseInt(clean[i]) * (10 - i);
  let rev = 11 - (sum % 11);
  if (rev >= 10) rev = 0;
  if (rev !== parseInt(clean[9])) return false;

  // Valida segundo dígito verificador
  sum = 0;
  for (let i = 0; i < 10; i++) sum += parseInt(clean[i]) * (11 - i);
  rev = 11 - (sum % 11);
  if (rev >= 10) rev = 0;
  if (rev !== parseInt(clean[10])) return false;

  return true;
}

// ─── Error Alert ──────────────────────────────────────────────────────────────
/**
 * Envia alerta de erro via Slack webhook (se configurado).
 * Adicione SLACK_WEBHOOK_URL no .env para ativar.
 * @param {{ title: string, ticket_id: string|number, email: string, error: string }} opts
 */
async function sendErrorAlert({ title, ticket_id, email, error }) {
  if (!config.SLACK_WEBHOOK_URL) return;

  try {
    const payload = {
      text: `*${title}*`,
      attachments: [
        {
          color: "#FF0000",
          fields: [
            { title: "Ticket ID", value: String(ticket_id || "N/A"), short: true },
            { title: "Email", value: email || "N/A", short: true },
            { title: "Erro", value: error || "Erro desconhecido", short: false },
            { title: "Timestamp", value: new Date().toISOString(), short: true },
          ],
        },
      ],
    };

    const response = await fetch(config.SLACK_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      console.error("Falha ao enviar alerta Slack:", response.status);
    }
  } catch (err) {
    console.error("Erro ao enviar alerta:", err.message);
  }
}

module.exports = { auditLog, maskCPF, validateEmail, validateCPF, sendErrorAlert };
