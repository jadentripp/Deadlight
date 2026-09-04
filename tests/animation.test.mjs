import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as THREE from 'three';
import {clone} from 'three/addons/utils/SkeletonUtils.js';
import {readRig} from '../scripts/audit-animations.mjs';
import {ZombieAnimator,actionRole} from '../zombie-animation.js';
import {CONTACT,solveTwoBone,sampleMotion,canStartWeaponAction} from '../motion.js';
import {VAULT,vaultPose,windowPoint} from '../window-traversal.js';
const gltf=await readRig();
const clips=JSON.parse(readFileSync(new URL('../assets/animations.json',import.meta.url))).clips.map(c=>THREE.AnimationClip.parse(c));
const roles={idle:'Idle',walk:'Walk',walk2:'Walk2',run:'Run',run2:'Run2',crawl:'Crawl',crawlIdle:'CrawlIdle',crawlAttack:'CrawlAttack',crawlBash:'CrawlBash',crawlDeath:'CrawlDeath',crawlClimb:'CrawlClimb',climb:'Climb',attack:'Attack',attack2:'Attack2',attack3:'Attack3',hit:'HitReact',hit2:'HitReact2',death:'Death'};
function rig() {
  const obj=clone(gltf.scene),mixer=new THREE.AnimationMixer(obj),actions={};
  for(const [role,name]of Object.entries(roles))actions[role]=mixer.clipAction(clips.find(c=>c.name===name));
  const model={obj,mixer,actions,cur:null};model.animator=new ZombieAnimator(model);return model;
}
const snapshot={state:'chase',crawler:false,speed:1.55,scale:1,walkRole:'walk',runRole:'run',attackRole:'attack',attackTime:0,attackDuration:1.1667,vault:0,bashElapsed:0};
test('all 18 clips are valid; locomotion loops have matching poses',()=>{
  assert.equal(clips.length,18);
  for(const c of clips){assert.ok(c.validate(),c.name);for(const t of c.tracks)assert.ok([...t.values].every(Number.isFinite),c.name);}
  for(const c of clips.filter(c=>/^(Idle|Walk2?|Run2?|Crawl|CrawlIdle)$/.test(c.name)))for(const t of c.tracks){
    const n=t.getValueSize(),first=t.values.slice(0,n),last=t.values.slice(-n);
    if(n===4)assert.ok(new THREE.Quaternion().fromArray(first).normalize().angleTo(new THREE.Quaternion().fromArray(last).normalize())<.003,c.name);
    else assert.ok(Math.hypot(...first.map((v,i)=>v-last[i]))<1e-5,c.name);
  }
});
test('action owns clip selection for both postures, including crawler windows and death',()=>{
  const m=rig();
  for(const crawler of [false,true]){
    for(const state of ['rise','bash','enter']){
      m.animator.update({...snapshot,state,crawler,vault:.5,bashElapsed:.75},.016);
      assert.equal(m.curRole,actionRole(state,crawler,m.actions));
    }
    const role=crawler?'crawlAttack':'attack2';m.animator.update({...snapshot,state:'attack',crawler,attackRole:role,attackTime:.4,attackDuration:m.actions[role].getClip().duration},.016);
    assert.equal(m.curRole,role);assert.ok(Math.abs(m.cur.time-.4)<1e-5);
    assert.equal(actionRole('death',crawler,m.actions),crawler?'crawlDeath':'death');
  }
});
test('a blocked zombie settles to idle; changing gait preserves foot phase',()=>{
  const m=rig();m.animator.play('walk');m.cur.time=.4*m.cur.getClip().duration;
  m.animator.play('run');assert.ok(Math.abs(m.cur.time/m.cur.getClip().duration-.4)<1e-6);
  for(let i=0;i<60;i++)m.animator.update({...snapshot,speed:0},1/60);
  assert.equal(m.curRole,'idle');assert.ok(m.animator.actions.filter(a=>a.isScheduled()).length<=2);
});
test('hit reactions are additive and leave the locomotion leg pose untouched',()=>{
  const m=rig();m.animator.play('walk',0);m.cur.time=.7;m.mixer.update(0);
  const before=['thighL','shinL','thighR','shinR'].map(n=>m.obj.getObjectByName(n).quaternion.clone());
  m.animator.hit('chase');m.animator.advance(.25);
  for(const [i,name]of ['thighL','shinL','thighR','shinR'].entries())assert.ok(before[i].normalize().angleTo(m.obj.getObjectByName(name).quaternion.clone().normalize())<1e-5);
  for(const c of clips.filter(c=>c.name.startsWith('HitReact'))){assert.equal(c.blendMode,THREE.AdditiveAnimationBlendMode);assert.ok(c.tracks.every(t=>!/^hips|^thigh|^shin|^foot/.test(t.name)));}
});
test('inverse kinematics preserves limb lengths, clamps reach, and remains finite',()=>{
  const root=new THREE.Vector3(.26,-.3,.34),pole=new THREE.Vector3(.7,-.65,.45),joint=new THREE.Vector3(),end=new THREE.Vector3();
  for(const target of [new THREE.Vector3(.015,-.028,.03),new THREE.Vector3(-.24,-.02,-.18),new THREE.Vector3(-.02,-.04,-.34),root.clone(),new THREE.Vector3(10,10,10)]){
    solveTwoBone(root,target,pole,.36,.4,joint,end);
    assert.ok(Math.abs(root.distanceTo(joint)-.36)<1e-5);assert.ok(Math.abs(joint.distanceTo(end)-.4)<1e-5);
    assert.ok([...joint.toArray(),...end.toArray()].every(Number.isFinite));
  }
});
test('hand paths carry velocity through intermediate keys and preserve holds',()=>{
  const keys=[[0,{x:0}],[.3,{x:.2}],[.6,{x:.4}],[.8,{x:.4}],[1,{x:0}]];
  const h=1e-5,left=(sampleMotion(keys,.3).x-sampleMotion(keys,.3-h).x)/h,right=(sampleMotion(keys,.3+h).x-sampleMotion(keys,.3).x)/h;
  assert.ok(left>.4&&Math.abs(left-right)<.001);assert.equal(sampleMotion(keys,.7).x,.4);
  for(let i=0;i<=100;i++)assert.ok(sampleMotion(keys,i/100).x>=-1e-6&&sampleMotion(keys,i/100).x<=.400001);
});
test('weapon hand actions are exclusive and reload can be interrupted',()=>{
  const ready={holstered:false,swapping:false,meleeT:-1,grenadeT:-1,reloading:false};
  for(const action of ['swap','reload','melee','grenade']){
    assert.ok(canStartWeaponAction(action,ready));
    for(const busy of [{swapping:true},{meleeT:.2},{grenadeT:.2},{holstered:true}])assert.equal(canStartWeaponAction(action,{...ready,...busy}),false);
  }
  assert.ok(canStartWeaponAction('grenade',{...ready,reloading:true}));assert.equal(canStartWeaponAction('reload',{...ready,reloading:true}),false);
  assert.equal(CONTACT.melee,.42);assert.equal(CONTACT.grenade,.62);
});
test('traversal endpoints are inside the opening in all four wall orientations',()=>{
  for(const [dx,dz]of [[1,0],[-1,0],[0,1],[0,-1]])for(const crawler of [false,true]){
    const w={x:10,z:20,outer:{x:10-dx*.95,z:20-dz*.95},inner:{x:10+dx*1.3,z:20+dz*1.3}};
    const a=windowPoint(w,crawler),b=windowPoint(w,crawler,true),v=VAULT[crawler?'crawler':'standing'];
    assert.ok(Math.abs(Math.hypot(a.x-w.x,a.z-w.z)-v.approach)<1e-6);assert.ok(Math.abs(Math.hypot(b.x-w.x,b.z-w.z)-v.landing)<1e-6);
    assert.equal(vaultPose(0,crawler).travel,0);assert.equal(vaultPose(1,crawler).travel,1);
  }
});
test('skinned standing and crawler vaults clear the sill and lintel at minimum and maximum spawn scale',()=>{
  const m=rig();let mesh;m.obj.traverse(o=>{if(o.isSkinnedMesh)mesh=o;});const p=new THREE.Vector3();
  // Bounds include the metal frame: opening y=1.06..2.54, thickness=.6m.
  for(const scale of [.82,1.10])for(const crawler of [false,true]){
    const role=crawler?'crawlClimb':'climb',v=VAULT[crawler?'crawler':'standing'];m.mixer.stopAllAction();m.animator.play(role,0,true,0);
    for(let i=0;i<=50;i++){
      const phase=i/50;m.cur.time=Math.min(phase,.999999)*m.cur.getClip().duration;m.mixer.update(0);m.obj.updateMatrixWorld(true);mesh.skeleton.update();
      const {travel,height}=vaultPose(phase,crawler,scale),z=THREE.MathUtils.lerp(-v.approach,v.landing,travel);
      let low=Infinity,high=-Infinity;
      for(let j=0;j<mesh.geometry.attributes.position.count;j++){
        mesh.getVertexPosition(j,p).multiplyScalar(scale);p.y+=.99736*scale+height;p.z+=z;
        if(Math.abs(p.z)<.30&&Math.abs(p.x)<1.04){low=Math.min(low,p.y);high=Math.max(high,p.y);}
      }
      assert.ok(low>=1.06&&high<=2.54,`${role}, scale=${scale}, phase=${phase}, aperture y=${low.toFixed(3)}..${high.toFixed(3)}`);
    }
  }
});
