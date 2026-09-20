# Handover

Everything a new developer — or a new AI assistant — needs before touching this
project. It says where things live and what is deliberately missing; the design
decisions themselves are in [CLAUDE.md](CLAUDE.md), which is the long document
and the one to read second.

**No secret values appear in this file, and none may be added to it. This
repository is public.** A Gemini key leaked through its history once already.

---

## 1. What this is

ReaLab Medical & Diagnostic Center's queueing system. Patients join a queue from
their own phone or book an appointment; staff call tickets across stations
(front desk → laboratory / imaging → doctor → front desk); a lobby screen shows
and announces the numbers.

Node.js + Express + Socket.IO, MySQL, and plain HTML/CSS/JS in `public/` with
**no build step and no frontend framework**. That is a deliberate choice and the
main reason the project is easy to pick up: edit a file in `public/`, reload the
page, and that is the whole loop.

---

## 2. Run it

```bash
npm install
npm start      # needs a local MySQL on 3306 and a .env
```

or, with no local Node or MySQL at all:

```bash
docker compose up --build
```

The first boot creates the database, every table, the seed accounts, the seed
laboratories and doctors, and the default services. There are no migration files
to run — schema changes are applied on every boot by `addColumnIfMissing` /
`addIndexIfMissing` in `database.js`, which is where a new column belongs.

---

## 3. Check it

```bash
npm test
```

This is the whole safety net, and it needs no database, no network and no API
key. It:

- parses every backend and frontend file (`node --check`);
- runs `verify_ai_chain.js` — 112 assertions over the OCR and assistant
  provider chains: key rotation on a spent key, model fallback, overload
  retries, the DeepSeek circuit breaker, and the assistant answering a bare sum
  with its own calculator instead of asking a language model;
- runs `verify_payment_math.js` — 23 assertions over the cashier's arithmetic:
  the two statutory discount rates, the discount preselected from the patient's
  category, centavo rounding, and the refusal of a request that claims its own
  discount rate;
- runs `verify_frontend_globals.js` — the one frontend failure `node --check`
  cannot see. These pages have no bundler, so every `public/*.js` file a page
  loads shares one global scope, and two `const` declarations of the same name
  is a `SyntaxError` that blanks the entire page.

Everything else is manual. Exercise the pages after a change.

---

## 4. Deploy it

The live site is **https://real-labs.up.railway.app** — Railway project
`respectful-enjoyment`, service `Queue-Anti`, plus its own MySQL service.

**Pushing to `main` deploys.** Nothing else is needed. If a change is missing
from the live site, check what the site is actually serving before re-diagnosing
the change:

```bash
curl -s https://real-labs.up.railway.app/owner.js | grep -c someNewSymbol
railway status
railway logs --build
```

`railway up` deploys uncommitted local state, which is occasionally useful for
trying something on the real host before committing it.

The database is on Railway's private network (`mysql.railway.internal`) and is
not reachable from a laptop. To run something against it, run it *inside* the
container:

```bash
railway ssh --service Queue-Anti "cd /app && node -e \"...\""
```

---

## 5. Configuration

`.env.example` documents every variable, what it does, and why — read it rather
than this list. Only `PORT` and `JWT_SECRET` are genuinely required; every AI
feature degrades to local logic when its key is absent, so the app boots and
works with nothing else set.

**The live values live in Railway's variables, and nowhere else.** They are not
in the repository and must not be put there. As of this writing the service has:

| Group | Variables |
|---|---|
| Server | `PORT`, `TZ`, `NODE_ENV`, `JWT_SECRET`, `SEED_PASSWORD` |
| Database | `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` |
| Customer login OTP | `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL` |
| Email (reset) | `EMAILJS_SERVICE_ID`, `EMAILJS_TEMPLATE_ID`, `EMAILJS_PUBLIC_KEY`, `EMAILJS_PRIVATE_KEY` |
| Email (OTP codes) | `EMAILJS_OTP_SERVICE_ID`, `EMAILJS_OTP_TEMPLATE_ID`, `EMAILJS_OTP_PUBLIC_KEY`, `EMAILJS_OTP_PRIVATE_KEY` |
| Elevated accounts | `ADMIN_APPROVAL_EMAIL` — the mailbox that approves a new owner/admin account. Unset means no elevated account can be created at all |
| ID scanning | `GEMINI_API_KEY`, `GEMINI_API_KEY_2`, `GEMINI_API_KEY_3`, `DEEPSEEK_API_KEY`, `NVIDIA_API_KEY` |
| Assistant voice | `GROQ_API_KEY` (`OPENAI_API_KEY` is supported and currently unset) |
| Reports | `API_ALLAROUND` (Hugging Face) |
| Set by Railway itself | everything prefixed `RAILWAY_` |

To see the names on the live service:

```bash
railway variables --service Queue-Anti --kv | cut -d= -f1 | sort
```

`BETTER_AUTH_URL` must match the site's current address — it is used when
constructing the customer login OTP flow, and it kept the old
`medical-cliniqueue` address for a while after the domain was renamed. **Update
it in Railway whenever the domain changes.**

---

## 6. Accounts

Seed staff accounts and their passwords are in [README.md](README.md) and
`example_accounts.md`. **They are published in a public repository**, so
`SEED_PASSWORD` must be set on any deployment — otherwise `owner1` / `owner123`
is a working administrator login for anyone who finds the site.

Who signs in where, which station each account works, and which services route
through it, is written out in the accounts-and-services text file kept outside
the repository (`C:\Users\wendelle\AntiGravity\clinic-docs\`). It is generated
from the live database, so regenerate it rather than editing it by hand.

Patients register themselves; nobody approves a registration. A patient with no
phone is registered at the front desk as a walk-in and gets printed forms
instead.

---

## 7. Deliberately not in this repository

- `.env` — gitignored. Real values are in Railway.
- `uploads/` — ID photographs. They are deleted inside the request that reads
  them and never stored.
- The private accounts file and the real-data screenshots, both kept in
  `C:\Users\wendelle\AntiGravity\` outside the repo.
- Any API key, in any form, including in a commit message or a comment.

---

## 8. Known gaps

Honest list, so the next person does not rediscover them:

**Sales and payments**
- No refunds and no voided payments. A wrong amount can only be corrected in the
  database.
- The **AI Reports** screen still totals the package price list, not what was
  taken, so its revenue figure is higher than the Sales Report's. The Sales
  Report is the correct one; AI Reports has not been converted.
- Visits paid before payment recording shipped have no recorded amount. The
  Sales Report counts them separately rather than as zero, but they are missing
  from the totals.
- The payment box has not been exercised end to end on the live site by a real
  cashier. The dialog itself and the arithmetic are covered by tests.

**Testing**
- One assertion suite for the AI chains, one for the payment arithmetic, one
  structural check on the frontend. Everything else — routes, queue engine,
  pages — is manual.
- No end-to-end test of a visit from joining the queue to being released.

**Features**
- No SMS. Every notification is email or on-screen.
- No online payment. Everything is settled at the counter.
- Single clinic. Nothing in the schema separates branches.
- The lobby board announces in English only.
- `index.html` (the landing page) is not theme-capable — it is a hand-designed
  light page with 219 colour literals, so the dark theme deliberately skips it.
- The staff dashboards are theme-capable but deliberately left on light.

**Operational**
- Gemini's free-tier quota is per project and resets at midnight Pacific, which
  is mid-afternoon in Manila. When it runs out, ID scanning falls back and reads
  Philippine IDs considerably worse.
- Groq's free tier rate-limits the assistant's voice transcription.

---

## 9. If you are an AI assistant

Read [CLAUDE.md](CLAUDE.md) first — it is the architecture and, more usefully,
the reasoning: what was tried, what broke, and why the code is shaped the way it
is. Several of its rules exist because the opposite reached a live clinic.

A knowledge graph of the codebase is in `graphify-out/`. Query it instead of
grepping blind, and run `graphify update .` after changing code.

Three habits matter more than the rest here:

1. **Run `npm test` before saying something works.** It is fast and needs
   nothing.
2. **Never put a key, a password or a patient's data in the repository**, a
   commit message or a comment.
3. **Guard every new route in `routes/admin.js` explicitly.** That file is
   mounted twice — once behind an administrator check and once behind plain
   authentication — so an unguarded handler is reachable by every signed-in
   account, patients included.
