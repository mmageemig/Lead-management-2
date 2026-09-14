'use strict';
const { URL } = require('url');

function pathToRegex(p) {
  const paramNames = [];
  const pattern = p
    .split('/')
    .map((seg) => {
      if (seg.startsWith(':')) {
        paramNames.push(seg.slice(1));
        return '([^/]+)';
      }
      return seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    })
    .join('/');
  return { regex: new RegExp('^' + pattern + '/?$'), paramNames };
}

class Router {
  constructor() {
    this.routes = [];
  }
  _add(method, p, handlers) {
    const { regex, paramNames } = pathToRegex(p);
    this.routes.push({ method, regex, paramNames, handlers });
  }
  get(p, ...handlers) { this._add('GET', p, handlers); }
  post(p, ...handlers) { this._add('POST', p, handlers); }
  match(method, pathname) {
    for (const r of this.routes) {
      if (r.method !== method) continue;
      const m = r.regex.exec(pathname);
      if (m) {
        const params = {};
        r.paramNames.forEach((name, i) => { params[name] = decodeURIComponent(m[i + 1]); });
        return { handlers: r.handlers, params };
      }
    }
    return null;
  }
}

function parseBody(req) {
  return new Promise((resolve) => {
    let data = '';
    let tooLarge = false;
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 5 * 1024 * 1024) {
        tooLarge = true;
        req.destroy();
      }
    });
    req.on('end', () => {
      if (tooLarge) return resolve({});
      const ct = (req.headers['content-type'] || '').split(';')[0].trim();
      try {
        if (ct === 'application/json') {
          resolve(data ? JSON.parse(data) : {});
        } else if (ct === 'application/x-www-form-urlencoded') {
          resolve(Object.fromEntries(new URLSearchParams(data)));
        } else {
          resolve({});
        }
      } catch (e) {
        resolve({});
      }
    });
    req.on('error', () => resolve({}));
  });
}

function parseCookies(req) {
  const header = req.headers.cookie;
  const cookies = {};
  if (!header) return cookies;
  header.split(';').forEach((pair) => {
    const idx = pair.indexOf('=');
    if (idx === -1) return;
    const key = pair.slice(0, idx).trim();
    const val = pair.slice(idx + 1).trim();
    try { cookies[key] = decodeURIComponent(val); } catch (e) { cookies[key] = val; }
  });
  return cookies;
}

function setCookie(res, name, value, opts = {}) {
  let str = `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax`;
  if (opts.maxAge !== undefined) str += `; Max-Age=${opts.maxAge}`;
  if (opts.expires) str += `; Expires=${opts.expires.toUTCString()}`;
  if (process.env.FORCE_SECURE_COOKIE === '1') str += '; Secure';
  const existing = res.getHeader('Set-Cookie');
  const arr = existing ? (Array.isArray(existing) ? existing : [existing]) : [];
  arr.push(str);
  res.setHeader('Set-Cookie', arr);
}

function clearCookie(res, name) {
  setCookie(res, name, '', { maxAge: 0 });
}

function sendHtml(res, html, status = 200) {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}

function sendJson(res, obj, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

function redirect(res, location) {
  res.writeHead(302, { Location: location });
  res.end();
}

function buildContext(req, res) {
  const fullUrl = new URL(req.url, 'http://localhost');
  return {
    req,
    res,
    pathname: fullUrl.pathname,
    query: Object.fromEntries(fullUrl.searchParams),
    cookies: parseCookies(req),
  };
}

module.exports = {
  Router,
  parseBody,
  parseCookies,
  setCookie,
  clearCookie,
  sendHtml,
  sendJson,
  redirect,
  buildContext,
};
