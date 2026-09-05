# Deadlight animation audit

Scope: all 13 source zombie clips, the procedural fallback, first-person poses across nine weapons, action transitions, window traversal, collision-driven movement, and related input/audio timing. Five additional crawler clips bring the shipped set to 18. The source character has 19 bones and about 45,000 triangles.

## Findings and changes

| Area | Finding | Change |
|---|---|---|
| Idle | A roughly one-second breathing loop and excessive root bob | 3.4-second breathing loop with smaller pelvis movement |
| Walk / Walk2 | Playback used desired velocity even when collision stopped movement; feet lacked a planted stance | Rebuilt contact trajectories, anatomically constrained knees and relaxed counter-swinging arms; completed distance directly advances phase |
| Run / Run2 | Walk/run changes reset the cycle; floating feet and weak weight transfer | Rebuilt alternating stance/swing, knee lift and pelvis compression; preserve gait phase; frame-rate-independent separation |
| Attack / Attack2 / Attack3 | Damage timing and clip durations were separately hard-coded; feet shifted underneath the body | Shared contact clock; staggered planted feet and constrained elbow bend planes |
| HitReact / HitReact2 | Full-body reactions replaced walking, including excessive raised arms | Masked additive upper-body reactions with reduced arm rotation, recovery envelope, and unchanged leg motion |
| Crawl | Crawl branch took precedence over attack and climb; floating support hands and swimming-like raised heels; duplicated height scaling | Alternating pulling hands, low dragging legs, slower travel, floor pins, action-first selection, separate hitbox sizing, and bone-based aim target |
| CrawlIdle / CrawlAttack | Crawlers lacked a stationary pose and compatible attack | Added prone breathing and a reaching strike with a shared contact phase |
| CrawlBash | A prone crawler could not visibly reach barricade boards | Rise, reach the boards, and recover before entering the vault |
| Climb / CrawlClimb | The pose intersected both sill and lintel; crawling never yielded to climbing; traversal ended before the clip | Crouch/tuck corrections, explicit crawler rise and settle transitions, one traversal timeline, and a longer crawler landing distance |
| Death | Feet penetrated the floor; sinking began after 1.6 seconds despite a 2.5-second clip | Baked leg corrections; play the entire death clip plus a hold before sinking |
| CrawlDeath | Crawlers transitioned into an upright death | Added a prone collapse with settling limbs |
| Rise | No source Rise clip exists | Retained the ground-emergence effect with the appropriate standing or prone idle pose |
| First-person arms | Centered capsule meshes were placed at the shoulder/elbow rather than between joints | Center each segment and solve elbows with fixed-length two-bone IK |
| Reload | Every intermediate hand key stopped; insertion audio fired while the hand was at the belt | Shape-preserving cubic paths; audio aligned with extraction, insertion, and bolt phases |
| Knife / grenade | Damage/release occurred before the visible contact pose; actions could overlap | Shared contact phases and exclusive hand-action guards |
| Player movement | Camera bob and footsteps continued while pushing into walls | Drive both from completed movement |

## Verification

`npm test` includes 29 regression tests. They cover all animation assets, both postures across action states, additive hits, loop continuity, gait changes and stops, IK reach, continuous hand paths, action exclusivity, mobile input recovery, all nine decoded weapon meshes, regional character materials, and isolated first-person lighting.

The second character pass checks 100 samples per gait: planted foot/hand trajectories stay within 2 mm of the intended source-space contact path. Gaits are baked at 60 samples per second. Runtime floor pins remain fixed through a moving turn and yield immediately to a vault; gait phase follows completed distance exactly, including acceleration and blocked motion. These are flat-floor contact constraints, not terrain raycasting.

The window geometry test skins every vertex at 51 timeline samples for standing and crawling at both extreme spawn scales: **204 full-mesh poses**. Vertices within the wall's 0.6 m thickness must fit the actual frame opening, **1.06–2.54 m high**. Separate tests check the four wall orientations and run the entire crawler traversal at **30, 60, and 120 updates per second**. First-person tests check connected joints throughout all nine weapon reloads, knife motion, and grenade motion.

CPU contact sheets inspect source and corrected poses using the actual skinned mesh, with neutral colors for comparison. Original character and weapon GLBs are retained without rewriting their geometry or textures.

## Pose samples

Neutral CPU renders of the original and corrected skeletons, without game lighting or textures:

![Original and corrected pose samples](pose-comparison.png)

![Crawler action sequences](pose-crawler.png)

## Practical limits

The available cloud browser has WebGL disabled, so a live GPU playthrough and phone frame-rate measurements were not possible. The startup failure was observed and now explains when 3D graphics are unavailable. Rendering, lighting, touch comfort, and sustained mobile performance still need confirmation on real devices before merging the review build.

This pass preserves the original stylized zombie mesh and procedural first-person hands. It adds flat-floor stance locking but does not add motion capture, articulated fingers/toes, terrain raycasting, or a physical ragdoll. The corpse clips and approximate body hit volumes remain authored approximations. The geometry regression covers the canonical vault path; arbitrary crowds, interrupted traversal, and all combat situations still benefit from device playtesting.

## Character appearance and weapon history

The three zombie definitions all use the same original mesh. Previously, a random whole-body tint and additional darkening obscured facial and clothing detail. The new Scavenger, Drifter and Worker looks color skin, clothing and trousers separately using skin weights, preserve facial brightness, and share immutable geometry buffers. They are appearance variants, not three newly sculpted characters. The original texture is available for comparison in `workshop.html`.

All nine gun files are byte-identical to the embedded GLBs in commit `d6cd245` ("Replace procedural box guns with 9 original GLB weapon models"). No better alternate gun set appears in the repository's main-branch history. Each original model decodes successfully with its UVs, normals and muzzle attachment. Equipping a missing model now requests it immediately; a completed download replaces the temporary procedural fallback. First-person-only key/fill lighting makes the original surfaces more readable without illuminating the bunker. The original projected textures and materials remain intact.

Open `workshop.html` to rotate every gun and the textured zombie, compare original/refined clips, scrub every pose, and inspect motion at half or quarter speed. This standalone preview samples clips in place; gameplay adds travel and runtime contact locking.

A larger art upgrade would require a better-authored character mesh and skin weights, articulated hands/toes, and grounded motion-capture or hand-keyed source clips. The current generated base mesh and projected texture remain the ceiling on close-up anatomical realism; additional polygons or a renderer switch alone will not fix them.
