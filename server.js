'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');

// Minimal .env loader (no external dependency). Existing environment
// variables always win over values from the file.
(function loadDotEnv() {
  const envPath = path.join(__dirname, '.env');
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, 'utf8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    let value = trimmed.slice(idx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
})();

const { Router, parseBody, buildContext, sendHtml, sendJson } = require('./lib/http');
const { getSessionUser, countAdmins } = require('./lib/auth');
const { registerAuthRoutes } = require('./routes/auth');
const { registerFunnelRoutes } = require('./routes/funnel');
const { registerAgentRoutes } = require('./routes/agent');
const { registerAdminRoutes } = require('./routes/admin');
const { registerImportRoutes } = require('./routes/import');

const router = new Router();
registerAuthRoutes(router);
registerFunnelRoutes(router);
registerAgentRoutes(router);
// Import routes must be registered before admin routes: routes match in
// registration order, and admin's GET /admin/leads/:id would otherwise
// swallow /admin/leads/import (treating "import" as a lead id) since it's
// registered first.
registerImportRoutes(router);
registerAdminRoutes(router);

const PUBLIC_DIR = path.join(__dirname, 'public');
const MIME = {
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function serveStatic(req, res, pathname) {
  const rel = pathname.replace(/^\/+/, '');
  const filePath = path.join(PUBLIC_DIR, rel);
  if (!filePath.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end('Forbidden'); }
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': 'public, max-age=3600' });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const ctx = buildContext(req, res);

    if (req.method === 'GET' && ctx.pathname.startsWith('/css/') || ctx.pathname.startsWith('/js/')) {
      return serveStatic(req, res, ctx.pathname);
    }

    if (ctx.pathname === '/') {
      if (countAdmins() === 0) {
        res.writeHead(302, { Location: '/setup' });
        return res.end();
      }
      const user = getSessionUser(ctx.cookies.sid);
      res.writeHead(302, { Location: user ? (user.role === 'admin' ? '/admin' : '/portal') : '/login' });
      return res.end();
    }

    if (req.method === 'POST') {
      ctx.body = await parseBody(req);
    } else {
      ctx.body = {};
    }

    ctx.user = getSessionUser(ctx.cookies.sid);

    const match = router.match(req.method, ctx.pathname);
    if (!match) {
      res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end('<h1>404 Not Found</h1><p><a href="/">Go home</a></p>');
    }
    ctx.params = match.params;
    await match.handlers[0](ctx);
  } catch (err) {
    console.error('Unhandled error:', err);
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<h1>500 Internal Server Error</h1><p>Something went wrong. Please try again.</p>');
    }
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Insurance Lead Manager running on http://localhost:${PORT}`);
});
