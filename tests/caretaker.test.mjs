import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as THREE from 'three';
import {clone} from 'three/addons/utils/SkeletonUtils.js';
import {readRig} from '../scripts/audit-animations.mjs';
import {CARETAKER,bindZombieRig,prepareZombieClips} from '../zombie-rig.js';
import {ZombieAnimator} from '../zombie-animation.js';
import {vaultPose,vaultConfig} from '../window-traversal.js';
import {caretakerHitTest} from '../zombie-hit-zones.js';
import {applyCharacterLook} from '../character-look.js';
const gltf=await readRig('caretaker'),prepared=prepareZombieClips(gltf.animations,CARETAKER);
const roles={Idle:'idle',Walk:'walk',Walk2:'walk2',Run:'run',Run2:'run2',Crawl:'crawl',CrawlIdle:'crawlIdle',Climb:'climb',CrawlClimb:'crawlClimb',Attack:'attack',Attack2:'attack2',Attack3:'attack3',CrawlAttack:'crawlAttack',HitReact:'hit',HitReact2:'hit2',Death:'death',CrawlDeath:'crawlDeath',CrawlBash:'crawlBash'};
function rig() {
  const obj=clone(gltf.scene),mixer=new THREE.AnimationMixer(obj),actions={};
  for(const c of prepared)actions[roles[c.name]]=mixer.clipAction(c);
  const model={obj,mixer,actions,profile:CARETAKER,bones:bindZombieRig(obj,CARETAKER),cur:null};
  model.animator=new ZombieAnimator(model);return model;
}
const snapshot={state:'chase',crawler:false,speed:1,scale:1,walkRole:'walk',runRole:'run'};
const at=(m,role,phase)=>{m.cur.time=phase*m.actions[role].getClip().duration;m.mixer.update(0);m.obj.updateWorldMatrix(true,true);};

test('reviewed asset contains 53 joints, all 18 embedded clips, and opaque embedded textures',()=>{
  const src=readFileSync(new URL('../assets/models/caretaker.glb',import.meta.url)),n=src.readUInt32LE(12),json=JSON.parse(src.toString('utf8',20,20+n));
  assert.equal(json.skins[0].joints.length,53);assert.equal(gltf.animations.length,18);
  assert.ok(json.images.every(i=>i.bufferView!==undefined&&!i.uri));
  assert.ok(json.materials.every(m=>(m.alphaMode||'OPAQUE')==='OPAQUE'));
  const m=rig();assert.equal(Object.keys(m.actions).length,18);
  for(const c of gltf.animations){assert.ok(c.validate(),c.name);for(const t of c.tracks)assert.ok(m.obj.getObjectByName(t.name.split('.')[0]),t.name);}
  assert.throws(()=>bindZombieRig(new THREE.Group(),CARETAKER),/Missing caretaker joint/);
});

test('Caretaker keeps the reviewed skin and eye materials and shares geometry between enemies',()=>{
  const a=rig(),b=rig(),skin=a.obj.getObjectByName('Caretaker_skin'),eye=a.obj.getObjectByName('Clouded_eyes');
  skin.material=new THREE.MeshStandardMaterial({color:0x719058,roughness:.71});
  eye.material=new THREE.MeshStandardMaterial({color:0xabb6a0,roughness:.39});
  const sc=skin.material.color.clone(),ec=eye.material.color.clone();
  applyCharacterLook(a.obj,1,CARETAKER);applyCharacterLook(b.obj,2,CARETAKER);
  assert.ok(skin.material.color.equals(sc));assert.ok(eye.material.color.equals(ec));
  assert.equal(eye.material.roughness,.39);assert.equal(eye.material.emissiveIntensity,1);assert.equal(eye.material.emissive.getHex(),0);
  assert.equal(skin.geometry,b.obj.getObjectByName('Caretaker_skin').geometry);
  assert.notEqual(skin.material,b.obj.getObjectByName('Caretaker_skin').material);
  assert.equal(skin.geometry.attributes.color,undefined);
});

test('runtime attacks preserve left/right independence, continuity, and visible crawler reach',()=>{
  const m=rig(),p=new THREE.Vector3();
  for(const role of ['attack','attack2','attack3','crawl','crawlAttack']) {
    m.mixer.stopAllAction();m.animator.play(role,0,true,0);
    const points={L:[],R:[]},previous={};let maxStep=0;
    const duration=m.cur.getClip().duration;
    for(let frame=0;frame<=Math.ceil(duration*120);frame++) {
      at(m,role,Math.min(1,frame/120/duration));
      for(const side of ['L','R']) {
        m.bones['hand'+side].getWorldPosition(p);points[side].push(p.clone());
        for(const part of ['upperarm','forearm','hand']) {
          const name=part+side,q=m.bones[name].quaternion.clone().normalize();
          if(previous[name])maxStep=Math.max(maxStep,q.angleTo(previous[name]));previous[name]=q;
        }
      }
    }
    const travel=side=>Math.max(...points[side].flatMap(a=>points[side].map(b=>a.distanceTo(b))));
    if(role==='attack2'||role==='attack3') {
      assert.ok(THREE.MathUtils.radToDeg(maxStep)<9,`${role} must not flip`);
      assert.ok(travel(role==='attack2'?'L':'R')>.45);
      assert.ok(travel(role==='attack2'?'R':'L')<.08);
    } else if(role==='crawlAttack')assert.ok(travel('R')>.4);
    else {assert.ok(travel('L')>.2);assert.ok(travel('R')>.2);}
  }
});

test('foot and palm pins use the new anatomy and release when an action takes over',()=>{
  for(const role of ['walk','crawl']) {
    const m=rig();m.animator.play(role,0);let initial;const p=new THREE.Vector3();
    for(let i=0;i<12;i++) {
      const phase=.17+i*.006;at(m,role,phase);
      m.obj.position.z=(phase-.17)*CARETAKER.stride[role];m.obj.rotation.y=i*.002;
      m.animator.contacts.update(role,phase,'chase',1);
      m.bones[role==='crawl'?'handL':'footL'].getWorldPosition(p);
      if(!initial)initial=p.clone();else assert.ok(p.distanceTo(initial)<.0001,`${role} contact drift`);
    }
    m.animator.play(role==='crawl'?'crawlAttack':'attack2',0,true);
    assert.equal(m.animator.contacts.pins.L.active,false);
  }
});

test('absolute hit clips become torso-only additive reactions and yield to attacks',()=>{
  const m=rig();m.animator.play('crawl',0);at(m,'crawl',.3);
  const names=['thighL','shinL','upperarmL','forearmL'],before=names.map(n=>m.bones[n].quaternion.clone().normalize());
  m.animator.hit('chase');assert.ok(m.hitAction);m.animator.advance(.15);
  names.forEach((n,i)=>assert.ok(m.bones[n].quaternion.clone().normalize().angleTo(before[i])<1e-5));
  m.animator.play('crawlAttack',0,true);assert.equal(m.hitAction,null);
  assert.ok(gltf.animations.filter(c=>c.name.startsWith('HitReact')).every(c=>c.blendMode===THREE.NormalAnimationBlendMode));
});

test('new hit zones follow prone torsos and heads without an invisible standing hitbox',()=>{
  const m=rig();m.animator.play('crawl',0);at(m,'crawl',.3);
  assert.equal(caretakerHitTest(m,1,false,0,1.5,3,0,0,-1,10),null);
  const chest=m.bones.chest.getWorldPosition(new THREE.Vector3());
  assert.ok(caretakerHitTest(m,1,false,-3,chest.y,chest.z,1,0,0,10));
  m.animator.play('idle',0);at(m,'idle',.3);
  const head=m.bones.head.localToWorld(new THREE.Vector3(0,.075,0));
  const hit=caretakerHitTest(m,1,false,head.x,head.y,head.z+3,0,0,-1,10);
  assert.equal(hit?.head,true);assert.equal(caretakerHitTest(m,1,false,head.x,head.y,head.z+3,0,0,-1,1),null);
});

test('both Caretaker vaults clear the actual window through all meshes and intermediate spawn scales',()=>{
  const m=rig(),meshes=[];m.obj.traverse(o=>{if(o.isSkinnedMesh)meshes.push(o);});const p=new THREE.Vector3();
  for(const crawler of [false,true]) {
    const role=crawler?'crawlClimb':'climb',v=vaultConfig(crawler,CARETAKER);
    m.mixer.stopAllAction();m.animator.play(role,0,true,0);
    for(let frame=0;frame<=240;frame++) {
      const phase=frame/240;at(m,role,Math.min(phase,.999999));
      const vertices=[];
      for(const mesh of meshes){mesh.skeleton.update();for(let j=0;j<mesh.geometry.attributes.position.count;j++){mesh.getVertexPosition(j,p).applyMatrix4(mesh.matrixWorld);vertices.push(p.x,p.y,p.z);}}
      for(const scale of [.8964,.947,1.013,1.063,1.10]) {
        const {travel,height}=vaultPose(phase,crawler,scale,CARETAKER),z=THREE.MathUtils.lerp(-v.approach,v.landing,travel);
        let low=Infinity,high=-Infinity,width=0;
        for(let j=0;j<vertices.length;j+=3)if(Math.abs(vertices[j+2]*scale+z)<.30) {
          low=Math.min(low,vertices[j+1]*scale+height);high=Math.max(high,vertices[j+1]*scale+height);width=Math.max(width,Math.abs(vertices[j]*scale));
        }
        assert.ok(low>=1.06&&high<=2.54&&width<=1.04,`${role} phase=${phase} scale=${scale}: ${low}..${high}, width=${width}`);
      }
    }
  }
});
