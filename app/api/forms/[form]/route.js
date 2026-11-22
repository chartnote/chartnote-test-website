import {
  FORMS,
  MAX_BODY_BYTES,
  forwardToZapier,
  hookUrlFor,
  originAllowed,
  validateSubmission,
} from "../../../../lib/zapier-forms.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(status, body) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function POST(request, { params }) {
  const { form: formId } = await params;
  if (!Object.prototype.hasOwnProperty.call(FORMS, formId)) {
    return json(404, { ok: false, error: "Unknown form" });
  }

  if (!originAllowed(request.headers.get("origin"), request.headers.get("host"))) {
    return json(403, { ok: false, error: "Forbidden" });
  }

  const declared = Number(request.headers.get("content-length") || 0);
  if (declared > MAX_BODY_BYTES) {
    return json(413, { ok: false, error: "Payload too large" });
  }

  const rawBody = await request.text();
  const result = validateSubmission(formId, rawBody);
  if (result.honeypot) {
    // Pretend success so bots get no signal; nothing is forwarded.
    return json(200, { ok: true });
  }
  if (!result.ok) {
    return json(result.status, { ok: false, error: result.error });
  }

  const hookUrl = hookUrlFor(formId);
  if (!hookUrl) {
    console.error(`[forms] ${FORMS[formId].envVar} is not set; dropping ${formId} submission`);
    return json(503, { ok: false, error: "Form is not configured" });
  }

  try {
    const upstream = await forwardToZapier(hookUrl, result.payload);
    if (!upstream.ok) {
      console.error(`[forms] Zapier hook for ${formId} returned ${upstream.status}`);
      return json(502, { ok: false, error: "Upstream error" });
    }
  } catch (err) {
    console.error(`[forms] Zapier hook for ${formId} failed:`, err?.name || err);
    return json(502, { ok: false, error: "Upstream error" });
  }

  return json(200, { ok: true });
}

export function GET() {
  return json(405, { ok: false, error: "Method not allowed" });
}
