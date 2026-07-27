# Page: Event Detail

> Overrides MASTER for the item detail view (`renderDetail`).

## Layout
- Single hero composition: identity + **large countdown** + actions in one surface
- Do NOT put actions in a separate card below the hero
- Push history remains a secondary card under the hero
- Period forecast stays below hero when type is period

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

## Anti patterns
- No purple gradient
- No emoji in action buttons
- No floating badge stickers over countdown
