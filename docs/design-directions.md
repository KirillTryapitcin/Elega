# Design directions

Status: Step 2 blueprint draft, waiting for Kirill's choice. Visual comparison (light and
dark, same components in each): https://claude.ai/artifact/5YbX7SHtX16LVw9N5q1gCB

All three meet WCAG 2.1 AA for the pairs used in the sketches (text, muted text, buttons,
chips, reaction badges ≥ 4.5:1 in both themes, checked by script), use Google-hosted fonts
with full Cyrillic, 44 px touch targets, and avoid Facebook's and VK's blue identity.

| | A · Malachite (recommended) | B · Dusk | C · Birch bark |
| --- | --- | --- | --- |
| Mood | Warm, calm, natural | Bright, young, evening | Strict, light, most legible |
| Primary (light / dark) | `#0F6B62` / `#46B9A9` | `#4338B8` / `#8F8BF7` | `#2E3A46` / `#DFE4E9` |
| Accent (light / dark) | amber `#E2A23B` / `#F2B451` | coral `#F0715A` / `#FF8A73` | rowan `#B3261E` / `#E5584F` |
| Neutral 900 / 50 | `#17201E` / `#F3F5F4` | `#1B1B2E` / `#F4F4FA` | `#1F2328` / `#F7F7F5` |
| Typeface | Manrope (display 800) | Onest (display 700) | Golos Text (display 600) |
| Shape | Cards 14 px, buttons 12 px, soft shadow | Cards 18 px, pill buttons, deeper shadow | Cards 12 px, 1 px borders, no shadow |
| Risk | Green reads "bank" to some | Indigo sits close to VK | Little brand character |

After the choice, M0 turns the chosen direction into tokens in `packages/config`: 50–900
scales for primary, accent, neutral, success, warning, danger, info; semantic tokens
(background, surface, surface-raised, border, text-primary/secondary/disabled, link,
focus-ring); 4 px spacing scale; radius, shadow, z-index and motion tokens (100/200/300 ms);
breakpoints sm 360, md 768, lg 1024, xl 1280 (brief §25.2).
