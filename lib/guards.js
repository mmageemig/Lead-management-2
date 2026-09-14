'use strict';
const { redirect } = require('./http');

function requireAuth(ctx) {
  if (!ctx.user) { redirect(ctx.res, '/login'); return false; }
  return true;
}

function requireRole(ctx, role) {
  if (!ctx.user) { redirect(ctx.res, '/login'); return false; }
  if (ctx.user.role !== role) {
    redirect(ctx.res, ctx.user.role === 'admin' ? '/admin' : '/portal');
    return false;
  }
  return true;
}

module.exports = { requireAuth, requireRole };
