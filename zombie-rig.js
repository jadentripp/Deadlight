import * as THREE from 'three';

// Asset-space contracts live beside the rig, never inferred from an animated
// mesh's bounds. Caretaker is exported in metres with an already grounded root.
export const CARETAKER = Object.freeze({
  id: 'caretaker', height: 1.813678, origin: [0, 0, 0], maxScale: 1.10,
  bones: {hips:'pelvis', chest:'spine_03', head:'head',
    upperarmL:'upperarm_l', forearmL:'lowerarm_l', handL:'hand_l',
    upperarmR:'upperarm_r', forearmR:'lowerarm_r', handR:'hand_r',
    thighL:'thigh_l', shinL:'calf_l', footL:'foot_l',
    thighR:'thigh_r', shinR:'calf_r', footR:'foot_r'},
  stride: {walk:1.10, walk2:1.04, run:2.18, run2:1.76, crawl:.34/.62},
  stance: {walk:.62, walk2:.65, run:.38, run2:.42, crawl:.62},
  contact: {attack:.48, attack2:.50, attack3:.50, crawlAttack:.48, crawlBash:.48},
});

export function bindZombieRig(obj, profile) {
  const bones={};
  obj.traverse(b=>{if(b.isBone)bones[b.name]=b;});
  for(const [role,name] of Object.entries(profile?.bones||{})) {
    if(!bones[name])throw new Error(`Missing ${profile.id} joint: ${name}`);
    bones[role]=bones[name];
  }
  return bones;
}

export function prepareZombieClips(animations, profile) {
  if(profile?.id!=='caretaker')return animations;
  const idle=animations.find(c=>c.name==='Idle');
  if(!idle)throw new Error('Caretaker is missing its Idle reference pose');
  return animations.map(clip=>{
    if(!/^HitReact2?$/.test(clip.name))return clip;
    // Embedded reactions are absolute poses baked over Idle. Subtract that
    // exact reference and mask the torso so planted hands and legs keep moving.
    const hit=clip.clone();
    hit.tracks=hit.tracks.filter(t=>/^(spine_0[123]|neck_01|head)\.quaternion$/.test(t.name));
    return THREE.AnimationUtils.makeClipAdditive(hit,0,idle,30);
  });
}
