'use strict';
const { db, newId, getSetting, setSetting, withTransaction } = require('../lib/db');
const crypto = require('crypto');
const { redirect, sendHtml } = require('../lib/http');
const { requireRole } = require('../lib/guards');
const { UserError } = require('../lib/errors');
const { layout, esc, money, fmtDate, statusBadge, leadTypeBadge } = require('../lib/ui');
const { htmlLocalToStorage, storageToHtmlLocal } = require('../lib/dates');

function leadName(lead) {
  return [lead.first_name, lead.last_name].filter(Boolean).join(' ') || 'Unnamed lead';
}

function centsFromInput(val) {
  const n = Math.round(parseFloat(val) * 100);
  return Number.isFinite(n) ? n : 0;
}

function leadRow(lead) {
  return `<tr>
    <td><a href="/admin/leads/${lead.id}">${esc(leadName(lead))}</a></td>
    <td>${esc([lead.city, lead.state].filter(Boolean).join(', ') || '—')}</td>
    <td>${leadTypeBadge(lead.lead_type)}</td>
    <td>${lead.lead_type === 'paid' ? money(lead.cost_cents) : '<span class="muted">Free</span>'}</td>
    <td>${statusBadge(lead.status)}</td>
    <td>${esc(lead.agent_name || '—')}</td>
    <td>${fmtDate(lead.received_at || lead.created_at)}</td>
  </tr>`;
}

const LEAD_FORM_FIELDS = [
  ['first_name', 'First name', 'text'], ['last_name', 'Last name', 'text'],
  ['phone', 'Phone', 'tel'], ['email', 'Email', 'email'],
  ['address', 'Address', 'text'], ['city', 'City', 'text'], ['state', 'State', 'text'], ['zip', 'ZIP', 'text'],
  ['insurance_type', 'Insurance type', 'text'], ['current_carrier', 'Current carrier', 'text'], ['coverage_interest', 'Coverage interest', 'text'],
  ['dob', 'Date of birth', 'date'], ['age', 'Age', 'number'], ['household_size', 'Household size', 'number'], ['income_range', 'Income range', 'text'],
  ['source', 'Source', 'text'], ['campaign', 'Campaign', 'text'],
];

function leadFormHtml(action, lead = {}, submitLabel = 'Save') {
  const fields = LEAD_FORM_FIELDS.map(([key, label, type]) =>
    `<label>${label}<input type="${type}" name="${key}" value="${esc(lead[key] != null ? lead[key] : '')}"></label>`
  ).join('');
  return `
  <form method="post" action="${action}">
    <div class="form-grid">
      <label>Lead type
        <select name="lead_type">
          <option value="free" ${lead.lead_type === 'free' || !lead.lead_type ? 'selected' : ''}>Free</option>
          <option value="paid" ${lead.lead_type === 'paid' ? 'selected' : ''}>Paid</option>
        </select>
      </label>
      <label>Cost override (USD, paid only)
        <input type="number" step="0.01" min="0" name="cost_override" placeholder="Uses current global price if blank" value="${lead.cost_cents != null && lead.lead_type === 'paid' && lead._explicit_cost ? (lead.cost_cents / 100).toFixed(2) : ''}">
      </label>
      <label>Lead received
        <input type="datetime-local" name="received_at" value="${esc(storageToHtmlLocal(lead.received_at))}">
      </label>
      ${fields}
    </div>
    <button class="btn btn-primary" type="submit">${submitLabel}</button>
  </form>`;
}

function registerAdminRoutes(router) {
  // ---- Dashboard ----
  router.get('/admin', (ctx) => {
    if (!requireRole(ctx, 'admin')) return;
    const totalLeads = db.prepare('SELECT COUNT(*) c FROM leads').get().c;
    const unclaimedFree = db.prepare("SELECT COUNT(*) c FROM leads WHERE status='unclaimed' AND lead_type='free'").get().c;
    const unclaimedPaid = db.prepare("SELECT COUNT(*) c FROM leads WHERE status='unclaimed' AND lead_type='paid'").get().c;
    const claimedActive = db.prepare("SELECT COUNT(*) c FROM leads WHERE status IN ('claimed','working')").get().c;
    const sold = db.prepare("SELECT COUNT(*) c FROM leads WHERE status='sold'").get().c;
    const revenue = db.prepare("SELECT COALESCE(SUM(-amount_cents),0) s FROM wallet_transactions WHERE type='lead_purchase'").get().s;
    const refundedTotal = db.prepare("SELECT COALESCE(SUM(amount_cents),0) s FROM wallet_transactions WHERE type='refund'").get().s;
    const agentCount = db.prepare("SELECT COUNT(*) c FROM users WHERE role='agent'").get().c;
    const walletTotal = db.prepare("SELECT COALESCE(SUM(wallet_balance_cents),0) s FROM users WHERE role='agent'").get().s;
    const pendingFunding = db.prepare("SELECT COUNT(*) c FROM funding_requests WHERE status='pending'").get().c;
    const pendingRefunds = db.prepare("SELECT COUNT(*) c FROM refund_requests WHERE status='pending'").get().c;
    const recentLeads = db.prepare(`SELECT l.*, u.name as agent_name FROM leads l LEFT JOIN users u ON u.id = l.claimed_by ORDER BY l.received_at DESC LIMIT 8`).all();

    const body = `
    <div class="page-head"><h1>Admin dashboard</h1></div>
    <div class="stat-grid">
      <div class="stat-card"><div class="stat-label">Total leads</div><div class="stat-value">${totalLeads}</div></div>
      <div class="stat-card"><div class="stat-label">Unclaimed free</div><div class="stat-value">${unclaimedFree}</div></div>
      <div class="stat-card"><div class="stat-label">Unclaimed paid</div><div class="stat-value">${unclaimedPaid}</div></div>
      <div class="stat-card"><div class="stat-label">Active (claimed/working)</div><div class="stat-value">${claimedActive}</div></div>
      <div class="stat-card"><div class="stat-label">Sold</div><div class="stat-value">${sold}</div></div>
      <div class="stat-card"><div class="stat-label">Lead revenue collected</div><div class="stat-value">${money(revenue)}</div></div>
      <div class="stat-card"><div class="stat-label">Total refunded</div><div class="stat-value">${money(refundedTotal)}</div></div>
      <div class="stat-card"><div class="stat-label">Agents</div><div class="stat-value">${agentCount}</div></div>
      <div class="stat-card"><div class="stat-label">Total agent wallet funds</div><div class="stat-value">${money(walletTotal)}</div></div>
      <div class="stat-card ${pendingFunding ? 'stat-alert' : ''}"><div class="stat-label">Pending funding requests</div><div class="stat-value">${pendingFunding}</div><a class="stat-link" href="/admin/funding-requests">Review →</a></div>
      <div class="stat-card ${pendingRefunds ? 'stat-alert' : ''}"><div class="stat-label">Pending refund requests</div><div class="stat-value">${pendingRefunds}</div><a class="stat-link" href="/admin/refund-requests">Review →</a></div>
    </div>
    <h2>Recent leads</h2>
    ${recentLeads.length ? `<table class="table"><thead><tr><th>Lead</th><th>Location</th><th>Type</th><th>Cost</th><th>Status</th><th>Agent</th><th>Received</th></tr></thead><tbody>${recentLeads.map(leadRow).join('')}</tbody></table>` : '<p class="muted">No leads yet.</p>'}
    `;
    sendHtml(ctx.res, layout({ title: 'Admin dashboard', user: ctx.user, active: 'dashboard', body, query: ctx.query }));
  });

  // ---- Leads ----
  router.get('/admin/leads', (ctx) => {
    if (!requireRole(ctx, 'admin')) return;
    const status = ctx.query.status || 'all';
    const type = ctx.query.type || 'all';
    let sql = `SELECT l.*, u.name as agent_name FROM leads l LEFT JOIN users u ON u.id = l.claimed_by WHERE 1=1`;
    const params = [];
    if (status !== 'all') { sql += ' AND l.status = ?'; params.push(status); }
    if (type !== 'all') { sql += ' AND l.lead_type = ?'; params.push(type); }
    sql += ' ORDER BY l.received_at DESC LIMIT 300';
    const leads = db.prepare(sql).all(...params);

    const currentPrice = parseInt(getSetting('paid_lead_price_cents'), 10);
    const body = `
    <div class="page-head"><h1>Leads</h1><div><a class="btn btn-secondary" href="/admin/leads/import">Import CSV</a> <button class="btn btn-primary" type="button" onclick="document.getElementById('add-lead-form').classList.toggle('hidden')">+ Add lead</button></div></div>
    <div id="add-lead-form" class="panel hidden">
      <h3>Add a lead manually</h3>
      <p class="muted small">Current global paid lead price: <strong>${money(currentPrice)}</strong>. Leave the cost override blank to use it.</p>
      ${leadFormHtml('/admin/leads', {}, 'Add lead')}
    </div>
    <div class="tabs">
      ${['all', 'unclaimed', 'claimed', 'working', 'sold', 'dead', 'refund_requested', 'refunded'].map(s =>
        `<a class="tab ${status === s ? 'active' : ''}" href="/admin/leads?status=${s}${type !== 'all' ? '&type=' + type : ''}">${s === 'all' ? 'All statuses' : esc(s.replace('_', ' '))}</a>`
      ).join('')}
    </div>
    <div class="tabs">
      ${['all', 'free', 'paid'].map(t =>
        `<a class="tab ${type === t ? 'active' : ''}" href="/admin/leads?type=${t}${status !== 'all' ? '&status=' + status : ''}">${t === 'all' ? 'All types' : esc(t)}</a>`
      ).join('')}
    </div>
    ${leads.length ? `<table class="table"><thead><tr><th>Lead</th><th>Location</th><th>Type</th><th>Cost</th><th>Status</th><th>Agent</th><th>Received</th></tr></thead><tbody>${leads.map(leadRow).join('')}</tbody></table>` : '<p class="muted">No leads match this filter.</p>'}
    `;
    sendHtml(ctx.res, layout({ title: 'Leads', user: ctx.user, active: 'leads', body, query: ctx.query }));
  });

  router.post('/admin/leads', (ctx) => {
    if (!requireRole(ctx, 'admin')) return;
    const b = ctx.body;
    const leadType = b.lead_type === 'paid' ? 'paid' : 'free';
    let costCents = 0;
    if (leadType === 'paid') {
      costCents = b.cost_override && b.cost_override.trim() !== '' ? centsFromInput(b.cost_override) : parseInt(getSetting('paid_lead_price_cents'), 10);
    }
    const id = newId('lead');
    const receivedAt = htmlLocalToStorage(b.received_at);
    db.prepare(`INSERT INTO leads (
      id, lead_type, cost_cents, status, first_name, last_name, phone, email, address, city, state, zip,
      insurance_type, current_carrier, coverage_interest, dob, age, household_size, income_range, source, campaign, received_at
    ) VALUES (?,?,?,'unclaimed',?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, COALESCE(?, datetime('now')))`).run(
      id, leadType, costCents,
      b.first_name || null, b.last_name || null, b.phone || null, b.email || null,
      b.address || null, b.city || null, b.state || null, b.zip || null,
      b.insurance_type || null, b.current_carrier || null, b.coverage_interest || null,
      b.dob || null, b.age ? parseInt(b.age, 10) : null, b.household_size ? parseInt(b.household_size, 10) : null,
      b.income_range || null, b.source || 'manual', b.campaign || null, receivedAt
    );
    redirect(ctx.res, '/admin/leads?success=' + encodeURIComponent('Lead added.'));
  });

  router.get('/admin/leads/:id', (ctx) => {
    if (!requireRole(ctx, 'admin')) return;
    const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(ctx.params.id);
    if (!lead) return redirect(ctx.res, '/admin/leads?error=' + encodeURIComponent('Lead not found.'));
    const agent = lead.claimed_by ? db.prepare('SELECT * FROM users WHERE id = ?').get(lead.claimed_by) : null;
    const notes = db.prepare('SELECT n.*, u.name as author_name FROM lead_notes n LEFT JOIN users u ON u.id = n.user_id WHERE lead_id = ? ORDER BY n.created_at DESC').all(lead.id);
    const refundReq = db.prepare('SELECT * FROM refund_requests WHERE lead_id = ? ORDER BY created_at DESC LIMIT 1').get(lead.id);

    lead._explicit_cost = true;
    const body = `
    <div class="page-head">
      <h1>${esc(leadName(lead))}</h1>
      <div>${leadTypeBadge(lead.lead_type)} ${statusBadge(lead.status)}</div>
    </div>
    <div class="two-col">
      <div>
        <div class="panel">
          <h3>Lead details</h3>
          ${leadFormHtml(`/admin/leads/${lead.id}/update`, lead, 'Save changes')}
        </div>
        <div class="panel">
          <h3>Notes</h3>
          ${notes.length ? `<div class="notes-list">${notes.map(n => `<div class="note"><div class="note-meta">${esc(n.author_name || 'System')} · ${fmtDate(n.created_at)}</div><div>${esc(n.note)}</div></div>`).join('')}</div>` : '<p class="muted">No notes yet.</p>'}
        </div>
      </div>
      <div>
        <div class="panel">
          <h3>Assignment</h3>
          <p>${agent ? `Claimed by <strong>${esc(agent.name)}</strong> (${esc(agent.email)}) on ${fmtDate(lead.claimed_at)}.` : 'Not yet claimed — sitting in the agent pool.'}</p>
          ${agent && lead.status !== 'refunded' ? `
          <form method="post" action="/admin/leads/${lead.id}/release" onsubmit="return confirm('Release this lead back to the pool? ${lead.lead_type === 'paid' ? 'The agent will be fully refunded.' : ''}');">
            <button class="btn btn-secondary" type="submit">Release back to pool</button>
          </form>` : ''}
        </div>
        ${refundReq ? `<div class="panel"><h3>Refund request</h3><p>Status: ${statusBadge(refundReq.status)}</p><p>Amount: ${money(refundReq.refund_amount_cents)}</p>${refundReq.reason ? `<p class="muted small">"${esc(refundReq.reason)}"</p>` : ''}${refundReq.status === 'pending' ? `<a class="btn btn-small" href="/admin/refund-requests">Review in queue →</a>` : ''}</div>` : ''}
        ${!agent ? `
        <div class="panel">
          <h3>Delete lead</h3>
          <p class="muted small">Only possible while unclaimed.</p>
          <form method="post" action="/admin/leads/${lead.id}/delete" onsubmit="return confirm('Delete this lead permanently?');">
            <button class="btn btn-danger" type="submit">Delete lead</button>
          </form>
        </div>` : ''}
      </div>
    </div>
    `;
    sendHtml(ctx.res, layout({ title: leadName(lead), user: ctx.user, active: 'leads', body, query: ctx.query }));
  });

  router.post('/admin/leads/:id/update', (ctx) => {
    if (!requireRole(ctx, 'admin')) return;
    const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(ctx.params.id);
    if (!lead) return redirect(ctx.res, '/admin/leads?error=' + encodeURIComponent('Lead not found.'));
    const b = ctx.body;
    const leadType = b.lead_type === 'paid' ? 'paid' : 'free';
    let costCents = lead.cost_cents;
    if (leadType === 'paid') {
      costCents = b.cost_override && b.cost_override.trim() !== '' ? centsFromInput(b.cost_override) : parseInt(getSetting('paid_lead_price_cents'), 10);
    } else {
      costCents = 0;
    }
    const receivedAt = htmlLocalToStorage(b.received_at);
    db.prepare(`UPDATE leads SET lead_type=?, cost_cents=?, first_name=?, last_name=?, phone=?, email=?, address=?, city=?, state=?, zip=?,
      insurance_type=?, current_carrier=?, coverage_interest=?, dob=?, age=?, household_size=?, income_range=?, source=?, campaign=?,
      received_at=COALESCE(?, received_at), updated_at=datetime('now')
      WHERE id=?`).run(
      leadType, costCents,
      b.first_name || null, b.last_name || null, b.phone || null, b.email || null,
      b.address || null, b.city || null, b.state || null, b.zip || null,
      b.insurance_type || null, b.current_carrier || null, b.coverage_interest || null,
      b.dob || null, b.age ? parseInt(b.age, 10) : null, b.household_size ? parseInt(b.household_size, 10) : null,
      b.income_range || null, b.source || null, b.campaign || null,
      receivedAt,
      lead.id
    );
    redirect(ctx.res, `/admin/leads/${lead.id}?success=` + encodeURIComponent('Lead updated.'));
  });

  router.post('/admin/leads/:id/release', (ctx) => {
    if (!requireRole(ctx, 'admin')) return;
    const leadId = ctx.params.id;
    try {
      withTransaction(() => {
        const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(leadId);
        if (!lead) throw new UserError('Lead not found.');
        if (!lead.claimed_by) throw new UserError('Lead is not claimed.');
        if (lead.lead_type === 'paid' && lead.status !== 'refunded') {
          const agent = db.prepare('SELECT * FROM users WHERE id = ?').get(lead.claimed_by);
          const newBalance = agent.wallet_balance_cents + lead.cost_cents;
          db.prepare('UPDATE users SET wallet_balance_cents = ? WHERE id = ?').run(newBalance, agent.id);
          db.prepare(`INSERT INTO wallet_transactions (id, user_id, type, amount_cents, balance_after_cents, related_lead_id, note, created_by) VALUES (?,?,?,?,?,?,?,?)`)
            .run(newId('wtx'), agent.id, 'refund', lead.cost_cents, newBalance, leadId, 'Full refund: lead released back to pool by admin', ctx.user.id);
        }
        db.prepare(`UPDATE leads SET status='unclaimed', claimed_by=NULL, claimed_at=NULL, updated_at=datetime('now') WHERE id=?`).run(leadId);
      });
      redirect(ctx.res, `/admin/leads/${leadId}?success=` + encodeURIComponent('Lead released back to the pool.'));
    } catch (e) {
      redirect(ctx.res, `/admin/leads/${leadId}?error=` + encodeURIComponent(e instanceof UserError ? e.message : 'Could not release lead.'));
    }
  });

  router.post('/admin/leads/:id/delete', (ctx) => {
    if (!requireRole(ctx, 'admin')) return;
    const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(ctx.params.id);
    if (!lead) return redirect(ctx.res, '/admin/leads?error=' + encodeURIComponent('Lead not found.'));
    if (lead.claimed_by) return redirect(ctx.res, `/admin/leads/${lead.id}?error=` + encodeURIComponent('Cannot delete a claimed lead.'));
    db.prepare('DELETE FROM lead_notes WHERE lead_id = ?').run(lead.id);
    db.prepare('DELETE FROM leads WHERE id = ?').run(lead.id);
    redirect(ctx.res, '/admin/leads?success=' + encodeURIComponent('Lead deleted.'));
  });

  // ---- Agents ----
  router.get('/admin/agents', (ctx) => {
    if (!requireRole(ctx, 'admin')) return;
    const agents = db.prepare(`
      SELECT u.*,
        (SELECT COUNT(*) FROM leads WHERE claimed_by = u.id) as lead_count,
        (SELECT COALESCE(SUM(-amount_cents),0) FROM wallet_transactions WHERE user_id = u.id AND type='lead_purchase') as spent
      FROM users u WHERE role='agent' ORDER BY u.created_at DESC`).all();
    const rows = agents.map(a => `<tr>
      <td><a href="/admin/agents/${a.id}">${esc(a.name)}</a></td>
      <td>${esc(a.email)}</td>
      <td>${money(a.wallet_balance_cents)}</td>
      <td>${money(a.spent)}</td>
      <td>${a.lead_count}</td>
      <td><span class="badge badge-${a.status === 'active' ? 'sold' : 'dead'}">${esc(a.status)}</span></td>
      <td>${fmtDate(a.created_at)}</td>
    </tr>`).join('');
    const body = `
    <div class="page-head"><h1>Agents</h1></div>
    ${agents.length ? `<table class="table"><thead><tr><th>Name</th><th>Email</th><th>Balance</th><th>Spent</th><th>Leads</th><th>Status</th><th>Joined</th></tr></thead><tbody>${rows}</tbody></table>` : '<p class="muted">No agents have registered yet.</p>'}
    `;
    sendHtml(ctx.res, layout({ title: 'Agents', user: ctx.user, active: 'agents', body, query: ctx.query }));
  });

  router.get('/admin/agents/:id', (ctx) => {
    if (!requireRole(ctx, 'admin')) return;
    const agent = db.prepare("SELECT * FROM users WHERE id = ? AND role='agent'").get(ctx.params.id);
    if (!agent) return redirect(ctx.res, '/admin/agents?error=' + encodeURIComponent('Agent not found.'));
    const txs = db.prepare('SELECT * FROM wallet_transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT 100').all(agent.id);
    const leads = db.prepare('SELECT * FROM leads WHERE claimed_by = ? ORDER BY claimed_at DESC').all(agent.id);
    const txTypeLabel = { deposit: 'Deposit', lead_purchase: 'Lead purchase', refund: 'Refund', adjustment: 'Adjustment' };
    const txRows = txs.map(t => `<tr>
      <td>${fmtDate(t.created_at)}</td><td>${esc(txTypeLabel[t.type] || t.type)}</td>
      <td class="${t.amount_cents < 0 ? 'text-neg' : 'text-pos'}">${t.amount_cents < 0 ? '' : '+'}${money(t.amount_cents)}</td>
      <td>${money(t.balance_after_cents)}</td><td>${esc(t.note || '—')}</td>
    </tr>`).join('');
    const leadRows = leads.map(l => `<tr><td><a href="/admin/leads/${l.id}">${esc(leadName(l))}</a></td><td>${leadTypeBadge(l.lead_type)}</td><td>${money(l.cost_cents)}</td><td>${statusBadge(l.status)}</td></tr>`).join('');

    const body = `
    <div class="page-head"><h1>${esc(agent.name)}</h1><div><span class="badge badge-${agent.status === 'active' ? 'sold' : 'dead'}">${esc(agent.status)}</span></div></div>
    <div class="stat-grid">
      <div class="stat-card"><div class="stat-label">Wallet balance</div><div class="stat-value">${money(agent.wallet_balance_cents)}</div></div>
      <div class="stat-card"><div class="stat-label">Email</div><div class="stat-value" style="font-size:16px">${esc(agent.email)}</div></div>
      <div class="stat-card"><div class="stat-label">Phone</div><div class="stat-value" style="font-size:16px">${esc(agent.phone || '—')}</div></div>
      <div class="stat-card"><div class="stat-label">Joined</div><div class="stat-value" style="font-size:16px">${fmtDate(agent.created_at)}</div></div>
    </div>
    <div class="two-col">
      <div>
        <h2>Wallet history</h2>
        ${txs.length ? `<table class="table"><thead><tr><th>Date</th><th>Type</th><th>Amount</th><th>Balance after</th><th>Note</th></tr></thead><tbody>${txRows}</tbody></table>` : '<p class="muted">No transactions yet.</p>'}
        <h2>Leads</h2>
        ${leads.length ? `<table class="table"><thead><tr><th>Lead</th><th>Type</th><th>Cost</th><th>Status</th></tr></thead><tbody>${leadRows}</tbody></table>` : '<p class="muted">No leads claimed yet.</p>'}
      </div>
      <div>
        <div class="panel">
          <h3>Adjust wallet</h3>
          <p class="muted small">Positive amount credits the agent; negative amount debits.</p>
          <form method="post" action="/admin/agents/${agent.id}/adjust">
            <label>Amount (USD)<input type="number" step="0.01" name="amount" required placeholder="e.g. 50 or -20"></label>
            <label>Note<input type="text" name="note" placeholder="Reason for adjustment" required></label>
            <button class="btn btn-primary" type="submit">Apply adjustment</button>
          </form>
        </div>
        <div class="panel">
          <h3>Account status</h3>
          <form method="post" action="/admin/agents/${agent.id}/toggle-status" onsubmit="return confirm('${agent.status === 'active' ? 'Disable' : 'Re-enable'} this agent account?');">
            <button class="btn ${agent.status === 'active' ? 'btn-danger' : 'btn-secondary'}" type="submit">${agent.status === 'active' ? 'Disable account' : 'Re-enable account'}</button>
          </form>
        </div>
      </div>
    </div>
    `;
    sendHtml(ctx.res, layout({ title: agent.name, user: ctx.user, active: 'agents', body, query: ctx.query }));
  });

  router.post('/admin/agents/:id/adjust', (ctx) => {
    if (!requireRole(ctx, 'admin')) return;
    const agentId = ctx.params.id;
    const amount = centsFromInput(ctx.body.amount);
    const note = (ctx.body.note || '').trim();
    if (!amount || Number.isNaN(amount)) return redirect(ctx.res, `/admin/agents/${agentId}?error=` + encodeURIComponent('Enter a valid non-zero amount.'));
    try {
      withTransaction(() => {
        const agent = db.prepare("SELECT * FROM users WHERE id = ? AND role='agent'").get(agentId);
        if (!agent) throw new UserError('Agent not found.');
        const newBalance = agent.wallet_balance_cents + amount;
        if (newBalance < 0) throw new UserError('This adjustment would make the wallet balance negative.');
        db.prepare('UPDATE users SET wallet_balance_cents = ? WHERE id = ?').run(newBalance, agentId);
        db.prepare(`INSERT INTO wallet_transactions (id, user_id, type, amount_cents, balance_after_cents, note, created_by) VALUES (?,?,?,?,?,?,?)`)
          .run(newId('wtx'), agentId, 'adjustment', amount, newBalance, note || 'Manual adjustment', ctx.user.id);
      });
      redirect(ctx.res, `/admin/agents/${agentId}?success=` + encodeURIComponent('Wallet adjusted.'));
    } catch (e) {
      redirect(ctx.res, `/admin/agents/${agentId}?error=` + encodeURIComponent(e instanceof UserError ? e.message : 'Could not apply adjustment.'));
    }
  });

  router.post('/admin/agents/:id/toggle-status', (ctx) => {
    if (!requireRole(ctx, 'admin')) return;
    const agent = db.prepare("SELECT * FROM users WHERE id = ? AND role='agent'").get(ctx.params.id);
    if (!agent) return redirect(ctx.res, '/admin/agents?error=' + encodeURIComponent('Agent not found.'));
    const newStatus = agent.status === 'active' ? 'disabled' : 'active';
    db.prepare('UPDATE users SET status = ? WHERE id = ?').run(newStatus, agent.id);
    if (newStatus === 'disabled') {
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(agent.id);
    }
    redirect(ctx.res, `/admin/agents/${agent.id}?success=` + encodeURIComponent(`Account ${newStatus === 'active' ? 're-enabled' : 'disabled'}.`));
  });

  // ---- Funding requests ----
  router.get('/admin/funding-requests', (ctx) => {
    if (!requireRole(ctx, 'admin')) return;
    const requests = db.prepare(`SELECT f.*, u.name as agent_name, u.email as agent_email FROM funding_requests f JOIN users u ON u.id = f.user_id ORDER BY (f.status='pending') DESC, f.created_at DESC LIMIT 200`).all();
    const rows = requests.map(r => `<tr>
      <td>${fmtDate(r.created_at)}</td>
      <td>${esc(r.agent_name)}<br><span class="muted small">${esc(r.agent_email)}</span></td>
      <td>${money(r.amount_cents)}</td>
      <td>${esc(r.note || '—')}</td>
      <td><span class="badge badge-${r.status}">${esc(r.status)}</span></td>
      <td>
      ${r.status === 'pending' ? `
        <form method="post" action="/admin/funding-requests/${r.id}/complete" class="inline-form"><button class="btn btn-small btn-primary" type="submit">Confirm & credit</button></form>
        <form method="post" action="/admin/funding-requests/${r.id}/reject" class="inline-form"><button class="btn btn-small btn-danger" type="submit">Reject</button></form>
      ` : `<span class="muted small">Resolved ${fmtDate(r.resolved_at)}</span>`}
      </td>
    </tr>`).join('');
    const body = `
    <div class="page-head"><h1>Funding requests</h1></div>
    ${requests.length ? `<table class="table"><thead><tr><th>Date</th><th>Agent</th><th>Amount</th><th>Note</th><th>Status</th><th></th></tr></thead><tbody>${rows}</tbody></table>` : '<p class="muted">No funding requests yet.</p>'}
    `;
    sendHtml(ctx.res, layout({ title: 'Funding requests', user: ctx.user, active: 'funding', body, query: ctx.query }));
  });

  router.post('/admin/funding-requests/:id/complete', (ctx) => {
    if (!requireRole(ctx, 'admin')) return;
    const reqId = ctx.params.id;
    try {
      withTransaction(() => {
        const fr = db.prepare("SELECT * FROM funding_requests WHERE id = ?").get(reqId);
        if (!fr) throw new UserError('Request not found.');
        if (fr.status !== 'pending') throw new UserError('This request was already resolved.');
        const agent = db.prepare('SELECT * FROM users WHERE id = ?').get(fr.user_id);
        const newBalance = agent.wallet_balance_cents + fr.amount_cents;
        db.prepare('UPDATE users SET wallet_balance_cents = ? WHERE id = ?').run(newBalance, agent.id);
        db.prepare(`INSERT INTO wallet_transactions (id, user_id, type, amount_cents, balance_after_cents, note, created_by) VALUES (?,?,?,?,?,?,?)`)
          .run(newId('wtx'), agent.id, 'deposit', fr.amount_cents, newBalance, 'Funding request confirmed', ctx.user.id);
        db.prepare(`UPDATE funding_requests SET status='completed', resolved_at=datetime('now'), resolved_by=? WHERE id=?`).run(ctx.user.id, reqId);
      });
      redirect(ctx.res, '/admin/funding-requests?success=' + encodeURIComponent('Funds credited to agent wallet.'));
    } catch (e) {
      redirect(ctx.res, '/admin/funding-requests?error=' + encodeURIComponent(e instanceof UserError ? e.message : 'Could not complete request.'));
    }
  });

  router.post('/admin/funding-requests/:id/reject', (ctx) => {
    if (!requireRole(ctx, 'admin')) return;
    const fr = db.prepare("SELECT * FROM funding_requests WHERE id = ?").get(ctx.params.id);
    if (!fr || fr.status !== 'pending') return redirect(ctx.res, '/admin/funding-requests?error=' + encodeURIComponent('Request not found or already resolved.'));
    db.prepare(`UPDATE funding_requests SET status='rejected', resolved_at=datetime('now'), resolved_by=? WHERE id=?`).run(ctx.user.id, fr.id);
    redirect(ctx.res, '/admin/funding-requests?success=' + encodeURIComponent('Funding request rejected.'));
  });

  // ---- Refund requests ----
  router.get('/admin/refund-requests', (ctx) => {
    if (!requireRole(ctx, 'admin')) return;
    const requests = db.prepare(`
      SELECT r.*, u.name as agent_name, u.email as agent_email, l.first_name, l.last_name, l.cost_cents as lead_cost
      FROM refund_requests r JOIN users u ON u.id = r.user_id JOIN leads l ON l.id = r.lead_id
      ORDER BY (r.status='pending') DESC, r.created_at DESC LIMIT 200`).all();
    const rows = requests.map(r => `<tr>
      <td>${fmtDate(r.created_at)}</td>
      <td>${esc(r.agent_name)}</td>
      <td><a href="/admin/leads/${r.lead_id}">${esc([r.first_name, r.last_name].filter(Boolean).join(' ') || 'Lead')}</a> <span class="muted small">(${money(r.lead_cost)})</span></td>
      <td>${esc(r.reason || '—')}</td>
      <td>${money(r.refund_amount_cents)}</td>
      <td><span class="badge badge-${r.status}">${esc(r.status)}</span></td>
      <td>
      ${r.status === 'pending' ? `
        <form method="post" action="/admin/refund-requests/${r.id}/approve" class="inline-form"><button class="btn btn-small btn-primary" type="submit">Approve</button></form>
        <form method="post" action="/admin/refund-requests/${r.id}/deny" class="inline-form"><button class="btn btn-small btn-danger" type="submit">Deny</button></form>
      ` : `<span class="muted small">Resolved ${fmtDate(r.resolved_at)}</span>`}
      </td>
    </tr>`).join('');
    const body = `
    <div class="page-head"><h1>Refund requests</h1></div>
    ${requests.length ? `<table class="table"><thead><tr><th>Date</th><th>Agent</th><th>Lead</th><th>Reason</th><th>Refund amount</th><th>Status</th><th></th></tr></thead><tbody>${rows}</tbody></table>` : '<p class="muted">No refund requests yet.</p>'}
    `;
    sendHtml(ctx.res, layout({ title: 'Refund requests', user: ctx.user, active: 'refunds', body, query: ctx.query }));
  });

  router.post('/admin/refund-requests/:id/approve', (ctx) => {
    if (!requireRole(ctx, 'admin')) return;
    const reqId = ctx.params.id;
    try {
      withTransaction(() => {
        const rf = db.prepare('SELECT * FROM refund_requests WHERE id = ?').get(reqId);
        if (!rf) throw new UserError('Request not found.');
        if (rf.status !== 'pending') throw new UserError('This request was already resolved.');
        const agent = db.prepare('SELECT * FROM users WHERE id = ?').get(rf.user_id);
        const newBalance = agent.wallet_balance_cents + rf.refund_amount_cents;
        db.prepare('UPDATE users SET wallet_balance_cents = ? WHERE id = ?').run(newBalance, agent.id);
        db.prepare(`INSERT INTO wallet_transactions (id, user_id, type, amount_cents, balance_after_cents, related_lead_id, note, created_by) VALUES (?,?,?,?,?,?,?,?)`)
          .run(newId('wtx'), agent.id, 'refund', rf.refund_amount_cents, newBalance, rf.lead_id, 'Partial refund approved', ctx.user.id);
        db.prepare(`UPDATE refund_requests SET status='approved', resolved_at=datetime('now'), resolved_by=? WHERE id=?`).run(ctx.user.id, reqId);
        db.prepare(`UPDATE leads SET status='refunded', updated_at=datetime('now') WHERE id=?`).run(rf.lead_id);
      });
      redirect(ctx.res, '/admin/refund-requests?success=' + encodeURIComponent('Refund approved and credited.'));
    } catch (e) {
      redirect(ctx.res, '/admin/refund-requests?error=' + encodeURIComponent(e instanceof UserError ? e.message : 'Could not approve refund.'));
    }
  });

  router.post('/admin/refund-requests/:id/deny', (ctx) => {
    if (!requireRole(ctx, 'admin')) return;
    const rf = db.prepare('SELECT * FROM refund_requests WHERE id = ?').get(ctx.params.id);
    if (!rf || rf.status !== 'pending') return redirect(ctx.res, '/admin/refund-requests?error=' + encodeURIComponent('Request not found or already resolved.'));
    db.prepare(`UPDATE refund_requests SET status='denied', resolved_at=datetime('now'), resolved_by=? WHERE id=?`).run(ctx.user.id, rf.id);
    db.prepare(`UPDATE leads SET status='dead', updated_at=datetime('now') WHERE id=?`).run(rf.lead_id);
    redirect(ctx.res, '/admin/refund-requests?success=' + encodeURIComponent('Refund request denied.'));
  });

  // ---- Settings ----
  router.get('/admin/settings', (ctx) => {
    if (!requireRole(ctx, 'admin')) return;
    const price = parseInt(getSetting('paid_lead_price_cents'), 10);
    const pct = getSetting('refund_percent');
    const apiKey = getSetting('funnel_api_key');
    const host = ctx.req.headers.host;
    const proto = ctx.req.headers['x-forwarded-proto'] || 'http';
    const funnelUrl = `${proto}://${host}/api/funnel/leads`;
    const body = `
    <div class="page-head"><h1>Settings</h1></div>
    <div class="two-col">
      <div>
        <div class="panel">
          <h3>Lead pricing</h3>
          <form method="post" action="/admin/settings">
            <label>Current paid lead price (USD)<input type="number" step="0.01" min="0" name="paid_lead_price" value="${(price / 100).toFixed(2)}" required></label>
            <label>Refund percentage on dead paid leads<input type="number" step="1" min="0" max="100" name="refund_percent" value="${esc(pct)}" required></label>
            <p class="muted small">Changing the price only affects new leads created after this change (funnel + manual, unless a manual cost override is used).</p>
            <button class="btn btn-primary" type="submit">Save settings</button>
          </form>
        </div>
      </div>
      <div>
        <div class="panel">
          <h3>Funnel integration</h3>
          <p class="muted small">Point your lead-generation funnel / landing page webhook at this endpoint to submit leads automatically.</p>
          <label>Endpoint URL<input type="text" readonly value="${esc(funnelUrl)}" onclick="this.select()"></label>
          <label>API key (send as header <code>X-API-Key</code>)<input type="text" readonly value="${esc(apiKey)}" onclick="this.select()"></label>
          <form method="post" action="/admin/settings/regenerate-key" onsubmit="return confirm('Regenerate the API key? Any funnel using the old key will stop working until updated.');">
            <button class="btn btn-secondary" type="submit">Regenerate API key</button>
          </form>
          <details class="doc-details">
            <summary>Example request</summary>
            <pre>curl -X POST "${esc(funnelUrl)}" \\
  -H "Content-Type: application/json" \\
  -H "X-API-Key: ${esc(apiKey)}" \\
  -d '{
    "lead_type": "paid",
    "first_name": "Jane",
    "last_name": "Doe",
    "phone": "555-123-4567",
    "email": "jane@example.com",
    "city": "Springfield",
    "state": "IL",
    "insurance_type": "Medicare Advantage",
    "age": 67,
    "source": "Facebook Ad"
  }'</pre>
          </details>
        </div>
      </div>
    </div>
    `;
    sendHtml(ctx.res, layout({ title: 'Settings', user: ctx.user, active: 'settings', body, query: ctx.query }));
  });

  router.post('/admin/settings', (ctx) => {
    if (!requireRole(ctx, 'admin')) return;
    const price = centsFromInput(ctx.body.paid_lead_price);
    const pct = parseInt(ctx.body.refund_percent, 10);
    if (Number.isNaN(price) || price < 0) return redirect(ctx.res, '/admin/settings?error=' + encodeURIComponent('Enter a valid price.'));
    if (Number.isNaN(pct) || pct < 0 || pct > 100) return redirect(ctx.res, '/admin/settings?error=' + encodeURIComponent('Refund percentage must be between 0 and 100.'));
    setSetting('paid_lead_price_cents', price);
    setSetting('refund_percent', pct);
    redirect(ctx.res, '/admin/settings?success=' + encodeURIComponent('Settings updated.'));
  });

  router.post('/admin/settings/regenerate-key', (ctx) => {
    if (!requireRole(ctx, 'admin')) return;
    setSetting('funnel_api_key', crypto.randomBytes(24).toString('hex'));
    redirect(ctx.res, '/admin/settings?success=' + encodeURIComponent('API key regenerated.'));
  });
}

module.exports = { registerAdminRoutes };
