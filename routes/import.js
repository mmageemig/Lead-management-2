'use strict';
const { db, newId, getSetting, withTransaction } = require('../lib/db');
const { redirect, sendHtml } = require('../lib/http');
const { requireRole } = require('../lib/guards');
const { layout, esc } = require('../lib/ui');
const { parseCsv } = require('../lib/csv');
const { parseLeadDateString } = require('../lib/dates');

const IMPORTABLE_FIELDS = [
  ['', '— Skip this column —'],
  ['first_name', 'First name'], ['last_name', 'Last name'],
  ['phone', 'Phone'], ['email', 'Email'],
  ['address', 'Address'], ['city', 'City'], ['state', 'State'], ['zip', 'ZIP'],
  ['insurance_type', 'Insurance type'], ['current_carrier', 'Current carrier'], ['coverage_interest', 'Coverage interest'],
  ['dob', 'Date of birth'], ['age', 'Age'], ['household_size', 'Household size'], ['income_range', 'Income range'],
  ['source', 'Source'], ['campaign', 'Campaign'], ['received_at', 'Date/time lead received'],
];

function guessField(header) {
  const h = header.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  const table = {
    firstname: 'first_name', fname: 'first_name', first: 'first_name',
    lastname: 'last_name', lname: 'last_name', last: 'last_name',
    name: 'first_name',
    phone: 'phone', phonenumber: 'phone', cell: 'phone', mobile: 'phone', cellphone: 'phone',
    email: 'email', emailaddress: 'email',
    address: 'address', street: 'address', streetaddress: 'address',
    city: 'city', state: 'state', zip: 'zip', zipcode: 'zip', postalcode: 'zip',
    insurancetype: 'insurance_type', coveragetype: 'insurance_type', producttype: 'insurance_type',
    currentcarrier: 'current_carrier', carrier: 'current_carrier',
    coverageinterest: 'coverage_interest', interest: 'coverage_interest',
    dob: 'dob', dateofbirth: 'dob', birthdate: 'dob', birthday: 'dob',
    age: 'age',
    householdsize: 'household_size', householdmembers: 'household_size', familysize: 'household_size',
    incomerange: 'income_range', income: 'income_range',
    source: 'source', leadsource: 'source',
    campaign: 'campaign', adcampaign: 'campaign',
    datereceived: 'received_at', leaddate: 'received_at', received: 'received_at', receiveddate: 'received_at',
    date: 'received_at', dateadded: 'received_at', createdat: 'received_at', timestamp: 'received_at',
  };
  return table[h] || '';
}

function registerImportRoutes(router) {
  router.get('/admin/leads/import', (ctx) => {
    if (!requireRole(ctx, 'admin')) return;
    const body = `
    <div class="page-head"><h1>Import leads from CSV</h1></div>
    <div class="panel">
      <p class="muted small">Upload a CSV export of your leads. On the next screen you'll match its columns to the right fields before anything is saved — nothing is imported until you confirm.</p>
      <form method="post" action="/admin/leads/import/preview" enctype="multipart/form-data">
        <label>CSV file<input type="file" name="csv_file" accept=".csv,text/csv" required></label>
        <button class="btn btn-primary" type="submit">Continue →</button>
      </form>
    </div>`;
    sendHtml(ctx.res, layout({ title: 'Import leads', user: ctx.user, active: 'leads', body, query: ctx.query }));
  });

  router.post('/admin/leads/import/preview', (ctx) => {
    if (!requireRole(ctx, 'admin')) return;
    const file = ctx.body.csv_file;
    if (!file || !file.data || !file.data.length) {
      return redirect(ctx.res, '/admin/leads/import?error=' + encodeURIComponent('Choose a CSV file to upload.'));
    }
    const text = file.data.toString('utf8');
    const rows = parseCsv(text);
    if (rows.length < 2) {
      return redirect(ctx.res, '/admin/leads/import?error=' + encodeURIComponent('That file has no data rows to import.'));
    }
    const headers = rows[0];
    const dataRows = rows.slice(1);
    const preview = dataRows.slice(0, 5);

    const mapSelects = headers.map((h, idx) => {
      const guess = guessField(h);
      const opts = IMPORTABLE_FIELDS.map(([val, label]) => `<option value="${val}" ${val === guess ? 'selected' : ''}>${esc(label)}</option>`).join('');
      return `<label>${esc(h) || `Column ${idx + 1}`}<select name="map_${idx}">${opts}</select></label>`;
    }).join('');

    const previewTable = `<table class="table"><thead><tr>${headers.map((h, i) => `<th>${esc(h) || `Column ${i + 1}`}</th>`).join('')}</tr></thead>
      <tbody>${preview.map((r) => `<tr>${headers.map((_, i) => `<td>${esc(r[i] || '')}</td>`).join('')}</tr>`).join('')}</tbody></table>`;

    const body = `
    <div class="page-head"><h1>Match your columns</h1></div>
    <p class="muted small">Found ${dataRows.length} row${dataRows.length === 1 ? '' : 's'} in <strong>${esc(file.filename)}</strong>. We guessed the mapping below where we could — double-check it. Preview of the first ${preview.length}:</p>
    ${previewTable}
    <form method="post" action="/admin/leads/import/confirm">
      <input type="hidden" name="csv_data" value="${esc(text)}">
      <div class="panel">
        <h3>Column mapping</h3>
        <div class="form-grid">${mapSelects}</div>
      </div>
      <div class="panel">
        <h3>Defaults for every imported lead</h3>
        <div class="form-grid">
          <label>Lead type
            <select name="lead_type">
              <option value="free" selected>Free</option>
              <option value="paid">Paid</option>
            </select>
          </label>
          <label>Cost override (USD, paid only)<input type="number" step="0.01" min="0" name="cost_override" placeholder="Uses current global price if blank"></label>
          <label>Source label (used only if no column is mapped to Source)<input type="text" name="default_source" value="csv_import"></label>
        </div>
        <p class="muted small">Rows with no name, phone, or email are skipped. If no "Date/time lead received" column is mapped, each lead's received date defaults to right now.</p>
      </div>
      <button class="btn btn-primary" type="submit">Import ${dataRows.length} lead${dataRows.length === 1 ? '' : 's'}</button>
    </form>`;
    sendHtml(ctx.res, layout({ title: 'Import leads', user: ctx.user, active: 'leads', body, query: ctx.query }));
  });

  router.post('/admin/leads/import/confirm', (ctx) => {
    if (!requireRole(ctx, 'admin')) return;
    const b = ctx.body;
    const csvText = b.csv_data;
    if (!csvText) return redirect(ctx.res, '/admin/leads/import?error=' + encodeURIComponent('Upload session expired — please upload the file again.'));
    const rows = parseCsv(csvText);
    const headers = rows[0] || [];
    const dataRows = rows.slice(1);

    const fieldForCol = headers.map((_, idx) => b['map_' + idx] || '');
    const leadType = b.lead_type === 'paid' ? 'paid' : 'free';
    const defaultSource = (b.default_source || 'csv_import').trim() || 'csv_import';
    let costCents = 0;
    if (leadType === 'paid') {
      const override = parseFloat(b.cost_override);
      costCents = b.cost_override && b.cost_override.trim() !== '' && !Number.isNaN(override)
        ? Math.round(override * 100)
        : parseInt(getSetting('paid_lead_price_cents'), 10);
    }

    let imported = 0, skipped = 0;
    withTransaction(() => {
      for (const row of dataRows) {
        const rec = {};
        fieldForCol.forEach((field, idx) => {
          if (!field) return;
          const val = (row[idx] || '').trim();
          if (val !== '') rec[field] = val;
        });
        if (!rec.first_name && !rec.last_name && !rec.phone && !rec.email) { skipped++; continue; }
        const receivedAt = rec.received_at ? parseLeadDateString(rec.received_at) : null;
        db.prepare(`INSERT INTO leads (
          id, lead_type, cost_cents, status, first_name, last_name, phone, email, address, city, state, zip,
          insurance_type, current_carrier, coverage_interest, dob, age, household_size, income_range, source, campaign, received_at
        ) VALUES (?,?,?,'unclaimed',?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, COALESCE(?, datetime('now')))`).run(
          newId('lead'), leadType, costCents,
          rec.first_name || null, rec.last_name || null, rec.phone || null, rec.email || null,
          rec.address || null, rec.city || null, rec.state || null, rec.zip || null,
          rec.insurance_type || null, rec.current_carrier || null, rec.coverage_interest || null,
          rec.dob || null, rec.age ? parseInt(rec.age, 10) : null, rec.household_size ? parseInt(rec.household_size, 10) : null,
          rec.income_range || null, rec.source || defaultSource, rec.campaign || null, receivedAt
        );
        imported++;
      }
    });
    redirect(ctx.res, '/admin/leads?success=' + encodeURIComponent(
      `Imported ${imported} lead${imported === 1 ? '' : 's'}.` + (skipped ? ` Skipped ${skipped} row${skipped === 1 ? '' : 's'} with no name, phone, or email.` : '')
    ));
  });
}

module.exports = { registerImportRoutes };
