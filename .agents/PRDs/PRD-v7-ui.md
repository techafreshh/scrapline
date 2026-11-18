# PRD v7: Scrapline UI Design System Milestone

**Goal**: fix the broken menu and give the whole interface a coherent design system — so the UI reads as a designed game, not tiled wallpaper. Side effect target: the menu should be instantly comparable to play.skyscrap.fun's menu anatomy.

**Verified current defects (captures 2026-11-18)**:
- **F1 (P0, regression from #270).** The menu renders the UI-pack "large tiles" sheet tiled across the *entire screen* as a stud-wall background; the title is clipped off the top; the previous match's standings table bleeds through the buttons. Root cause direction: the pack tilesheet was applied as full-screen tiling instead of 9-slice panel borders, and menu overlay z-order/visibility is wrong (stale end-screen DOM under the menu).
- **F2.** HUD ammo module uses a red-brick panel that clashes with the navy/cyan palette.
- **F3.** Buttons are raw tiled rectangles: no hover/pressed states, inconsistent heights, no focus rings.
- **F4.** No spacing/typography system: elements crowd, title clipped, tips text collides with panels.

**Constraint**: same CC0 sources (UI Pack: Pixel Adventure, or pure CSS/SVG for chrome — whichever integrates cleaner); core untouched; all probes green; bundle stays ≤ 6 MB.

---

## D. Design system foundation

- **D1. Tokens.** One `tokens.css` (or TS constants) defining: palette (bg deep navy `#0b0f1a`, panel translucent `rgba(13,18,32,.92)`, panel border 2 px `#2a3550`, accent cyan `#00E5FF`, accent-warm `#FF6B35`, text `#e8ecf4`, muted `#8a94a8`), spacing scale (4/8/12/16/24/32), radius (8/12), typography scale (title 40, h2 24, body 16, label 12 — bitmap font retained for HUD numbers), and shadow tokens. All UI modules consume tokens — no raw colors in module CSS.
- **D2. Panel + button primitives.** One `Panel` primitive (translucent dark, 2 px border, subtle inner glow — NOT full-screen tiling) and one `Button` primitive with three visual states (default/hover/pressed) + disabled + keyboard focus ring, consistent paddings and min-height. Both built as thin DOM wrappers, used by menu, setup, settings, how-to, challenges, locker, end screen, HUD modules.
- **D3. Layer discipline.** Fixed stacking: match canvas < HUD < overlays (pause/end) < menu; only one overlay visible at a time; stale end-screen/standings DOM is destroyed (not hidden) when returning to menu. Test: opening the menu after a match shows no standings text anywhere in menu DOM.

## M. Menu redesign

- **M1. Layout hierarchy.** Left-anchored column like the reference: logo lockup ("Scrapline" wordmark + small tagline "deterministic jetpack arena"), then the primary CTA (Quick Play + summary chip, largest button), then secondary stack (Play vs bots · Play online · Challenges · Locker · Settings · How to Play), map carousel to the right of the CTA, pilot/color/Lv row above, tips line pinned bottom-left. Minimum gaps from the token scale; nothing overlaps the live-match backdrop edge-to-edge — the backdrop keeps a dark scrim for text contrast.
- **M2. CTA treatment.** Quick Play is visually dominant (accent fill, hover glow, pressed state); secondary buttons quiet (ghost style).
- **M3. Carousel cards.** Fixed card size, selected state = accent border + slight scale, unselected dimmed; map name + a small "best score" line if present; smooth transition between selections.

## H. HUD redesign

- **H1. Cohesive modules.** One shared module style (translucent dark panel, 2 px border, cyan accent bar) for: HP/fuel cluster (top-left), timer/standings chip (top-center), kill feed (top-right, entries fade), ammo module (bottom-right) — replacing the red-brick panel. Grenade pips as accent-colored dots, weapon name in label size.
- **H2. Damage/flash states.** HP bar flashes accent-warm on damage; kill feed entry for YOUR kill highlights cyan; module borders never fight the game's palette.

## S. Overlays

- **S1. Setup / Settings / How to Play / Challenges / Locker.** All rebuilt on the Panel primitive: consistent header (h2 + close button), consistent row spacing, no tiled backgrounds; setup keeps URL/state behavior.
- **S2. End screen.** Standings table styled with the token system (row stripes, winner highlight accent), Play again as CTA, Menu as ghost.

## V. Verification

- **V1. UI verification lap.** Captures at 1920×1080 + 1280×720: menu, setup, how-to, challenges, locker, mid-match HUD, end screen, after-menu-return (F1 regression proof: no bleed). Assertions: title fully visible; zero full-screen tiling; standings absent from menu DOM (D3 test); all buttons have hover styles in CSS; fps guardrail green; all prior scenario probes green.

**Acceptance**
- [ ] Menu reads as designed: hierarchy, states, no broken layers (F1 fixed with regression test)
- [ ] HUD modules share one style; brick panel gone
- [ ] All surfaces on token system; zero raw-color modules; probes + budget green

**Out of scope**: art changes to the world/characters (sprites stay), new fonts, music.
