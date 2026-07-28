# Page: Event Detail

> Overrides MASTER for the item detail view (`renderDetail`).

## Layout
- Single hero composition: identity + **large countdown** + actions in one surface
- Do NOT put actions in a separate card below the hero
- Push history remains a secondary card under the hero
- Period forecast stays below hero when type is period
- **Mobile:** countdown stacks above date rows; header back button (not in-page back link)
- **Dates:** always `YYYY-MM-DD` (+ optional `· 周X`); never mix `1993/05/16` with `5月1日 2027`

## Hierarchy
1. Countdown (dominant visual — ring + large number)
2. Event name (display type)
3. Compact meta (mode / time / calendar) — no long “剩 X 天” string in meta
4. Inline action chips
5. Push history

## Motion (budget ≤20% viewport)
- Hero entrance: rise 500ms `--ease-out-expo`
- Ring stroke draw: 800ms once
- Action chips: staggered fade 40ms apart (≤4)
- Respect `prefers-reduced-motion`

## Palette (page override)
- Sage: `#5B7C72` / soft `#E7EFEC`
- Amber: `#C9844A` / soft `#F6EDE4`
- Soft dual-layer shadows only; no sparkles, no card tilt

## Anti patterns
- No purple gradient
- No emoji in action buttons
- No floating badge stickers over countdown
- No decorative sparkles / skewed “playful” tiles
