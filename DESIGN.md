---
version: alpha
name: "Lottify Member"
description: "Thai-first lottery member product with botanical night surfaces, rice-gold actions, and an open product canvas instead of a generic dashboard shell."
colors:
  night: "#071711"
  forest: "#0D2A1F"
  rice: "#F5EED8"
  gold: "#E9CD83"
  goldStrong: "#F4DD9A"
  leaf: "#8DBD67"
  textOnDark: "#F8F4E8"
  textMutedDark: "#A8BAAE"
  ink: "#13251E"
  success: "#79C487"
  warning: "#E9C76F"
  danger: "#D77C6E"
  info: "#8FB4C7"
  focus: "#F4DD9A"
typography:
  display:
    fontFamily: "Georgia, 'Noto Serif Thai', serif"
  sans:
    fontFamily: "'Noto Sans Thai', 'Leelawadee UI', system-ui, sans-serif"
  numeric:
    fontFamily: "'IBM Plex Sans Thai', 'Noto Sans Thai', ui-monospace, monospace"
rounded:
  DEFAULT: "1rem"
  sm: "0.75rem"
  md: "1rem"
  lg: "1.5rem"
  xl: "2rem"
spacing:
  page-gutter: "2rem"
  page-max: "90rem"
  section-gap: "3rem"
components:
  memberMasthead: {}
  dockNavigation: {}
  mobileNavigation: {}
  walletHero: {}
  section: {}
  dataRow: {}
  button: {}
  input: {}
---

# Lottify Member Design System

## Overview

### Creative North Star
A calm Thai evening landscape translated into a trustworthy money-and-betting product: deep botanical green, restrained rice-gold actions, warm light review surfaces, and Thai-first typography. The product should feel specific to Lottify without borrowing generic SaaS dashboard or casino-neon conventions.

### Product context and register
- **Audience and primary job:** Thai members buying lottery products, reviewing authoritative terms/results, and managing wallet/account/security.
- **Target market:** Thailand; business time is server-authoritative and commonly Asia/Bangkok.
- **Locale:** `th-TH` primary. Immutable API/domain identifiers may remain English.
- **Usage scene:** mobile-first short sessions, with desktop/laptop review and history.
- **Register:** product-first; brand expression is concentrated in Home, auth entry, promotions, and completion moments.
- **Memorable signature:** five-area floating navigation dock over an open botanical canvas; no persistent left sidebar.
- **Restraint:** Quote, Confirm, Receipt, Withdrawal, security, error, and recovery states favor legibility over decoration.
- **Anti-references:** generic sidebar SaaS dashboards, acid-green AI templates, casino neon, card-everywhere bento layouts.
- **Token ownership:** this file owns durable intent; `apps/member-web/app/styles.css` is the runtime CSS source. Shared shell ownership is `app-chrome.tsx`, `topbar.tsx`, `navigation.tsx`, and `auth-shell.tsx`.

## Colors
`night` and `forest` define authenticated canvas depth. `rice` is reserved for high-legibility task surfaces. `gold` is a brand/action color, not a semantic status. Success/warning/danger/info remain distinct from gold. Focus is always visibly gold on dark or light surfaces.

## Typography
Display typography is reserved for page-level moments. Product body, controls, forms, and dense data use the Thai sans stack. Money, countdowns, IDs, and financial totals use tabular numeric treatment. Do not add decorative English kickers by default.

## Layout
Desktop uses a compact sticky masthead and floating five-area bottom dock. Mobile uses a compact masthead and safe-area-aware bottom navigation. Main content is an open canvas with bands, rails, lists, and selected framed surfaces—not a permanent sidebar/topbar dashboard. Tables own their horizontal scrolling.

## Elevation & Depth
Use tonal depth, borders, and restrained shadow. Strong elevation is reserved for floating navigation, overlays, and selected hero/review surfaces. Static content must not become a stack of floating cards by default.

## Shapes
Controls use rounded rectangles; status may use pills. The dock and hero can use larger radius. Data rows stay tighter. Borders communicate grouping rather than decoration.

## Components
- **Buttons:** primary = rice-gold fill + dark text; secondary = surface/outline; danger stays separated.
- **Navigation:** exactly five primary areas — หน้าแรก / ซื้อหวย / โพยของฉัน / กระเป๋า / บัญชี.
- **Forms:** real labels, owned validation, preserved values on recoverable server errors, masked sensitive values.
- **Iconography:** keep one consistent line-icon family with text labels for primary navigation.
- **Motion:** brief state-oriented transitions only; respect `prefers-reduced-motion`.
- **Content:** never invent balances, draws, rewards, referral state, settlement state, or payout state when the API has no value.

## Do's and Don'ts
- **Do:** make the five primary jobs immediately reachable.
- **Do:** keep authoritative server state visually dominant in betting and money flows.
- **Do:** use one expressive atmospheric moment per route, then keep task surfaces quiet.
- **Don't:** recreate the previous sidebar + sticky topbar shell.
- **Don't:** use casino urgency or neon gambling aesthetics.
- **Don't:** hide overflow/layout defects with page-level clipping.
