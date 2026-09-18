# Lottify Member — Design Contract

## Product register

Lottify Member is a Thai-first, mobile-first transactional member application. The product must feel trustworthy enough for wallet and betting state while remaining recognizably Lottify rather than a generic finance dashboard.

## Visual thesis

**Thai botanical ticket desk at night.** Deep botanical greens provide the application frame, warm rice-paper surfaces carry transactional content, and restrained brass/gold details reference printed lottery tickets without imitating a casino. The signature motif is a subtle perforated ticket rail used only at key hierarchy boundaries.

This direction deliberately avoids the previous desktop `sidebar + topbar + card dashboard` architecture.

## Durable tokens

- `night-950`: `#071d18`
- `forest-900`: `#0b3027`
- `forest-700`: `#175846`
- `rice-50`: `#f7f4ec`
- `rice-100`: `#eee8dc`
- `brass-500`: `#c8a85b`
- `leaf-400`: `#92c56b`
- `ink-950`: `#13231e`
- `muted-600`: `#68766f`
- danger/success/info/warning continue to come from the established semantic system.

## Typography

- Display / brand moments: `Chonburi`, then Thai-capable serif fallback.
- Product/body/UI: `Anuphan`, then `Noto Sans Thai`, `Leelawadee UI`, `Tahoma`, sans-serif.
- Financial and reference values use tabular numerals.
- Display typography is reserved for masthead/hero identity; forms, tables, buttons and statuses stay in the UI face.

## Layout contract

### Desktop

- No persistent left sidebar.
- A compact masthead owns brand, current context and member/session actions.
- Primary five-area navigation lives in a floating bottom dock.
- Main product content uses an open canvas with strong editorial bands, ledger rows and task surfaces instead of nesting every section in cards.
- Contextual promotions/notifications remain secondary entry points and never become primary tabs.

### Mobile

- Exactly five primary destinations remain in the bottom navigation.
- Minimum interactive target: 44 CSS px.
- Fixed navigation must never cover the final actionable content.
- Financial tables/status rows must contain overflow inside their own surface, never the document body.

## Component geometry

- Main surfaces: 18–24 px radius only when a surface is genuinely grouped.
- Buttons: 12–14 px radius; no decorative pill treatment for routine actions.
- Status labels may remain pills because status is categorical.
- Borders are low contrast warm/green rules, with depth coming mostly from spacing and restrained shadows.
- Avoid nested-card stacks and generic bento composition.

## Motion

Use short opacity/translate transitions for masthead/dock and actionable rows only. No ambient motion in financial confirmation, receipt, withdrawal, or settlement states. Respect `prefers-reduced-motion`.

## Accessibility

Target WCAG 2.2 AA. Maintain visible focus, semantic links/buttons, Thai accessible labels, reduced-motion behavior, 44 px touch targets, and stable loading/feedback geometry.

## Authority boundary

Visual prototypes never redefine API or financial truth. Quote, order, receipt, settlement, wallet, deposit, payout destination, withdrawal and readiness state remain server-authoritative. UI must never invent successful financial state.
