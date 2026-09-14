'use strict';
const { db, newId } = require('../lib/db');
const { hashPassword, verifyPassword, createSession, destroySession, findUserByEmail, countAdmins, createUser } = require('../lib/auth');
const { setCookie, clearCookie, sendHtml, redirect } = require('../lib/http');
const { authLayout, esc } = require('../lib/ui');

function registerAuthRoutes(router) {
  // ---- First-run setup: create the admin account ----
  router.get('/setup', (ctx) => {
    if (countAdmins() > 0) return redirect(ctx.res, '/login');
    const body = `
    <h1>Create your admin account</h1>
    <p class="muted">This is a one-time setup. This account manages leads, agents, pricing and payouts.</p>
    <form method="post" action="/setup">
      <label>Your name<input type="text" name="name" required autofocus></label>
      <label>Email<input type="email" name="email" required></label>
      <label>Password<input type="password" name="password" required minlength="8"></label>
      <button class="btn btn-primary" type="submit">Create admin account</button>
    </form>`;
    sendHtml(ctx.res, authLayout({ title: 'Setup', body, query: ctx.query }));
  });

  router.post('/setup', async (ctx) => {
    if (countAdmins() > 0) return redirect(ctx.res, '/login');
    const { name, email, password } = ctx.body;
    if (!name || !email || !password || password.length < 8) {
      return redirect(ctx.res, '/setup?error=' + encodeURIComponent('Please fill in all fields (password 8+ characters).'));
    }
    if (findUserByEmail(email)) {
      return redirect(ctx.res, '/setup?error=' + encodeURIComponent('That email is already in use.'));
    }
    const id = createUser({ role: 'admin', name, email, phone: null, password });
    const session = createSession(id);
    setCookie(ctx.res, 'sid', session.id, { expires: session.expiresAt });
    redirect(ctx.res, '/admin');
  });

  // ---- Login ----
  router.get('/login', (ctx) => {
    if (countAdmins() === 0) return redirect(ctx.res, '/setup');
    const body = `
    <h1>Log in</h1>
    <form method="post" action="/login">
      <label>Email<input type="email" name="email" required autofocus></label>
      <label>Password<input type="password" name="password" required></label>
      <button class="btn btn-primary" type="submit">Log in</button>
    </form>
    <p class="muted small">New agent? <a href="/register">Create an agent account</a></p>`;
    sendHtml(ctx.res, authLayout({ title: 'Log in', body, query: ctx.query }));
  });

  router.post('/login', (ctx) => {
    const { email, password } = ctx.body;
    const user = email ? findUserByEmail(email) : null;
    if (!user || !verifyPassword(password || '', user.password_hash)) {
      return redirect(ctx.res, '/login?error=' + encodeURIComponent('Incorrect email or password.'));
    }
    if (user.status === 'disabled') {
      return redirect(ctx.res, '/login?error=' + encodeURIComponent('This account has been disabled. Contact your administrator.'));
    }
    const session = createSession(user.id);
    setCookie(ctx.res, 'sid', session.id, { expires: session.expiresAt });
    redirect(ctx.res, user.role === 'admin' ? '/admin' : '/portal');
  });

  // ---- Agent self-registration ----
  router.get('/register', (ctx) => {
    const body = `
    <h1>Create your agent account</h1>
    <p class="muted">Register to access the lead portal, claim leads and manage your wallet.</p>
    <form method="post" action="/register">
      <label>Full name<input type="text" name="name" required autofocus></label>
      <label>Email<input type="email" name="email" required></label>
      <label>Phone<input type="tel" name="phone"></label>
      <label>Password<input type="password" name="password" required minlength="8"></label>
      <button class="btn btn-primary" type="submit">Create account</button>
    </form>
    <p class="muted small">Already have an account? <a href="/login">Log in</a></p>`;
    sendHtml(ctx.res, authLayout({ title: 'Register', body, query: ctx.query }));
  });

  router.post('/register', (ctx) => {
    const { name, email, phone, password } = ctx.body;
    if (!name || !email || !password || password.length < 8) {
      return redirect(ctx.res, '/register?error=' + encodeURIComponent('Please fill in all required fields (password 8+ characters).'));
    }
    if (findUserByEmail(email)) {
      return redirect(ctx.res, '/register?error=' + encodeURIComponent('An account with that email already exists.'));
    }
    const id = createUser({ role: 'agent', name, email, phone, password });
    const session = createSession(id);
    setCookie(ctx.res, 'sid', session.id, { expires: session.expiresAt });
    redirect(ctx.res, '/portal?success=' + encodeURIComponent('Welcome! Your agent account is ready.'));
  });

  router.post('/logout', (ctx) => {
    destroySession(ctx.cookies.sid);
    clearCookie(ctx.res, 'sid');
    redirect(ctx.res, '/login');
  });
}

module.exports = { registerAuthRoutes };
