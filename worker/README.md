# targetx-ask

The Worker behind the app's ask box.

## Why it exists

Three requirements cannot be met inside a Tauri binary, because all three
depend on trusting a machine we do not control:

| Requirement | Why the client cannot do it |
|---|---|
| Keep the Gemini key secret | A Tauri bundle is files on the user's disk. Any shipped key is extractable, and the bill is ours. |
| Rate limit per user | A limit enforced in JS is a limit the user deletes. |
| Only signed-in users | A Clerk session token proves nothing until something verifies its signature. |

## What it does and does not see

The request carries **a question and the semester's course list**. It does not
carry marks, attendance, CGPA, the student's name or their register number.

The model chooses a route — a view, or a subject plus the view that answers
questions about it. The app then computes the actual figure locally, the same
way it does with no network at all. Nothing that reaches a student's screen was
authored by a model.

## Why the topic rule holds

Not because the prompt asks nicely. Two independent mechanisms:

1. **Structured output.** Gemini decodes against a JSON schema whose `code`
   field is an enum of the codes the client actually sent. Prose is not a value
   the schema permits, and an invented course code is not generatable.
2. **`parseAction` on the way out.** Whatever comes back is validated against
   the same closed set before the client sees it. Anything else becomes
   `{ kind: "none" }`.

The prompt is for accuracy. The schema is for safety. Never rely on the first
for the second.

## Deploy

You need a Cloudflare account, a Clerk instance and a Gemini API key.

```sh
npm install

# 1. Clerk issuer. Public, not a secret - Clerk Dashboard -> API Keys -> the
#    "Frontend API" / issuer URL, e.g. https://cheerful-cat-42.clerk.accounts.dev
#    Put it in wrangler.toml under [vars].

# 2. The Gemini key. A secret. This command prompts and never writes to disk.
npx wrangler secret put GEMINI_KEY

# 3. Ship it.
npx wrangler deploy
```

For local development put the key in `.dev.vars` (gitignored, never committed):

```
GEMINI_KEY=...
```

## Quota

40 questions per user per UTC day, counted in a Durable Object keyed by the
Clerk user id. Counted *before* the model is called: counting on success would
let anyone who can reliably provoke an upstream error spend our budget without
spending their own quota.

Change `DAILY` in `src/limit.ts`.

## Endpoint

```
POST /ask
Authorization: Bearer <clerk session jwt>

{ "question": "how many classes can I miss in ML",
  "subjects": [{ "code": "CST414", "name": "Machine Learning" }] }
```

```
200 { "action": { "kind": "subject", "code": "CST414", "view": "attendance" },
      "remaining": 39 }
401 { "error": "unauthorized" }
429 { "error": "rate_limited", "resetAt": 1757030400 }
502 { "error": "upstream" }
```

Failures never explain themselves. "Expired" and "forged" must look identical
from outside, and an upstream error string can carry a URL or a key fragment.

## Not wired to the app yet

The app does not call this. The ask box answers attendance and leave questions
today with no network, no key and no account, straight from the engine. This
service is for the questions the engine genuinely cannot answer, and turning it
on means requiring sign-in and sending questions to Google — a deliberate
change to the app's privacy position, not a config flag.
