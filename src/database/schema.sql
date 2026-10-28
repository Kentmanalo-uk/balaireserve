-- ============================================================
-- Balai-Reserve Database Schema
-- MySQL 8 (InnoDB, utf8mb4)
-- Timestamps are stored in UTC (the app sets time_zone = '+00:00').
-- ============================================================

SET FOREIGN_KEY_CHECKS = 0;

-- ─── ROLES ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS roles (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  name       VARCHAR(50)  NOT NULL UNIQUE,      -- admin, staff, customer
  label      VARCHAR(100) NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── USERS ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  role_id        INT NOT NULL,
  first_name     VARCHAR(100) NOT NULL,
  last_name      VARCHAR(100) NOT NULL,
  email          VARCHAR(255) NOT NULL UNIQUE,
  password_hash  VARCHAR(255) NOT NULL DEFAULT '',
  phone          VARCHAR(50),
  avatar         VARCHAR(500),
  is_active      TINYINT NOT NULL DEFAULT 1,
  last_login     DATETIME,
  created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
  auth_provider  VARCHAR(50) NOT NULL DEFAULT 'local',
  firebase_uid   VARCHAR(255),
  email_verified TINYINT NOT NULL DEFAULT 0,
  google_sub     VARCHAR(255),
  UNIQUE KEY idx_users_google_sub (google_sub),
  FOREIGN KEY (role_id) REFERENCES roles(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── CUSTOMERS ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS customers (
  id                INT AUTO_INCREMENT PRIMARY KEY,
  user_id           INT,
  customer_code     VARCHAR(50) UNIQUE,
  first_name        VARCHAR(100) NOT NULL,
  last_name         VARCHAR(100) NOT NULL,
  email             VARCHAR(255),
  phone             VARCHAR(50),
  address           TEXT,
  preferred_contact VARCHAR(20) DEFAULT 'email',    -- email, phone, sms
  customer_type     VARCHAR(20) DEFAULT 'regular',  -- regular, vip, corporate
  status            VARCHAR(20) DEFAULT 'active',   -- active, inactive, blacklisted
  notes             TEXT,
  created_at        DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── ROOM TYPES ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS room_types (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  name        VARCHAR(100) NOT NULL UNIQUE,   -- Standard, Deluxe, Suite, Family, etc.
  description TEXT,
  base_price  DECIMAL(12,2) NOT NULL DEFAULT 0,
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── ROOMS ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS rooms (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  room_type_id INT NOT NULL,
  room_number  VARCHAR(50) NOT NULL UNIQUE,
  name         VARCHAR(255) NOT NULL,
  description  TEXT,
  capacity     INT NOT NULL DEFAULT 2,
  price        DECIMAL(12,2) NOT NULL,
  amenities    TEXT,              -- JSON array string
  images       TEXT,              -- JSON array of image paths
  floor        VARCHAR(50),
  status       VARCHAR(20) NOT NULL DEFAULT 'available',
               -- available | reserved | occupied | cleaning | maintenance | unavailable
  is_active    TINYINT NOT NULL DEFAULT 1,
  created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (room_type_id) REFERENCES room_types(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── VENUES ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS venues (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  name         VARCHAR(255) NOT NULL,
  venue_type   VARCHAR(50) NOT NULL,
               -- function_hall | outdoor | garden | pavilion | poolside | event_space
  capacity     INT NOT NULL DEFAULT 50,
  description  TEXT,
  location     VARCHAR(255),
  price        DECIMAL(12,2) NOT NULL DEFAULT 0,
  price_note   VARCHAR(255),
  amenities    TEXT,              -- JSON array
  images       TEXT,              -- JSON array
  status       VARCHAR(20) NOT NULL DEFAULT 'available',
  is_active    TINYINT NOT NULL DEFAULT 1,
  created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at   DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── COTTAGES ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cottages (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  name        VARCHAR(255) NOT NULL,
  description TEXT,
  capacity    INT NOT NULL DEFAULT 10,
  price       DECIMAL(12,2) NOT NULL DEFAULT 0,
  amenities   TEXT,
  images      TEXT,
  status      VARCHAR(20) NOT NULL DEFAULT 'available',
  is_active   TINYINT NOT NULL DEFAULT 1,
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── EVENT PACKAGES ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS event_packages (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  name        VARCHAR(255) NOT NULL,
  description TEXT,
  event_type  VARCHAR(50),   -- wedding | birthday | corporate | debut | party | meeting | other
  price       DECIMAL(12,2) NOT NULL DEFAULT 0,
  inclusions  TEXT,          -- JSON array of what is included (src/utils/eventPackages.js)
  images      TEXT,          -- JSON array of photo paths
  capacity    INT,
  is_active   TINYINT NOT NULL DEFAULT 1,
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- The function hall, rooms and cottages an event package includes. Booking the package reserves the
-- hall; rooms and cottages are listed on the booking for staff to assign (src/utils/eventPackages.js).
CREATE TABLE IF NOT EXISTS event_package_items (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  package_id  INT NOT NULL,
  item_type   VARCHAR(20) NOT NULL,   -- venue | room | cottage
  item_id     INT NOT NULL,
  quantity    INT NOT NULL DEFAULT 1,
  note        VARCHAR(255) NULL,      -- e.g. "for the celebrant's family, 1 night"
  sort_order  INT NOT NULL DEFAULT 0,
  KEY idx_epi_package (package_id),
  FOREIGN KEY (package_id) REFERENCES event_packages(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── RESERVATIONS ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS reservations (
  id                INT AUTO_INCREMENT PRIMARY KEY,
  booking_ref       VARCHAR(50) NOT NULL UNIQUE,
  customer_id       INT NOT NULL,
  reservation_type  VARCHAR(20) NOT NULL,   -- room | venue | event | cottage
  check_in_date     DATE,
  check_out_date    DATE,
  event_date        DATE,
  start_time        VARCHAR(10),            -- HH:MM
  end_time          VARCHAR(10),            -- HH:MM
  num_guests        INT NOT NULL DEFAULT 1,
  special_requests  TEXT,
  total_amount      DECIMAL(12,2) NOT NULL DEFAULT 0,
  downpayment_req   DECIMAL(12,2) NOT NULL DEFAULT 0,
  status            VARCHAR(30) NOT NULL DEFAULT 'pending',
               -- pending | awaiting_payment | confirmed | checked_in | completed | cancelled | rejected | no_show
  payment_status    VARCHAR(30) NOT NULL DEFAULT 'unpaid',
               -- unpaid | partially_paid | fully_paid | refunded
  assigned_staff_id INT,
  notes             TEXT,
  source            VARCHAR(20) DEFAULT 'walk_in',  -- walk_in | online | phone | staff
  created_at        DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME DEFAULT CURRENT_TIMESTAMP,
  payment_method    VARCHAR(30) DEFAULT 'cash',
  KEY idx_reservations_customer (customer_id),
  KEY idx_reservations_dates (check_in_date, check_out_date),
  KEY idx_reservations_status (status),
  FOREIGN KEY (customer_id) REFERENCES customers(id),
  FOREIGN KEY (assigned_staff_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── RESERVATION ITEMS ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS reservation_items (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  reservation_id INT NOT NULL,
  item_type      VARCHAR(30) NOT NULL,   -- room | venue | cottage | event_package | equipment
  item_id        INT NOT NULL,
  item_name      VARCHAR(255),
  quantity       INT NOT NULL DEFAULT 1,
  unit_price     DECIMAL(12,2) NOT NULL DEFAULT 0,
  total_price    DECIMAL(12,2) NOT NULL DEFAULT 0,
  notes          TEXT,
  created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (reservation_id) REFERENCES reservations(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── RESERVATION STATUS HISTORY ───────────────────────────────
CREATE TABLE IF NOT EXISTS reservation_status_history (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  reservation_id INT NOT NULL,
  from_status    VARCHAR(30),
  to_status      VARCHAR(30) NOT NULL,
  changed_by     INT,
  notes          TEXT,
  created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (reservation_id) REFERENCES reservations(id),
  FOREIGN KEY (changed_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── PAYMENTS ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS payments (
  id               INT AUTO_INCREMENT PRIMARY KEY,
  reservation_id   INT NOT NULL,
  reference_number VARCHAR(100) UNIQUE,
  amount           DECIMAL(12,2) NOT NULL DEFAULT 0,
  payment_method   VARCHAR(30) NOT NULL DEFAULT 'cash',        -- cash | gcash | bank_transfer | credit_card | check
  payment_date     DATE NOT NULL,
  payment_type     VARCHAR(30) NOT NULL DEFAULT 'downpayment', -- downpayment | full_payment | balance | refund
  status           VARCHAR(30) NOT NULL DEFAULT 'received',    -- received | verified | refunded
  received_by      INT,
  notes            TEXT,
  created_at       DATETIME DEFAULT CURRENT_TIMESTAMP,
  proof_image      VARCHAR(500) DEFAULT NULL,
  submitted_by     VARCHAR(20) DEFAULT 'staff',
  verified_by      INT DEFAULT NULL,
  verified_at      DATETIME DEFAULT NULL,
  KEY idx_payments_reservation (reservation_id),
  FOREIGN KEY (reservation_id) REFERENCES reservations(id),
  FOREIGN KEY (received_by) REFERENCES users(id),
  FOREIGN KEY (verified_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── REFUND REQUESTS ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS refund_requests (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  reservation_id INT NOT NULL,
  customer_id    INT,
  amount         DECIMAL(12,2) NOT NULL DEFAULT 0,
  reason         TEXT,
  status         VARCHAR(20) NOT NULL DEFAULT 'pending',
  admin_note     TEXT,
  reviewed_by    INT,
  reviewed_at    DATETIME,
  created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
  gcash_number   VARCHAR(50),
  payout_method  VARCHAR(30),
  payout_ref     VARCHAR(100),
  payout_date    DATE,
  payout_proof   VARCHAR(500),
  FOREIGN KEY (reservation_id) REFERENCES reservations(id),
  FOREIGN KEY (customer_id) REFERENCES customers(id),
  FOREIGN KEY (reviewed_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── GUESTS ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS guests (
  id               INT AUTO_INCREMENT PRIMARY KEY,
  reservation_id   INT NOT NULL,
  customer_id      INT,
  first_name       VARCHAR(100) NOT NULL,
  last_name        VARCHAR(100) NOT NULL,
  email            VARCHAR(255),
  phone            VARCHAR(50),
  address          TEXT,
  id_type          VARCHAR(50),    -- passport | drivers_license | national_id | other
  id_number        VARCHAR(100),
  num_guests       INT NOT NULL DEFAULT 1,
  special_requests TEXT,
  status           VARCHAR(20) NOT NULL DEFAULT 'expected',  -- expected | checked_in | checked_out | no_show
  created_at       DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME DEFAULT CURRENT_TIMESTAMP,
  KEY idx_guests_reservation (reservation_id),
  FOREIGN KEY (reservation_id) REFERENCES reservations(id),
  FOREIGN KEY (customer_id) REFERENCES customers(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── CHECK-INS / CHECK-OUTS ───────────────────────────────────
CREATE TABLE IF NOT EXISTS check_ins (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  reservation_id INT NOT NULL,
  guest_id       INT,
  checked_in_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  checked_in_by  INT,
  method         VARCHAR(20) DEFAULT 'manual',  -- manual | qr
  notes          TEXT,
  FOREIGN KEY (reservation_id) REFERENCES reservations(id),
  FOREIGN KEY (guest_id) REFERENCES guests(id),
  FOREIGN KEY (checked_in_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS check_outs (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  reservation_id INT NOT NULL,
  guest_id       INT,
  checked_out_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  checked_out_by INT,
  notes          TEXT,
  FOREIGN KEY (reservation_id) REFERENCES reservations(id),
  FOREIGN KEY (guest_id) REFERENCES guests(id),
  FOREIGN KEY (checked_out_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── QR CODES ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS qr_codes (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  reservation_id INT NOT NULL,
  token          VARCHAR(100) NOT NULL UNIQUE,
  qr_path        VARCHAR(500),     -- public path to generated QR image
  used           TINYINT NOT NULL DEFAULT 0,
  used_at        DATETIME,
  expires_at     DATETIME,
  created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (reservation_id) REFERENCES reservations(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── EVENTS ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS events (
  id               INT AUTO_INCREMENT PRIMARY KEY,
  reservation_id   INT,
  customer_id      INT NOT NULL,
  event_package_id INT,
  venue_id         INT,
  event_name       VARCHAR(255) NOT NULL,
  event_type       VARCHAR(50) NOT NULL,
  event_date       DATE NOT NULL,
  start_time       VARCHAR(10) NOT NULL,
  end_time         VARCHAR(10) NOT NULL,
  num_attendees    INT NOT NULL DEFAULT 1,
  special_requests TEXT,
  equipment_needs  TEXT,   -- JSON array
  status           VARCHAR(30) NOT NULL DEFAULT 'pending',
  total_cost       DECIMAL(12,2) NOT NULL DEFAULT 0,
  payment_status   VARCHAR(30) NOT NULL DEFAULT 'unpaid',
  notes            TEXT,
  created_at       DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME DEFAULT CURRENT_TIMESTAMP,
  KEY idx_events_date (event_date),
  FOREIGN KEY (reservation_id) REFERENCES reservations(id),
  FOREIGN KEY (customer_id) REFERENCES customers(id),
  FOREIGN KEY (event_package_id) REFERENCES event_packages(id),
  FOREIGN KEY (venue_id) REFERENCES venues(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── FEEDBACK ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS feedback (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  reservation_id INT NOT NULL,
  customer_id    INT NOT NULL,
  rating         INT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  category       VARCHAR(30),   -- room | venue | service | event | overall
  comments       TEXT,
  suggestions    TEXT,
  is_public      TINYINT NOT NULL DEFAULT 1,
  admin_response TEXT,
  responded_by   INT,
  responded_at   DATETIME,
  created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (reservation_id) REFERENCES reservations(id),
  FOREIGN KEY (customer_id) REFERENCES customers(id),
  FOREIGN KEY (responded_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── INQUIRIES ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS inquiries (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  customer_id INT,
  name        VARCHAR(255),
  email       VARCHAR(255),
  phone       VARCHAR(50),
  subject     VARCHAR(255) NOT NULL,
  message     TEXT NOT NULL,
  category    VARCHAR(30) DEFAULT 'general',  -- general | room | venue | event | pricing | complaint | other
  source      VARCHAR(30) DEFAULT 'website',  -- website | chatbot | email | phone | walk_in
  status      VARCHAR(30) NOT NULL DEFAULT 'open',  -- open | in_progress | escalated | resolved | closed
  assigned_to INT,
  resolution  TEXT,
  resolved_at DATETIME,
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (customer_id) REFERENCES customers(id),
  FOREIGN KEY (assigned_to) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── CRM ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS crm_activities (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  customer_id   INT NOT NULL,
  activity_type VARCHAR(30) NOT NULL,  -- call | email | chat | support | follow_up | inquiry | complaint | feedback
  subject       VARCHAR(255),
  description   TEXT,
  staff_id      INT,
  status        VARCHAR(20) DEFAULT 'completed',  -- scheduled | completed | cancelled
  scheduled_at  DATETIME,
  completed_at  DATETIME,
  follow_up_at  DATETIME,
  outcome       TEXT,
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  KEY idx_crm_customer (customer_id),
  FOREIGN KEY (customer_id) REFERENCES customers(id),
  FOREIGN KEY (staff_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS sales_calls (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  customer_id  INT NOT NULL,
  staff_id     INT NOT NULL,
  call_date    DATE NOT NULL,
  call_time    VARCHAR(10),
  purpose      VARCHAR(255) NOT NULL,
  result       TEXT,
  notes        TEXT,
  follow_up_at DATETIME,
  status       VARCHAR(20) NOT NULL DEFAULT 'completed',  -- scheduled | completed | no_answer | cancelled
  created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (customer_id) REFERENCES customers(id),
  FOREIGN KEY (staff_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS marketing_emails (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  customer_id  INT,
  campaign     VARCHAR(255),
  recipient    VARCHAR(255) NOT NULL,
  subject      VARCHAR(255) NOT NULL,
  body         TEXT,
  sent_at      DATETIME,
  status       VARCHAR(20) NOT NULL DEFAULT 'draft',  -- draft | sent | failed | bounced
  follow_up_at DATETIME,
  created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (customer_id) REFERENCES customers(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS support_tickets (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  ticket_number VARCHAR(50) NOT NULL UNIQUE,
  customer_id   INT,
  inquiry_id    INT,
  subject       VARCHAR(255) NOT NULL,
  description   TEXT NOT NULL,
  category      VARCHAR(30) DEFAULT 'general',
  priority      VARCHAR(20) NOT NULL DEFAULT 'normal',  -- low | normal | high | urgent
  assigned_to   INT,
  status        VARCHAR(20) NOT NULL DEFAULT 'open',    -- open | in_progress | resolved | closed
  resolution    TEXT,
  resolved_at   DATETIME,
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (customer_id) REFERENCES customers(id),
  FOREIGN KEY (inquiry_id) REFERENCES inquiries(id),
  FOREIGN KEY (assigned_to) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS follow_ups (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  reservation_id INT,
  customer_id    INT NOT NULL,
  follow_up_type VARCHAR(50) NOT NULL,  -- booking_inquiry | payment_reminder | event_reminder | checkin_reminder | post_stay | feedback_request
  scheduled_at   DATETIME NOT NULL,
  sent_at        DATETIME,
  status         VARCHAR(20) NOT NULL DEFAULT 'pending',  -- pending | sent | failed | skipped
  message        TEXT,
  created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (reservation_id) REFERENCES reservations(id),
  FOREIGN KEY (customer_id) REFERENCES customers(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── INVENTORY ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS inventory_categories (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  name        VARCHAR(100) NOT NULL UNIQUE,
  description TEXT,
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS inventory_items (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  category_id   INT NOT NULL,
  item_code     VARCHAR(50) UNIQUE,
  name          VARCHAR(255) NOT NULL,
  description   TEXT,
  unit          VARCHAR(30) DEFAULT 'pcs',
  total_qty     INT NOT NULL DEFAULT 0,
  available_qty INT NOT NULL DEFAULT 0,
  reserved_qty  INT NOT NULL DEFAULT 0,
  damaged_qty   INT NOT NULL DEFAULT 0,
  reorder_level INT NOT NULL DEFAULT 5,
  location      VARCHAR(255),
  is_active     TINYINT NOT NULL DEFAULT 1,
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  KEY idx_inventory_items_cat (category_id),
  FOREIGN KEY (category_id) REFERENCES inventory_categories(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS inventory_transactions (
  id               INT AUTO_INCREMENT PRIMARY KEY,
  item_id          INT NOT NULL,
  transaction_type VARCHAR(30) NOT NULL,  -- reserved | released | damaged | repaired | added | removed | lost
  quantity         INT NOT NULL DEFAULT 1,
  reference_id     INT,                   -- reservation_id or event_id
  reference_type   VARCHAR(30),           -- reservation | event
  performed_by     INT,
  notes            TEXT,
  created_at       DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (item_id) REFERENCES inventory_items(id),
  FOREIGN KEY (performed_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- `condition` is a reserved word in MySQL; always quote it with backticks.
CREATE TABLE IF NOT EXISTS equipment (
  id                INT AUTO_INCREMENT PRIMARY KEY,
  category_id       INT,
  equipment_code    VARCHAR(50) UNIQUE,
  name              VARCHAR(255) NOT NULL,
  description       TEXT,
  quantity          INT NOT NULL DEFAULT 1,
  `condition`       VARCHAR(30) NOT NULL DEFAULT 'good',
                    -- excellent | good | needs_maintenance | damaged | lost
  available_qty     INT NOT NULL DEFAULT 1,
  maintenance_notes TEXT,
  is_active         TINYINT NOT NULL DEFAULT 1,
  created_at        DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (category_id) REFERENCES inventory_categories(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS equipment_assignments (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  equipment_id    INT NOT NULL,
  reservation_id  INT,
  event_id        INT,
  quantity        INT NOT NULL DEFAULT 1,
  assigned_by     INT,
  date_assigned   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expected_return DATE,
  actual_return   DATE,
  condition_out   VARCHAR(30) DEFAULT 'good',
  condition_in    VARCHAR(30),
  status          VARCHAR(20) NOT NULL DEFAULT 'assigned',  -- assigned | returned | damaged | lost
  notes           TEXT,
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (equipment_id) REFERENCES equipment(id),
  FOREIGN KEY (reservation_id) REFERENCES reservations(id),
  FOREIGN KEY (event_id) REFERENCES events(id),
  FOREIGN KEY (assigned_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── NOTIFICATIONS ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS notifications (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  user_id     INT,
  customer_id INT,
  type        VARCHAR(30) NOT NULL,    -- reservation | payment | event | inventory | system | inquiry
  title       VARCHAR(255) NOT NULL,
  message     TEXT NOT NULL,
  link        VARCHAR(500),
  is_read     TINYINT NOT NULL DEFAULT 0,
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
  KEY idx_notifications_user (user_id, is_read),
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (customer_id) REFERENCES customers(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── AI INSIGHTS ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ai_insights (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  insight_type VARCHAR(30) NOT NULL,   -- trend | recommendation | forecast | alert
  category     VARCHAR(30),            -- reservations | revenue | inventory | events | satisfaction
  title        VARCHAR(255) NOT NULL,
  message      TEXT NOT NULL,
  data_basis   TEXT,                   -- JSON: supporting data used to generate insight
  confidence   VARCHAR(20),            -- low | medium | high
  is_dismissed TINYINT NOT NULL DEFAULT 0,
  created_at   DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── AUDIT LOGS ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS audit_logs (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  user_id    INT,
  action     VARCHAR(100) NOT NULL,
  module     VARCHAR(100) NOT NULL,
  record_id  INT,
  old_values TEXT,   -- JSON
  new_values TEXT,   -- JSON
  ip_address VARCHAR(100),
  user_agent TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  KEY idx_audit_user (user_id),
  FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── SETTINGS ─────────────────────────────────────────────────
-- `key` is a reserved word in MySQL; always quote it with backticks.
CREATE TABLE IF NOT EXISTS settings (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  `key`      VARCHAR(100) NOT NULL UNIQUE,
  value      TEXT,
  label      VARCHAR(255),
  group_name VARCHAR(50) DEFAULT 'general',
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── SESSIONS (express-session store) ─────────────────────────
CREATE TABLE IF NOT EXISTS sessions (
  sid    VARCHAR(128) NOT NULL PRIMARY KEY,
  sess   MEDIUMTEXT NOT NULL,
  expire DATETIME NOT NULL,
  KEY idx_sessions_expire (expire)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS = 1;
