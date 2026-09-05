# DEADLIGHT

A browser wave-survival zombie FPS in the spirit of round-based zombies modes: points, barricaded windows, wall-buys, a Mystery Box, perks gated behind the power switch, Pack-a-Punch upgrades and classic power-ups — with a fully synthesized soundscape and touch controls for phones.

**Play:** [Deadlight on GitHub Pages](https://jadentripp.github.io/Deadlight/)

**Caretaker preview:** [Private game build](https://deadlight-polish.jadentripp.chatgpt.site)

Built with [Three.js](https://threejs.org). The game, renderer, models, and animation data are served from the same origin. Google Fonts is optional; local font fallbacks remain available.

## Mobile polish and motion update

- The reviewed Caretaker now replaces every loaded enemy: anatomical mesh, decayed skin, cloudy eyes, 53 joints, and 18 embedded animations. Left and right swipes retain their independent arm motion.
- An explicit rig adapter preserves the reviewed materials, maps floor contacts and anatomical bullet hit zones, and converts absolute hit reactions into torso-only additive motion. Window paths are calibrated for the new proportions.
- Cacheable model files and one shared zombie decode replace the 20 MB inline page. The entry HTML is now about 9 KB; the original model data still downloads separately.
- Clearer combat HUD, larger touch controls, safe-area spacing, quality settings, reduced camera motion, adaptive resolution, and a fixed light budget.
- Action-driven character animation, travel-matched gaits, additive hit reactions, and proper elbow placement.
- Rebuilt stance/swing cycles, floor contact locking, grounded crawler pulls, regional character looks, and first-person lighting for the original gun models.
- Crawlers rise, vault through the window opening, and return to crawling. New crawl idle, attack, barricade, climb, and death clips complete the original 13-clip set.
- Input cancellation, pause recovery, touch semiautomatic firing, line-of-sight aim assist, and exclusive first-person hand actions.

Read the [animation audit](docs/ANIMATION_AUDIT.md) for findings, verification, and remaining visual limitations, and the [architecture notes](docs/ARCHITECTURE.md) for ownership boundaries and the WebGPU decision.

Open **`workshop.html`** on the game host to rotate Caretaker and all nine weapons, scrub poses, and play clips in slow motion. The older zombie remains available there for comparison.

## Development

Use Node.js 22 or newer. The tracked `vendor/` directory and assets allow static hosting without a bundler at runtime.

```sh
npm ci
npm test
npm run build
npm run dev
```

The build produces `dist/`. Serving the repository directly also works, including GitHub Pages under a repository subpath. Open the game through HTTP(S), not `file://`.

Caretaker uses the animations embedded in `assets/models/caretaker.glb`. See [integration notes](docs/CARETAKER.md) for provenance, rig conventions, and validation. After changing this mesh or its climb clips, run `node scripts/calibrate-caretaker-vault.mjs` and `npm test` to recalibrate and check the window path. The old `bake:animations` command and pose-render scripts only maintain the original character for comparison; they do not replace Caretaker's clips.

## Controls

| Desktop | | Mobile |
|---|---|---|
| WASD move · Mouse look · Shift sprint | | Left thumb: virtual joystick (push far to sprint) · Right thumb: drag to look |
| LMB fire · RMB aim · R reload | | FIRE (hold) · AIM · RELOAD buttons |
| F buy / interact · F (hold) repair barricade | | Tap the on-screen prompt (hold to repair) |
| G grenade · V knife · 1/2 or wheel swap · Esc pause | | FRAG · KNIFE · SWAP · pause button |

## Assets

- Caretaker zombie: CC0 MakeHuman anatomical base and system assets, original generated decay texture and Deadlight animation work — see [`assets/ATTRIBUTION.txt`](assets/ATTRIBUTION.txt). The original zombie remains as a comparison asset.
- All 9 weapons (Sidearm, Viper, Breacher, Sentinel, Warden, ARC-9, Mauler, Longbow, Nova): original models built for this project (AI-generated concept and base mesh, projected original textures), stored in `assets/models/` — see [`assets/ATTRIBUTION.txt`](assets/ATTRIBUTION.txt).
- Fonts via Google Fonts (Anton, Barlow Condensed, Share Tech Mono)
