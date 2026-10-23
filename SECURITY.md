# Balai-Reserve — Security Overview

This document describes the security algorithms and controls currently in use in
the Balai-Reserve application, with emphasis on payment-proof handling.

## Authentication & Passwords
- **Password hashing:** `bcryptjs` with a work factor of **12** on every live
  code path (registration, admin/CRM user creation, password change). Login
  verifies with `bcrypt.compareSync`. Plaintext passwords are never stored.
- **Sessions:** `express-session` backed by a persistent MySQL store
  (`src/config/sessionStore.js`, `sessions` table). Session cookies are:
  - `httpOnly: true` (not readable by JavaScript),
  - `sameSite: 'lax'` (mitigates cross-site request forgery on top-level POSTs),
  - `secure: true` in production (HTTPS-only), and
  - `maxAge` 24 hours.
  - The session secret comes from `SESSION_SECRET`. **Set a strong secret in
    production** — do not rely on the development fallback.
- **Sign-in:** Users can authenticate with email and password stored in the SQL
  database or with Google OAuth. Google OAuth uses a session-bound random state,
  exchanges authorization codes server-side, and only accepts Google-verified
  email addresses. Google subject IDs are stored uniquely to link accounts.

## Authorization (access control)
- `requireAuth` — requires a logged-in session.
- `requireRole('admin'[, 'staff'])` — role-gated routes; renders a 403 page
  otherwise.
- `requireCustomer` / `requireCustomerOrGuest` — customer-portal guards that
  keep staff out of the guest portal and vice-versa.
- All admin/staff actions (status changes, payments, refunds, settings) are
  behind `requireRole('admin'[, 'staff'])`.
- **Audit logging:** `attachAudit` records state-changing actions (who, what,
  old/new values, IP, user-agent) into the `audit_logs` table.

## Transport & HTTP hardening
- **helmet** sets security headers including a Content-Security-Policy that
  restricts script/style/connect/frame origins to the app and required CDNs.
- **Rate limiting** (`express-rate-limit`): a stricter limiter on `/auth`
  (brute-force protection) and a global limiter on the rest of the app.

## Payment-Proof Images (GCash screenshots) — hardened
Payment-proof screenshots contain sensitive PII (payer name, phone, reference
number, amount) and are treated as confidential:

- **Storage:** files are written to `uploads/payment_proofs/` with a
  **cryptographically random filename** (`crypto.randomBytes(24)`), so URLs
  cannot be guessed or enumerated.
- **No public serving:** the `uploads/payment_proofs` path is explicitly
  **blocked** from the public static mount (returns 403).
- **Access-controlled delivery:** proof images are served only through
  `GET /portal/payment-proof/:paymentId`, which:
  1. requires a logged-in session,
  2. allows access only to **staff/admin** or the **customer who owns** the
     related reservation,
  3. resolves the file strictly inside `uploads/payment_proofs/`
     (path-traversal safe via `path.basename`), and
  4. sets `Cache-Control: private, no-store`.
- **Upload validation:** multer restricts file type (jpg/jpeg/png/webp/gif/pdf)
  and size (10 MB).
- **Content validation:** `src/utils/gcashValidator.js` runs OCR (tesseract.js)
  on GCash uploads and scores GCash-specific markers (brand text, reference
  number, amount, receipt wording). This is **fraud deterrence, not proof** — it
  rejects obviously-wrong images but cannot prove a transfer occurred. **Staff
  verification remains the authoritative step** before a payment is accepted.

## Payment Verification Flow
1. Customer submits a payment notification with an amount, optional reference,
   and (for GCash) a required screenshot that must pass OCR validation.
2. The payment is recorded as `received` / `submitted_by = 'customer'` and the
   booking's `payment_status` is recalculated — but the booking is **not**
   auto-confirmed.
3. Staff review the proof (via the access-controlled route) and explicitly
   **verify** or **reject** it. Only verification advances the booking.

## Refunds
- Refunds are **never** issued automatically. A customer submits a refund
  **request** with a reason; an admin/staff must **review and approve or reject**
  it. On approval the admin records the payout details (method + transaction
  reference). See the Refunds feature for details.

## Known limitations / recommendations
- There is no CSRF token middleware; the app relies on `sameSite: 'lax'`
  cookies. Consider adding CSRF tokens for defense-in-depth on POST forms.
- Upload filtering is by extension + size + OCR, not by magic-byte MIME
  sniffing. Consider adding content-type sniffing if stricter guarantees are
  needed.
- Always run behind HTTPS in production and set a strong `SESSION_SECRET`.
