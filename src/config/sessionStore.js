/**
 * express-session store backed by the MySQL `sessions` table.
 */
'use strict';

const session = require('express-session');

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

function toMySqlDateTime(date) {
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

class MySqlSessionStore extends session.Store {
  constructor(db, { clearIntervalMs = 15 * 60 * 1000 } = {}) {
    super();
    this.db = db;
    if (clearIntervalMs) {
      this.clearTimer = setInterval(() => {
        this.clearExpired().catch(err => console.error('[session] Failed to clear expired sessions:', err.message));
      }, clearIntervalMs);
      this.clearTimer.unref();
    }
  }

  expiryFor(sess) {
    const expires = sess?.cookie?.expires ? new Date(sess.cookie.expires) : new Date(Date.now() + DEFAULT_TTL_MS);
    return toMySqlDateTime(expires);
  }

  get(sid, cb) {
    this.db.prepare('SELECT sess FROM sessions WHERE sid = ? AND expire > UTC_TIMESTAMP()').get(sid)
      .then(row => cb(null, row ? JSON.parse(row.sess) : null))
      .catch(cb);
  }

  set(sid, sess, cb = () => {}) {
    this.db.prepare(`
      INSERT INTO sessions (sid, sess, expire) VALUES (?, ?, ?)
      ON DUPLICATE KEY UPDATE sess = VALUES(sess), expire = VALUES(expire)
    `).run(sid, JSON.stringify(sess), this.expiryFor(sess))
      .then(() => cb(null))
      .catch(cb);
  }

  touch(sid, sess, cb = () => {}) {
    this.db.prepare('UPDATE sessions SET expire = ? WHERE sid = ?').run(this.expiryFor(sess), sid)
      .then(() => cb(null))
      .catch(cb);
  }

  destroy(sid, cb = () => {}) {
    this.db.prepare('DELETE FROM sessions WHERE sid = ?').run(sid)
      .then(() => cb(null))
      .catch(cb);
  }

  clearExpired() {
    return this.db.prepare('DELETE FROM sessions WHERE expire <= UTC_TIMESTAMP()').run();
  }
}

module.exports = MySqlSessionStore;
