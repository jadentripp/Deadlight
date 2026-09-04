# DEADLIGHT

A browser wave-survival zombie FPS in the spirit of round-based zombies modes: points, barricaded windows, wall-buys, a Mystery Box, perks gated behind the power switch, Pack-a-Punch upgrades and classic power-ups — with a fully synthesized soundscape and touch controls for phones.

**Play:** [Deadlight on GitHub Pages](https://jadentripp.github.io/Deadlight/)

Built with [Three.js](https://threejs.org). The game, renderer, models, and animation data are served from the same origin. Google Fonts is optional; local font fallbacks remain available.

## Mobile polish and motion update

- Cacheable model files and one shared zombie decode replace the 20 MB inline page. The entry HTML is now about 9 KB; the original model data still downloads separately.
- Clearer combat HUD, larger touch controls, safe-area spacing, quality settings, reduced camera motion, adaptive resolution, and a fixed light budget.
- Action-driven character animation, travel-matched gaits, additive hit reactions, and proper elbow placement.
- Crawlers rise, vault through the window opening, and return to crawling. New crawl idle, attack, barricade, climb, and death clips complete the original 13-clip set.
- Input cancellation, pause recovery, touch semiautomatic firing, line-of-sight aim assist, and exclusive first-person hand actions.

Read the [animation audit](docs/ANIMATION_AUDIT.md) for findings, verification, and remaining visual limitations, and the [architecture notes](docs/ARCHITECTURE.md) for ownership boundaries and the WebGPU decision.

## Development

Use Node.js 22 or newer. The tracked `vendor/` directory and assets allow static hosting without a bundler at runtime.

```sh
npm ci
npm test
npm run build
npm run dev
```

The build produces `dist/`. Serving the repository directly also works, including GitHub Pages under a repository subpath. Open the game through HTTP(S), not `file://`.

To edit the pose corrections, change `scripts/refine-animations.mjs`, then run `npm run bake:animations` and `npm test`. The original GLB remains unchanged. `scripts/render-poses.mjs` exports actual skinned mesh samples; `scripts/render-poses.py` makes contact sheets using NumPy and Matplotlib. These CPU audit views do not reproduce the game's lighting or materials.

## Controls

| Desktop | | Mobile |
|---|---|---|
| WASD move · Mouse look · Shift sprint | | Left thumb: virtual joystick (push far to sprint) · Right thumb: drag to look |
| LMB fire · RMB aim · R reload | | FIRE (hold) · AIM · RELOAD buttons |
| F buy / interact · F (hold) repair barricade | | Tap the on-screen prompt (hold to repair) |
| G grenade · V knife · 1/2 or wheel swap · Esc pause | | FRAG · KNIFE · SWAP · pause button |

## Assets

- Zombie character: original, built for this project (AI-generated concept and base mesh, hand-authored rig, textures, and animation set) — see [`assets/ATTRIBUTION.txt`](assets/ATTRIBUTION.txt).
- All 9 weapons (Sidearm, Viper, Breacher, Sentinel, Warden, ARC-9, Mauler, Longbow, Nova): original models built for this project (AI-generated concept and base mesh, projected original textures), stored in `assets/models/` — see [`assets/ATTRIBUTION.txt`](assets/ATTRIBUTION.txt).
- Fonts via Google Fonts (Anton, Barlow Condensed, Share Tech Mono)
