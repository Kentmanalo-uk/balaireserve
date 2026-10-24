# BALAI-RESERVE — COMPLETE UI/UX OVERHAUL V3
## An expressive, Airbnb-caliber resort booking experience — one system, three audiences

**For Claude Code / implementation agent.** This is an execution specification for redesigning the existing Balai-Reserve website, guest portal, and staff/admin back office. **Redesign the presentation and interaction patterns, not the underlying business rules.** Inspect the actual repository and routes before making changes. Do not replace live data with demo data, silently remove actions, or break existing flows.

> **North star:** A welcoming beachfront resort with the effortless usability, warmth, personality, and confidence of a best-in-class travel product. **Not** a generic hotel template, sterile SaaS dashboard, copied Airbnb screen, or overly sparse minimalist concept.

---

## 01 — Understand the product before designing

Balai-Reserve serves a real beachfront resort in **Brgy. San Antonio, Gloria, Oriental Mindoro, Philippines**, with the tagline **“Your Home Away From Home.”** It supports:

1. **Public visitors:** discover rooms, cottages, Pavilion Function Hall, event packages, amenities, photographs, policies and availability.
2. **Signed-in guests:** book, upload GCash/Maya/bank payment proof, view reservations, track verification, use a check-in QR, cancel, request refunds, inquire and review.
3. **Staff/admin:** manage walk-ins and online reservations, calendars, payments, refunds, check-in/out, inventory, catalogue, customers, inquiries, reporting and settings.

Primary guest audiences are Filipino families, barkadas, celebrations, and event organizers. Show **₱** pricing and **Philippine local time (UTC+8)**. The booking experience must accommodate both **overnight stays** and **time-based venue/cottage/event bookings** without forcing them into the same confusing date interface.

**Brand positioning:** relaxed, social, welcoming, dependable, subtly playful. Not a five-star luxury impersonation. Make the actual resort feel appealing and credible on its own terms.

### Product-wide non-negotiables

- Preserve every existing route, authorization boundary, booking state, calendar rule, price calculation, notification, export, audit trail, and integration.
- Guest cash payments are not offered online. Online methods are **GCash, Maya, bank transfer**; these are **manual proof-upload and verification**, not instant automatic checkout.
- Rooms are **priced per night**. Cottages, venue and event packages use **flat booking prices** plus applicable add-ons. Show clear price units.
- The current downpayment is **50%**, but render the value from the live `downpayment_percent` setting, not hard-coded UI text.
- Pending, Pencil Booking, On Hold, Awaiting payment, Confirmed and Checked in block availability as defined by the existing system. Never visually imply a blocked date is available.
- Check-in QR is for guest presentation; only authorized staff can confirm check-in. QR is single-use and has the existing expiry rules.
- Staff walk-ins: source **Walk In**, cash default, all types include dates and times, no guest-count cap, editable totals, optional payment and Pencil Booking status.
- No fake testimonials, property photography, amenity claims, booking counts, awards, availability, urgency timers, reviews or payment confirmations.

---

## 02 — Design personality: Airbnb-quality, Balai identity

### What to learn from Airbnb

- Listings feel tangible because **photography, price, capacity, location and dates** are immediately legible.
- Discovery is light and fun: browsing feels like exploring a place, not filling in a government form.
- Interfaces are friendly without being childish: gentle rounding, thoughtful iconography, confident typography, tactile controls, clear selected states.
- A listing detail screen explains the offer before asking the user to commit.
- Price breakdowns and sticky booking controls provide confidence and continuity.
- Mobile feels intentionally composed rather than a squeezed desktop layout.

### What NOT to copy

Do not clone Airbnb's wordmark, illustrations, exact header, search pill, coral brand color, icons, layouts, content, or animations. **Translate the design principles into a distinct resort identity.** Balai is a single destination, not a marketplace of thousands of homes; optimize for **choosing between a small number of real accommodations and packages**, not infinite filters.

### Signature Balai design motifs

1. **The coastline:** spacious image horizons, gentle curves used selectively in section transitions or photography masks, warm sea/sand tones.
2. **The welcome:** inviting, conversational microcopy; clear reassurance about what happens after a booking.
3. **The escape:** immersive real images and short location-specific details; not huge decorative slogans.
4. **The gathering:** celebrate group size and occasion type in discoverable filters and package information.
5. **The craft:** small, tasteful details — hover image movement, selected date feedback, gallery counters, subtle transitions — rather than excessive ornaments.

**Design personality mix:** 45% warm hospitality, 30% crisp product utility, 15% editorial photography, 10% tasteful playfulness. Never let decoration obstruct tasks.

---

## 03 — Design tokens (implement once; use everywhere)

Use CSS variables or a centralized theme. Audit current styles and migrate repeated values rather than stacking more overrides.

### Color palette

| Token | Hex | Usage |
|---|---|---|
| `--color-ocean-700` | `#0F5C66` | Main brand, primary actions, active navigation |
| `--color-ocean-800` | `#0B4850` | Hover/pressed |
| `--color-ocean-900` | `#14343A` | Strong headings, dark surfaces |
| `--color-seaglass-100` | `#E7F3F0` | Soft selected surfaces, quiet highlights |
| `--color-seaglass-400` | `#8FCFC4` | Limited decorative accent |
| `--color-sand-100` | `#F7F2E8` | Warm section backdrop |
| `--color-sand-400` | `#E8B96A` | Tiny playful accents, never critical body text |
| `--color-canvas` | `#FCFBF8` | Warm site canvas |
| `--color-white` | `#FFFFFF` | Primary surfaces |
| `--color-text` | `#1C3034` | Primary copy |
| `--color-secondary` | `#526368` | Supporting copy |
| `--color-muted` | `#6B7A7D` | Metadata with contrast check |
| `--color-divider` | `#E7E9E6` | Necessary separation only |
| `--color-danger` | `#B43D3D` | Destructive/error states |
| `--color-focus` | `#176F7B` | Visible focus outline |

**Color allocation:** approximately 70% light neutrals, 20% ocean/ink, 10% warm/sea-glass accents and photography-driven colors. The resort photos should supply most of the visual excitement. Avoid a solid teal background behind every section and avoid uniform white-on-gray cards everywhere.

### Typography

- **Inter**: UI, body, buttons, navigation, prices, tables, numbers.
- **Fraunces**: selected public/editorial headings and distinctive feature moments. Never use it for form labels, analytics, data tables or status text.
- Optional fallback: system sans / Georgia if web fonts fail. Avoid downloading new font families without a strong reason.
- Display heading: `clamp(40px, 5vw, 72px)`, 1.05–1.12 line height; section heading: `clamp(28px, 3vw, 42px)`; listing title 22–28px; body 16px/1.55; secondary 14px/1.45; metadata 12–13px only when accessible.
- Admin page titles 26–32px; table text 13–14px with sensible row height; financial numbers use `font-variant-numeric: tabular-nums`.
- Keep marketing paragraphs to ~65 characters per line. Do not fill empty space with extra paragraphs.
- Sentence case by default. No all-caps eyebrow above every heading, no giant gradient text, no gratuitous letter spacing.

### Layout, spacing and surfaces

- 4px spacing grid: `4, 8, 12, 16, 20, 24, 32, 40, 48, 64, 80, 96`.
- Public max-width: **1240–1320px** with responsive side padding **20px mobile / 32px tablet / 48px desktop**. Booking detail reading column ~640–760px.
- Admin max-width may be wider for tables; preserve useful density and sticky table headers.
- Radii: inputs **10–12px**; primary buttons **12px**; image/listing containers **16–20px**; major modal **20px**. Fully rounded pills only for functional chips/filters, never everywhere.
- Elevation: flat for most content; light shadow on raised booking summary, menus and dialogs. Prefer spacing, surface contrast and typography over borders.
- Use dividers sparingly between real sections and rows; **do not outline every card**.
- Main buttons 44–48px tall; touch targets at least 44×44px; form controls 44–52px tall.

### Interaction feel

- Fast, natural transitions: 140–220ms for hover/press; 220–320ms for drawers/dialogs. Use easing that feels smooth, not springy everywhere.
- Listing images: optional 1.02–1.04 scale on hover; never jump layout.
- Button press: subtle color/scale response. Selected date and filters: instant visual confirmation.
- Respect `prefers-reduced-motion`; no scroll-jacking, auto-playing loud videos or distracting continuous animation.
- Every interaction needs a clear focus, hover, pressed, disabled, loading, success and error state.

---

## 04 — Composition rules: remove AI-generated design clichés

**Prohibited default patterns:**

- Hero with tiny eyebrow + giant vague slogan + two generic CTA buttons + three stat cards.
- Endless three-across cards with identical icon circles and shadows.
- Every section as a rounded white container on gray.
- Gradient blobs, glassmorphism, neon glows, floating emoji, meaningless geometric decoration.
- Fake review quotes, fabricated guest statistics, placeholder resort pictures presented as real.
- Generic section labels like “Experience Excellence” or “Our Amazing Features.”
- Random extra feature suggestions that do not exist in the backend.
- All content centered, all buttons pill-shaped, oversized blank spaces, overly thin type.

**Required composition variety:**

- A photography-led opening, not a dashboard-style hero.
- Accommodation browsing with **image-led listing tiles**, varied but orderly, not generic icon cards.
- Editorial photo/text split for About, with actual resort facts.
- Compact amenity list using icons only where they improve scanning.
- A visually clear four-step booking explainer (timeline/numbered flow) rather than four cards.
- Events as occasion-driven photo sections or clean package comparisons.
- Reviews as readable real feedback with attribution when permitted, not fabricated quote carousels.
- Operational pages as tables, calendars, split views, drawers, and focused forms — not card galleries.

**Rule:** For every new component ask: *Is this a place to look, choose, compare, complete a task, or monitor operations?* Choose its layout accordingly.

---

## 05 — Public landing page: exact visual blueprint

### 5.1 Global header

**Desktop:** height around 76–84px; Balai wordmark left; center/right navigation: **Stay, Cottages, Events, Gallery, Contact**; prominent but compact **Check availability** action; account access at far right. Use a warm white background with minimal divider. On scroll, maintain readable contrast and subtle elevation. Do not force a generic search bar into every state.

**Mobile:** compact logo + menu + visible **Book** entry. Use an accessible menu sheet with full-size targets. No six tiny header links.

### 5.2 Hero — resort first, booking second

Use the real beachfront/gazebo hero photograph. Desktop hero should feel immersive: approx 540–680px tall, panoramic crop, subject-aware positioning. Prefer a real photo with natural light and a subtle directional overlay only if text sits on top. On mobile, crop intentionally; do not shrink the entire desktop image into a letterbox.

Content: resort name, concise real location, one human headline such as **“Make room for a beach day.”** Keep **“Your Home Away From Home”** as supporting brand copy where appropriate. One obvious **Explore stays / Check availability** action. Avoid repeating the same CTA four times in the hero.

**Booking search dock:** on desktop, a calm elevated white search module overlapping the bottom of the hero *only if it fits*. Controls: **What are you booking?** (Stay / Cottage / Venue / Event), date(s), guests (where relevant), **Check availability**. Changing type must change date/time inputs appropriately. On mobile, use a clean vertical search sheet or stacked controls below the photo, not six compressed pills.

### 5.3 Accommodation discovery

Heading: **“Find your spot by the sea”** or similarly natural copy. Optional small category tabs: **Rooms / Cottages / Venue / Packages**. Show only real inventory. Each listing tile should feature:

- Large real photo (roughly 4:3), with careful crop and restrained 16px corners.
- Clear title, guest capacity, meaningful features actually recorded, and **₱ amount with correct unit**.
- Availability CTA or detail link; no misleading “Instant book” label.
- Hover: gentle image scale; keyboard focus visible; entire listing navigation intuitive.
- Missing photos: designed neutral placeholder labeled **“Photos coming soon”**, not an unrelated stock image.

Desktop: two or three columns depending on content and image quality. Tablet: two. Mobile: one or horizontally scrollable curated row with accessible controls — never tiny 3-up thumbnails.

### 5.4 Resort story and gallery

Editorial layout: one strong real image + one concise story block; no giant text wall. Gallery should have a thoughtful mosaic: one dominant photo plus smaller supporting photos, with **View all photos**. Modal/gallery: swipe on mobile, arrows on desktop, image count, captions where available, keyboard and Escape support. Never stretch a low-resolution photo.

### 5.5 Event packages

Lead with occasions: **Birthdays, Weddings, Debuts, Meetings, Corporate events** when real packages exist. Show packages with capacity, verified inclusions, price and relevant add-ons. Use **comparison rows or editorial tiles**, not a repetitive six-card marketing grid. One clear **See package details / Ask a question** action. Show “starting at” only when it is factually true.

### 5.6 Amenities, booking process, reviews, contact

- **Amenities:** compact grouped list (comfort, facilities, event essentials) only after confirming actual availability. No 12 giant feature cards.
- **How booking works:** four readable stages: choose → dates/details → contact → payment instructions; then clearly explain **upload proof and wait for staff verification**. Do not imply automatic payment capture.
- **Guest reviews:** only feedback that is rated ≥4 and public, with truthful review metadata; otherwise show no fabricated social proof.
- **Contact:** real address in Gloria, Oriental Mindoro; only verified phone/email; clear directions/map entry and policies. Footer should be useful and visually grounded, not stuffed with marketing links.

---

## 06 — Listing detail pages: Airbnb-caliber decision support

Use one consistent detail template for room, cottage, venue and package, with type-specific fields.

**Desktop information architecture:**

1. Breadcrumb / back to browsing.
2. Name + type + location context.
3. Large photo gallery mosaic with **Show all photos**.
4. Main two-column region: **left = what you get, capacity, details, inclusions, rules, availability, policies**; **right = sticky booking summary panel**.
5. Real related offerings at bottom (if useful).

**Sticky booking panel:** current price and unit; selected dates/times; guest count where relevant; nights or flat-rate explanation; add-ons if supported; calculated total; downpayment; clear **Check availability / Reserve** action. The sticky panel must stop before footer and never obscure content. No fake scarcity messages.

**Mobile:** photo gallery first; name, price and essentials next; bottom sticky bar with **total / price context** and **Reserve**. Tap to open a focused booking sheet or flow. Do not keep a full desktop sidebar on mobile.

**Type-specific rules:** rooms require check-in/out and nights; cottage/venue/event require the supported date + time range; package add-ons display per-item pricing. Show precise capacity and price basis. When information is missing, omit unsupported claims and expose a contact action.

---

## 07 — Booking wizard: beautiful, calm, precise

Preserve the existing **four steps**:

1. **What to book** — type and actual item.
2. **Dates & details** — room nights vs cottage/venue/event date + time; guest count; requests; optional add-ons.
3. **Guest information** — mobile number with Philippine formats and clear validation.
4. **Payment method** — GCash, Maya, bank transfer; actual configured account details and QR; terms.

**Desktop:** 65/35 split: focused step form on left, stable summary on right. Progress shown as **Step 2 of 4** with a thin progress indicator and descriptive label, not four giant numbered circles. Form sections grouped by meaning; one primary action at a time; back is quiet but visible.

**Mobile:** full-width wizard; persistent small price summary with expand/collapse; next action pinned above safe area where helpful; no full-screen wall of form fields. Preserve entered data when navigating backward.

**Date picker:** selected start/end dates unmistakable; booked dates unavailable; distinguish blocked vs selectable with text/legend; correct time ranges; clear errors for conflicts and past dates. Preserve the required error phrasing **“Please select <date> onward.”** Use local Philippine date conventions consistently.

**Price breakdown:** show base rate × nights where relevant, add-ons, total, downpayment due, remaining balance and payment instructions. Totals must come from actual server logic; never independently recalculate with divergent assumptions.

**Payment step:** explain that payment is completed externally and proof is submitted afterward; do not display **Payment successful** before verification. Show payment QR in a useful size; copyable account number; upload guidance and file state; distinguish **proof submitted**, **under review**, **verified**, **rejected**.

**Success screen:** booking reference `BK-YYYY-NNNN`, accurate status **Pending**, next action, where to view booking, and QR availability as supported. No false promise of immediate confirmation.

---

## 08 — Guest portal: travel companion, not an admin dashboard

Use the same visual DNA but prioritize **upcoming stays and next actions** over statistics.

### Portal home

Top: warm greeting + one clear primary action **Book another stay**. If there is an upcoming booking, show a featured **trip summary** with photo, dates, booking reference, status and next required action. If not, show a graceful empty state with real accommodation discovery. Avoid fake metric cards such as “4 destinations explored.”

Below: **Your reservations**, **Explore accommodations**, **Messages/inquiries**, useful contact details. Show compact counts only when operationally useful.

### My reservations

Tabs/filters for upcoming, active, past/cancelled where supported. Reservation rows/tiles show actual item, dates, amount, payment status and action. Booking detail is a clear timeline: **Booked → Payment proof → Verified → Check-in → Completed** with branching states for hold/cancel/refund. Do not misrepresent states as a single guaranteed linear sequence.

### Payment and check-in

Payment instructions and proof upload deserve their own focused section. Make **amount paid / balance due / required downpayment** visually distinct. QR code should be large, high contrast, downloadable or displayable if supported, and accompanied by a note that **staff scan and confirm it**. Avoid QR styling that hurts scan reliability.

### Notifications, inquiries and profile

Readable inbox-style lists; meaningful unread state; human timestamps; reply context. Profile forms with consistent field labels, validation, password visibility toggle. Destructive actions require confirmation and an explanation of consequences.

---

## 09 — Back office: hospitality operations, not decorative analytics

**Same brand, different density.** The admin should feel like the operational side of the same resort, not a separate generic dashboard template. Use Inter, shared tokens and status colors; less Fraunces and fewer decorative photos.

### Shell

Desktop left navigation: compact, stable, grouped exactly by existing domains (**Dashboard; Bookings; Accommodations; Events; Inventory; CRM; Management**), with current route strongly indicated. Collapsible sidebar is allowed. Top bar: page title, useful contextual actions, notifications, account. No duplicate breadcrumb + title + subtitle + giant welcome banner on every page.

Tablet: compact navigation; mobile: accessible drawer and task-focused layouts. Avoid impossible wide tables squeezed into phone width.

### Dashboard

**Daily default:** date switcher with prev/today/next; primary revenue collected and payment count; compact operational metrics (new bookings, check-ins, check-outs, refunds); **today’s payments table** and **payment method breakdown**; bookings made that day. Use one clear large metric, several quiet inline metrics, and substantial useful tables/charts — not six identical cards.

**Monthly:** year selector; Jan–Dec booking bar chart with **clickable months** and drill-down showing daily sales, methods, statuses and booking list. **Yearly:** bookings and sales from 2026 onward plus cancelled/rejected counts. **Accommodation graph:** bookings by room/cottage/venue/package for the chosen period. **Right now** operational queue: pending bookings, inquiries, payment proofs, upcoming events, inventory alerts, availability counts.

Chart design: legible labels, subtle gridlines, accessible colors, meaningful tooltips, no gratuitous gradients or 3D charts. Never generate placeholder analytics.

### Reservations and calendar

Reservation list: strong search; filters by status/type/date; sensible table columns (reference, guest, item, dates, amount, payment, status, action). Sticky table header on desktop; row click opens detailed view; bulk actions only when truly supported. Status shown with **text + subtle tint**; not a rainbow of giant pills.

Detail screen: split into **booking facts**, **guest**, **payment ledger**, **status history**, **internal notes**, and **contextual actions**. Surface dangerous actions carefully: reschedule, hold/resume, override amount/balance, reject proof, refund. Keep an audit trail visible.

Calendar: readable day/week/month controls where supported, status legend, room/resource grouping where useful, distinguish **Pencil Booking** and **On Hold**, and ensure both block dates. On mobile use a day agenda/list rather than a microscopic month grid. Always prevent booking conflicts via existing server validation.

### Walk-in form

Design as a focused front-desk workflow with clear sections: customer → type/item → date/time → amount/payment → notes/status. Cash default, Walk In fixed source, no guest cap, editable total with a clear indication of override, optional payment. Preserve all existing behavior. Optimize keyboard navigation and error recovery.

### Payments, refunds, inventory, CRM and settings

- **Payments:** review queue with proof preview, amount/reference, OCR mismatch warning where available, verify/reject controls and clear confirmation. Never infer OCR is infallible.
- **Refunds:** decision history, payout method, proof and reference, explicit approve/decline controls.
- **Inventory:** dense list, stock and adjustment history, quick add/remove/damaged/repaired actions with validation and confirmation; deactivation not deletion.
- **Customers/inquiries:** readable customer activity timeline and inbox-style reply/assignment views.
- **Catalogue:** real image management, price/capacity/status, preview of guest-facing listing; missing-photo prompts are informative, not fabricated.
- **Settings:** clear tabs for Payment, General, Booking, Landing Page; photo upload previews, sensitive payment detail handling, save feedback and unsaved-change protection.

---

## 10 — Component specifications

### Buttons

- Primary: ocean background, white label, 12px radius, 44–48px height, medium weight; hover darkens slightly.
- Secondary: neutral surface with subtle outline or quiet fill, no huge shadows.
- Tertiary: text action with proper hover/focus treatment.
- Destructive: explicit red with confirmation; do not make every red action visually dominant.
- One dominant CTA per section/form. Disable only when necessary; explain why.

### Inputs and selectors

- Labels **above** fields, not placeholders as the only label.
- Inline help under complex inputs, concise errors directly under fields.
- Date/guest selectors must work with keyboard, mouse and touch.
- Dropdowns have clear selected state; no custom dropdown when native select is better.
- Phone numbers support `09XXXXXXXXX` and `+639…` as existing rules permit.

### Cards and imagery

- A **listing tile** is photo-led, not an admin stat card.
- A **reservation tile** is task-led, with state and action.
- An **admin metric** may be a quiet text block without a container.
- A **booking summary** is an elevated sticky surface because it anchors a transaction.
- Never reuse one card component for every purpose merely for consistency.

### Status language

| State | Visual cue | Notes |
|---|---|---|
| Pending | amber | waiting for next action |
| Pencil Booking | purple | tentative, still blocks dates |
| On Hold | slate | paused, still blocks dates |
| Awaiting payment | orange | payment action needed |
| Confirmed | teal/green | confirmed booking |
| Checked in | blue | currently on site |
| Completed | gray | finished |
| Cancelled / Rejected / No show | red family | distinct text labels |

Payment statuses: **Unpaid, Partially paid, Fully paid, Refunded**. Use words and not color alone. Preserve existing status transitions; UI must not invent a new workflow.

### Empty, loading, error and success states

- Skeletons resemble actual final content; avoid full-page shimmer.
- Empty states give the next sensible action and do not shame the user.
- Failed network calls show retry, preserve input and do not silently reset forms.
- Success confirmations state exactly what happened: **“Payment proof submitted for review”**, not **“Payment completed”**.
- Toasts are short and accessible; irreversible decisions use confirmation dialogs.

---

## 11 — Responsive rules and real-device quality

| Viewport | Design strategy |
|---|---|
| Small phone (320–390px) | Single-column content, comfortable touch, short titles, sticky booking action, no sideways overflow |
| Large phone (391–600px) | Better photo ratios, grouped fields when appropriate, bottom booking summary |
| Tablet (601–1023px) | Two-column listings, compact header, adaptive booking form, drawer navigation for admin |
| Desktop (1024–1439px) | Full editorial layouts, listing grids, two-column details, sticky summaries |
| Wide desktop (1440px+) | Constrain marketing text and imagery; allow useful table width in admin; avoid stretched empty compositions |

**Mobile-specific requirements:** safe-area padding, 44px touch targets, sticky CTA never covers content, sensible virtual keyboard behavior, horizontal galleries that do not hijack vertical scrolling, and date pickers usable with thumbs. Test landscape and 200% text zoom.

**Accessibility:** WCAG 2.2 AA as target, minimum 4.5:1 normal text contrast, visible keyboard focus, semantic headings, descriptive alt text for real images, accessible dialog focus trap and Escape, logical tab order, status text, screen-reader feedback for form errors and async state. Never remove focus outlines for aesthetics.

**Performance:** responsive images (`srcset`, sizes), lazy-load below-fold photos, preload critical hero only when beneficial, stable image aspect ratios to prevent CLS, defer heavy galleries/charts, avoid huge animation libraries for tiny effects. Keep interactions responsive on mid-range Android devices and slower Philippine mobile connections.

---

## 12 — Copywriting and content rules

Tone: **welcoming, straightforward, human, locally grounded**. Short helpful sentences, no corporate superlatives. Examples:

- Good: **“Choose your dates to see what’s available.”**
- Good: **“Pay through GCash, Maya or bank transfer, then upload your receipt for verification.”**
- Good: **“This cottage is booked for the selected time.”**
- Avoid: **“Unlock unforgettable luxury experiences today.”**
- Avoid: **“Instantly confirmed!”** when staff verification is required.

Verify content against actual data. Existing phone/email and bank placeholders must not be displayed as real contact/payment details. Confirm amenities and avoid claiming 300-person venue capacity when the catalogue says 200. Avoid creating an invented local history or location-distance claims.

---

## 13 — Technical implementation approach for the existing stack

Current stack: **Node/Express, `.xian` server-rendered templates (EJS-like), Bootstrap 5, Font Awesome, Chart.js, FullCalendar, MySQL 8**. Keep it unless a stack change is explicitly approved. Do not force a React rewrite just to improve appearance.

1. **Audit:** inventory all templates, partials, routes, stylesheets, scripts, current assets and responsive breakpoints. Identify repeated components and design inconsistencies. Capture before screenshots for public, guest and admin pages.
2. **Token foundation:** define shared CSS variables, type scales, spacing, radii, colors, focus and interaction states. Prefer one canonical component stylesheet plus page-specific modules. Reduce conflicting Bootstrap overrides rather than accumulating `!important` patches.
3. **Shared components:** update header, footer, buttons, form controls, listings, status treatment, modals, tables, navigation and toasts. Preserve existing IDs/names/events needed by JS and server templates.
4. **Public:** redesign hero, availability search, catalogue, galleries, package sections, policies and contact.
5. **Guest:** redesign catalogue detail, booking wizard, reservations, proof upload, QR, inquiries, notifications and profile.
6. **Admin:** redesign shell, daily/monthly/yearly dashboard, lists, detail pages, calendar, walk-in workflow, payments/refunds, inventory, CRM, reports and settings.
7. **Validate:** visual QA at 360, 390, 768, 1024, 1280 and 1440px; keyboard-only checks; real mobile touch; dark/light photo contrast; empty/error/loading cases; cross-role permission tests.
8. **Regression:** run all existing automated checks (previous rebuild brief mentions 61 checks) and add coverage for UI-affecting booking/payment workflows. Fix failures before marking done.

**Agent operating rules:** implement page by page; inspect before changing; use actual data; do not delete features because a new layout is cleaner; do not make unrelated refactors; no fake demo screens; do not leave dead buttons; preserve server-side permission checks; verify before/after screenshots; report files changed, flows tested, known gaps.

---

## 14 — Acceptance checklist: visual quality AND functional safety

### Visual

- [ ] Public pages look like a distinctive beachfront hospitality brand, not a generic SaaS landing page.
- [ ] Public imagery is prominent, authentic, properly cropped and responsive.
- [ ] Layouts vary purposefully; there is no endless identical-card grid.
- [ ] Design is warm and playful in subtle ways, never boring, childish or cluttered.
- [ ] Buttons, controls, spacing, typography and status language are consistent across all three areas.
- [ ] Booking price and next action are immediately obvious on phone and desktop.
- [ ] Admin screens are fast to scan, with dense tables and clearly prioritized actions.
- [ ] No fabricated content or unsupported amenity, price, review or confirmation claim.

### Functional

- [ ] Live prices and `downpayment_percent` propagate to all guest-facing views and chatbot.
- [ ] Room nights vs cottage/venue/package flat-rate pricing is correct.
- [ ] All booking statuses, holds, pencil bookings, blocked dates and conflict checks remain intact.
- [ ] Guest booking still follows four steps and does not offer cash.
- [ ] Proof upload, OCR warning, staff verification/rejection, notifications and balances work.
- [ ] Walk-ins retain fixed source, cash default, no guest cap, editable totals and all date/time fields.
- [ ] QR check-in remains staff-only, single-use and expires according to existing rules.
- [ ] Refund requests, approvals, payout details, audit logs and status histories remain intact.
- [ ] Daily, clickable Monthly (Jan–Dec), Yearly (2026+) and Accommodation analytics work.
- [ ] Inventory history, deactivation behavior, catalogue editing, image uploads and exports work.
- [ ] Guests cannot access staff/admin routes, even by direct URL.
- [ ] Keyboard, mobile, loading, error and empty states are tested.

---

## 15 — Direct execution prompt for Claude Code

> Read this entire file and inspect the Balai-Reserve repository before editing. Perform a **complete system-wide visual and UX overhaul** inspired by Airbnb's quality of hospitality browsing, photographic storytelling, playful warmth, precise booking controls and mobile polish — **without cloning Airbnb**. Preserve the resort's own ocean/sea-glass/sand identity and all existing business logic. Build one coherent design system across public pages, guest portal and back office, adapting layout density to each audience. Replace generic AI-template patterns (repeated cards, meaningless badges, excessive outlines, generic slogans, empty hero sections) with authentic photo-led discovery, purposeful editorial compositions, usable booking summaries, operational tables, responsive calendars and well-crafted interactions. Do not flatten the experience into boring minimalism: add tasteful personality, tactility and motion where it improves clarity. Use only real resort content and live data. Implement iteratively, test every existing workflow and responsive breakpoint, and deliver a polished, production-ready result rather than mockups.
