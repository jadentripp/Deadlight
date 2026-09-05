# Caretaker game integration

The game uses the approved Caretaker from the separate zombie review project, revision `eeb3fd7caca8551e183cdcc7029acd7b4cf13546`. The GLB is copied unchanged: 3,375,320 bytes, 29,126 triangles across five meshes, 53 joints, six embedded textures, and 18 embedded clips.

Review and editable source: https://deadlight-zombie-review.jadentripp.chatgpt.site
Recorded pose videos and Gemini critique: https://deadlight-zombie-review.jadentripp.chatgpt.site/audit.html

## Runtime contract

- `zombie-rig.js` explicitly maps legacy anatomical roles to the new pelvis, segmented spine, clavicle, arm and leg joints. Missing joints fail asset registration rather than silently disabling contact handling.
- The exported root is already grounded in metres. Its origin stays at zero; the old rest-bounds recentering and one-metre floor offset are not applied. Combined spawn scale is capped at 1.10 for the calibrated aperture; current spawn rules produce a minimum above .896.
- The three variants share geometry and textures. Only clothing receives slight colour variation. Skin, cloudy eyes, roughness, normal maps, and embedded textures retain the reviewed appearance.
- All animation roles bind to embedded clips. `Attack2` strikes with the character's left arm; `Attack3` with the right. Clip duration and authored contact phase govern damage. Gait phase follows completed distance, and crawling uses its authored .62-cycle support phase and .34/.62-metre stride.
- Embedded hit reactions are absolute poses over Idle. Copies are converted to additive deltas against that exact reference and restricted to spine, neck and head; limbs and root stay owned by locomotion. Attacks, vaults and death cancel the overlay.
- Fixed-radius bullet capsules follow pelvis/chest and leg bones, with a head sphere. Navigation still owns a fixed collision radius; animated mesh bounds never drive gameplay collision.
- Standing and crawler window paths have separate approach distances and crossing timing. A small offline table stores root lift measured from the exported mesh, twelve scales, and 101 phases. Runtime interpolation does no vertex scans. Begin-vault alignment puts the actor on the opening centreline; navigation and crowd shoves yield until the action completes.

## Verification and limits

`npm test` loads the actual GLB in Three.js (texture decoding omitted only for CPU tests). Checks cover animation binding, single-arm attack independence and 120 Hz continuity, visible crawl/attack hand motion, floor pins, hit masks and hit zones, and all five skinned meshes clearing the window sill, lintel and jambs at intermediate scales and 240 phase samples. Game simulation exercises crawler traversal at 30, 60 and 120 Hz, single damage events, corpse timing, and existing mobile input/weapon regressions.

The numerical aperture check proves clearance for this centred path, flat floor and spawn-scale range; it does not establish realistic finger grips or perfect weight transfer. Previous video judging still flags some leg dragging and death settling. Browser WebGL is unavailable in the agent environment, so visual gameplay and sustained mobile GPU frame rate require device review. No 60 fps claim is made.

## Provenance

The MakeHuman hm08 base, bundled anatomical targets, weights and system assets are CC0. MPFB 2.0.17 was used only as an external Blender authoring tool; its GPL application code is not bundled in the game. Source asset release holders: Data Collection AB, Joel Palmius and Jonas Hauquier. See the asset attribution file and the review project's editable source and texture prompts.
