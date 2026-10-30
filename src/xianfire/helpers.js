/**
 * Xianfire Template Helpers
 * 
 * Functions made available in every .xian template via app.locals.
 * Import and attach with: app.use(xianHelpers);
 */

'use strict';

const dayjs = require('dayjs');
dayjs.extend(require('dayjs/plugin/utc'));

// ─── Date / Time ─────────────────────────────────────────────────────────────

// The database stores timestamps in UTC as 'YYYY-MM-DD HH:MM:SS' (space, no zone).
// The resort runs on Philippine time (UTC+8, no DST), whatever the server's zone.
const DB_UTC_DATETIME = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/;
const PH_OFFSET_HOURS = 8;

/**
 * Parse a value for display in Philippine time.
 *  - DB timestamps ('YYYY-MM-DD HH:MM:SS') and Date objects are UTC → shifted to PH time.
 *  - Date-only values ('YYYY-MM-DD') and already-local 'YYYY-MM-DDTHH:MM:SS'
 *    strings are shown as written.
 */
function toPhilippineTime(value) {
  if (value instanceof Date) return dayjs.utc(value).add(PH_OFFSET_HOURS, 'hour');
  const s = String(value);
  if (DB_UTC_DATETIME.test(s)) return dayjs.utc(s.replace(' ', 'T') + 'Z').add(PH_OFFSET_HOURS, 'hour');
  return dayjs.utc(s.length === 10 ? s + 'T00:00:00Z' : s.replace(/([^Z])$/, '$1Z'));
}

/**
 * Format a date value using dayjs (Philippine time).
 * @param {string|Date} date
 * @param {string} fmt  — dayjs format string, default 'MMM D, YYYY'
 */
function formatDate(date, fmt = 'MMM D, YYYY') {
  if (!date) return '—';
  const d = toPhilippineTime(date);
  return d.isValid() ? d.format(fmt) : dayjs(date).format(fmt);
}

/**
 * Format a datetime value (Philippine time).
 */
function formatDateTime(date, fmt = 'MMM D, YYYY h:mm A') {
  if (!date) return '—';
  const d = toPhilippineTime(date);
  return d.isValid() ? d.format(fmt) : dayjs(date).format(fmt);
}

/**
 * Returns 'active' if the current path starts with the given prefix.
 * Useful for sidebar nav highlighting.
 */
function activeNav(currentPath, prefix) {
  return currentPath && currentPath.startsWith(prefix) ? 'active' : '';
}

// ─── Currency ─────────────────────────────────────────────────────────────────

/**
 * Format a number as Philippine Peso.
 */
function formatPeso(amount) {
  if (amount == null || amount === '') return '—';
  return '₱' + Number(amount).toLocaleString('en-PH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * Guest-facing price: '₱3,500' for whole pesos, '₱3,500.50' otherwise.
 * Use formatPeso for amounts due, payments and back-office figures.
 */
function formatPrice(amount) {
  if (amount == null || amount === '') return '—';
  const n = Number(amount);
  const whole = Number.isInteger(Math.round(n * 100) / 100);
  return '₱' + n.toLocaleString('en-PH', {
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: 2,
  });
}

// ─── Status Badge ─────────────────────────────────────────────────────────────

// Colour families follow the shared status system (public/css/tokens.css):
// the same status looks the same on lists, detail pages, calendar and portal.
const STATUS_COLORS = {
  // Reservation
  pending:           'st-amber',
  pencil:            'st-purple',
  on_hold:           'st-slate',
  awaiting_payment:  'st-orange',
  confirmed:         'st-teal',
  checked_in:        'st-blue',
  completed:         'st-gray',
  checked_out:       'st-gray',
  cancelled:         'st-red',
  rejected:          'st-red',
  no_show:           'st-red',
  // Room / cottage / venue
  available:         'st-teal',
  reserved:          'st-amber',
  occupied:          'st-blue',
  cleaning:          'st-slate',
  maintenance:       'st-gray',
  unavailable:       'st-red',
  // Payment records
  received:          'st-amber',
  verified:          'st-teal',
  // Refund requests
  approved:          'st-teal',
  declined:          'st-red',
  // Equipment condition
  excellent:         'st-teal',
  good:              'st-teal',
  needs_maintenance: 'st-amber',
  damaged:           'st-red',
  lost:              'st-red',
  // Inquiries / tickets / events
  open:              'st-amber',
  in_progress:       'st-blue',
  escalated:         'st-orange',
  resolved:          'st-teal',
  closed:            'st-gray',
  // Customers
  active:            'st-teal',
  inactive:          'st-gray',
  blacklisted:       'st-red',
  // Inventory stock levels
  in_stock:          'st-teal',
  low_stock:         'st-amber',
  out_of_stock:      'st-red',
};

// Payment status of a reservation is a separate system, shown as dot + text.
const PAYMENT_STATUSES = new Set(['unpaid', 'partially_paid', 'fully_paid', 'refunded']);

// Statuses whose label isn't just the key title-cased.
const STATUS_LABELS = {
  pencil:           'Pencil Booking',
  on_hold:          'On Hold',
  awaiting_payment: 'Awaiting Payment',
  partially_paid:   'Partially Paid',
  fully_paid:       'Fully Paid',
  no_show:          'No Show',
};

/**
 * Human-readable label for a status key, e.g. 'on_hold' -> 'On Hold'.
 */
function statusLabel(status) {
  if (!status) return '';
  const key = status.toLowerCase().replace(/\s+/g, '_');
  return STATUS_LABELS[key] || status.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
}

/**
 * Returns an HTML status indicator for a given status string.
 * Reservation/resource statuses render as a chip; payment statuses as dot + text.
 */
function statusBadge(status) {
  if (!status) return '';
  const key = status.toLowerCase().replace(/\s+/g, '_');
  if (PAYMENT_STATUSES.has(key)) {
    return `<span class="pay-status pay-${key}">${statusLabel(status)}</span>`;
  }
  const cls = STATUS_COLORS[key] || 'st-gray';
  return `<span class="status-chip ${cls}">${statusLabel(status)}</span>`;
}

// ─── Pagination ───────────────────────────────────────────────────────────────

/**
 * Build a simple pagination object.
 * @param {number} total   — total records
 * @param {number} page    — current page (1-indexed)
 * @param {number} limit   — records per page
 */
function paginate(total, page, limit = 20) {
  const totalPages = Math.ceil(total / limit);
  return {
    total,
    page,
    limit,
    totalPages,
    offset: (page - 1) * limit,
    hasPrev: page > 1,
    hasNext: page < totalPages,
    prevPage: page - 1,
    nextPage: page + 1,
  };
}

// ─── Express middleware — attach helpers to res.locals ────────────────────────

function xianHelpersMiddleware(req, res, next) {
  // Attach pure helper functions — these never change per-request
  res.locals.formatDate     = formatDate;
  res.locals.formatDateTime = formatDateTime;
  res.locals.formatPeso     = formatPeso;
  res.locals.formatPrice    = formatPrice;
  res.locals.statusBadge    = statusBadge;
  res.locals.statusLabel    = statusLabel;
  res.locals.payMethodsText = (site) => require('../utils/paymentAccounts').methodsText(site || {}) || 'the resort’s accounts';
  res.locals.activeNav      = activeNav;
  res.locals.paginate       = paginate;
  // NOTE: currentUser, currentPath, and flash are set in the
  // dedicated global middleware block in app.js so there is a
  // single authoritative place.  Do NOT set or clear them here.
  next();
}

module.exports = {
  formatDate,
  formatDateTime,
  formatPeso,
  formatPrice,
  statusBadge,
  statusLabel,
  activeNav,
  paginate,
  xianHelpersMiddleware,
};
