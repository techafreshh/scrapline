# Asset licenses

All third-party art in `packages/client/assets/vendor/` is **Creative Commons Zero (CC0)** — public domain, no attribution required (kept here as good practice). Nothing in this tree originates from the reference game (play.skyscrap.fun) or any non-CC0 source.

| Vendor pack | Author | License | Source | Included |
|---|---|---|---|---|
| `platformer-characters` | Kenney Vleugels (kenney.nl) | CC0 1.0 | https://kenney.nl/assets/platformer-characters | `PNG/` (Adventurer, Soldier incl. limb pieces + poses, Female, Player, Zombie) |
| `pixel-platformer` | Kenney Vleugels (kenney.nl) | CC0 1.0 | https://kenney.nl/assets/pixel-platformer | `PNG/`, `Tilemap/`, `Tiled/` |
| `pixel-platformer-industrial-expansion` | Kenney Vleugels (kenney.nl) | CC0 1.0 | https://kenney.nl/assets/pixel-platformer-industrial-expansion | `PNG/`, `Tilemap/`, `Tiled/` |
| `simplified-platformer-pack` | Kenney Vleugels (kenney.nl) | CC0 1.0 | https://kenney.nl/assets/simplified-platformer-pack | `PNG/` (toon-vector alternative family) |
| `particle-pack` | Kenney Vleugels (kenney.nl) | CC0 1.0 | https://kenney.nl/assets/particle-pack | `PNG/` (transparent-background set, 512×512) |
| `ui-pack-pixel-adventure` | Kenney Vleugels (kenney.nl) | CC0 1.0 | https://kenney.nl/assets/ui-pack-pixel-adventure | `Tiles/`, `Tilesheets/` |

Rules enforced by `tests/asset-pipeline.test.js`:
- Vendor files are committed once; laps never download assets from the network.
- Only sprites referenced by an atlas manifest may enter the shipped bundle; total loaded asset weight stays ≤ 6 MB behind the loading screen.
- New vendor packs require a row in this manifest before use.
