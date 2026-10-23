# Balai-Reserve

**Online Booking and Event Management System**  
With CRM, Inventory Management, Automated Customer Assistance, Analytics, and AI-Based Decision Support

---

## Overview

Balai-Reserve is a full-featured, web-based management platform for resorts and event venues. It replaces fragmented manual processes with a centralized system for managing room reservations, event bookings, guests, customers, inventory, payments, inquiries, reports, and analytics.

**Stack:** Node.js · Express · MySQL 8 (mysql2) · Xianfire (.xian templates) · Bootstrap 5 · Chart.js

---

## Features

| Module | Capabilities |
|---|---|
| **Dashboard** | Live stats, revenue charts, check-in list, AI insights |
| **Reservations** | Room/venue/event bookings, payment tracking, QR check-in |
| **Rooms** | Room CRUD, availability, status management |
| **Venues** | Venue CRUD, booking calendar, availability checks |
| **Events** | Full event lifecycle, package management, equipment tracking |
| **Guests** | Guest records, check-in/out history, QR scan |
| **CRM** | Customer profiles, activity timeline, sales calls, support tickets |
| **Inventory** | Items and equipment tracking, low-stock alerts, adjustments |
| **Payments** | Payment recording, balance tracking, method history |
| **Inquiries** | Inquiry inbox, assignment, escalation, chatbot assistant |
| **Reports** | Sales, reservation, event reports with CSV export |
| **Analytics** | Revenue trends, occupancy, AI recommendations, forecasting |
| **Notifications** | In-app notifications for all key events |

---

## User Roles

| Role | Access |
|---|---|
| `admin` | Full access to all modules, reports, analytics, settings |
| `reservation_staff` | Reservations, guests, events, inquiries, payments |
| `marketing_staff` | CRM, customers, sales calls, marketing emails |
| `inventory_staff` | Rooms, venues, inventory, equipment |
| `customer` | Public booking, QR check-in, feedback |

---

## Quick Start

### Prerequisites

- **Node.js** v18 or higher (tested on v22)
- **npm** v9+
- Windows Build Tools are **not required** (uses prebuilt binaries)

### 1. Install dependencies

Run this from the project folder:

```bash
npm install
```

### 2. Configure environment

```bash
copy .env.example .env
```

Edit `.env` if needed. The defaults (`DB_HOST=localhost`, `DB_PORT=3306`, `DB_USER=root`, empty `DB_PASSWORD`, `DB_NAME=balai_reserve`) match a stock Laragon MySQL install. Make sure MySQL is running.

### 3. Create the database and seed demo data

```bash
npm run setup
```

This runs the migration (creates all tables) and seeds realistic demo data in one command.

Or run them separately:

```bash
npm run migrate   # creates the database and tables
npm run seed      # inserts demo data
```

Moving from the old SQLite file? `npm run migrate:sqlite` **drops all tables** in the MySQL database and copies every row from `src/database/balai_reserve.db`.

### 4. Start the server

Xianfire is the app's template engine; it does not have a separate `npm run xian` command. Start the app from the project folder with:

```bash
npm run dev       # with nodemon (auto-restart on file changes)
npm start         # production start
```

Open **http://localhost:3000** in your browser.

---

## Demo Login Credentials

| Role | Email | Password |
|---|---|---|
| Administrator | admin@balai.com | password123 |
| Reservation Staff | maria@balai.com | password123 |
| Marketing Staff | ana@balai.com | password123 |
| Inventory Staff | carlos@balai.com | password123 |
| Customer | juan@example.com | password123 |

---

## Project Structure

```
balai-reserve/
├── app.js                        # Main Express application entry point
├── .env                          # Environment variables
├── package.json
│
├── src/
│   ├── config/
│   │   └── database.js           # MySQL connection pool (async)
│   ├── database/
│   │   ├── schema.sql            # Full database schema (30+ tables)
│   │   ├── migrate.js            # Run schema on the database
│   │   └── seed.js               # Demo/sample data
│   ├── middleware/
│   │   ├── auth.js               # requireAuth, requireRole, guestOnly, attachAudit
│   │   └── flash.js              # Flash message middleware
│   ├── modules/
│   │   ├── auth/routes/          # Login, logout
│   │   ├── dashboard/routes/     # Dashboard stats and charts
│   │   ├── rooms/routes/         # Room CRUD and status management
│   │   ├── venues/routes/        # Venue CRUD
│   │   ├── reservations/routes/  # Booking lifecycle, payments, QR
│   │   ├── guests/routes/        # Guest records and check-in/out
│   │   ├── events/routes/        # Event management
│   │   ├── inventory/routes/     # Inventory items and equipment
│   │   ├── crm/routes/           # Customers, calls, tickets
│   │   ├── reports/routes/       # Sales, reservation, event reports + CSV export
│   │   ├── analytics/routes/     # Business analytics and AI insights
│   │   ├── notifications/routes/ # Notification list
│   │   ├── payments/routes/      # Payment records
│   │   └── inquiries/routes/     # Inquiry management + chatbot API
│   ├── utils/
│   │   ├── bookingRef.js         # Booking reference, ticket, customer code generators
│   │   ├── notifications.js      # In-app notification helpers
│   │   └── qrGenerator.js        # QR code generation and validation
│   └── xianfire/
│       ├── engine.js             # Xianfire template engine (.xian files)
│       └── helpers.js            # Template helpers (formatDate, formatPeso, etc.)
│
├── views/
│   ├── layouts/
│   │   ├── main.xian             # Main app layout (sidebar + navbar)
│   │   ├── auth.xian             # Auth pages layout
│   │   └── minimal.xian          # Minimal layout (QR check-in pages)
│   ├── partials/
│   │   ├── sidebar.xian          # Sidebar navigation
│   │   ├── navbar.xian           # Top navigation bar
│   │   ├── flash.xian            # Flash message display
│   │   ├── pagination.xian       # Reusable pagination component
│   │   └── chatbot.xian          # Chatbot / booking assistant widget
│   ├── auth/                     # login.xian
│   ├── dashboard/                # index.xian
│   ├── rooms/                    # index, show, form
│   ├── venues/                   # index, show, form
│   ├── reservations/             # index, show, form, calendar
│   ├── guests/                   # index, show, checkin-scan/success/invalid
│   ├── events/                   # index, show, form
│   ├── inventory/                # index, form, equipment-form
│   ├── crm/                      # customers, customer-profile, calls, tickets
│   ├── reports/                  # index, sales, reservations, events
│   ├── analytics/                # index
│   ├── notifications/            # index
│   ├── payments/                 # index
│   ├── inquiries/                # index, show
│   └── errors/                   # 403, 404, 500
│
└── public/
    ├── css/main.css              # Complete application stylesheet
    ├── js/main.js                # Client-side JavaScript
    ├── images/                   # Uploaded images
    └── qrcodes/                  # Generated QR code images
```

---

## Xianfire Template Engine

Balai-Reserve uses a custom `.xian` template engine built on top of Express. It supports EJS-compatible syntax:

```xian
<%  code %>           Execute JavaScript (loops, conditionals)
<%= expr %>           Output HTML-escaped value
<%- expr %>           Output raw/unescaped HTML (for partials, statusBadge, etc.)
<%# comment %>        Template comment (not rendered)
<%include('path')%>   Include another .xian partial

<%- layout('layouts/main') %>   Wrap view in a layout
```

**Available template helpers** (via `res.locals`):

| Helper | Usage |
|---|---|
| `formatDate(date)` | `formatDate('2026-09-06')` → `Sep 6, 2026` |
| `formatDateTime(date)` | Includes time |
| `formatPeso(amount)` | `formatPeso(1500)` → `₱1,500.00` |
| `statusBadge(status)` | Returns colored HTML badge |
| `activeNav(currentPath, prefix)` | Returns `'active'` for sidebar links |
| `paginate(total, page, limit)` | Returns pagination object |

---

## Key Business Rules

- **Double booking prevention** — rooms and venues are checked for date/time conflicts before saving
- **Automatic status transitions** — payment triggers status change from `pending` → `awaiting_payment` → `confirmed`
- **QR check-in** — each confirmed reservation gets a unique, single-use QR code
- **Inventory tracking** — reserving equipment automatically adjusts available quantities
- **Audit trail** — all important changes are logged with user, action, and timestamp

---

## Development Phase Order

The project is structured for incremental development:

1. **Foundation** — Auth, roles, dashboard ✅
2. **Booking** — Rooms, venues, reservations, calendar ✅
3. **Guests** — Profiles, check-in/out, QR ✅
4. **Events** — Event management, packages, equipment ✅
5. **Inventory** — Items, equipment, adjustments ✅
6. **CRM** — Customers, sales calls, tickets ✅
7. **Automation** — Chatbot assistant, notifications ✅
8. **Reports** — Sales, reservations, events, CSV export ✅
9. **Analytics & AI** — Trends, forecasting, recommendations ✅
10. **Testing & Deployment** — Coming next

---

## Security Features

- Password hashing with bcryptjs
- Session-based authentication with MySQL session store
- Role-based access control on every route
- HTTP security headers via Helmet
- Rate limiting on login and API routes (express-rate-limit)
- Input validation on all forms (express-validator)
- Parameterized SQL queries (mysql2 placeholders)
- QR tokens are UUID-based, single-use, and time-limited
- Audit logging on all important mutations

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | HTTP port |
| `SESSION_SECRET` | *(set in .env)* | Session signing secret — **change in production** |
| `DB_HOST` | `localhost` | MySQL host |
| `DB_PORT` | `3306` | MySQL port |
| `DB_USER` | `root` | MySQL user |
| `DB_PASSWORD` | *(empty)* | MySQL password |
| `DB_NAME` | `balai_reserve` | MySQL database name |
| `DATABASE_URL` | — | Optional `mysql://user:pass@host:port/db`; overrides the `DB_*` values |
| `QR_PATH` | `./public/qrcodes` | QR code image output directory |
| `NODE_ENV` | `development` | Set to `production` for secure cookies |

---

## License

MIT — Built for Balai Miciano Resort Management System
#   D e p l o y m e n t   t r i g g e r  
 