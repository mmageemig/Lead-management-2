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

// Hand-rolled multipart/form-data parser (no external deps). Text fields
// come back as strings; file fields come back as { filename, contentType,
// data: Buffer }.
function parseMultipart(buf, contentTypeHeader) {
  const result = {};
  const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentTypeHeader || '');
  if (!m) return result;
  const boundary = '--' + (m[1] || m[2]).trim();
  const boundaryBuf = Buffer.from('\r\n' + boundary);
  const firstBoundaryBuf = Buffer.from(boundary);

  let start = buf.indexOf(firstBoundaryBuf);
  if (start === -1) return result;
  start += firstBoundaryBuf.length;

  while (start < buf.length) {
    if (buf[start] === 0x2d && buf[start + 1] === 0x2d) break; // trailing "--"
    if (buf[start] === 0x0d && buf[start + 1] === 0x0a) start += 2; // skip CRLF after boundary

    const nextBoundaryIdx = buf.indexOf(boundaryBuf, start);
    if (nextBoundaryIdx === -1) break;
    const partBuf = buf.slice(start, nextBoundaryIdx);
    const headerEnd = partBuf.indexOf('\r\n\r\n');
    if (headerEnd !== -1) {
      const headerStr = partBuf.slice(0, headerEnd).toString('utf8');
      const bodyBuf = partBuf.slice(headerEnd + 4);
      const nameMatch = /name="([^"]*)"/i.exec(headerStr);
      const filenameMatch = /filename="([^"]*)"/i.exec(headerStr);
      const ctMatch = /Content-Type:\s*([^\r\n]+)/i.exec(headerStr);
      const fieldName = nameMatch ? nameMatch[1] : null;
      if (fieldName) {
        if (filenameMatch && filenameMatch[1]) {
          result[fieldName] = {
            filename: filenameMatch[1],
            contentType: ctMatch ? ctMatch[1].trim() : 'application/octet-stream',
            data: bodyBuf,
          };
        } else {
          result[fieldName] = bodyBuf.toString('utf8');
        }
      }
    }
    start = nextBoundaryIdx + boundaryBuf.length;
  }
  return result;
}

function parseBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    let size = 0;
    let tooLarge = false;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > 15 * 1024 * 1024) {
        tooLarge = true;
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (tooLarge) return resolve({});
      const buf = Buffer.concat(chunks);
      const contentTypeHeader = req.headers['content-type'] || '';
      const ct = contentTypeHeader.split(';')[0].trim();
      try {
        if (ct === 'application/json') {
          resolve(buf.length ? JSON.parse(buf.toString('utf8')) : {});
        } else if (ct === 'application/x-www-form-urlencoded') {
          resolve(Object.fromEntries(new URLSearchParams(buf.toString('utf8'))));
        } else if (ct === 'multipart/form-data') {
          resolve(parseMultipart(buf, contentTypeHeader));
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
