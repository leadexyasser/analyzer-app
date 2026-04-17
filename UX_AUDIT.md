# UX Audit — Call Analyzer (Final Expense)
**Date:** 2026-04-17 · **Auditor:** Claude Sonnet 4.6  
**Backup tag:** `backup/pre-ux-audit`

---

## Phase 1 Summary

### Tech Stack
- **Framework:** Next.js 16 App Router (Server + Client Components)
- **Styling:** Tailwind CSS v4 + custom `--rb-*` CSS tokens (Ringba palette)
- **Component library:** shadcn/ui is *installed* (`components/ui/`) but almost entirely *unused* — actual UI is all hand-rolled inline styles
- **Icons:** Lucide (only in `CallsTable`); emojis (`⚠️ ✅ ✉️`) used elsewhere — inconsistent
- **Font:** Geist Sans / Geist Mono

### Routes & Screens
| Route | Type | Description |
|---|---|---|
| `/login` | Client | Magic link auth |
| `/dashboard` | Server | Stats + timeline + summary + call table |
| `/dashboard/calls/[id]` | Server + Client | Full call detail, audio, transcript, analysis |

### Design Token Inventory
**Defined tokens (`--rb-*`):** sidebar, surface, surface-2, border, border-2, text, text-2, text-3, accent, accent-hover, red, amber, green  
**Problem:** Hundreds of hardcoded hex colors (`#071a10`, `#0d2e1e`, `#200a0a`, `#1c0808`…) bypassing the token system. These "semantic dark" backgrounds have no names and can't be changed globally.

---

## Phase 2: Prioritized Findings

### 🔴 Critical — Blocks users or violates accessibility

#### C1 · No mobile layout whatsoever
**Problem:** Sidebar is a fixed `w-56` with no hamburger or mobile drawer. On phones the content area is ~200px wide — the call table, stat cards, and date picker are completely unusable.  
**Why it matters:** If the user checks the dashboard on a phone (common for affiliate ops), they see a broken layout.  
**Fix:** Add a collapsible mobile sidebar triggered by a hamburger in the top bar. The main content takes full width on mobile.  
**Effort:** L

#### C2 · No keyboard focus states
**Problem:** Interactive elements (buttons, table rows, inputs) use JavaScript `onFocus`/`onBlur` to toggle border color, but there are no CSS `:focus-visible` outlines. Tab navigation produces no visible indicator.  
**Why it matters:** WCAG 2.1 AA SC 2.4.7 requires visible focus. Keyboard-only users are lost.  
**Fix:** Add `outline: 2px solid var(--rb-accent); outline-offset: 2px` on `:focus-visible` globally in `globals.css`. Remove the JS-based focus handlers.  
**Effort:** S

#### C3 · Color contrast failures
**Problem:** Several color combinations fail WCAG AA (4.5:1 for normal text, 3:1 for large):
- `--rb-text-3` (`#4d6078`) on `--rb-surface` (`#161e2d`) → ~2.8:1 ❌ (used for ALL labels, dates, metadata)
- `--rb-text-2` (`#8496ad`) on `--rb-surface` → ~4.1:1 ❌ (used widely for body text)
- `--rb-text-3` on `--rb-sidebar` (`#0f1623`) → ~2.6:1 ❌  
**Why it matters:** Low-vision users and anyone in bright environments can't read the UI.  
**Fix:** Lighten `--rb-text-3` to `#6b7fa0` (~4.6:1 on surface) and `--rb-text-2` to `#9aadC4` (~5.1:1). Two token changes fix it everywhere.  
**Effort:** S

#### C4 · Login form label not associated with input
**Problem:** `<label>` and `<input>` in the login form have no `htmlFor`/`id` linkage. Screen readers can't associate them.  
**Fix:** Add `id="email"` to the input and `htmlFor="email"` to the label.  
**Effort:** S (5 min)

#### C5 · Table accessibility — no `scope`, no caption
**Problem:** Both `CallsTable` and `SummaryTable` use `<th>` without `scope="col"`. Screen readers can't map headers to data cells.  
**Fix:** Add `scope="col"` to all `<th>` elements. Add a visually-hidden `<caption>` to each table.  
**Effort:** S

---

### 🟠 High Impact — Significant friction or confusion

#### H1 · 7 stat cards in one row — information overload
**Problem:** `xl:grid-cols-7` on a 1440px screen gives each card ~170px. Cards feel crammed, labels are truncated, and the hierarchy is flat — everything looks equally important.  
**Fix:** Split into two rows with clear hierarchy: primary metrics (Calls Today, Revenue, Closed Rate, CPA) on top; quality indicators (FE Lead Quality, Compliance Score, Compliance Flags) below. Or use a 4+3 grid with visual grouping.  
**Effort:** S

#### H2 · Calls table has 14 columns — horizontal scroll hell
**Problem:** 14 columns means horizontal scrolling even on 1440px. Most columns (Target #, Dup, End Source) are rarely needed. No way to hide columns.  
**Fix:** Hide low-priority columns behind a "Columns" toggle (show/hide per-column). Default visible: Date, Campaign, Caller ID, Duration, Revenue, FE Qualifier, Status.  
**Effort:** M

#### H3 · Sidebar nav active state is hardcoded
**Problem:** The nav link always renders with active styling regardless of current route. If a second nav item is added, it would also show as active.  
**Fix:** Use `usePathname()` to compare `href` with current path. Apply active styles conditionally.  
**Effort:** S

#### H4 · Date range control UX is confusing
**Problem:** Preset buttons apply *immediately* on click; custom date inputs require hitting "Apply" separately. Users may not realize this. The two interactions feel disconnected.  
**Fix:** Add a subtle "press to apply" hint label above the date inputs, or make both inputs trigger navigation on change (no Apply button needed). Highlight the currently active preset clearly.  
**Effort:** S

#### H5 · Empty state is just plain text
**Problem:** "No calls match your filters" is an unstyled `<td>` text. No icon, no suggestion, no "clear filters" action.  
**Fix:** Add a proper empty state with an icon, message, and contextual action (e.g. "Clear filters" or "Waiting for calls from Ringba").  
**Effort:** S

#### H6 · No loading state on initial page load
**Problem:** Dashboard stats block the whole page while fetching. No skeleton or progressive loading — users see nothing until the server finishes all queries.  
**Fix:** Wrap each stat section in `<Suspense>` with skeleton placeholders so the layout renders immediately.  
**Effort:** M

#### H7 · Expanded call row is overwhelmingly dense
**Problem:** The expanded row shows 3 columns with 8+ sections squeezed in, including full compliance flag cards, two score progress bars, quality breakdown bars, and a coaching note — all at once. There's no scan path.  
**Fix:** Add a tab bar inside the expanded row: **Overview** (summary + closed/compliance status) | **Scores** (FE quality, compliance, lead intent) | **Details** (coaching, flags). Reduces cognitive load dramatically.  
**Effort:** M

#### H8 · Breadcrumb shows raw UUID on call detail page
**Problem:** "Call 36252590-640d-4834-b3d0-b7bb87be26c5" is meaningless. Users can't quickly identify the call from the breadcrumb.  
**Fix:** Show the caller ID and date instead: "Dashboard / +18504643672 · Apr 17"  
**Effort:** S

---

### 🟡 Polish — Consistency, refinement, delight

#### P1 · Hardcoded semantic colors bypass the token system
**Problem:** ~40 hardcoded hex values like `#071a10`, `#0d2e1e`, `#200a0a` are used for status backgrounds. These are semantic colors (success-bg, error-bg, warning-bg) but they're inlined across 5 files.  
**Fix:** Add semantic tokens to `globals.css`: `--rb-green-bg`, `--rb-red-bg`, `--rb-amber-bg`, `--rb-blue-bg`. One change updates all status colors everywhere.  
**Effort:** M

#### P2 · Mixed icon systems
**Problem:** Lucide icons in `CallsTable`, inline SVGs in the sidebar, and emoji in `CallsTable`/`FinalExpenseCard` (`⚠️`, `✅`, `🟡`). Three different icon systems in one app.  
**Fix:** Use Lucide for all icons. Replace emoji with `<AlertTriangle>`, `<CheckCircle>`, `<Circle>` from lucide-react. Already installed.  
**Effort:** M

#### P3 · Button style inconsistency — 5+ variants, no system
**Problem:** Primary action (teal bg), secondary (surface bg + border), ghost (text-only), danger (red), inline (text + pencil). Each is hand-styled inline with no shared component.  
**Fix:** Define 3 button variants in a shared `Button` component (already in `components/ui/button.tsx` — just use it): `primary`, `secondary`, `ghost`. Replace all inline button styles.  
**Effort:** M

#### P4 · Filter panel appears/disappears without animation
**Problem:** The filter panel `showFilters` toggle has no transition — it instantly pops in and out, causing jarring layout shift.  
**Fix:** Wrap in a CSS height transition or use Tailwind's `animate-in`/`animate-out` (already imported via `tw-animate-css`).  
**Effort:** S

#### P5 · `ReanalyzeButton` duplicated across files
**Problem:** `ReanalyzeButton` in `CallsTable.tsx` and `ReanalyzeBtn` in `CallDetail.tsx` are near-identical components. One will drift from the other over time.  
**Fix:** Extract to `components/ReanalyzeButton.tsx`, import in both places.  
**Effort:** S

#### P6 · "Live" dot in top bar uses Tailwind class `bg-green-500`
**Problem:** Everything else uses `var(--rb-green)` CSS variables. This one element uses a Tailwind color class — breaks if the palette changes.  
**Fix:** Replace with `style={{ background: 'var(--rb-green)' }}`.  
**Effort:** S (2 min)

#### P7 · No page titles / `<title>` tags
**Problem:** All pages use the default Next.js title. Browser tabs just say "Create Next App" or the route path.  
**Fix:** Add `export const metadata` in each page with meaningful titles.  
**Effort:** S

#### P8 · `CallsTable.tsx` is 730 lines — too large to maintain
**Problem:** One file contains state management, 6 sub-components, filter logic, and the table render. Hard to navigate and test.  
**Fix:** Extract `ExpandedRow`, `FiltersPanel`, `RevenueEditor`, badge atoms into separate files. This is a refactor, not a visual change — do it alongside P3/P5.  
**Effort:** M

---

## Phase 3: Implementation Order (impact ÷ effort)

| # | Finding | Impact | Effort | Ratio |
|---|---|---|---|---|
| 1 | C3 — Contrast fixes | Critical | S | ★★★★★ |
| 2 | C2 — Focus states | Critical | S | ★★★★★ |
| 3 | C4 — Login label | Critical | S | ★★★★★ |
| 4 | P6 — Live dot token | Polish | S | ★★★★★ |
| 5 | P7 — Page titles | Polish | S | ★★★★★ |
| 6 | H3 — Nav active state | High | S | ★★★★★ |
| 7 | H4 — Date range UX | High | S | ★★★★ |
| 8 | H5 — Empty state | High | S | ★★★★ |
| 9 | H8 — Breadcrumb | High | S | ★★★★ |
| 10 | P4 — Filter animation | Polish | S | ★★★★ |
| 11 | P5 — Deduplicate ReanalyzeButton | Polish | S | ★★★★ |
| 12 | C5 — Table scope/caption | Critical | S | ★★★★ |
| 13 | H1 — Stat card layout | High | S | ★★★★ |
| 14 | P1 — Semantic color tokens | Polish | M | ★★★ |
| 15 | P2 — Unified icons | Polish | M | ★★★ |
| 16 | P3 — Button system | Polish | M | ★★★ |
| 17 | H6 — Suspense/skeletons | High | M | ★★★ |
| 18 | H7 — Expanded row tabs | High | M | ★★★ |
| 19 | H2 — Column visibility | High | M | ★★ |
| 20 | P8 — Split CallsTable.tsx | Tech debt | M | ★★ |
| 21 | C1 — Mobile sidebar | Critical | L | ★★ |

---

## Awaiting your review before any code is written.
