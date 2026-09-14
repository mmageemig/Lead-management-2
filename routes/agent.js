'use strict';
const { db, newId, getSetting, withTransaction } = require('../lib/db');
const { redirect, sendHtml } = require('../lib/http');
const { requireRole } = require('../lib/guards');
const { UserError } = require('../lib/errors');
const { layout, esc, money, fmtDate, statusBadge, leadTypeBadge } = require('../lib/ui');

function leadName(lead) {
  return [lead.first_name, lead.last_name].filter(Boolean).join(' ') || 'Unnamed lead';
}

function poolRow(lead) {
  const initials = (lead.first_name || '') + ' ' + (lead.last_name ? lead.last_name[0] + '.' : '');
  return `<tr>
    <td>${esc(initials.trim() || 'Lead')}</td>
    <td>${esc([lead.city, lead.state].filter(Boolean).join(', ') || '—')}</td>
    <td>${esc(lead.insurance_type || '—')}</td>
    <td>${leadTypeBadge(lead.lead_type)}</td>
    <td>${lead.lead_type === 'paid' ? money(lead.cost_cents) : '<span class="muted">Free</span>'}</td>
    <td>${fmtDate(lead.received_at || lead.created_at)}</td>
    <td class="right">
      <a class="btn btn-small" href="/portal/leads/${lead.id}">View</a>
    </td>
  </tr>`;
}

function myLeadRow(lead) {
  return `<tr>
    <td><a href="/portal/leads/${lead.id}">${esc(leadName(lead))}</a></td>
    <td>${esc([lead.city, lead.state].filter(Boolean).join(', ') || '—')}</td>
    <td>${leadTypeBadge(lead.lead_type)}</td>
    <td>${lead.lead_type === 'paid' ? money(lead.cost_cents) : '<span class="muted">Free</span>'}</td>
    <td>${statusBadge(lead.status)}</td>
    <td>${fmtDate(lead.claimed_at)}</td>
    <td class="right"><a class="btn btn-small" href="/portal/leads/${lead.id}">Open</a></td>
  </tr>`;
}

function filterTabs(basePath, current, options, paramName = 'type') {
  return `<div class="tabs">${options.map(([val, label]) => {
    const href = val === 'all' ? basePath : `${basePath}?${paramName}=${val}`;
    return `<a class="tab ${current === val ? 'active' : ''}" href="${href}">${esc(label)}</a>`;
  }).join('')}</div>`;
}

function registerAgentRoutes(router) {
  // ---- Dashboard ----
  router.get('/portal', (ctx) => {
    if (!requireRole(ctx, 'agent')) return;
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(ctx.user.id);
    const availFree = db.prepare("SELECT COUNT(*) c FROM leads WHERE status='unclaimed' AND lead_type='free'").get().c;
    const availPaid = db.prepare("SELECT COUNT(*) c FROM leads WHERE status='unclaimed' AND lead_type='paid'").get().c;
    const myActive = db.prepare("SELECT COUNT(*) c FROM leads WHERE claimed_by=? AND status IN ('claimed','working')").get(user.id).c;
    const mySold = db.prepare("SELECT COUNT(*) c FROM leads WHERE claimed_by=? AND status='sold'").get(user.id).c;
    const pendingRefunds = db.prepare("SELECT COUNT(*) c FROM refund_requests WHERE user_id=? AND status='pending'").get(user.id).c;
    const pendingFunding = db.prepare("SELECT COUNT(*) c FROM funding_requests WHERE user_id=? AND status='pending'").get(user.id).c;
    const recentLeads = db.prepare("SELECT * FROM leads WHERE claimed_by=? ORDER BY updated_at DESC LIMIT 5").all(user.id);

    const body = `
    <div class="page-head">
      <h1>Welcome back, ${esc(user.name.split(' ')[0])}</h1>
    </div>
    <div class="stat-grid">
      <div class="stat-card"><div class="stat-label">Wallet balance</div><div class="stat-value">${money(user.wallet_balance_cents)}</div><a href="/portal/wallet" class="stat-link">Manage wallet →</a></div>
      <div class="stat-card"><div class="stat-label">Available free leads</div><div class="stat-value">${availFree}</div><a href="/portal/leads?type=free" class="stat-link">View pool →</a></div>
      <div class="stat-card"><div class="stat-label">Available paid leads</div><div class="stat-value">${availPaid}</div><a href="/portal/leads?type=paid" class="stat-link">View pool →</a></div>
      <div class="stat-card"><div class="stat-label">My active leads</div><div class="stat-value">${myActive}</div><a href="/portal/my-leads" class="stat-link">View my leads →</a></div>
      <div class="stat-card"><div class="stat-label">My leads sold</div><div class="stat-value">${mySold}</div></div>
      <div class="stat-card"><div class="stat-label">Pending requests</div><div class="stat-value">${pendingRefunds + pendingFunding}</div><span class="muted small">${pendingFunding} funding · ${pendingRefunds} refund</span></div>
    </div>
    <h2>Recent activity</h2>
    ${recentLeads.length ? `<table class="table"><thead><tr><th>Lead</th><th>Location</th><th>Type</th><th>Cost</th><th>Status</th><th>Updated</th><th></th></tr></thead><tbody>${recentLeads.map(myLeadRow).join('')}</tbody></table>` : '<p class="muted">No lead activity yet — visit the lead pool to claim your first lead.</p>'}
    `;
    sendHtml(ctx.res, layout({ title: 'Dashboard', user: ctx.user, active: 'pool', body, query: ctx.query }));
  });

  // ---- Lead pool ----
  router.get('/portal/leads', (ctx) => {
    if (!requireRole(ctx, 'agent')) return;
    const type = ['free', 'paid'].includes(ctx.query.type) ? ctx.query.type : 'all';
    let leads;
    if (type === 'all') {
      leads = db.prepare("SELECT * FROM leads WHERE status='unclaimed' ORDER BY received_at DESC").all();
    } else {
      leads = db.prepare("SELECT * FROM leads WHERE status='unclaimed' AND lead_type=? ORDER BY received_at DESC").all(type);
    }
    const body = `
    <div class="page-head"><h1>Lead pool</h1><p class="muted">Contact details are revealed once you claim a lead.</p></div>
    ${filterTabs('/portal/leads', type, [['all', 'All'], ['free', 'Free'], ['paid', 'Paid']])}
    ${leads.length ? `<table class="table"><thead><tr><th>Lead</th><th>Location</th><th>Interest</th><th>Type</th><th>Cost</th><th>Received</th><th></th></tr></thead><tbody>${leads.map(poolRow).join('')}</tbody></table>`
      : '<p class="muted">No leads available in this category right now. Check back soon.</p>'}
    `;
    sendHtml(ctx.res, layout({ title: 'Lead pool', user: ctx.user, active: 'pool', body, query: ctx.query }));
  });

  // ---- My leads ----
  router.get('/portal/my-leads', (ctx) => {
    if (!requireRole(ctx, 'agent')) return;
    const status = ctx.query.status && ctx.query.status !== 'all' ? ctx.query.status : null;
    let leads;
    if (status) {
      leads = db.prepare("SELECT * FROM leads WHERE claimed_by=? AND status=? ORDER BY updated_at DESC").all(ctx.user.id, status);
    } else {
      leads = db.prepare("SELECT * FROM leads WHERE claimed_by=? ORDER BY updated_at DESC").all(ctx.user.id);
    }
    const tabs = [['all', 'All'], ['claimed', 'Claimed'], ['working', 'Working'], ['sold', 'Sold'], ['dead', 'Dead'], ['refund_requested', 'Refund Pending'], ['refunded', 'Refunded']];
    const body = `
    <div class="page-head"><h1>My leads</h1></div>
    ${filterTabs('/portal/my-leads', status || 'all', tabs, 'status')}
    ${leads.length ? `<table class="table"><thead><tr><th>Lead</th><th>Location</th><th>Type</th><th>Cost</th><th>Status</th><th>Claimed</th><th></th></tr></thead><tbody>${leads.map(myLeadRow).join('')}</tbody></table>`
      : '<p class="muted">No leads in this view yet.</p>'}
    `;
    sendHtml(ctx.res, layout({ title: 'My leads', user: ctx.user, active: 'my-leads', body, query: ctx.query }));
  });

  // ---- Lead detail ----
  router.get('/portal/leads/:id', (ctx) => {
    if (!requireRole(ctx, 'agent')) return;
    const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(ctx.params.id);
    if (!lead || (lead.status !== 'unclaimed' && lead.claimed_by !== ctx.user.id)) {
      return redirect(ctx.res, '/portal/leads?error=' + encodeURIComponent('That lead is not available.'));
    }
    const isMine = lead.claimed_by === ctx.user.id;
    const notes = isMine ? db.prepare('SELECT n.*, u.name as author_name FROM lead_notes n LEFT JOIN users u ON u.id = n.user_id WHERE lead_id = ? ORDER BY n.created_at DESC').all(lead.id) : [];
    const refundReq = isMine ? db.prepare('SELECT * FROM refund_requests WHERE lead_id = ? ORDER BY created_at DESC LIMIT 1').get(lead.id) : null;

    let detailFields = '';
    if (isMine) {
      detailFields = `
        <dl class="detail-grid">
          <dt>Name</dt><dd>${esc(leadName(lead))}</dd>
          <dt>Phone</dt><dd>${esc(lead.phone || '—')}</dd>
          <dt>Email</dt><dd>${esc(lead.email || '—')}</dd>
          <dt>Address</dt><dd>${esc([lead.address, lead.city, lead.state, lead.zip].filter(Boolean).join(', ') || '—')}</dd>
          <dt>Insurance type</dt><dd>${esc(lead.insurance_type || '—')}</dd>
          <dt>Current carrier</dt><dd>${esc(lead.current_carrier || '—')}</dd>
          <dt>Coverage interest</dt><dd>${esc(lead.coverage_interest || '—')}</dd>
          <dt>Date of birth</dt><dd>${esc(lead.dob || '—')}</dd>
          <dt>Age</dt><dd>${esc(lead.age != null ? lead.age : '—')}</dd>
          <dt>Household size</dt><dd>${esc(lead.household_size != null ? lead.household_size : '—')}</dd>
          <dt>Income range</dt><dd>${esc(lead.income_range || '—')}</dd>
          <dt>Source / campaign</dt><dd>${esc([lead.source, lead.campaign].filter(Boolean).join(' / ') || '—')}</dd>
          <dt>Received</dt><dd>${fmtDate(lead.received_at || lead.created_at)}</dd>
        </dl>`;
    } else {
      detailFields = `
        <dl class="detail-grid">
          <dt>Location</dt><dd>${esc([lead.city, lead.state].filter(Boolean).join(', ') || '—')}</dd>
          <dt>Insurance type</dt><dd>${esc(lead.insurance_type || '—')}</dd>
          <dt>Coverage interest</dt><dd>${esc(lead.coverage_interest || '—')}</dd>
          <dt>Age</dt><dd>${esc(lead.age != null ? lead.age : '—')}</dd>
          <dt>Household size</dt><dd>${esc(lead.household_size != null ? lead.household_size : '—')}</dd>
          <dt>Source</dt><dd>${esc(lead.source || '—')}</dd>
          <dt>Received</dt><dd>${fmtDate(lead.received_at || lead.created_at)}</dd>
        </dl>
        <p class="muted small">Full contact details (name, phone, email, address) are revealed once you claim this lead.</p>`;
    }

    let actionPanel = '';
    if (!isMine) {
      actionPanel = `
      <div class="panel">
        <h3>Claim this lead</h3>
        <p>${lead.lead_type === 'paid' ? `This is a <strong>paid lead</strong>. Claiming it will deduct <strong>${money(lead.cost_cents)}</strong> from your wallet balance.` : 'This is a <strong>free lead</strong>. Claiming it is at no cost.'}</p>
        <form method="post" action="/portal/leads/${lead.id}/claim">
          <button class="btn btn-primary" type="submit">Claim lead</button>
        </form>
      </div>`;
    } else {
      const canRefund = lead.lead_type === 'paid' && lead.status === 'dead' && !refundReq;
      actionPanel = `
      <div class="panel">
        <h3>Update this lead</h3>
        <form method="post" action="/portal/leads/${lead.id}/status">
          <label>Status
            <select name="status">
              <option value="claimed" ${lead.status === 'claimed' ? 'selected' : ''} disabled>Claimed (new)</option>
              <option value="working" ${lead.status === 'working' ? 'selected' : ''}>Working</option>
              <option value="sold" ${lead.status === 'sold' ? 'selected' : ''}>Sold / Won</option>
              <option value="dead" ${lead.status === 'dead' ? 'selected' : ''}>Dead / No Pan Out</option>
            </select>
          </label>
          <label>Add a note (optional)<textarea name="note" rows="3" placeholder="What happened on this lead?"></textarea></label>
          <button class="btn btn-primary" type="submit" ${lead.status === 'refunded' ? 'disabled' : ''}>Save update</button>
        </form>
      </div>
      ${lead.lead_type === 'paid' ? `
      <div class="panel">
        <h3>Refund</h3>
        ${refundReq
          ? `<p>Refund request status: ${statusRefundBadge(refundReq.status)} ${refundReq.status !== 'pending' ? '' : '(awaiting admin review)'}${refundReq.status === 'approved' ? ` — ${money(refundReq.refund_amount_cents)} credited to your wallet.` : ''}</p>`
          : canRefund
            ? `<p>If this lead didn't pan out, you can request a ${esc(getSetting('refund_percent'))}% refund (${money(Math.round(lead.cost_cents * parseInt(getSetting('refund_percent'), 10) / 100))}) back to your wallet.</p>
               <form method="post" action="/portal/leads/${lead.id}/refund-request">
                 <label>Reason<textarea name="reason" rows="2" placeholder="e.g. wrong number, not interested, already insured"></textarea></label>
                 <button class="btn btn-secondary" type="submit">Request refund</button>
               </form>`
            : `<p class="muted">Mark this lead as "Dead / No Pan Out" to become eligible for a partial refund.</p>`}
      </div>` : ''}
      `;
    }

    const notesHtml = notes.length ? `<div class="notes-list">${notes.map(n => `
      <div class="note"><div class="note-meta">${esc(n.author_name || 'System')} · ${fmtDate(n.created_at)}</div><div>${esc(n.note)}</div></div>
    `).join('')}</div>` : '<p class="muted">No notes yet.</p>';

    const body = `
    <div class="page-head">
      <h1>${isMine ? esc(leadName(lead)) : 'Lead details'}</h1>
      <div>${leadTypeBadge(lead.lead_type)} ${statusBadge(lead.status)}</div>
    </div>
    <div class="two-col">
      <div>
        <div class="panel">${detailFields}</div>
        ${isMine ? `<div class="panel"><h3>Notes</h3>${notesHtml}</div>` : ''}
      </div>
      <div>${actionPanel}</div>
    </div>
    `;
    sendHtml(ctx.res, layout({ title: leadName(lead), user: ctx.user, active: isMine ? 'my-leads' : 'pool', body, query: ctx.query }));
  });

  router.post('/portal/leads/:id/claim', (ctx) => {
    if (!requireRole(ctx, 'agent')) return;
    const leadId = ctx.params.id;
    try {
      withTransaction(() => {
        const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(leadId);
        if (!lead) throw new UserError('Lead not found.');
        if (lead.status !== 'unclaimed') throw new UserError('That lead has already been claimed by someone else.');
        if (lead.lead_type === 'paid') {
          const price = lead.cost_cents;
          const user = db.prepare('SELECT * FROM users WHERE id = ?').get(ctx.user.id);
          if (user.wallet_balance_cents < price) throw new UserError('Insufficient wallet balance to claim this paid lead. Add funds first.');
          const newBalance = user.wallet_balance_cents - price;
          db.prepare('UPDATE users SET wallet_balance_cents = ? WHERE id = ?').run(newBalance, ctx.user.id);
          db.prepare(`INSERT INTO wallet_transactions (id, user_id, type, amount_cents, balance_after_cents, related_lead_id, note) VALUES (?,?,?,?,?,?,?)`)
            .run(newId('wtx'), ctx.user.id, 'lead_purchase', -price, newBalance, leadId, 'Purchased lead');
        }
        db.prepare(`UPDATE leads SET status='claimed', claimed_by=?, claimed_at=datetime('now'), updated_at=datetime('now') WHERE id=?`).run(ctx.user.id, leadId);
      });
      redirect(ctx.res, `/portal/leads/${leadId}?success=` + encodeURIComponent('Lead claimed successfully.'));
    } catch (e) {
      redirect(ctx.res, `/portal/leads?error=` + encodeURIComponent(e instanceof UserError ? e.message : 'Could not claim lead.'));
    }
  });

  router.post('/portal/leads/:id/status', (ctx) => {
    if (!requireRole(ctx, 'agent')) return;
    const leadId = ctx.params.id;
    const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(leadId);
    if (!lead || lead.claimed_by !== ctx.user.id) return redirect(ctx.res, '/portal/my-leads?error=' + encodeURIComponent('Lead not found.'));
    if (lead.status === 'refunded') return redirect(ctx.res, `/portal/leads/${leadId}?error=` + encodeURIComponent('This lead has already been refunded and is closed.'));
    const allowed = ['working', 'sold', 'dead'];
    const newStatus = ctx.body.status;
    if (!allowed.includes(newStatus)) return redirect(ctx.res, `/portal/leads/${leadId}?error=` + encodeURIComponent('Invalid status.'));
    db.prepare(`UPDATE leads SET status=?, updated_at=datetime('now') WHERE id=?`).run(newStatus, leadId);
    if (ctx.body.note && ctx.body.note.trim()) {
      db.prepare(`INSERT INTO lead_notes (id, lead_id, user_id, note) VALUES (?,?,?,?)`).run(newId('note'), leadId, ctx.user.id, ctx.body.note.trim());
    }
    redirect(ctx.res, `/portal/leads/${leadId}?success=` + encodeURIComponent('Lead updated.'));
  });

  router.post('/portal/leads/:id/refund-request', (ctx) => {
    if (!requireRole(ctx, 'agent')) return;
    const leadId = ctx.params.id;
    const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(leadId);
    if (!lead || lead.claimed_by !== ctx.user.id) return redirect(ctx.res, '/portal/my-leads?error=' + encodeURIComponent('Lead not found.'));
    if (lead.lead_type !== 'paid') return redirect(ctx.res, `/portal/leads/${leadId}?error=` + encodeURIComponent('Only paid leads are eligible for a refund.'));
    if (lead.status !== 'dead') return redirect(ctx.res, `/portal/leads/${leadId}?error=` + encodeURIComponent('Mark the lead as "Dead / No Pan Out" before requesting a refund.'));
    const existing = db.prepare("SELECT * FROM refund_requests WHERE lead_id=? AND status IN ('pending','approved')").get(leadId);
    if (existing) return redirect(ctx.res, `/portal/leads/${leadId}?error=` + encodeURIComponent('A refund request already exists for this lead.'));
    const pct = parseInt(getSetting('refund_percent'), 10);
    const refundAmount = Math.round(lead.cost_cents * pct / 100);
    db.prepare(`INSERT INTO refund_requests (id, lead_id, user_id, reason, refund_amount_cents) VALUES (?,?,?,?,?)`)
      .run(newId('rf'), leadId, ctx.user.id, (ctx.body.reason || '').trim() || null, refundAmount);
    db.prepare(`UPDATE leads SET status='refund_requested', updated_at=datetime('now') WHERE id=?`).run(leadId);
    redirect(ctx.res, `/portal/leads/${leadId}?success=` + encodeURIComponent('Refund request submitted for admin review.'));
  });

  // ---- Wallet ----
  router.get('/portal/wallet', (ctx) => {
    if (!requireRole(ctx, 'agent')) return;
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(ctx.user.id);
    const txs = db.prepare('SELECT * FROM wallet_transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT 100').all(user.id);
    const fundingReqs = db.prepare('SELECT * FROM funding_requests WHERE user_id = ? ORDER BY created_at DESC LIMIT 20').all(user.id);
    const spent = db.prepare("SELECT COALESCE(SUM(-amount_cents),0) s FROM wallet_transactions WHERE user_id=? AND type='lead_purchase'").get(user.id).s;
    const deposited = db.prepare("SELECT COALESCE(SUM(amount_cents),0) s FROM wallet_transactions WHERE user_id=? AND type='deposit'").get(user.id).s;
    const refunded = db.prepare("SELECT COALESCE(SUM(amount_cents),0) s FROM wallet_transactions WHERE user_id=? AND type='refund'").get(user.id).s;

    const txTypeLabel = { deposit: 'Deposit', lead_purchase: 'Lead purchase', refund: 'Refund', adjustment: 'Adjustment' };
    const txRows = txs.map(t => `<tr>
      <td>${fmtDate(t.created_at)}</td>
      <td>${esc(txTypeLabel[t.type] || t.type)}</td>
      <td class="${t.amount_cents < 0 ? 'text-neg' : 'text-pos'}">${t.amount_cents < 0 ? '' : '+'}${money(t.amount_cents)}</td>
      <td>${money(t.balance_after_cents)}</td>
      <td>${esc(t.note || '—')}</td>
    </tr>`).join('');

    const frStatusLabel = { pending: 'Pending', completed: 'Completed', rejected: 'Rejected' };
    const frRows = fundingReqs.map(f => `<tr>
      <td>${fmtDate(f.created_at)}</td>
      <td>${money(f.amount_cents)}</td>
      <td><span class="badge badge-${f.status}">${esc(frStatusLabel[f.status])}</span></td>
      <td>${esc(f.note || '—')}</td>
    </tr>`).join('');

    const body = `
    <div class="page-head"><h1>Wallet</h1></div>
    <div class="stat-grid">
      <div class="stat-card"><div class="stat-label">Current balance</div><div class="stat-value">${money(user.wallet_balance_cents)}</div></div>
      <div class="stat-card"><div class="stat-label">Total deposited</div><div class="stat-value">${money(deposited)}</div></div>
      <div class="stat-card"><div class="stat-label">Total spent on leads</div><div class="stat-value">${money(spent)}</div></div>
      <div class="stat-card"><div class="stat-label">Total refunded</div><div class="stat-value">${money(refunded)}</div></div>
    </div>

    <div class="two-col">
      <div>
        <h2>Transaction history</h2>
        ${txs.length ? `<table class="table"><thead><tr><th>Date</th><th>Type</th><th>Amount</th><th>Balance after</th><th>Note</th></tr></thead><tbody>${txRows}</tbody></table>` : '<p class="muted">No transactions yet.</p>'}
      </div>
      <div>
        <div class="panel">
          <h3>Add funds</h3>
          <p class="muted small">Submit a funding request with the amount you've sent (check, Zelle, etc.). Your administrator will confirm receipt and credit your wallet.</p>
          <form method="post" action="/portal/wallet/fund-request">
            <label>Amount (USD)<input type="number" name="amount" min="1" step="0.01" required></label>
            <label>Note (optional)<input type="text" name="note" placeholder="e.g. Zelle sent 9/11"></label>
            <button class="btn btn-primary" type="submit">Submit funding request</button>
          </form>
        </div>
        <h3>Funding request history</h3>
        ${fundingReqs.length ? `<table class="table"><thead><tr><th>Date</th><th>Amount</th><th>Status</th><th>Note</th></tr></thead><tbody>${frRows}</tbody></table>` : '<p class="muted">No requests yet.</p>'}
      </div>
    </div>
    `;
    sendHtml(ctx.res, layout({ title: 'Wallet', user: ctx.user, active: 'wallet', body, query: ctx.query }));
  });

  router.post('/portal/wallet/fund-request', (ctx) => {
    if (!requireRole(ctx, 'agent')) return;
    const amount = Math.round(parseFloat(ctx.body.amount) * 100);
    if (!amount || amount <= 0 || Number.isNaN(amount)) {
      return redirect(ctx.res, '/portal/wallet?error=' + encodeURIComponent('Enter a valid amount.'));
    }
    db.prepare(`INSERT INTO funding_requests (id, user_id, amount_cents, note) VALUES (?,?,?,?)`)
      .run(newId('fr'), ctx.user.id, amount, (ctx.body.note || '').trim() || null);
    redirect(ctx.res, '/portal/wallet?success=' + encodeURIComponent('Funding request submitted. Your admin will review it shortly.'));
  });
}

function statusRefundBadge(status) {
  const map = { pending: 'Pending', approved: 'Approved', denied: 'Denied' };
  return `<span class="badge badge-${status}">${map[status] || status}</span>`;
}

module.exports = { registerAgentRoutes };
