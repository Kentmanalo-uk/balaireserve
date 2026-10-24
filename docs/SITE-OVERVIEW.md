# Balai-Reserve — Website Overview (rebuild brief)

This document describes what the Balai-Reserve website is, who uses it, every page it has, and the business rules it must keep. It is written for the team rebuilding the site with a cleaner, more professional design. **Keep the behaviour; redesign the presentation.**

Snapshot date: October 2026 (branch `feature/client-feedback-oct`).

---

## 1. What the site is

Balai-Reserve is the online booking and back-office system for a small beachfront resort in **Brgy. San Antonio, Gloria, Oriental Mindoro, Philippines** (the business also appears as "Balai Miciano Resort" on bank details). Tagline: **"Your Home Away From Home."**

It does three jobs:

1. **Public website** — shows the resort, its rooms, cottages, function hall and event packages with live prices, and lets visitors start a booking.
2. **Guest portal** — signed-in guests book, pay the downpayment by GCash / Maya / bank transfer, upload proof of payment, track bookings, get a check-in QR code, cancel, request refunds, send inquiries and leave feedback.
3. **Back office** — the resort's admin and staff manage reservations (including walk-ins), payments, refunds, check-in/out, the catalogue, inventory, customers, inquiries, reports and settings.

Audience: Filipino families, groups and event organisers (weddings, birthdays, debuts, corporate events). Prices are in **Philippine pesos (₱)**. Times are **Philippine time (UTC+8)**.

---

## 2. Users and roles

| Role | Who | Where they work | What they can do |
|---|---|---|---|
| **Visitor** | Anyone, not signed in | Public landing page | Browse, check availability, use the chatbot, start sign-up |
| **Guest** (`customer`) | Registered guest | Guest portal (`/portal`) | Book, pay, upload proof, view/cancel own bookings, request refunds, inquire, feedback, notifications, profile |
| **Staff** (`staff`) | Front desk / resort staff | Back office | Day-to-day: reservations, walk-ins, check-in/out, payments, inquiries, inventory, customers |
| **Admin** (`admin`) | Owner / manager | Back office | Everything staff can do, plus users, settings, sales reports, analytics, refunds approval, payment verification |

Guests must **never** see back-office pages (enforced server-side).

---

## 3. Site map

### 3.1 Public (no login)

| Page | Purpose |
|---|---|
| **Landing page** `/` | One long page: hero with quick availability check · About · Photo gallery · Rooms / Venue / Cottages with prices · Events & packages · Amenities · How to book (4 steps) · Guest reviews · Contact & map details · Footer. Has a rule-based chatbot. |
| **Sign in** `/auth/login` | Email + password. "Continue with Google" appears once Google credentials are configured. |
| **Create account** `/auth/register` | First/last name, email, phone, password, terms checkbox. Also offers Google sign-up. |
| **QR check-in** `/checkin/:token` | Opened by scanning a booking QR. Shows the booking; only signed-in staff can confirm check-in. |

### 3.2 Guest portal (signed-in guests)

| Page | Purpose |
|---|---|
| Portal home `/portal` | Welcome, quick links, available counts, featured rooms/cottages/venue/packages |
| Rooms / Venues / Cottages | Browse each catalogue with photos, capacity, price, downpayment |
| **Book** `/portal/book` | 4-step wizard (see §4.1) |
| Availability calendar | Month view of booked / held dates |
| My Reservations + detail | Status, items, amount paid, balance, payment instructions with GCash/Maya QR, proof upload, check-in QR, cancel, refund request, feedback |
| My Inquiries / Contact | Send inquiry; read the resort's reply |
| Notifications | Bell list of booking / payment / inquiry updates |
| Profile | Edit details, change password (show/hide toggles) |

### 3.3 Back office (admin / staff)

Left sidebar, grouped:

- **Dashboard** — Daily / Monthly / Yearly views (see §6)
- **Bookings** — Reservations · Booking Calendar · Guests · Payments · Refund Requests · Inquiries
- **Accommodations** — Rooms · Venues · Cottages
- **Events** — Events
- **Inventory** — Inventory (items, adjustments, history)
- **CRM** — Customers · Support Tickets · Feedback
- **Management** — Reports · Analytics & AI · User Management · Settings
- (bottom) My Profile · Logout

Note: the "Analytics & AI" page is chart-based trend reporting; there is no AI model behind it.

Key back-office screens:

| Screen | Purpose |
|---|---|
| Reservations list | Search/filter by status, type, date |
| **New reservation (walk-in)** | Staff books for a guest at the desk (§4.3) |
| Reservation detail | Items, guest, payments, status history, internal notes, QR, actions: change status, put on hold / resume, reschedule, edit total or balance, record payment, verify/reject guest proof, collect balance, check-in/out |
| Booking calendar | All bookings by date, colour-coded by status (incl. Pencil Booking and On Hold) |
| Payments / Refund requests | Ledger, verify, refund, review guest refund requests and record payout |
| Rooms / Venues / Cottages | Add/edit items, photos, price, capacity, status (available, maintenance…) |
| Inventory | Add, edit, remove items; adjust (add / remove / damaged / repaired) with validation; per-item history |
| Customers (CRM) | Customer profiles, activity log, optional portal login creation |
| Inquiries | Assign, reply/resolve, escalate to support ticket |
| Reports | Sales, reservations, events — export to Excel, Word, CSV |
| Analytics | Revenue/booking trends, occupancy, demand, satisfaction charts |
| Users | Create/edit staff accounts, activate/deactivate |
| Settings | Tabs: **Payment** (GCash/Maya numbers + QR images, bank details) · **General** (resort name, tagline, address, phone, email) · **Booking** (check-in/out times, downpayment %, cancellation policy) · **Landing Page** (hero photo, About photo, gallery with captions) |

---

## 4. Key journeys

### 4.1 Guest books online

1. **What to book** — Room, Cottage, Venue, or Event package.
2. **Dates & details** — check-in/out dates (rooms: nights), or date + time-in/time-out (cottage/venue/event); guests; special requests; optional add-ons for packages.
3. **Guest info** — contact mobile number (`09XXXXXXXXX` or `+639…`).
4. **Payment** — choose **GCash, Maya, or Bank Transfer** (no cash online). Shows the account number and the uploaded QR code for the chosen method; agree to terms.

Result: a reservation with a booking reference `BK-YYYY-NNNN`, status **Awaiting payment** (not confirmed) and payment status **Unpaid**, plus a check-in QR. Guest and admins are notified. (Walk-ins created by staff start as Pending or Pencil Booking.)

### 4.2 Downpayment and verification

1. Guest pays outside the site, then uploads a **screenshot** on the booking page (amount, reference number). GCash screenshots are auto-read (OCR) to catch mismatches.
2. Staff **verify** or **reject** the proof. Verified → payment status *Partially paid* or *Fully paid*; the booking moves to *Awaiting payment* / *Confirmed*. The guest is notified ("Booking Verified" / "Payment Verified" / "Payment Not Accepted").
3. Remaining balance is collected at the resort ("Collect balance" before checkout).

### 4.3 Walk-in at the front desk

Staff create the booking for an existing or new customer:

- Type: room / cottage / venue / event — **every type has check-in date, check-out date, time-in, time-out**.
- **Source is always "Walk In"**; payment method defaults to **Cash** (GCash, Maya, Bank Transfer also allowed).
- **No limit on number of guests.**
- **Total amount is editable** (auto-filled from the item price, staff can overwrite); optional "record payment now"; internal notes.
- Starting status: Pending or **Pencil Booking**.

### 4.4 Check-in with QR

Each booking has a QR code that opens `/checkin/<token>`. A staff member scans it with a phone, signs in if needed, and taps **Confirm Check-in** → booking becomes *Checked in*, the room/cottage/venue becomes *Occupied*, the guest is notified. A QR works once and expires two days after the stay. Guests can only show the QR; they cannot check themselves in.

### 4.5 Hold and reschedule

Admin can put any active booking **On Hold** with a reason (e.g. guest emergency) and later resume it, and can **reschedule** dates/times (conflict-checked). Held and pencil bookings keep their dates blocked and appear on both calendars.

### 4.6 Cancellation and refunds

Guests can cancel and request a refund (with GCash payout number). Admin reviews: approve (record payout method, reference, proof image) or decline. Cancellation policy text comes from Settings.

### 4.7 Inquiries

Guests (or visitors via the chatbot) send inquiries → admins are notified → staff reply/resolve → the guest is notified and reads the reply under My Inquiries. Inquiries can be escalated to support tickets.

---

## 5. Catalogue and pricing (current live data)

**Rooms** (priced per night)

| Code | Room | Price / night | Capacity |
|---|---|---|---|
| CS-01 | Casa Standard Room | ₱3,500 | 4 |
| CD-01 | Casa Deluxe Room | ₱3,800 | 4 |
| VP-01 | Villa with Private Pool | ₱5,000 | 10 |
| MH-01 | Main House with Private Pool (overnight) | ₱12,000 | 20 |

**Cottages** (flat rate per booking — a ₱300 rate is a ₱300 total, regardless of hours)

| Cottage | Rate | Capacity |
|---|---|---|
| Umbrella Cottage | ₱300 | 4 |
| Cottage | ₱500 | 5 |
| Pavilion | ₱2,000 | 60 |

**Venue** (one only)

| Venue | Price | Capacity |
|---|---|---|
| Pavilion Function Hall | ₱10,000 | 200 |

**Event packages**

| Package | Type | Price | Capacity |
|---|---|---|---|
| Meeting Package | meeting | ₱5,000 | 20 |
| Birthday Package | birthday | ₱15,000 | 30 |
| Corporate Package | corporate | ₱25,000 | 50 |
| Events with Caterer | other | ₱25,000 | 20 |
| Debut Package | debut | ₱35,000 | 80 |
| Wedding Package A | wedding | ₱50,000 | 50 |
| Wedding Package B | wedding | ₱80,000 | 100 |

Packages have inclusions (e.g. "Venue (4 hrs)", "Catering (30 pax)") and optional priced add-ons.

**Pricing rules**

- Prices are always read live from the catalogue; an admin price change must show everywhere immediately (landing, portal, booking summary, chatbot).
- Downpayment = **`downpayment_percent` setting (currently 50%)** of the total.
- Rooms: price × nights. Cottages, venue, packages: flat price (+ selected add-ons).
- Staff can override totals and balances on any booking.

---

## 6. Admin dashboard (must keep)

- **Daily view (default):** pick a date (prev/next/today). Sales collected that day, number of payments, refunds, new bookings, check-ins, check-outs; table of that day's payments; breakdown by payment method; bookings made that day.
- **Monthly view:** year selector; bar chart of bookings per month **January–December**; each month is **clickable** to drill into that month (sales per day, payment methods, status breakdown, bookings list).
- **Yearly view:** bookings and sales per year from **2026 onward**, with cancelled/rejected counts.
- **Accommodation graph:** bookings per room / cottage / venue / package for the selected period.
- "Right now" panel: pending reservations, open inquiries, pending payments, upcoming events (next 7 days), inventory alerts, availability counts.

---

## 7. Business rules to preserve

**Reservation statuses**

`Pending` → `Pencil Booking` (tentative) → `Awaiting payment` → `Confirmed` → `Checked in` → `Completed`
plus `On Hold`, `Cancelled`, `Rejected`, `No show`.

- Active statuses (Pending, Pencil, On Hold, Awaiting payment, Confirmed, Checked in) **block the dates** for that room/cottage/venue.
- Bookings past their end date are auto-completed — **except** Pencil and On Hold, which wait for an admin decision.

**Payment statuses:** Unpaid · Partially paid · Fully paid · Refunded.

**Other rules**

- Check-in 14:00, check-out 12:00 (settings).
- Double-booking is prevented: rooms by night; cottages/venue by date + time range.
- Every booking has **internal notes** (free text, up to 5,000 characters) separate from the guest's special requests.
- Wrong/past date message reads: **"Please select <date> onward."** (never "or later").
- Guest booking cannot use cash; walk-ins can.
- All money changes, status changes, holds and reschedules are written to status history and the audit log.
- Removed catalogue/inventory items are **hidden (deactivated), never deleted**, so history and reports stay intact.

**Notifications (in-app bell)**

| Event | Who is notified |
|---|---|
| New online booking | Admins + guest |
| Payment proof submitted | Admins + guest ("Payment Proof Received") |
| Payment verified / booking confirmed | Guest ("Booking Verified" / "Payment Verified") |
| Payment proof rejected | Guest |
| Status change, reschedule, check-in | Guest |
| New inquiry | Admins |
| Inquiry replied | Guest |
| Refund approved / declined | Guest |

---

## 8. Data model (main entities)

- **users** (admin / staff / customer login), **roles**
- **customers** (guest profile; optionally linked to a user)
- **rooms**, **room_types**, **cottages**, **venues**, **event_packages** (catalogue; `is_active` flag)
- **reservations** (booking ref, type, dates, times, guests, total, downpayment, status, payment status, source, payment method, notes, special requests)
- **reservation_items** (what was booked, unit/total price), **reservation_status_history**
- **payments** (amount, method, date, type: downpayment / balance / full / refund, status, proof image, verified by)
- **refund_requests** (amount, reason, payout details, proof)
- **qr_codes** (token, used, expiry), **check_ins**, **check_outs**, **guests**
- **inquiries**, **support_tickets**, **crm_activities**, **feedback**
- **inventory_items**, **inventory_categories**, **inventory_transactions**, **equipment**
- **notifications**, **audit_logs**, **settings** (key/value), **sessions**

---

## 9. Technology (current build)

- Node.js + Express, server-rendered templates (`.xian`, EJS-like), Bootstrap 5, Font Awesome, Chart.js, FullCalendar.
- **MySQL 8** (database `balai_reserve`).
- File uploads: room/cottage/venue photos, payment proofs (private), refund proofs (private), GCash/Maya QR images, landing images.
- QR images generated on demand; QR links use the machine's LAN address (or `APP_URL` in production).
- GCash screenshot OCR (Tesseract).
- Report exports: Excel (.xlsx), Word (.docx), CSV.
- Chatbot: keyword/rule-based, answers prices, times, policy, contact from live data.
- **Not yet connected:** Google sign-in (code ready, needs Google OAuth credentials), email to guests (not built).

A rebuild may change the stack, but must keep the behaviours in §4–§7.

---

## 10. Content inventory and gaps

**Real content available**

- Resort name, tagline, address, check-in/out times, GCash/Maya account name and number, cancellation policy, downpayment %.
- Real photos: some rooms (Casa Deluxe, Villa with Private Pool, Main House), some cottages, and the beachfront gazebo hero photo. **Casa Standard Room, the venue, and several cottages have no photos yet.**
- Guest reviews come from real feedback (rating ≥ 4, marked public).

**Placeholder or unverified — confirm before launch**

- Phone `(02) 8123-4567` and email `info@balai-reserve.com` look like placeholders.
- Bank account numbers are `XXXX-XXXX-XXXX`.
- Amenities list (Free WiFi, Air conditioning, Swimming pool, Free parking, Dining, Projector & AV, Sound system, Garden, 24/7 front desk, Housekeeping) is hard-coded marketing copy — confirm each with the resort.
- Section headlines are generic template copy ("We Make Every Occasion Unforgettable", "Everything You Need for a Perfect Stay") — rewrite in the resort's own voice.
- About copy mentions "Suite and Family rooms" and "receptions for 300 guests", which no longer match the catalogue (4 rooms; venue holds 200).

---

## 11. Current design and what the rebuild should fix

**Current look (after an October clean-up):** deep sea-teal (`#0f5c66`, dark `#0f2a30`) with a sand accent (`#e8b96a`) and sea-glass highlights (`#8fcfc4`); Fraunces serif for headings, Inter for text; dark photo-backed hero; white content sections; teal admin sidebar.

**Problems to solve in the rebuild**

1. **Three visual systems stitched together** — the landing page, guest portal and back office were styled separately and still differ in spacing, card styles, button sizes and headers. Build **one design system** (tokens for colour, type scale, spacing, radius, shadow) used everywhere.
2. **Too many identical cards** — almost every section is a grid of white rounded cards with icons. Vary composition: photo-led layouts for rooms, a clear price table, a timeline for "How to book", a quieter amenities list.
3. **Photography under-used** — the resort's selling point is the beach; use large real photos, and give every room/cottage/venue a proper gallery. Avoid icon placeholders where a photo should be.
4. **Booking is the main task** — make "Check availability → Book" the most prominent path on every public page, with a clear price summary and downpayment shown up front.
5. **Generic marketing copy** — replace with specific, honest text (what's included, distances, actual policies).
6. **Mobile first** — most guests will book on phones: sticky booking button, simple date pickers, readable price summaries, no cramped nav.
7. **Back office density** — staff need fast, dense, scannable tables and clear status colours; less decoration, more information. Keep status colours consistent across list, detail, calendar and dashboard.
8. **Accessibility** — sufficient contrast on photo backgrounds, visible focus states, labelled form fields, keyboard-usable modals and calendars.
9. **Trust signals that are real** — show actual payment methods (GCash, Maya, bank), the real cancellation policy, real reviews; no invented claims like "free cancellation" or "instant confirmation".

**Status colour set to keep consistent**

Pending (amber) · Pencil Booking (purple) · On Hold (slate) · Awaiting payment (orange) · Confirmed (teal/green) · Checked in (blue) · Completed (grey) · Cancelled / Rejected / No show (red tones).

---

## 12. Acceptance checklist for the rebuilt site

The current site passes all of these (61 automated checks, October 2026). The rebuild must too.

- [ ] Every booking has editable internal notes (≥ 1,000 characters).
- [ ] Past-date message says "onward", not "later".
- [ ] Admin can upload landing hero, About and gallery photos.
- [ ] Dashboard has Daily (sales), Monthly (Jan–Dec, clickable), Yearly (2026+), and an Accommodation graph.
- [ ] Walk-in reservations save for every type; cash default; no guest limit; source "Walk In" only; dates + times for every type; editable amount.
- [ ] "Pencil Booking" and "On Hold" statuses; admin can hold, resume and reschedule; held dates show on calendars.
- [ ] Admin can edit a booking's total and the guest's balance.
- [ ] Only one venue (Pavilion Function Hall); 3 cottages (Cottage, Umbrella Cottage, Pavilion); Main House with Private Pool ₱12,000 / 20 pax; Events with Caterer ₱25,000 / 20 pax.
- [ ] Cottage total equals its rate; admin price changes appear on every guest-facing price.
- [ ] Inventory: add, edit, remove, adjust with clear feedback; history.
- [ ] Profile password change with show/hide.
- [ ] Staff list includes Maria Nora Miciano (role to be confirmed).
- [ ] QR check-in works from a phone; staff-only confirmation; single use.
- [ ] Guest payment: GCash, Maya (with QR), bank transfer — no cash.
- [ ] Notifications: booking/payment verified (guest), new inquiry (admin), inquiry reply (guest).
- [ ] Guests cannot open any back-office page.
- [ ] Later: Sign in with Google; email confirmations and inquiry replies to the guest's Gmail.
