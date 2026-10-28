/**
 * Account emails: confirm your email, welcome, reset your password, password changed.
 *
 * Links carry a random one-time token; only its SHA-256 hash is stored (email_tokens), so a database
 * leak can't be used to open them. Confirmation links last 3 days, reset links 1 hour, and asking for a
 * new link retires the older ones. Sending goes through src/utils/mailer.js (in the background).
 */
'use strict';

const crypto = require('crypto');
const db = require('../config/database');
const { mailNotification, settings: mailSettings } = require('./mailer');
const { notifyUser } = require('./notifications');

const TTL = { verify: 3 * 24 * 3600 * 1000, reset: 60 * 60 * 1000 };
const hash = t => crypto.createHash('sha256').update(String(t)).digest('hex');
const absolute = path => mailSettings().appUrl + path;

async function createToken(userId, purpose) {
  const token = crypto.randomBytes(32).toString('base64url');
  await db.prepare('UPDATE email_tokens SET used_at = NOW() WHERE user_id = ? AND purpose = ? AND used_at IS NULL').run(userId, purpose);
  await db.prepare('INSERT INTO email_tokens (user_id, purpose, token_hash, expires_at) VALUES (?, ?, ?, ?)')
    .run(userId, purpose, hash(token), new Date(Date.now() + TTL[purpose]));
  return token;
}

/** A valid, unused token → its user row (the token is not used up yet). */
async function findToken(token, purpose) {
  if (!token || typeof token !== 'string' || token.length > 100) return null;
  return (await db.prepare(`
    SELECT t.id AS token_id, u.id, u.email, u.first_name, u.is_active, u.email_verified
    FROM email_tokens t JOIN users u ON u.id = t.user_id
    WHERE t.token_hash = ? AND t.purpose = ? AND t.used_at IS NULL AND t.expires_at > UTC_TIMESTAMP()
  `).get(hash(token), purpose)) || null;
}

/** Use the token up. Returns false when it was already used (two clicks at once: only one wins). */
async function useToken(tokenId) {
  return (await db.prepare('UPDATE email_tokens SET used_at = NOW() WHERE id = ? AND used_at IS NULL').run(tokenId)).changes > 0;
}

async function sendVerification(user) {
  const token = await createToken(user.id, 'verify');
  return mailNotification({
    to: user.email, name: user.first_name,
    title: 'Confirm your email address',
    message: 'Thanks for creating a Balai-Reserve account. Please confirm this is your email address so we can send you your booking confirmations, payment updates and check-in details.\nThe link works for 3 days.',
    link: absolute('/auth/verify-email?token=' + encodeURIComponent(token)),
    buttonText: 'Confirm my email',
    note: 'If you didn’t create a Balai-Reserve account, you can ignore this email.',
    subject: 'Confirm your email — Balai-Reserve',
  });
}

// In the bell and by email (through notifyUser).
async function sendWelcome(user) {
  await notifyUser(user.id, 'account', `Welcome to Balai-Reserve, ${user.first_name}!`,
    'Your account is ready. Browse rooms, cottages, the function hall and event packages, check availability and book online. You’ll get an email for every booking update, payment and check-in.',
    '/portal');
}

async function sendPasswordReset(user) {
  const token = await createToken(user.id, 'reset');
  return mailNotification({
    to: user.email, name: user.first_name,
    title: 'Reset your password',
    message: 'We received a request to reset the password for your Balai-Reserve account. Choose a new password with the button below.\nThe link works for 1 hour and only once.',
    link: absolute('/auth/reset-password?token=' + encodeURIComponent(token)),
    buttonText: 'Choose a new password',
    note: 'If you didn’t ask for this, you can ignore this email — your password stays the same.',
    subject: 'Reset your password — Balai-Reserve',
  });
}

// In the bell and by email: a security notice whenever a password changes.
async function sendPasswordChanged(user) {
  const when = new Date().toLocaleString('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'short' });
  await notifyUser(user.id, 'account', 'Your password was changed',
    `The password for your Balai-Reserve account was changed on ${when}. If this wasn’t you, reset your password now and contact the resort.`,
    '/auth/forgot-password');
}

// An account staff created for someone (a guest's portal login, or a staff user). Never includes the password.
async function sendAccountCreated(userId, kind) {
  const guest = kind === 'guest';
  await notifyUser(userId, 'account', 'Your Balai-Reserve account is ready',
    guest
      ? 'The resort created an account for you with this email address. Sign in to see your bookings, payments and check-in details. If you don’t know your password, use “Forgot password?” on the sign-in page to choose one.'
      : 'An administrator created a staff account for you. Sign in with this email address and the password you were given, then change it under Profile → Password. If you don’t have it, use “Forgot password?” on the sign-in page.',
    '/auth/login');
}

module.exports = { createToken, findToken, useToken, sendVerification, sendWelcome, sendPasswordReset, sendPasswordChanged, sendAccountCreated };
