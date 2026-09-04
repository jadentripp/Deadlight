# Motion architecture and renderer decision

## Why crawlers bypassed windows

The original animation chain checked `crawler` before `attack` and `enter`. A locomotion style competed with gameplay actions, so a crawler could keep playing its prone loop while navigation moved it through a zombie-only window channel. Meanwhile, movement progress, clip playback, attack damage, and corpse cleanup each used independent timing rules.

The fix establishes ownership:

| Module | Owns | Boundary |
|---|---|---|
| `game.js` | Game state, AI decisions, completed movement, combat clocks and damage | Sends animation snapshots; does not advance clocked clips independently |
| `zombie-animation.js` | Action-to-posture clip selection, mixer transitions, gait phase, additive hits, inactive action cleanup | Does not move characters or apply damage |
| `window-traversal.js` | Approach/landing points, vault duration, phase, path and height | Shared by gameplay, animation baking, and geometry checks |
| `motion.js` | Contact phases, gait stride values, limb IK, smooth hand paths, action eligibility | Pure helpers independent of DOM, rendering and game state |
| `scripts/refine-animations.mjs` | Reproducible authored corrections and additional crawler clips | Runs offline; outputs `assets/animations.json` |

Action has priority. `enter` resolves to Climb or CrawlClimb; `bash` to a posture-compatible barricade action; `death` to Death or CrawlDeath. Crawling is a clip choice within the action, never a reason to bypass it. Active vaults own horizontal movement; generic navigation and crowd separation do not advance them. The actor returns to chasing only when the shared timeline completes.

Reload may be interrupted by a new action. Swap, melee, and grenade are exclusive so two independent animation booleans cannot control the same hands. Hand contact phases are also used for reload sounds, knife damage and grenade release.

The remaining gameplay orchestration is still in `game.js`. Future extraction should follow concrete ownership boundaries—asset loading, renderer/post-processing, input, and game simulation—while retaining the regression tests. A wholesale engine rewrite is unnecessary for the bugs addressed here.

## WebGL, WebGPU, and vgpu

This review build keeps Three.js r170 and WebGL. Its current GLSL ShaderMaterials, layered viewmodel rendering, and EffectComposer stack require a deliberate migration to Three.js's newer node-material and post-processing APIs. Three.js supports WebGPU with WebGL2 fallback, but its own migration guide still identifies limitations and advises checking performance for the application's workload. [Three.js WebGPURenderer guide](https://threejs.org/manual/en/webgpurenderer.html)

WebGPU is available on modern mobile platforms, including Safari 26 and supported Android Chrome devices. Older devices and browser/GPU combinations still justify a fallback. [WebKit Safari 26 release notes](https://webkit.org/blog/17333/webkit-features-in-safari-26-0/), [Chrome WebGPU Android support](https://developer.chrome.com/blog/new-in-webgpu-121)

Vercel's vgpu is a WebGPU library with an optional `vgpu/three` adapter. Its `tslExports` API makes reusable WGSL functions callable from Three.js node materials; Three.js still owns the renderer, scene, bindings and render loop. It is useful for shader authoring, not a replacement for character animation, navigation, or collision. Its Three.js integration currently targets Three 0.180 or newer. [vgpu Three.js integration](https://github.com/vercel-labs/vgpu/blob/canary/docs/topics/threejs.docs.md)

Recommended next renderer experiment: update Three.js in an isolated branch, port the custom effects and layered rendering to the node pipeline, use WebGPU with WebGL2 fallback, and compare image parity, sustained frame time, startup time, and memory on actual phones. Adopt vgpu if reusable WGSL modules improve that work. No WebGPU performance gain is claimed for this build.
