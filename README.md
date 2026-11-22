# chartnote-test-website

Next.js marketing site for Chartnote, deployed on Vercel (`hub.chartnote.com`, `leads.chartnote.com`).

```bash
npm install
npm run dev     # http://localhost:3000
npm run build
```

## Lead forms and Zapier

The lead forms post to a same-origin route, `POST /api/forms/<formId>`
(`app/api/forms/[form]/route.js`, logic in `lib/zapier-forms.mjs`). The route
validates the submission and forwards the same JSON payload to the form's
Zapier Catch Hook. Hook URLs are secrets: they live only in env vars and must
never be committed or referenced from client code.

| Env var | Form ID | Page |
| --- | --- | --- |
| `ZAPIER_HOOK_PLAYBOOK` | `playbook` | `/playbook` and `leads.chartnote.com` (`public/playbook/main.js`) |
| `ZAPIER_HOOK_DEMO` | `demo` | `/demo` (`public/demo/index.html`) |
| `ZAPIER_HOOK_ACP2026` | `acp2026` | `/acp2026` (`public/acp2026/index.html`) |

Set each one in Vercel (Project → Settings → Environment Variables) for
Production and Preview, to the full `https://hooks.zapier.com/hooks/catch/...`
URL. For local testing put them in `.env.local` (git-ignored by Next).
If a variable is missing the route logs an error and returns `503`, and the
form shows its normal error state; there is no hardcoded fallback.

Abuse protection (no extra steps for real visitors):

- only the form IDs above are accepted (others get `404`);
- only the expected fields are forwarded; required fields and the email
  format are checked (`400`), each field is capped at 500 characters;
- request bodies over 8 KB are rejected (`413`);
- a hidden honeypot field (`_hp`) must stay empty; if a bot fills it the route
  answers `200` and forwards nothing;
- requests with an `Origin` header must come from chartnote.com,
  www/hub/leads.chartnote.com, `*.vercel.app` previews, localhost, or the
  request's own host (`403` otherwise).

Zapier receives the same body as before (a JSON string sent as
`text/plain;charset=UTF-8`, which is what the browser sent when the forms
posted to Zapier directly), so the existing Zaps need no changes.
