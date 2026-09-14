# Insurance Lead Manager

A self-contained web app for managing insurance leads: bring leads in manually or from a funnel/landing-page webhook, let agents claim and work leads from their own portal, and track each agent's wallet — deposits, lead spend, and refunds — in one place.

Built with **zero external npm packages**. It runs on plain Node.js (using the built-in `node:sqlite` database), so there is nothing to `npm install` and no native build step to fight with on whatever host you deploy to.

## Features

- **Admin dashboard** — stats on leads, revenue, agent wallets, and pending requests.
- **Lead intake** — add leads manually from the admin panel, or point an external funnel/landing page at a webhook (`POST /api/funnel/leads`) protected by an API key.
- **Free vs. paid leads** — every lead is tagged `free` or `paid`. Paid leads carry a cost (the current global price at the time they're created, or a manual override).
- **Agent portal** — agents register their own account, browse the lead pool (contact details are hidden until claimed), claim leads, and update status (Working / Sold / Dead) with notes.
- **Wallets** — every agent has a running balance. Claiming a paid lead debits the wallet automatically; insufficient funds blocks the claim. Agents submit funding requests (e.g. "I sent $100 via Zelle") which an admin confirms to credit the balance — there's no payment processor wired in, so this models how a lot of small agencies actually collect payment. Every credit/debit is recorded in a full transaction ledger.
- **Refunds** — if a paid lead "doesn't pan out," the agent marks it Dead and requests a refund; the admin approves or denies it. Approval credits a configurable percentage (50% by default) of the lead's cost back to the agent's wallet.
- **Settings** — change the global paid-lead price and refund percentage at any time, and regenerate the funnel API key.

## Requirements

- **Node.js 22.5 or newer** (needed for the built-in `node:sqlite` module). Check with `node -v`.

## Running it locally

```bash
cd insurance-lead-manager
npm start
```

Then open `http://localhost:3000`. The first visit walks you through creating the admin account (that's you — Magee Insurance Group). After that, agents can register themselves at `/register`.

The app stores its database in `./data/leads.db` (created automatically). Delete that folder to start over with a clean slate.

Copy `.env.example` to `.env` if you want to change the port or data location.

## Deploying it for real use

Because it uses a local SQLite file, it needs a host with a **persistent filesystem** — not a pure serverless/edge platform (like Vercel or Cloudflare Workers functions) where the disk resets on every request. Good, low-effort options:

- **Railway** or **Render** — connect this folder as a repo, set the start command to `npm start`, and attach a small persistent volume mounted at `/data` (set `DATA_DIR=/data` in the environment variables).
- **A small VPS** (DigitalOcean, Linode, etc.) — install Node 22+, copy the folder up, run it with `pm2` or a `systemd` service so it restarts on reboot, and put it behind Caddy or Nginx for HTTPS.
- **Fly.io** — similar to Railway/Render; attach a volume for `/data`.

Whichever host you pick, set `FORCE_SECURE_COOKIE=1` once it's served over HTTPS, and change `PORT` if the platform requires a specific one (most platforms set `PORT` for you automatically, which this app already reads).

Your existing Netlify site can stay as-is — link or button from it to wherever you deploy this app; Netlify's own hosting doesn't fit this app because it doesn't offer persistent disk for a long-running Node server.

## Connecting your lead funnel

In **Admin → Settings** you'll find:

- The webhook URL: `https://your-domain/api/funnel/leads`
- Your API key (regenerate it any time if it leaks)

Have your funnel/landing-page tool (or a Zapier/Make automation) POST JSON to that URL with the header `X-API-Key: <your key>`. Example payload:

```json
{
  "lead_type": "paid",
  "first_name": "Jane",
  "last_name": "Doe",
  "phone": "555-123-4567",
  "email": "jane@example.com",
  "city": "Springfield",
  "state": "IL",
  "insurance_type": "Medicare Advantage",
  "age": 67,
  "household_size": 2,
  "income_range": "$30k-$50k",
  "source": "Facebook Ad",
  "campaign": "Fall AEP 2026"
}
```

Only `lead_type` matters for billing (`"free"` or `"paid"`; anything else is treated as free) — every other field is optional but the more you send, the more agents can see before deciding to claim. New paid leads use whatever the current global price is at the moment they're submitted.

## How the money flows

- **Deposits**: agent submits a funding request → admin confirms it was received → balance credited, logged as a `deposit` transaction.
- **Claiming a paid lead**: balance debited by the lead's recorded cost, logged as a `lead_purchase` transaction. Blocked if the balance is too low.
- **Refunds**: agent marks a paid lead `Dead / No Pan Out` → requests a refund → admin approves → the configured percentage (default 50%) of that lead's original cost is credited back, logged as a `refund` transaction, and the lead is closed out.
- **Manual adjustments**: an admin can credit or debit any agent's wallet directly from that agent's page (for corrections, bonuses, chargebacks, etc.), logged as an `adjustment` transaction.
- **Releasing a lead**: if an admin needs to pull a claimed lead back into the pool (e.g., it was assigned by mistake), the agent is fully refunded automatically.

Every wallet-affecting action is written to `wallet_transactions` with a running balance, so each agent's full history is auditable from their Wallet page (agent view) or their agent detail page (admin view).

## Project structure

```
server.js            App entry point — plain Node http server + routing
lib/
  db.js              SQLite schema + connection + settings helpers
  auth.js            Password hashing, sessions
  http.js            Minimal router, body/cookie parsing, response helpers
  ui.js              Shared layout/HTML helpers (nav, badges, formatting)
  guards.js          Role-based access checks
  errors.js          UserError (safe, user-facing error messages)
routes/
  auth.js            /setup, /login, /register, /logout
  funnel.js          Public POST /api/funnel/leads webhook
  agent.js           Agent portal: pool, my leads, lead detail, wallet
  admin.js           Admin dashboard, leads, agents, requests, settings
public/css/style.css Styling
```

## Notes & things you may want to extend

- **Payments**: there's no real payment gateway wired in on purpose — adding Stripe (or similar) later is a natural next step if you want agents to pay by card instead of the manual confirm-a-deposit flow.
- **`node:sqlite` is still an experimental Node API.** It's been stable in practice for this kind of app, but if a future Node release changes its behavior, pin your deployment to a tested Node version (this project's `package.json` requires `>=22.5.0`).
- **Single admin role**: any user you create at `/setup`, or later promote by editing the database directly, is a full admin. There's no "manager" tier between admin and agent — add one if you need it.
