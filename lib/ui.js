'use strict';

function esc(str) {
  if (str === null || str === undefined) return '';
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function money(cents) {
  const n = Number(cents || 0);
  const neg = n < 0;
  const abs = Math.abs(n);
  const str = (abs / 100).toFixed(2);
  return (neg ? '-$' : '$') + str;
}

function fmtDate(iso) {
  if (!iso) return '';
  try {
    const d = new Date(iso.includes('T') || iso.includes('Z') ? iso : iso.replace(' ', 'T') + 'Z');
    return d.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
  } catch (e) { return iso; }
}

const STATUS_LABELS = {
  unclaimed: 'Unclaimed',
  claimed: 'Claimed',
  working: 'Working',
  sold: 'Sold / Won',
  dead: 'Dead / No Pan Out',
  refund_requested: 'Refund Requested',
  refunded: 'Refunded',
};

function statusBadge(status) {
  const label = STATUS_LABELS[status] || status;
  return `<span class="badge badge-${esc(status)}">${esc(label)}</span>`;
}

function leadTypeBadge(type) {
  return `<span class="badge badge-type-${esc(type)}">${type === 'paid' ? 'Paid' : 'Free'}</span>`;
}

function flashBanner(query) {
  let html = '';
  if (query.error) html += `<div class="flash flash-error">${esc(query.error)}</div>`;
  if (query.success) html += `<div class="flash flash-success">${esc(query.success)}</div>`;
  return html;
}

function nav(user, active) {
  if (!user) return '';
  const link = (href, label, key) => `<a href="${href}" class="${active === key ? 'active' : ''}">${label}</a>`;
  let links = '';
  if (user.role === 'admin') {
    links = [
      link('/admin', 'Dashboard', 'dashboard'),
      link('/admin/leads', 'Leads', 'leads'),
      link('/admin/agents', 'Agents', 'agents'),
      link('/admin/funding-requests', 'Funding Requests', 'funding'),
      link('/admin/refund-requests', 'Refund Requests', 'refunds'),
      link('/admin/settings', 'Settings', 'settings'),
    ].join('');
  } else {
    links = [
      link('/portal', 'Lead Pool', 'pool'),
      link('/portal/my-leads', 'My Leads', 'my-leads'),
      link('/portal/wallet', 'Wallet', 'wallet'),
    ].join('');
  }
  return `
  <header class="topbar">
    <div class="topbar-inner">
      <div class="brand">Insurance Lead Manager</div>
      <nav class="mainnav">${links}</nav>
      <div class="userbox">
        <span class="userbox-name">${esc(user.name)} <span class="role-chip">${esc(user.role)}</span></span>
        <form method="post" action="/logout" class="inline-form"><button class="link-btn" type="submit">Log out</button></form>
      </div>
    </div>
  </header>`;
}

function layout({ title, user, active, body, query = {} }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · Insurance Lead Manager</title>
<link rel="stylesheet" href="/css/style.css">
</head>
<body>
${nav(user, active)}
<main class="container">
${flashBanner(query)}
${body}
</main>
</body>
</html>`;
}

function authLayout({ title, body, query = {} }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · Insurance Lead Manager</title>
<link rel="stylesheet" href="/css/style.css">
</head>
<body class="auth-body">
<div class="auth-wrap">
  <div class="auth-brand">Insurance Lead Manager</div>
  <div class="auth-card">
    ${flashBanner(query)}
    ${body}
  </div>
</div>
</body>
</html>`;
}

module.exports = { esc, money, fmtDate, statusBadge, leadTypeBadge, layout, authLayout, flashBanner, STATUS_LABELS };
