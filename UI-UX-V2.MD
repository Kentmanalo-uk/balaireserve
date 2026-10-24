BALAI-RESERVE — UI/UX GUIDELINES V2
Airbnb-level usability, boutique beachfront resort identity
Implementation brief for Claude Code / the development team. Upgrade the EXISTING Balai-Reserve website's visual and interaction design. Do not rebuild or remove working business logic. The goal is the polish, discoverability, photographic storytelling, booking confidence, and mobile usability associated with Airbnb—not an Airbnb clone.

1. Product and design intent
Balai-Reserve is a beachfront resort in Brgy. San Antonio, Gloria, Oriental Mindoro, Philippines. It serves families, groups, and event organizers booking rooms, cottages, a function hall, and event packages. The same product includes a guest booking portal and an operational back office.

Design thesis: A relaxed beachfront escape, booked with confidence. The public site should look like a credible independent hospitality brand; the guest experience should make pricing and booking straightforward; the admin interface should be a fast, professional operations tool.

Borrow from Airbnb: photo-first listings, legible information architecture, search-first navigation, clear amenity and capacity details, polished date selection, sticky pricing/booking summary, sensible mobile bottom actions, trustworthy microcopy, robust interaction states. Do not copy Airbnb's logo, proprietary graphics, exact layouts, coral palette, or generic travel-marketplace tone.

Success metric: A first-time visitor can find a suitable stay or event space, understand total cost and required downpayment, check availability, and complete a reservation without confusion. Staff can process bookings and payments with fewer clicks and fewer mistakes.
2. Visual language: hospitality, not SaaS
- Real resort photography is the main visual asset. Prefer broad landscape photographs, natural light, true colors, uncluttered crops, and full-width galleries where appropriate. Never invent room images or present unrelated stock photos as actual property photos.
- Editorial hierarchy: confident headings, crisp details, restrained captions, and generous but purposeful whitespace. More resort magazine than tech startup.
- Distinct compositions: a split hero, edge-to-edge image sequences, image-plus-facts listings, editorial two-column sections, quiet lists, and a genuine information-rich footer. Do not use the same three-column card grid repeatedly.
- Restrained surfaces: white/warm off-white pages, occasional sand-toned sections, natural image color, no fake glass blur, neon gradients, floating blobs, glowing outlines, decorative badges, or oversized shadows.
- Useful density: visible price, capacity, availability, and booking conditions. Never sacrifice these to make a page look empty and 'minimal'.
Suggested design tokens
These are a refinement of the current brand, not an instruction to rebrand it:
Token	Value	Role
--brand	#0F5C66	Primary CTAs, links, selected controls
--brand-hover	#0B4850	Hover/pressed primary controls
--ink	#172D31	Main headings, strong content
--body	#33474B	Body copy
--muted	#68787A	Secondary metadata
--canvas	#FAF9F6	Warm site background
--surface	#FFFFFF	Forms, booking panels
--sand	#E8B96A	Sparing warmth and decorative detail
--line	#E5E8E6	Light separators where necessary
--focus	#146C78	Accessible keyboard focus


Keep status colors semantically distinct: Pending amber; Pencil Booking purple; On Hold slate; Awaiting payment orange; Confirmed teal/green; Checked in blue; Completed gray; Cancelled/Rejected/No show red. Status must always be spelled out in text, never conveyed by color alone.
Typography
- Inter for navigation, controls, body copy, booking information, admin tables, and numerals.
- Fraunces for selective editorial resort headings; not for tables, input labels, statuses, or every component.
- Public display: responsive clamp(2.25rem, 4.5vw, 4.5rem) with deliberate line breaks; section titles clamp(1.65rem, 2.8vw, 2.65rem); body 16–18px; metadata 13–14px.
- Admin headings 24–32px, body 14–16px, table content 13–14px where readable.
- Use medium weight, readable line lengths (55–75 characters for prose), tabular numerals for prices and reports, and a consistent type scale. No all-caps eyebrow text above every heading.
Spacing and geometry
- Base spacing: 4/8/12/16/24/32/48/64/88px. Section spacing responds to content, not a fixed giant gap.
- Public content width approximately 1180–1280px; long-form text 640–760px; admin content adapts to wide data tables.
- Corners: 8–12px for inputs/buttons, 12–18px for real photo/listing cards, 16–20px for significant booking panels. Avoid making everything pill-shaped.
- Shadows: almost invisible on ordinary surfaces; reserve elevation for floating booking panels, popovers, and dialogs.
- Use borders only to separate meaningful regions, input fields, tables, or focused controls. Visible keyboard focus is mandatory.
3. Public website: Airbnb-inspired resort discovery
Header and navigation
Desktop: understated resort wordmark on the left; clear Stay, Cottages, Events, Gallery, Contact navigation; one primary Check availability action; sign-in/account access as appropriate. Keep the header compact, with a solid readable background on scroll. Do not cram the entire site map into the top navigation.

Mobile: wordmark, a clear menu control, and a prominent booking entry point. Use a real accessible navigation drawer, not a tiny row of links. Keep the primary action easy to reach.
Hero: show the actual place
Use the best real beachfront/gazebo photograph, carefully cropped, with readable text overlay or a separate text column. Lead with the resort name, a short location-aware promise, and the functional availability search. Example copy direction: “A beachfront stay in Gloria, Oriental Mindoro.” Preserve the existing tagline “Your Home Away From Home” where it adds meaning. Do not make unverified claims about luxury, exclusivity, or facilities.

Availability search: accommodation type; check-in/out or date/time appropriate to type; guest count where applicable; Check availability CTA. On mobile, collapse to an obvious, tappable search entry that opens a focused date-and-details sheet. The search should connect to real availability and preserve selections through the booking flow.
Accommodation discovery
Use an Airbnb-like browse experience without copying its UI: large authentic image, accommodation name, capacity, actual nightly/flat price, and concise differentiators grounded in the catalogue. Put important details in a stable order. Make the entire listing easy to open; don't bury the price behind hover effects.

Show the current types and real live catalogue: Casa Standard Room, Casa Deluxe Room, Villa with Private Pool, Main House with Private Pool; Umbrella Cottage, Cottage, Pavilion; Pavilion Function Hall; and event packages. Preserve distinctions between rooms priced per night and cottages/venue/packages priced per booking. The venue and Pavilion cottage are different inventory items; do not conflate them.

Do not manufacture photos for Casa Standard Room, venue, or cottages missing imagery. Use a clean neutral photography placeholder clearly marked Photos coming soon, not AI illustrations pretending to show the resort. Preserve the ability for admins to add photos later.
Listing/detail page composition
1. Clear title and concise location/category context.
2. A strong photo gallery: main image + supporting images, mobile swipe gallery, keyboard-accessible lightbox, captions where available.
3. Primary details in a scan-friendly row: capacity, stay type, relevant timing, price unit.
4. Main column: verified description, actual inclusions, practical policies, guest suitability, optional add-ons for packages.
5. Desktop side panel: date/time selection, guest count, live price calculation, downpayment, booking action. Sticky only while its parent section remains visible.
6. Mobile: persistent bottom View price / Book action opening a clear booking sheet, without obscuring content or the keyboard.
Show actual availability and explain blocked dates. If an item has no photos or amenities recorded, omit the unsupported claims rather than filling space with invented icons.
Events and packages
Treat weddings, birthdays, debuts, meetings, and corporate events as a separate discovery journey. Use authentic event photos if available; otherwise emphasize factual package details and inclusions. Show package price, guest capacity, venue/time inclusions, and priced add-ons clearly. A short comparison table or editorial stacked rows is better than seven nearly identical cards.
Supporting sections
- About: concise local story with a real resort image, not a wall of aspirational copy.
- Gallery: curated real photos, sensible aspect ratios, caption/lightbox behavior; avoid a uniform mosaic of tiny thumbnails.
- Amenities: simple text-and-icon list only after amenities are verified.
- How booking works: compact 4-step timeline with real instructions about external payment and manual verification; avoid generic illustration cards.
- Reviews: only approved public feedback with real ratings; do not add fake totals or testimonials.
- Contact: verified contact information, actual location, directions/map where accurate, operating/check-in policies; remove placeholder phone/email/bank numbers before launch.
4. Guest portal: clear, reassuring, transactional
The portal is not another marketing homepage. It should feel like a lightweight hospitality account area, with familiar booking management patterns.
- Portal home: first show the guest's next relevant reservation or a clear Explore stays action. Then show upcoming/past reservations, payment actions, and useful catalogue recommendations from real records. Do not invent available rooms counts or show decorative KPI cards.
- Browse: same visual components, prices, photography, and availability behavior as the public site. Do not maintain two inconsistent listing designs.
- My reservations: simple status-aware list. Each row shows booking reference, item, dates/times, total, paid/balance, status, and next required action.
- Reservation detail: chronological status progress and payment activity, clearly separated from booking facts; visible QR check-in, proof upload, cancellation/refund controls when eligible, and inquiry support.
- Notifications: meaningful unread/read distinction and direct links to affected bookings; no fake notification counts.
- Profile: straightforward forms, labelled fields, password show/hide, clear save feedback.
Booking wizard: retain all four steps
Step 1 — What to book: room, cottage, venue, or event package. Show selected item's image if real, capacity, and rate unit.

Step 2 — Dates & details: date range for rooms; date plus time-in/out for cottages, venues, and events; guest count, special requests, and package add-ons. Explain availability conflicts next to the field.

Step 3 — Guest info: simple mobile number field with PH format support (09XXXXXXXXX or +639…), understandable validation, and no unnecessary repeated fields.

Step 4 — Payment: show actual total, calculated downpayment (from current setting, presently 50%), remaining balance, and available online payment methods: GCash, Maya, Bank Transfer. Explain that payment is made externally and proof is submitted for verification. Do not offer cash for online guest bookings.

Use a progress indicator with step names, a persistent summary on desktop, and a collapsible summary on mobile. Preserve selections when navigating backward. Never show a misleading Paid or Confirmed state merely because the wizard was submitted: new bookings start Pending with a BK-YYYY-NNNN reference, and payment proof must be reviewed.
Payment-proof interaction
Display actual recipient account name/number, QR when configured, copy-number control, upload field, accepted formats/size guidance, amount and reference inputs, thumbnail preview, and submission state. Distinguish proof submitted, payment verified, and booking confirmed. OCR is assistance, not a visual claim of automatic payment settlement. Show clear rejection reason and retry path when supported.
Mobile check-in QR
Make the QR large enough to scan on a phone, with booking reference and status nearby. State that only authorized staff can confirm check-in. QR is single-use and expires per current rules; guests must not see a self-check-in confirmation button.
5. Admin and staff: hospitality operations, not Airbnb marketing
The back office shares Balai-Reserve's tokens and typography, but prioritizes speed, scanability, and operational certainty over large photography.
App shell
A calm sidebar with the existing grouped navigation: Dashboard; Bookings; Accommodations; Events; Inventory; CRM; Management. Keep permissions intact. Use one active indicator, compact section labels, a useful top bar, global search where actually implemented, and notifications. Do not introduce dead search boxes or nonfunctional quick actions.
Dashboard
Use an editorial-data layout, not a wall of metric cards. First row: period switcher (Daily, Monthly, Yearly), selected date/year, and a compact headline for sales. Next: a small number of meaningful KPIs, a large chart/table region, and a right-side Needs attention column for pending reservations, payments, inquiries, upcoming events, inventory alerts, and availability counts. Show real data only.

Preserve: Daily payment ledger, sales/payments/refunds/bookings/check-ins/check-outs; Monthly January–December clickable booking chart and drill-down; Yearly views from 2026; accommodation performance graph. Charts need legends, tooltips, empty states, clear axis labels, and consistent money formatting (₱).
Reservations and calendar
Use compact tables with sticky headers on desktop, useful filters, status text, booking source, dates, guest, item, total, and next action. Clicking a row opens a comprehensive detail view with guest data, payments, balance, history, internal notes, QR, and authorized actions.

On mobile, use stacked reservation summaries with the same essential information—not horizontally clipped tables as the default. Preserve the calendar's status colors and make events tappable. Pending, Pencil Booking, On Hold, Awaiting payment, Confirmed, and Checked in must continue to block applicable dates.
Walk-ins and staff actions
Keep the walk-in form fast and explicit: all types support dates and times, source always Walk In, cash default but other methods available, no guest-count cap, editable total, optional payment, internal notes, and Pending/Pencil starting status. Use section grouping and inline validation instead of giant modal forms.

Critical actions (verify/reject proof, collect balance, refund decision, hold/resume, reschedule, check-in/out, amount override) need clear context, confirmation when irreversible, and visible success/error results. Do not hide them inside unlabeled ellipsis menus when frequently used.
Catalogue, inventory, CRM, settings
Use structured editing pages and practical tables. Photos have upload previews and image states; inventory adjustments expose quantity, reason, and history; customer details show actual activity; settings use clear tabs for Payment, General, Booking, Landing Page. Maintain deactivation rather than destructive deletion where required.
6. Interaction and motion standards
- Motion: subtle 120–220ms transitions for hover, selection, drawer, and modal changes. No entrance animation on every section or scroll-triggered parallax that harms readability.
- Loading: skeletons that match actual content geometry; no flashing placeholder dashboards or fake sample records.
- Empty states: say what is empty and what the user can do next. No generic cartoon illustrations.
- Errors: field-level explanation and recovery path; preserve typed data on failed requests.
- Success: concise toast or inline confirmation plus updated status; no confetti for payments/reservations.
- Forms: real labels, helpful examples, clear required/optional distinction, validation near the field, no placeholder-only labels.
- Dialogs: focus trap, escape behavior where safe, labelled title, mobile-safe dimensions, correct confirmation hierarchy.
- Images: optimized responsive sources, sensible loading priority, stable aspect ratios, meaningful alt text.
- Accessibility: WCAG AA contrast where applicable, visible focus, 44px-ish mobile tap targets, semantic headings, keyboard-friendly calendars and galleries, reduced-motion support.
7. Responsive design requirements
Mobile first (320–767px): no horizontal overflow; compact resort header; usable date picker; listing images with swipe; readable price unit; bottom booking action; step-by-step checkout; QR legible; staff workflows usable on phone. Account for safe areas and on-screen keyboard.

Tablet (768–1023px): adaptive two-column layouts, compact navigation, calendar interactions that remain usable by touch, booking summary positioned without hiding forms.

Desktop (1024px+): editorial photo compositions, balanced detail-and-booking columns, generous but not wasteful gutters, admin tables/charts with high information density. Support large and small laptop screens; avoid fixed pixel layouts.

Test at 320, 375, 390, 768, 1024, 1280, 1440, and 1920px. Check zoom at 200%, long names, validation errors, empty content, and large accessibility text settings.
8. Content and trust: non-negotiable
- Prices must come from the live catalogue, never hard-coded design mockups. Rooms = nightly rate × nights. Cottages/venue/packages = flat rate plus applicable add-ons.
- Downpayment uses the live downpayment_percent setting; do not permanently hard-code 50%.
- Never invent resort reviews, amenities, room photos, promotions, awards, guest counts, or instant confirmation promises.
- Missing images should be handled gracefully and honestly. Placeholder contact details and masked bank numbers must not appear as verified public information.
- Booking availability and calendar conflicts must reflect existing backend rules, including pencil and held bookings.
- Preserve PHP time display semantics for Philippine time (UTC+8) and peso formatting, irrespective of browser timezone.
- Preserve server-side access controls: guest cannot access staff/admin routes.
- Keep all audit logs, internal notes, payment/refund verification, and status histories intact.
9. Technical implementation approach
Current stack: Node.js/Express, .xian templates (EJS-like), Bootstrap 5, Font Awesome, Chart.js, FullCalendar, MySQL. Do not migrate frameworks just to improve the look. First inspect existing routes, templates, CSS, JavaScript, and reusable partials. Implement tokens and reusable components within the existing stack.
1. Audit before changing: map public, guest, and admin screens; identify shared and conflicting CSS, spacing, forms, button styles, photo handling, and mobile breakpoints. Capture screenshots of representative states.
2. Establish shared tokens: colors, type, spacing, surfaces, radius, focus, motion; centralize instead of accumulating per-page overrides.
3. Upgrade shared components: header, navigation, buttons, inputs, listing row/card, image gallery, date picker, price summary, status, dialog, table, empty/loading states.
4. Public first: landing, browse, details, gallery, event packages, mobile search. Replace repetitive card layouts with deliberate hospitality composition.
5. Guest second: portal home, booking wizard, payment proof, reservation detail, QR and notifications.
6. Admin third: app shell, dashboard, reservations, calendar, payments/refunds, inventory, settings.
7. Validate continuously: preserve the existing 61 automated checks; add responsive, accessibility, and screenshot regression checks. Review mobile and desktop after each page, not only at the end.
Avoid a superficial CSS-only makeover. Improve content hierarchy, screen composition, interaction flow, responsive behavior, and states—but do not modify data or business logic without necessity.
10. Design review / acceptance rubric
For each page, ask:
- Does this look like a real coastal resort brand, rather than a generic AI-generated travel landing page?
- Is the primary user action visible within seconds?
- Does authentic photography do more work than icons and decorative containers?
- Are rate units, capacity, dates, payment requirements, and status clear?
- Are repeated cards replaced with a more fitting composition where appropriate?
- Is the mobile experience genuinely designed, not a squeezed desktop page?
- Is the page trustworthy, with no fabricated content or misleading promises?
- Are hover, focus, loading, empty, error, and success states complete?
- Is this screen visually consistent with the rest of Balai-Reserve while fitting its own job?
- Have all current business rules and permissions been preserved?
Reject a design if it is attractive in a static screenshot but confusing to book, hard to scan, inaccessible, or inconsistent with actual resort operations.
11. Direct instruction to the AI coding agent
You are redesigning the EXISTING Balai-Reserve resort booking website. Study the codebase and the rebuild brief before editing. Use this V2 guide as the visual and UX standard. Aim for Airbnb-level usability and premium boutique-resort photography, but keep Balai-Reserve's coastal identity and do not imitate Airbnb's exact visual branding. Avoid generic AI landing-page patterns, overuse of cards, pill badges, decorative gradients, oversized spacing, and fake marketing content. Redesign every page according to its function: public discovery should be photographic and editorial, the guest portal should make booking/payment easy, and the admin dashboard should be operational and information-dense. Preserve all working features, routes, validations, statuses, live pricing, permission checks, and database rules. Work incrementally, inspect existing components before replacing them, and test desktop/tablet/mobile plus important interactive states. Make real design decisions—not just a color or border-radius change.
