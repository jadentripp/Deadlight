import {writeFileSync} from 'node:fs';
import * as THREE from 'three';
import {readRig} from './audit-animations.mjs';
import {solveTwoBone} from '../motion.js';
import {VAULT,climbPhase} from '../window-traversal.js';
import {contactPath} from '../gait.js';

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
    const sampleRate=/^(Walk2?|Run2?|Crawl)$/.test(name)?60:30;
    const count=Math.ceil(duration*sampleRate),times=[],data=bones.map(()=>({p:[],q:[]}));
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
  // Bone lengths and foot orientation come from the actual bind skeleton.
  const footOrientation={L:get('footL').getWorldQuaternion(new THREE.Quaternion()),R:get('footR').getWorldQuaternion(new THREE.Quaternion())};
  const setWorldRotation=(bone,q)=>{
    bone.parent.getWorldQuaternion(parentQ).invert();bone.quaternion.copy(parentQ.multiply(q));
    scene.updateMatrixWorld(true);
  };
  const plantFoot=(side,point,bend)=>{
    solveChain(get('thigh'+side),get('shin'+side),get('foot'+side),point,bend);
    setWorldRotation(get('foot'+side),footOrientation[side]);
  };
  const standingFeet=()=>{
    for(const side of ['L','R']) {
      const sign=side==='L'?1:-1;
      target.set(sign*.105,-.875,side==='L'?.065:-.105);
      pole.set(sign*.13,-.38,.65);plantFoot(side,target,pole);
    }
  };
  const locomotion=(name,p)=>{
    const crawl=name==='Crawl',role=name.toLowerCase(),run=name.startsWith('Run');
    const angle=p*Math.PI*2,hips=get('hips');
    if(crawl) {
      // Low commando crawl: alternate pulling hands and bent, dragging legs.
      // The source kicked both heels into the air like a swimming stroke.
      hips.position.set(.014*Math.sin(angle),-.735,-.003);
      hips.rotation.z=.022*Math.sin(angle);
      get('chest').rotation.z=-.025*Math.sin(angle);
      scene.updateMatrixWorld(true);
      for(const side of ['L','R']) {
        const sign=side==='L'?1:-1,q=p+(side==='R'?.5:0),hand=contactPath(role,q);
        target.set(sign*.25,-.915+hand.y,.565+hand.z);
        pole.set(sign*.5,-.87,.25);
        solveChain(get('upperarm'+side),get('forearm'+side),get('hand'+side),target,pole);
        const leg=contactPath(role,q+.5);
        target.set(sign*.15,-.875+leg.y*.35,-.715+leg.z*.48);
        pole.set(sign*.50,-.89,-.23);plantFoot(side,target,pole);
      }
      return;
    }
    hips.position.x=.018*Math.sin(angle);
    hips.position.y=run?-.150-.030*Math.sin(angle*2):-.105+.018*Math.cos(angle*2);
    hips.rotation.z=.025*Math.sin(angle);
    hips.rotation.y=.055*Math.sin(angle);
    get('chest').rotation.y=-.07*Math.sin(angle);
    get('chest').rotation.z=-.018*Math.sin(angle);
    get('neck').rotation.z*=.45;get('head').rotation.z*=.55;
    scene.updateMatrixWorld(true);
    for(const side of ['L','R']) {
      const sign=side==='L'?1:-1,q=p+(side==='R'?.5:0),foot=contactPath(role,q);
      target.set(sign*.105,-.875+foot.y,foot.z);
      pole.set(sign*.13,-.3,.8);plantFoot(side,target,pole);
      // Arms counter the opposite leg; elbows stay below/outside shoulders.
      const swing=Math.cos(q*Math.PI*2),reach=run?.18:.14;
      target.set(sign*.28,run?.05:-.055,(run?.18:.08)-swing*reach);
      pole.set(sign*.30,-.35,-.22);
      solveChain(get('upperarm'+side),get('forearm'+side),get('hand'+side),target,pole);
      // Let the wrist follow the forearm; preserving its old world rotation
      // after re-aiming the elbow produced a visibly broken wrist.
      get('hand'+side).quaternion.identity();scene.updateMatrixWorld(true);
    }
  };
  for(const source of gltf.animations) {
    const name=source.name, isHit=name.startsWith('HitReact'), loop=/^(Idle|Walk2?|Run2?|Crawl)$/.test(name);
    const duration=name==='Idle'?3.4:source.duration;
    const clip=bake(name,duration,p=>{
      sample(source,p);
      if(/^(Walk2?|Run2?|Crawl)$/.test(name)) {locomotion(name,p);return;}
      if(name==='Idle') get('hips').position.y=THREE.MathUtils.lerp(-.008,get('hips').position.y,.35);
      if(name==='Idle'||name.startsWith('Attack')) {
        get('hips').position.y-=.035;scene.updateMatrixWorld(true);standingFeet();
        if(name.startsWith('Attack'))for(const side of ['L','R']) {
          const sign=side==='L'?1:-1;
          get('hand'+side).getWorldPosition(target);target.x=sign*Math.max(.10,Math.abs(target.x));
          pole.set(sign*.52,.0,.1);
          solveChain(get('upperarm'+side),get('forearm'+side),get('hand'+side),target,pole);
        }
        return;
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
    sample(crawl,0);const support=get('handL').getWorldPosition(v()),lunge=Math.sin(Math.PI*p)**2;
    get('hips').position.z+=.12*lunge;get('chest').rotation.x-=.1*lunge;scene.updateMatrixWorld(true);
    pole.set(.5,-.87,.25);solveChain(get('upperarmL'),get('forearmL'),get('handL'),support,pole);
    get('handR').getWorldPosition(target);target.z+=.22*lunge;target.y+=.20*lunge;
    pole.set(-.7,-.55,.55);solveChain(get('upperarmR'),get('forearmR'),get('handR'),target,pole);
  }));
  out.push(bake('CrawlDeath',1.4,p=>{
    sample(crawl,0);const fall=1-Math.pow(1-p,3);
    get('hips').position.y-=.18*fall;get('chest').rotation.z+=.15*fall;get('head').rotation.x+=.2*fall;
    scene.updateMatrixWorld(true);
    for (const side of ['L','R']) {
      const foot=get('foot'+side);foot.getWorldPosition(target);target.y=THREE.MathUtils.lerp(target.y,-.865,fall);
      // A prone corpse settles sideways at the knee. The standing knee pole
      // lifted both knees into an arched pose as the pelvis hit the floor.
      pole.set(side==='L'?.6:-.6,-.86,-.35);solveChain(get('thigh'+side),get('shin'+side),foot,target,pole);
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
    // Keep the bash crouched instead of popping instantly to full height.
    const brace=Math.sin(Math.PI*p)**2;
    get('hips').position.z+=.32*brace;get('hips').position.y-=.30*brace;groundLegs();
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
