# BALAI-RESERVE — UI/UX DESIGN GUIDELINES

> **Purpose:** A practical design direction and implementation standard for redesigning the existing Balai-Reserve website. This is **not** permission to rebuild business logic. Preserve the working site, routes, data, validations, permissions, and booking rules while elevating its visual design and usability.

## 1. Creative direction

**Concept: Quiet coastal hospitality, operational clarity.** Balai-Reserve is a real beachfront resort in Brgy. San Antonio, Gloria, Oriental Mindoro. Its interface should feel like a thoughtfully designed boutique hospitality brand: warm, welcoming, credible, and easy to book. The back office should feel like a serious, efficient reservation-management product—not a marketing landing page.

The design should be recognizable as **Balai-Reserve**, not a generic AI-generated resort template. Take principles from strong hospitality products (clear booking paths, beautiful photography, careful typography, predictable interactions), not their exact page structures.

**Three modes, one identity:**
- **Public:** editorial, photographic, calm, aspirational but honest.
- **Guest portal:** friendly, task-focused, confidence-building, minimal friction.
- **Admin/staff:** information-dense, fast, structured, precise.

Use shared typography, colors, spacing, controls, icons, and interaction patterns across all three; allow the composition and density to differ by context.

## 2. Non-negotiable anti-generic rules

1. **Do not build everything from cards.** A card is for an actual independent object or interaction, not every paragraph, metric, icon, and section. Use open layouts, columns, photography, tables, dividers, and typographic hierarchy instead.
2. **Do not use the standard AI landing-page formula:** eyebrow label → oversized gradient heading → two buttons → three icon cards → another grid of cards → decorative CTA.
3. **No meaningless badges, pills, gradients, glassmorphism, floating orbs, abstract blobs, oversized shadows, glowing buttons, or decorative icons.** Use pills only when functionally appropriate, such as a compact filter or status.
4. **No unnecessary borders or outlines around every container.** Use whitespace, alignment, background contrast, and restrained separators. Preserve accessible keyboard focus outlines.
5. **No fabricated resort claims, ratings, reviews, amenities, photos, availability, counters, or testimonials.** Show only confirmed information and live records.
6. **No repetitive generic headings:** avoid “Experience Paradise,” “Discover Luxury,” “Unforgettable Memories,” etc. Write specific, grounded copy.
7. **No oversized empty hero sections or excessive vertical padding.** Every viewport should reveal meaningful information.
8. **No icon-only controls when the action is unclear.** Prefer familiar labels, especially for booking and payment.
9. **No redesign that makes the existing system harder to use.** Clarity and task completion outrank visual novelty.
10. **No fake sophistication.** Good design comes from photography, composition, typography, spacing, responsive behavior, and excellent interaction states.

## 3. Brand foundations

### Color

Retain and refine the existing palette instead of inventing an unrelated theme:

| Token | Suggested value | Use |
|---|---|---|
| Deep sea | `#0F5C66` | Main brand action, active links, selective highlights |
| Ink teal | `#0F2A30` | Headings, sidebar, strong text |
| Sea glass | `#8FCFC4` | Subtle accent, selected surfaces |
| Sand | `#E8B96A` | Small warm highlights; never blanket every CTA |
| Warm canvas | `#FAF9F6` | Public/portal page background |
| White | `#FFFFFF` | Content surfaces and form fields |
| Body ink | `#26383A` | Main readable text |
| Secondary ink | `#627174` | Metadata and supporting text |
| Hairline | `#E5E9E7` | Necessary table separators and section rules |

These are **starting tokens**, not an instruction to recolor every existing component. Check actual contrast before shipping. Avoid using sea-glass or sand as text colors on white when contrast is insufficient. Use a stronger teal for text/buttons when needed.

**Distribution:** neutral backgrounds dominate; teal anchors navigation and primary actions; sand is a rare accent. Do not use multiple strong accents in the same region.

### Typography

- **Display/editorial headings:** Fraunces, restrained and mostly on public-facing hospitality sections.
- **UI, forms, prices, navigation, data, tables:** Inter.
- Do not apply Fraunces to dashboard tables, tiny labels, buttons, or dense controls.
- Suggested desktop scale: display 48–64px, section headings 30–40px, page titles 28–34px, subsection headings 20–24px, body 15–17px, metadata 12–14px.
- Mobile display headings should scale down to roughly 34–44px without awkward wrapping.
- Use sentence case, strong weight hierarchy, readable line height, and consistent numerals for prices and financial data.
- Avoid overusing ALL CAPS, letter spacing, italic decorative words, or tiny eyebrow headings.

### Spacing, radius, elevation

- Use a consistent 4/8px spacing rhythm: 4, 8, 12, 16, 24, 32, 48, 64, 80.
- Public content max-width around 1180–1280px; editorial text width around 620–760px.
- Dashboard may use a wider fluid workspace; do not force narrow marketing-style content widths.
- Controls: usually 8–10px radius. Images/content surfaces: roughly 10–16px where needed. Do not round everything into pills.
- Shadows only for actual elevation (popover, modal, sticky overlay), not every item.
- Avoid hardcoded one-off spacing and radius values; use shared CSS variables/tokens.

### Photography

Photography is the strongest design asset. Prioritize authentic beachfront, room, cottage, pool, pavilion, and event images from the resort.

- Use wide, well-cropped imagery for storytelling; use consistent aspect ratios for comparable catalogue items.
- Keep the subject visible on mobile with responsive cropping and focal-position controls where possible.
- Provide genuine image galleries, not a row of decorative placeholders.
- When a listing has no real photo, show a quiet, honest **“Photos coming soon”** state—not a stock beach or invented image.
- Optimize images, serve responsive sizes, lazy-load below the fold, and prevent layout shift.
- Apply image overlays only when necessary for legible text; never darken everything by default.

## 4. Public website — hospitality-first composition

### Header

Create a restrained header with clear logo/wordmark, essential navigation, and one obvious **Check availability / Book now** action. It should feel like a real resort site, not a SaaS product. On mobile, use an accessible menu with readable tap targets; do not squeeze the desktop navigation into tiny links.

### Hero

Make the real beachfront image the focus. Pair it with a short, specific introduction and the tagline **“Your Home Away From Home.”** The booking action should be immediately understandable. Integrate a compact availability entry (dates, booking category, guests where relevant) if it can use real availability; otherwise show a clear route to the booking flow. Avoid multiple competing CTAs, fake availability, decorative floating cards, and giant empty space.

### Page composition

Use varied visual rhythms instead of identical card grids:

1. **Introduction/About:** asymmetric photo + concise, grounded text.
2. **Stay and spaces:** large image-led room/cottage/venue previews with name, capacity, actual price, unit (`/night` or `/booking`), and clear detail/booking action.
3. **Events/packages:** a different composition from room cards—e.g., editorial imagery plus a readable comparison/list of package inclusions and prices.
4. **Amenities:** a compact typographic list with restrained icons only when useful; publish only verified amenities.
5. **How booking works:** four clear steps, shown as a sequence/timeline rather than four large matching cards.
6. **Guest feedback:** real, public, qualifying reviews only; if none exist, omit the section or show an honest empty state.
7. **Location/contact:** actual resort location, map context, verified contact details, useful arrival information.
8. **Footer:** concise navigation, address, policies, and contact—not a second landing page.

Do not treat this order as an immutable template. Refine based on the real content and visitor priorities. Vary section scale, photo placement, and background only when it improves comprehension.

### Copywriting

Write in a welcoming, clear, locally grounded tone. Prefer **“Casa Deluxe Room · Sleeps 4 · ₱3,800/night”** over vague superlatives. Distinguish a **flat-rate cottage booking** from a **per-night room**. Do not imply instant booking confirmation, free cancellation, or guaranteed amenities unless those claims are true.

## 5. Guest portal — make booking effortless

The portal is a booking tool, not a second promotional homepage. Its visual priority is: **find a place → choose dates → understand total and downpayment → submit → track payment and stay**.

### Portal home

- Show the next relevant action first: continue a booking, complete a payment, view an upcoming reservation, or browse accommodations.
- Use real booking data and meaningful states; avoid fake “available count” stats or rows of decorative dashboard cards.
- Keep accommodation discovery visually attractive but compact and easy to scan.

### Catalogue and detail

- Clear tabs or navigation for **Rooms, Cottages, Venues, Event Packages**.
- Show real photos, capacity, availability context, full pricing unit, inclusions, and a primary booking action.
- Make filters useful and few; avoid chip overload.
- Use clear empty/loading/error states and no fabricated data.

### Four-step booking wizard

Preserve exactly the four business stages:

1. **What to book:** Room, Cottage, Venue, Event package.
2. **Dates & details:** appropriate dates and times, guests, requests, package add-ons.
3. **Guest information:** validated mobile number.
4. **Payment:** GCash, Maya, or bank transfer; payment details and terms.

Design rules:

- Use a readable progress indicator showing current step and completion; not four giant boxed tiles.
- Show only relevant fields at each step; reveal type-specific inputs progressively.
- Display a persistent, accurate **booking summary** on desktop; on mobile use a compact expandable summary or anchored total.
- Surface **total price, required downpayment (currently setting-driven, 50%), and balance** clearly before submission. Do not hardcode 50% into UI logic.
- Room cost = live nightly rate × nights. Cottage/venue/package rates are flat per booking, with package add-ons when applicable.
- Make date conflicts and validation errors understandable and close to the relevant field.
- Preserve form entries when moving backward; do not wipe data on minor errors.
- Use descriptive actions: **Continue to dates**, **Review payment**, **Submit booking**.
- Avoid implying the booking is confirmed immediately: online bookings begin **Pending**, with payment proof and verification steps.

### Payments and booking details

- Separate **reservation status** from **payment status** visibly; never conflate Pending with Unpaid.
- Give GCash, Maya, and bank transfer each a clear payment-method presentation with verified account details and QR images from settings.
- Make copying account numbers easy. Explain that payment is completed externally and the guest must upload proof for review.
- Clearly show amount due, amount paid, remaining balance, reference number, and proof upload status.
- Explain rejection with actionable next steps without exposing internal OCR or audit details unnecessarily.
- Make the check-in QR prominent when relevant, but clarify **only staff can confirm check-in**.
- Show cancellation/refund options only when permitted; display actual policy and request state.

### Notifications, inquiries, profile

Use straightforward lists, timestamps, unread indicators, clear reply threads, and standard editable forms. Do not make every notification a full-size card. Provide visible success and error feedback.

## 6. Admin/staff back office — designed for daily operations

**Goal:** staff should complete common tasks with fewer clicks, less scrolling, and fewer mistakes. This area can be visually denser than the public site while retaining the same brand tokens.

### Shell and navigation

- Use the existing grouped left sidebar: Dashboard; Bookings; Accommodations; Events; Inventory; CRM; Management.
- Keep group labels readable, active item unmistakable, and nested pages discoverable.
- Use the deep teal carefully; do not create a visually heavy full-screen dark dashboard.
- On smaller screens, provide a usable collapsible drawer; do not reduce labels to mysterious icons.
- Keep page title, primary action, search/filter, and table aligned in a consistent working layout.
- Respect staff vs admin permissions; do not show controls users cannot use.

### Dashboard

Preserve **Daily (default), Monthly, Yearly**, and **Accommodation** views and all drill-down behavior.

- **Daily:** date navigation, sales collected, payments, refunds, new bookings, check-ins/check-outs, payment method breakdown, payment ledger, bookings created that day.
- **Monthly:** January–December booking bar chart; each month remains clickable and opens month-level sales, methods, statuses, and bookings.
- **Yearly:** sales/bookings from 2026 onward, including cancelled/rejected counts.
- **Accommodation:** booking activity per room, cottage, venue, and package.
- **Right now:** pending reservations, inquiries, pending payments, upcoming events, inventory alerts, availability.

**Composition:** use one clear page header and period switcher; a restrained KPI strip; a dominant chart or transaction table; a compact operational priority panel. Do not place every number inside an oversized identical rounded card. Make dates, currency, axes, legends, and chart interactions obvious. Use real database records and meaningful empty states.

### Tables and management pages

- Use compact but breathable data tables with clear column alignment, readable row density, stable headings, search, filters, and pagination where needed.
- Prefer text-based row actions and a contextual menu for secondary actions; avoid six colorful buttons in each row.
- Keep critical booking reference, guest, dates, type, status, payment status, and amount visible.
- Right-align money, use consistent ₱ formatting, and display dates/times in Philippine local time.
- Avoid horizontal scrolling on desktop where reasonable; on mobile, use purpose-built record summaries rather than shrinking 10 columns.
- Make create/edit forms logical, grouped, and easy to validate. Keep internal notes clearly separate from guest special requests.

### Reservation detail

Treat this as a staff **workspace**, not a collection of unrelated cards. Recommended hierarchy:

1. Booking reference, status, primary next action.
2. Guest and stay/event details.
3. Amounts: total, downpayment, paid, balance.
4. Payment evidence and verification controls.
5. Timeline/status history and internal notes.
6. Secondary actions: hold/resume, reschedule, cancel, check-in/out, balance collection.

Use confirmation dialogs for destructive or consequential actions; show what will change before committing. Do not hide critical operations behind ambiguous icons.

### Calendar

Keep FullCalendar behavior and all status/date-blocking rules. Use clear status colors **plus text/labels**, not color alone. Make overlap, time ranges, tentative bookings, and on-hold reservations understandable. Mobile calendar must support an agenda/list view if the month grid becomes unreadable.

### Inventory, CRM, inquiries, reports, settings

- Inventory: visible quantities, low-stock/alert states, adjustment type and history, safe validation.
- CRM: easy customer lookup and readable activity chronology.
- Inquiries/tickets: clear assignment, reply, resolution, escalation, and response history.
- Reports: straightforward date filters, trustworthy totals, and obvious Excel/Word/CSV exports.
- Settings: group Payment, General, Booking, Landing Page; use clear form sections, previews for uploaded images, and save confirmation.

## 7. Status system — meaningful, consistent, accessible

Keep the same meaning across dashboard, lists, details, calendar, notifications, and guest views:

| Reservation state | Color family |
|---|---|
| Pending | Amber |
| Pencil Booking | Purple |
| On Hold | Slate |
| Awaiting payment | Orange |
| Confirmed | Teal/green |
| Checked in | Blue |
| Completed | Gray |
| Cancelled / Rejected / No show | Red family; distinguish by text |

Payment states are a separate system: **Unpaid, Partially paid, Fully paid, Refunded**. Use readable labels and adequate contrast; color is supplementary, not the only cue. Reserve colored status chips for statuses; do not turn every metadata field into a badge.

## 8. Interaction and motion

- Aim for responsive, direct interactions; animations should clarify changes, not show off.
- Typical micro-interaction duration: about 120–220ms; avoid bouncing panels and theatrical entrance animations.
- Use skeletons only where they match the real content structure; prevent layout shift.
- Provide hover, pressed, disabled, loading, success, empty, and error states for meaningful controls.
- Make loading/submission states prevent accidental duplicate payments or reservations.
- Keep modals focused and keyboard-accessible; use full-screen or sheet patterns on narrow screens when appropriate.
- Respect reduced-motion preferences.

## 9. Responsive rules

Design and test **mobile first for guests**, **desktop efficiency first for staff**, and make both fully usable across breakpoints.

- Test approximately **360, 390, 768, 1024, 1280, 1440px** widths, plus real devices when available.
- No horizontal page overflow, tiny inputs, clipped buttons, overlapping text, or inaccessible popovers.
- Minimum comfortable tap target around **44×44px**.
- Public pages: responsive image crops, short navigation, clear booking CTA.
- Guest booking: one-column forms, accessible date/time pickers, sticky or expandable summary, visible progression.
- Admin: compact navigation drawer, priority actions, mobile-friendly record detail and calendar agenda.
- Avoid sticky elements covering form controls, mobile keyboards, or confirmation actions.
- Use safe-area padding where appropriate.

## 10. Accessibility and trust

- Meet WCAG 2.2 AA where practical: contrast, keyboard navigation, visible focus, labels, errors, logical headings, accessible dialogs, and screen-reader announcements for updates.
- Use semantic headings and real form labels, not placeholder-only fields.
- Never rely solely on color to communicate booking or payment status.
- Display accurate Philippine peso values and Philippine local dates/times.
- Protect payment proof images and private customer information; do not surface internal notes in guest views.
- Do not invent a phone number, email, bank account, amenity, or claim where the existing content is placeholder/unverified.
- Google sign-in must not look operational unless configured; do not promise email notifications that are not implemented.

## 11. Existing functionality that the redesign MUST preserve

The interface may change; the underlying behavior must not:

- All public, guest, staff, and admin routes and server-side role restrictions.
- Online four-stage booking; correct date/time and availability validation; no double-booking.
- Live catalogue prices across landing, portal, booking, and chatbot; settings-driven downpayment.
- GCash/Maya/bank-transfer online payment; proof upload and staff verification; no cash online.
- Walk-in booking for every type, **Walk In** source, default Cash, editable amount, unlimited guest count, dates and times.
- Reservation statuses including Pencil Booking and On Hold; held/pencil dates stay blocked; hold/resume/reschedule.
- Staff-only single-use QR check-in and expiration rules.
- Refund request/approval flow, payment collection, notifications, inquiries, inventory history, audit logs, exports.
- Daily/monthly/yearly dashboards and clickable month drill-down; accommodation graph.
- Admin-managed landing photos, catalogue content, payment details, policies, and settings.
- Accurate status history, internal notes, and required error wording (e.g., “Please select <date> onward.”).
- Existing automated checks (61 at the October 2026 snapshot) must continue passing; add UI regression checks.

## 12. Implementation instructions for the AI coding agent

**Do not immediately rewrite the entire frontend.** First inspect the actual codebase, existing views, components, styles, templates, assets, and workflows. Then implement systematically.

### Phase 1 — Audit

- Map all public, portal, and back-office screens and shared components.
- Identify duplicated styles, inconsistent button/input patterns, repetitive card grids, unnecessary copy, layout problems, and actual usability failures.
- Identify real available photos and content; note missing/unverified material.
- Inventory current booking/payment/calendar/status behavior and test coverage before touching UI.

### Phase 2 — Foundation

- Define shared CSS variables for colors, type, spacing, radius, borders, shadows, and interaction states.
- Consolidate common buttons, fields, typography, navigation, tables, dialogs, and status indicators.
- Work within the current **Node/Express + .xian templates + Bootstrap 5 + Font Awesome + Chart.js + FullCalendar** stack unless explicitly instructed otherwise. Avoid unnecessary framework migrations.
- Make the design feel custom by carefully styling and composing existing components, not by installing a large UI kit.

### Phase 3 — Redesign in priority order

1. Public header, hero, availability entry, and accommodation presentation.
2. Guest catalogue, booking wizard, price summary, payment instructions, reservation detail.
3. Back-office shell, dashboard, reservation list/detail, booking calendar.
4. Inventory, CRM, inquiries, reports, settings, auth, and smaller screens.
5. Responsive, accessibility, copy, empty/loading/error states, and polish.

At every stage, **preserve existing handlers, forms, routes, API calls, data bindings, and authorization**. If a proposed visual change risks breaking behavior, choose the safer design and document the tradeoff.

### Phase 4 — Validate

For every changed page:

- Check real content, no fabricated data, no broken photos.
- Check 360/390px mobile, tablet, and desktop layouts.
- Check keyboard and screen-reader basics, contrast, focus, and reduced motion.
- Check loading, no-data, invalid form, server-error, and success states.
- Check actual guest booking, staff verification, admin controls, calendar interactions, and navigation.
- Run the existing automated test suite and repair any regression.
- Inspect screenshots visually: **Does this look like a considered resort brand, or a collection of generic cards? Is the next action obvious?** Refine until both answers are satisfactory.

## 13. Definition of done

The redesign is complete only when:

- The site looks distinctly like a real, trustworthy Oriental Mindoro beachfront resort.
- Public, portal, and admin experiences share one coherent design system without becoming visually identical.
- Booking and payment tasks are easier to understand, not just prettier.
- Photography and useful content replace unnecessary decorative cards and generic copy.
- Staff can scan, search, verify, reschedule, and check guests in efficiently.
- Mobile experiences feel intentionally designed, not compressed desktop pages.
- Real data, prices, permissions, status rules, and operational features remain intact.
- No invented marketing claims, fake records, or nonfunctional UI are introduced.

**Final instruction:** Build a quiet, confident, content-led hospitality product. Every design choice should support the resort, the guest, or the staff workflow. If an element adds decoration without improving meaning or usability, remove it.
