# Skyscrap — recon report

Site: https://play.skyscrap.fun — "a jetpack shooter you play in the browser", free, no sign-up.
Made by a Nigerian dev (lagosLife platform flag; gele/danfo/jollof cosmetics).

## Stack
- PixiJS v8 (WebGL renderer), Vite build, PWA (service worker, offline play)
- Client bundle: `boot-ugnRyfYG.js` (1.5 MB, game + full deterministic sim + offline bots),
  shared libs in `wakeLock-YwAzvUPu.js` (78 KB: constants, codec, net utils)
- Copies of all bundles saved in `recon/`

## Game rules (all constants extracted, from wakeLock bundle)
- **Tick rate: 60 Hz.** Aim quantized to 4096 steps. moveX quantized to 1/64.
- Player: 26×58 px (crouch 40), run 290 px/s, crouch 120, hop 300 px/s
- Jetpack: accel 3350, max up 470, fuel 100, burn 34/s, regen 60/s ground / 14/s air (0.35 s delay), min 8 to start
- Physics: gravity 1550, maxFall 1150, groundAccel 2600, groundFriction 2300, airAccel 1500, airDrag 160
- Health 100, regen 10/s after 5 s, respawn 3 s, spawn protection 1.5 s, max 3 grenades
- Match: 5 min time limit, score limit 25 kills, ffa or tdm, end delay 6 s
- Pickups: weapons respawn 15 s, health +50 @ 20 s, grenades +2 @ 20 s, pickup radius 22
- Destructible props: barrels 26×34 hp30 (respawn 30 s), crates 30×30 hp60 (25 s)
- Grenade: fuse 2.4 s, throw 760 px/s, inherits ½ velocity, gravity 1300, bounce 0.45, 115 dmg, 165 px radius, 0.6 s cooldown
- Melee: 34 dmg, 58 px range, ~70° arc, 0.5 s cooldown, knockback 300

## Weapons (id, name, kind, dmg, interval(ticks), mag, spread, range)
| id | name | kind | dmg | interval | mag | spread | range |
|----|------|------|-----|----------|-----|--------|-------|
| pistol | Viper P9 | hitscan | 20 | 14 | 12 | .022 | 950 |
| smg | Hornet SMG | hitscan | 11 | 5 | 32 | .07 | 760 |
| rifle | Ranger AR | hitscan | 17 | 7 | 30 | .034 | 1150 |
| shotgun | Breacher | hitscan | 9×8 pellets | 30 | 5 | — | 560 |
| sniper | Longbow | hitscan | 95 | 60 | 5 | .004 | 2600 |
| rocket | Thumper | projectile | 110 + splash 150px | 54 | 2 | .01 | 3000 |
| ricochet | Ricochet | projectile disc | 40 | 22 | 6 | .012 | — |
| vortex | Vortex | projectile orb | 110, pull 2400, 256px | 50 | 2 | .01 | — |
| rhino | Rhino | hitscan minigun | 10 | 3 | 200 | .035 | 950 |
- Headshot multipliers 1.3–1.6. Sniper has scope (spin-up 0.45 s, run/jet scaled 0.75/0.7).

## Maps
ffa/tdm maps: Dune Refinery, Frostbite Station, Jungle Temple, Kilima Outpost, Neon Rooftops, Sundial Hill.
Art themes: suburb, dune, frost, jungle, neon, savanna. Tile-based defs embedded in boot.

## Netcode (REST + WebSocket)
REST (same origin): `/api/config`, `/api/ping`, `/api/guest/session` (guest accounts, **ALTCHA proof-of-work bot check**), `/api/mm/quick|private|join|watch` (matchmaking), `/api/party/*`, `/api/wifi/*`, `/api/pad/*` (phone as gamepad), `/api/stats/me`, `/api/leaderboard`.
- Config says `proto: 4`, region eu, 0 players online at recon time.
- WS URL: `wss://{host}/{processId}/{roomId}?sessionId=...&reconnectionToken=...`
- Channels (binary frames): client→srv `INPUT:1, CONTROL:2, PING:3`; srv→client `SNAPSHOT:1, CONTROL:2, PONG:3`
- CONTROL = JSON: `{t:'hello', proto, view:[w,h], saver, client:{browser,os,conn,build,touch}}`; also start/rules/vote/votekick/chat/mute/report/follow/lane/leave
- INPUT packet (bit-packed, delta-compressed, up to 12 inputs/packet):
  `[hasAck? ackSeq:16, ackDelayMs:8×2] firstTick:16 count:4bits(1-12) viewDelay:9bits, then per input: repeat?1bit | moveX:signed8 (−64..64), aim:12bits, buttons:10bits`
- Buttons bitmask: `JET:1 CROUCH:2 FIRE:4 THROW:8 MELEE:16 RELOAD:32 SWAP:64 INTERACT:128 SCOPE:256 GHOST:512`
- Snapshot per player: `x:16bits y:16bits aim:12bits flags weapon hp:7bits shield:6bits` + event stream
  (shot, projectile, bounce, explosion, damage, kill, melee, pickup, vortex, disc…)
- Optional "datagram lane" (WebRTC DataChannel) upgrade for unreliable input/snapshot transport.

## Key insight for an RL bot
The **full deterministic 60 Hz simulation runs in the client bundle** (used for prediction) and the game
has an **offline mode vs built-in bots** (skill-scaled, `botCount` + `skill` params). So a training
environment can be built headlessly from the shipped code — no server, no accounts, no limits.
Online play via the documented protocol is also possible (guest session + ALTCHA PoW), but playing
against real humans on live servers is a separate decision from training.

## Recommended bot path
1. **Phase 1 (env):** run boot's local match (`Ek` class) headless in Node (stub Pixi renderer/audio),
   or reimplement sim in Python from extracted constants. Node-headless is far cheaper and stays exact.
2. **Phase 2 (interface):** observation = own player + visible enemies + projectiles + pickups + map tiles;
   action = moveX (−1..1), aim (continuous→quantize), buttons (jet/crouch/fire/throw/reload/swap).
3. **Phase 3 (training):** self-play PPO vs built-in bots at ramping skill, then vs itself.
4. **Phase 4 (optional):** take the policy online (needs session + ALTCHA solve; decide separately).
