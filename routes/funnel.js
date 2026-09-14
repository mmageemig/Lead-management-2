'use strict';
const { db, newId, getSetting } = require('../lib/db');
const { sendJson } = require('../lib/http');
const { parseLeadDateString } = require('../lib/dates');

// Public webhook endpoint for external funnels / landing pages to submit leads.
// Auth: header "X-API-Key" must match the funnel API key shown in Admin > Settings.
function registerFunnelRoutes(router) {
  router.post('/api/funnel/leads', (ctx) => {
    const key = ctx.req.headers['x-api-key'];
    const expected = getSetting('funnel_api_key');
    if (!key || key !== expected) {
      return sendJson(ctx.res, { ok: false, error: 'Invalid or missing API key.' }, 401);
    }

    const b = ctx.body || {};
    const leadType = (b.lead_type === 'paid') ? 'paid' : 'free';
    const costCents = leadType === 'paid' ? parseInt(getSetting('paid_lead_price_cents'), 10) : 0;

    if (!b.first_name && !b.last_name && !b.phone && !b.email) {
      return sendJson(ctx.res, { ok: false, error: 'At least a name, phone, or email is required.' }, 400);
    }

    const id = newId('lead');
    const receivedAt = b.received_at ? parseLeadDateString(b.received_at) : null;
    try {
      db.prepare(`INSERT INTO leads (
        id, lead_type, cost_cents, status, first_name, last_name, phone, email, address, city, state, zip,
        insurance_type, current_carrier, coverage_interest, dob, age, household_size, income_range, source, campaign, received_at
      ) VALUES (?,?,?,'unclaimed',?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, COALESCE(?, datetime('now')))`).run(
        id, leadType, costCents,
        b.first_name || null, b.last_name || null, b.phone || null, b.email || null,
        b.address || null, b.city || null, b.state || null, b.zip || null,
        b.insurance_type || null, b.current_carrier || null, b.coverage_interest || null,
        b.dob || null, b.age ? parseInt(b.age, 10) : null, b.household_size ? parseInt(b.household_size, 10) : null,
        b.income_range || null, b.source || 'funnel', b.campaign || null, receivedAt
      );
      return sendJson(ctx.res, { ok: true, lead_id: id, lead_type: leadType, cost_cents: costCents }, 201);
    } catch (e) {
      return sendJson(ctx.res, { ok: false, error: 'Could not save lead: ' + e.message }, 500);
    }
  });
}

module.exports = { registerFunnelRoutes };
