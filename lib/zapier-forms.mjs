/**
 * Server-side relay for marketing lead forms -> Zapier Catch Hooks.
 *
 * The hook URLs are secrets: they live only in env vars and never ship to the
 * browser. Each form posts its usual JSON payload to /api/forms/<formId>; we
 * validate it, drop the honeypot field, and forward the same JSON string to the
 * form's hook with the same Content-Type the browser used to send
 * (text/plain;charset=UTF-8), so the existing Zaps see an identical payload.
 */

export const HONEYPOT_FIELD = "_hp";
export const MAX_BODY_BYTES = 8 * 1024;
const MAX_FIELD_CHARS = 500;
const UPSTREAM_TIMEOUT_MS = 10_000;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * Allowlisted forms. `fields` is the exact payload shape (and key order) the
 * page sends today; `required` fields must be non-empty strings.
 */
export const FORMS = {
  playbook: {
    envVar: "ZAPIER_HOOK_PLAYBOOK",
    fields: ["name", "email", "organization", "source", "timestamp"],
    required: ["name", "email", "source", "timestamp"],
    nullable: ["organization"],
  },
  demo: {
    envVar: "ZAPIER_HOOK_DEMO",
    fields: ["first_name", "last_name", "email", "organization", "role", "ehr", "team_size"],
    // The demo page has no client-side validation and always shows the
    // scheduler, so only insist on the one field a lead is useless without.
    required: ["email"],
    nullable: [],
  },
  acp2026: {
    envVar: "ZAPIER_HOOK_ACP2026",
    fields: ["name", "email", "source", "ts"],
    required: ["name", "email", "source", "ts"],
    nullable: [],
  },
};

const ALLOWED_HOST_RES = [
  /^chartnote\.com$/,
  /^www\.chartnote\.com$/,
  /^hub\.chartnote\.com$/,
  /^leads\.chartnote\.com$/,
  /^[a-z0-9-]+\.vercel\.app$/,
  /^localhost$/,
  /^127\.0\.0\.1$/,
];

function hostOf(value) {
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return "";
  }
}

/** Browsers always send Origin on fetch POSTs; reject foreign origins only. */
export function originAllowed(originHeader, hostHeader) {
  if (!originHeader) return true;
  const originHost = hostOf(originHeader);
  if (!originHost) return false;
  const reqHost = String(hostHeader || "").split(",")[0].trim().toLowerCase().replace(/:\d+$/, "");
  if (reqHost && originHost === reqHost) return true;
  return ALLOWED_HOST_RES.some((re) => re.test(originHost));
}

/** Returns { ok: true, payload } or { ok: false, status, error, honeypot? }. */
export function validateSubmission(formId, rawBody) {
  const form = Object.prototype.hasOwnProperty.call(FORMS, formId) ? FORMS[formId] : null;
  if (!form) return { ok: false, status: 404, error: "Unknown form" };

  if (Buffer.byteLength(rawBody, "utf8") > MAX_BODY_BYTES) {
    return { ok: false, status: 413, error: "Payload too large" };
  }

  let body;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return { ok: false, status: 400, error: "Invalid JSON" };
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, status: 400, error: "Invalid payload" };
  }

  if (typeof body[HONEYPOT_FIELD] === "string" && body[HONEYPOT_FIELD].trim() !== "") {
    return { ok: false, honeypot: true };
  }

  const payload = {};
  for (const key of form.fields) {
    if (!(key in body)) return { ok: false, status: 400, error: `Missing field: ${key}` };
    const value = body[key];
    if (value === null && form.nullable.includes(key)) {
      payload[key] = null;
      continue;
    }
    if (typeof value !== "string") return { ok: false, status: 400, error: `Invalid field: ${key}` };
    if (value.length > MAX_FIELD_CHARS) return { ok: false, status: 400, error: `Field too long: ${key}` };
    if (form.required.includes(key) && value.trim() === "") {
      return { ok: false, status: 400, error: `Missing field: ${key}` };
    }
    payload[key] = value;
  }
  if (!EMAIL_RE.test(payload.email.trim())) {
    return { ok: false, status: 400, error: "Invalid email" };
  }
  return { ok: true, payload };
}

export function hookUrlFor(formId) {
  const url = process.env[FORMS[formId].envVar];
  return url && url.trim() ? url.trim() : "";
}

export async function forwardToZapier(url, payload) {
  return fetch(url, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=UTF-8" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    cache: "no-store",
  });
}
