import {writeFileSync} from 'node:fs';
import * as THREE from 'three';
import {readRig} from './audit-animations.mjs';
import {solveTwoBone} from '../motion.js';
import {VAULT,climbPhase} from '../window-traversal.js';

// Bake corrections once, outside the mobile render loop. Original GLB is kept
// untouched so the character, textures, and source animation remain recoverable.
export async function refineAnimations() {
  const gltf = await readRig(), scene = gltf.scene, mixer = new THREE.AnimationMixer(scene);
  const bones = []; scene.traverse(o => {if (o.isBone) bones.push(o);});
  const get = name => scene.getObjectByName(name);
  const bind = bones.map(b => ({p:b.position.clone(), q:b.quaternion.clone(), s:b.scale.clone()}));
  const reset = () => bones.forEach((b,i) => {b.position.copy(bind[i].p);b.quaternion.copy(bind[i].q);b.scale.copy(bind[i].s);});
  const clips = new Map(gltf.animations.map(c => [c.name,c]));
  const v = () => new THREE.Vector3();
  const root=v(), target=v(), pole=v(), joint=v(), end=v(), current=v(), desired=v();
  const parentQ = new THREE.Quaternion(), rotation = new THREE.Quaternion(), originalQ = new THREE.Quaternion();
  const aim = (bone, child, point) => {
    bone.getWorldPosition(root); child.getWorldPosition(current);
    current.sub(root).normalize(); desired.copy(point).sub(root).normalize();
    rotation.setFromUnitVectors(current,desired);
    bone.getWorldQuaternion(originalQ); bone.parent.getWorldQuaternion(parentQ).invert();
    bone.quaternion.copy(parentQ.multiply(rotation).multiply(originalQ));
    scene.updateMatrixWorld(true);
  };
  const solveChain = (upper, lower, tip, goal, bend) => {
    const tipOrientation=tip.getWorldQuaternion(new THREE.Quaternion());
    upper.getWorldPosition(root);
    solveTwoBone(root, goal, bend, lower.position.length(), tip.position.length(), joint, end);
    // aim() reuses scratch vectors; preserve the solved endpoint.
    const solvedEnd = end.clone(); aim(upper,lower,joint); aim(lower,tip,solvedEnd);
    tip.parent.getWorldQuaternion(parentQ).invert();tip.quaternion.copy(parentQ.multiply(tipOrientation));
    scene.updateMatrixWorld(true);
  };
  const groundLegs = () => {
    scene.updateMatrixWorld(true);
    for (const side of ['L','R']) {
      const foot=get('foot'+side);foot.getWorldPosition(target);
      if (target.y >= -.865) continue;
      target.y=-.865;
      get('thigh'+side).getWorldPosition(pole);pole.y+=.65;pole.z+=.45;
      solveChain(get('thigh'+side),get('shin'+side),foot,target,pole);
    }
  };
  const sample = (source, phase) => {
    mixer.stopAllAction();reset();const action=mixer.clipAction(source);
    action.reset().setLoop(THREE.LoopOnce,1);action.clampWhenFinished=true;action.play();
    action.time=source.duration*Math.min(phase,.999999);mixer.update(0);scene.updateMatrixWorld(true);
  };
  const bake = (name, duration, poser, loop=false) => {
    const count=Math.ceil(duration*30),times=[],data=bones.map(()=>({p:[],q:[]}));
    for(let i=0;i<=count;i++) {
      const phase=i/count;times.push(duration*phase);poser(loop&&i===count?0:phase);scene.updateMatrixWorld(true);
      bones.forEach((b,j)=>{b.position.toArray(data[j].p,data[j].p.length);const values=data[j].q;
        // A consistent quaternion hemisphere prevents interpolated sign flips.
        if(values.length&&b.quaternion.dot(new THREE.Quaternion().fromArray(values,values.length-4))<0)b.quaternion.set(-b.quaternion.x,-b.quaternion.y,-b.quaternion.z,-b.quaternion.w);
        b.quaternion.toArray(values,values.length);
      });
    }
    const tracks=[];bones.forEach((b,i)=>{tracks.push(new THREE.VectorKeyframeTrack(b.name+'.position',times,data[i].p),new THREE.QuaternionKeyframeTrack(b.name+'.quaternion',times,data[i].q));});
    return new THREE.AnimationClip(name,duration,tracks);
  };
  const out=[];
  for(const source of gltf.animations) {
    const name=source.name, isHit=name.startsWith('HitReact'), loop=/^(Idle|Walk2?|Run2?|Crawl)$/.test(name);
    const duration=name==='Idle'?3.4:source.duration;
    const clip=bake(name,duration,p=>{
      sample(source,p);
      if(name==='Idle') get('hips').position.y=THREE.MathUtils.lerp(-.008,get('hips').position.y,.35);
      if(name==='Crawl') {
        get('hips').position.y-=.14;scene.updateMatrixWorld(true);
        for(const side of ['L','R']) {
          const phase=p*Math.PI*2+(side==='R'?Math.PI:0),hand=get('hand'+side);
          hand.getWorldPosition(target);target.y=-.90+Math.max(0,Math.sin(phase))*.10;target.z+=Math.cos(phase)*.13;
          pole.set(side==='L'?.7:-.7,-.6,.55);
          solveChain(get('upperarm'+side),get('forearm'+side),hand,target,pole);
        }
      }
      if(name==='Climb') {
        const tuck=Math.sin(Math.PI*p)**2;
        const feet=['L','R'].map(side=>get('foot'+side).getWorldPosition(v()));
        get('hips').position.y-=.48*tuck;
        get('chest').rotation.x+=.35*tuck;
        scene.updateMatrixWorld(true);
        for (let i=0;i<2;i++) {
          const side=i===0?'L':'R';target.copy(feet[i]);target.y+=.30*tuck;
          get('thigh'+side).getWorldPosition(pole);pole.y+=.65;pole.z+=.55;
          solveChain(get('thigh'+side),get('shin'+side),get('foot'+side),target,pole);
        }
      }
      if(name==='Death'||name==='Crawl') groundLegs();
      else if(!isHit&&name!=='Climb') {
        scene.updateMatrixWorld(true);
        const low=Math.min(get('footL').getWorldPosition(v()).y,get('footR').getWorldPosition(v()).y);
        // Remove only penetration. Preserve airborne run phases and weight shift.
        if(low<-.875)get('hips').position.y+=-.875-low;
      }
    },loop);
    if(isHit) {
      THREE.AnimationUtils.makeClipAdditive(clip,0,clip,30);
      clip.tracks=clip.tracks.filter(t=>/^(spine|chest|neck|head|shoulder|upperarm|forearm|hand)/.test(t.name)&&t.name.endsWith('.quaternion'));
      for(const track of clip.tracks) for(let i=0;i<track.times.length;i++) {
        const q=new THREE.Quaternion().fromArray(track.values,i*4);
        const p=track.times[i]/duration;
        const strength=/shoulder|upperarm/.test(track.name)?.3:/forearm|hand/.test(track.name)?.55:.7;
        q.slerp(new THREE.Quaternion(),1-strength*Math.sin(Math.PI*p));q.toArray(track.values,i*4);
      }
    }
    out.push(clip);
  }
  const crawl=out.find(c=>c.name==='Crawl');
  out.push(bake('CrawlIdle',3.4,p=>{sample(crawl,0);get('chest').rotation.x+=Math.sin(p*Math.PI*2)*.018;},true));
  out.push(bake('CrawlAttack',1.2,p=>{
    sample(crawl,0);const lunge=Math.sin(Math.PI*p)**2;
    get('hips').position.z+=.12*lunge;get('chest').rotation.x-=.1*lunge;scene.updateMatrixWorld(true);
    get('handR').getWorldPosition(target);target.z+=.22*lunge;target.y+=.20*lunge;
    pole.set(-.7,-.55,.55);solveChain(get('upperarmR'),get('forearmR'),get('handR'),target,pole);
  }));
  out.push(bake('CrawlDeath',1.4,p=>{
    sample(crawl,0);const fall=1-Math.pow(1-p,3);
    get('hips').position.y-=.18*fall;get('chest').rotation.z+=.15*fall;get('head').rotation.x+=.2*fall;
    scene.updateMatrixWorld(true);
    for (const side of ['L','R']) {
      const foot=get('foot'+side);foot.getWorldPosition(target);target.y=THREE.MathUtils.lerp(target.y,-.865,fall);
      pole.set(side==='L'?.3:-.3,-.45,-.5);solveChain(get('thigh'+side),get('shin'+side),foot,target,pole);
      get('hand'+side).getWorldPosition(target);target.y=Math.max(-.90,target.y);
      pole.set(side==='L'?.7:-.7,-.6,.55);solveChain(get('upperarm'+side),get('forearm'+side),get('hand'+side),target,pole);
    }
  }));
  const blendPose = (a,pa,b,pb,weight) => {
    sample(a,pa);const first=bones.map(b=>({p:b.position.clone(),q:b.quaternion.clone()}));
    sample(b,pb);bones.forEach((b,i)=>{b.position.lerpVectors(first[i].p,b.position,weight);b.quaternion.slerpQuaternions(first[i].q,b.quaternion.clone(),weight);});
  };
  const climb=out.find(c=>c.name==='Climb'),ease=t=>t*t*(3-2*t);
  const traversal=VAULT.crawler;
  out.push(bake('CrawlClimb',traversal.duration,p=>{
    if(p<traversal.start) blendPose(crawl,0,climb,0,ease(p/traversal.start));
    else if(p<traversal.end) sample(climb,climbPhase(p,true));
    else blendPose(climb,.999999,crawl,0,ease((p-traversal.end)/(1-traversal.end)));
    if(p<traversal.start||p>traversal.end)groundLegs();
  }));
  const swipe=out.find(c=>c.name==='Attack2');
  out.push(bake('CrawlBash',1.5,p=>{
    if(p<.18) blendPose(crawl,0,swipe,0,ease(p/.18));
    else if(p<.80) sample(swipe,(p-.18)/.62);
    else blendPose(swipe,.999999,crawl,0,ease((p-.8)/.2));
    get('hips').position.z+=.55*Math.sin(Math.PI*p)**2;groundLegs();
  }));
  mixer.stopAllAction();reset();
  return out;
}

if(process.argv[1]?.endsWith('refine-animations.mjs')) {
  const clips=await refineAnimations();
  const json=JSON.stringify({version:1,clips:clips.map(c=>THREE.AnimationClip.toJSON(c))},(key,value)=>typeof value==='number'?Math.round(value*1e6)/1e6:value);
  writeFileSync(new URL('../assets/animations.json',import.meta.url),json);
  console.log(`Baked ${clips.length} clips (${(json.length/1024).toFixed(0)} KiB).`);
}
