# Scrapline third-party asset licenses

All game art in this repository is authored in-house for this project and
dedicated to the public domain, plus the committed CC0 vendor packs staged
under packages/client/assets/vendor/ for the sprite-swap milestone (PRD v6).

## Pack: Scrapline CC0 soldier sprites

- Author: Scrapline contributors
- License: CC0-1.0 (public domain dedication; no attribution required)
- Files:
  - packages/client/assets/soldier-idle.svg
  - packages/client/assets/soldier-run-a.svg
  - packages/client/assets/soldier-run-b.svg
  - packages/client/assets/soldier-jet.svg
  - packages/client/assets/soldier-crouch.svg
  - packages/client/assets/soldier-dead.svg

## Pack: Orbitron display webfont (OFL)

- Author: Matt McInerney (via Google Fonts)
- License: OFL-1.1 (SIL Open Font License 1.1)
- Files:
  - packages/client/assets/fonts/orbitron-700.woff2
  - packages/client/assets/fonts/fonts.json

## Pack: Kenney CC0 vendor packs (staged, PRD v6 sprite swap)

Third-party sprite sources committed once under packages/client/assets/vendor/
and never fetched over the network; per-pack rows live below and in
packages/client/assets/LICENSES.md.

| Vendor pack | Author | License | Source |
|---|---|---|---|
| `platformer-characters` | Kenney Vleugels (kenney.nl) | CC0 1.0 | https://kenney.nl/assets/platformer-characters |
| `pixel-platformer` | Kenney Vleugels (kenney.nl) | CC0 1.0 | https://kenney.nl/assets/pixel-platformer |
| `pixel-platformer-industrial-expansion` | Kenney Vleugels (kenney.nl) | CC0 1.0 | https://kenney.nl/assets/pixel-platformer-industrial-expansion |
| `simplified-platformer-pack` | Kenney Vleugels (kenney.nl) | CC0 1.0 | https://kenney.nl/assets/simplified-platformer-pack |
| `particle-pack` | Kenney Vleugels (kenney.nl) | CC0 1.0 | https://kenney.nl/assets/particle-pack |
| `ui-pack-pixel-adventure` | Kenney Vleugels (kenney.nl) | CC0 1.0 | https://kenney.nl/assets/ui-pack-pixel-adventure |

- Author: Kenney Vleugels (kenney.nl)
- License: CC0-1.0 (public domain dedication; no attribution required)
- Files:
  - packages/client/assets/vendor/
  - packages/client/assets/LICENSES.md

## Pack: Scrapline CC0 arena sprites

Parallax backdrop sets for kilima (dusk savanna), dune (golden-hour
 desert), and frostbite (polar night) are authored in-house as CC0 vector
 shapes painted in code (no external image or font files): sun disc,
 acacia silhouettes, and bird ticks on kilima; dune-ridge swells and
 refinery chimneys on dune; aurora bands, antenna masts, and snow on
 frostbite.

- Author: Scrapline contributors
- License: CC0-1.0 (public domain dedication; no attribution required)
- Files:
  - packages/client/assets/prop-crate.svg
  - packages/client/assets/prop-barrel.svg
  - packages/client/assets/prop-barrel-cracked.svg
  - packages/client/assets/prop-crate-cracked.svg
  - packages/client/assets/prop-explosion.svg
  - packages/client/assets/prop-bounce-pad.svg

## Pack: Scrapline generated menu art (issue #348)

Wordmark lockup, arena card frame, carousel arrows/dots, tip strip
plate, and profile row plates sliced in-house from the ME-* reference
renders (docs/ui-prompts/results/ME-02..ME-07) through the
dependency-free tools/slice-menu.js pipeline (chroma key, pitch-4
detect, quantise to the 12-colour palette, PNG-8 encode); the staged
bundle weight stays under the 6 MB gate like the atlas output.

- Author: Scrapline contributors
- License: CC0-1.0 (public domain dedication; no attribution required)
- Files:
  - packages/client/assets/ui/
