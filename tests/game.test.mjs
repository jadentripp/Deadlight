import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import * as THREE from 'three';
import {CONTACT, solveTwoBone, sampleMotion, canStartWeaponAction} from '../motion.js';
import {ZombieAnimator, actionRole} from '../zombie-animation.js';
import {VAULT, vaultPose, windowPoint} from '../window-traversal.js';
import {readRig} from '../scripts/audit-animations.mjs';
import {clone as skeletonClone} from 'three/addons/utils/SkeletonUtils.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const code = readFileSync(new URL('../game.js', import.meta.url), 'utf8')
  .replace(/^import .*;\n/gm, '').replaceAll('import.meta.url', "'https://game.example/Deadlight/game.js'")
  .replace(/\ninit\(\)\.catch\(error => \{[\s\S]*$/, '');
function element() {
  const classes = new Set(), events = new Map(), captures = new Set();
  return {textContent:'', innerHTML:'', style:{setProperty(){}}, disabled:false,
    classList:{add(...c){c.forEach(x=>classes.add(x));},remove(...c){c.forEach(x=>classes.delete(x));},contains(c){return classes.has(c);},toggle(c,on){if(on ?? !classes.has(c)) classes.add(c);else classes.delete(c);}},
    setAttribute(){},addEventListener(k,f){const list=events.get(k)||[];list.push(f);events.set(k,list);},
    setPointerCapture(id){captures.add(id);},hasPointerCapture(id){return captures.has(id);},
    emit(k,id=1,x=0,y=0){if(['pointerup','pointercancel','lostpointercapture'].includes(k)) captures.delete(id);for(const f of events.get(k)||[]) f({pointerId:id,clientX:x,clientY:y,preventDefault(){},stopPropagation(){}});},
  };
}
function harness() {
  const nodes = new Map([...html.matchAll(/id="([^"]+)"/g)].map(m=>[m[1],element()]));
  const document = {getElementById:id=>nodes.get(id)||null,body:element(),documentElement:element(),addEventListener(){},hidden:false};
  const context = vm.createContext({THREE, VAULT, vaultPose, windowPoint, CONTACT, solveTwoBone, sampleMotion, canStartWeaponAction, ZombieAnimator, actionRole, RenderPass, console, document, URL, URLSearchParams, AbortController, location:{search:''},
    window:{innerWidth:844,innerHeight:390,addEventListener(){}},innerWidth:844,innerHeight:390,devicePixelRatio:2,
    matchMedia:()=>({matches:false}),navigator:{maxTouchPoints:5},performance:{now:()=>100},
    setTimeout,clearTimeout,requestAnimationFrame(){},localStorage:{getItem:()=>null,setItem(){}},
    fetch:async()=>({ok:true,arrayBuffer:async()=>new ArrayBuffer(12)})});
  vm.runInContext(code+'\nwindow.test={clearInputs,pauseGame,resumeNow,bindTouch,loadGLB,assetRequests,HUD,Resolution,LightBudget,ARMS,updateRound,rayMap,buildAtmosphere,updateCombatHUD,Zombie};',context);
  return {...context.window.__DL,...context.window.test,context,nodes,document};
}
function weaponHarness() {
  const h=harness(),w=h.WPN;
  w.slots=[{id:'sidearm',mag:8,reserve:64,pap:false},null];w.cur=0;
  w.camera=new THREE.PerspectiveCamera();w.vm=new THREE.Group();w.mesh=new THREE.Object3D();w.flash=new THREE.Object3D();w.flashLight={intensity:0};
  w.tmpV=new THREE.Vector3();w.tmpD=new THREE.Vector3();
  h.ARMS.update=()=>{};h.HUD.ammo=()=>{};h.HUD.crosshair=()=>{};h.SFX.reload=()=>{};
  h.G.state='playing';return h;
}
test('all literal DOM hooks exist and all original GLBs are valid containers',()=>{
  const ids=[...html.matchAll(/id="([^"]+)"/g)].map(m=>m[1]);assert.equal(new Set(ids).size,ids.length);
  const dynamic=new Set(['btnRetry','reloadGame']);
  for(const [,id] of code.matchAll(/\$\('([^']+)'\)/g)) assert.ok(ids.includes(id)||dynamic.has(id),id);
  const dir=new URL('../assets/models/',import.meta.url);
  assert.equal(readdirSync(dir).length,10);
  for(const name of readdirSync(dir)) {const b=readFileSync(new URL(name,dir));assert.equal(b.toString('ascii',0,4),'glTF');assert.equal(b.readUInt32LE(8),b.length);}
});
test('concurrent zombie variants share one download and parse',async()=>{
  const h=harness();let fetches=0,parses=0;
  h.context.fetch=async()=>{fetches++;return{ok:true,arrayBuffer:async()=>new ArrayBuffer(12)}};
  const loader={parseAsync:async()=>{parses++;return{scene:'shared'}}};
  const a=await Promise.all([h.loadGLB(loader,'z.glb'),h.loadGLB(loader,'z.glb'),h.loadGLB(loader,'z.glb')]);
  assert.equal(fetches,1);assert.equal(parses,1);assert.equal(a[0],a[2]);
});
test('failed model requests can be retried',async()=>{
  const h=harness();h.context.fetch=async()=>({ok:false,status:503});
  await assert.rejects(h.loadGLB({parseAsync:async()=>({})},'retry.glb'));
  h.context.fetch=async()=>({ok:true,arrayBuffer:async()=>new ArrayBuffer(12)});
  assert.equal(await h.loadGLB({parseAsync:async()=>42},'retry.glb'),42);
});
test('pause clears movement, firing, aim, autofire and repair input',()=>{
  const h=harness();h.G.state='playing';h.G.mobile=true;h.PL.keys.KeyW=true;h.PL.touchMove={x:1,y:1};
  h.WPN.trigger=h.WPN.wantAds=h.WPN.afFire=h.IT.fHeld=true;h.WPN.afT=1;
  h.pauseGame();assert.equal(h.G.state,'paused');assert.equal(Object.keys(h.PL.keys).length,0);assert.equal(h.PL.touchMove,null);
  for(const flag of ['trigger','wantAds','afFire']) assert.equal(h.WPN[flag],false);
  assert.equal(h.IT.fHeld,false);h.resumeNow();assert.equal(h.G.state,'playing');assert.equal(h.WPN.trigger,false);
});
test('canceled movement and fire gestures recover; second finger cannot cancel fire',()=>{
  const h=harness();h.G.state='playing';h.G.mobile=true;h.bindTouch();
  const move=h.nodes.get('moveZone'), fire=h.nodes.get('tbFire');
  move.emit('pointerdown',1,100,100);move.emit('pointermove',1,100,40);assert.ok(h.PL.touchMove.y>0);
  move.emit('pointercancel',1);assert.equal(h.PL.touchMove,null);
  move.emit('pointerdown',2,100,100);move.emit('pointermove',2,100,40);assert.ok(h.PL.touchMove);
  fire.emit('pointerdown',3);assert.equal(h.WPN.trigger,true);
  fire.emit('pointerdown',4);fire.emit('pointerup',4);assert.equal(h.WPN.trigger,true);
  fire.emit('pointercancel',3);assert.equal(h.WPN.trigger,false);
  h.pauseGame();move.emit('pointermove',2,100,20);assert.equal(h.PL.touchMove,null);
});
test('touch hold repeats sidearm shots while desktop remains semiautomatic',()=>{
  for(const mobile of [true,false]) {
    const h=weaponHarness();h.G.mobile=mobile;h.WPN.trigger=true;
    let shots=0;h.WPN.fire=function(){shots++;this.semiReady=false;this.fireT=0.15;};
    h.WPN.update(0.1);h.WPN.update(0.1);h.WPN.update(0.1);
    assert.equal(shots,mobile?2:1);
    h.G.state='dying';h.WPN.update(0.2);assert.equal(shots,mobile?2:1);
  }
});
test('reload conserves ammo and fills only the available reserve',()=>{
  const h=weaponHarness(),w=h.WPN;w.inv.mag=2;w.inv.reserve=3;w.startReload();assert.equal(w.reloading,true);
  for(let i=0;i<14;i++) w.update(0.1);
  assert.equal(w.reloading,false);assert.equal(w.inv.mag,5);assert.equal(w.inv.reserve,0);
});
test('aim assist and autofire ignore a zombie behind a wall',()=>{
  const h=weaponHarness(),w=h.WPN;h.G.mobile=true;h.G.autofire=true;
  w.camera.position.set(0,1.7,0);w.camera.updateMatrixWorld();
  h.ZM.list=[{alive:true,dying:false,scale:1,x:0,z:-10,group:{position:{y:0.6}}}];
  h.MAP.solids=[{x1:-2,x2:2,y1:0,y2:4,z1:-5,z2:-4}];
  w.touchAssist(0.2);assert.equal(w.touchTarget,null);assert.equal(w.afFire,false);
  h.MAP.solids=[];w.touchAssist(0.2);assert.ok(w.touchTarget);assert.equal(w.afFire,true);
});
test('adaptive resolution responds to sustained slow frames and honors its floor',()=>{
  const h=harness(),r=h.Resolution;h.G.mobile=true;r.mode='auto';r.ratio=1.25;let resizes=0;r.apply=()=>resizes++;
  for(let i=0;i<80;i++)r.sample(50);assert.ok(r.ratio<1.25);assert.equal(resizes,1);
  for(let i=0;i<800;i++)r.sample(50);assert.equal(r.ratio,0.7);
  r.mode='high';for(let i=0;i<80;i++)r.sample(50);assert.equal(r.ratio,0.7);
});
test('round completion waits for all scheduled enemies and counts down once',()=>{
  const h=harness();h.G.roundState='active';h.G.round=1;h.ZM.toSpawn=6;h.ZM.spawned=5;h.SFX.roundEnd=()=>{};
  h.updateRound(0.1);assert.equal(h.G.roundState,'active');h.ZM.spawned=6;h.updateRound(0.1);
  assert.equal(h.G.roundState,'intermission');assert.equal(h.G.roundTimer,7);h.updateRound(1);assert.equal(h.G.roundTimer,6);
});

const sourceRig=await readRig();
const animationData=JSON.parse(readFileSync(new URL('../assets/animations.json',import.meta.url)));
function zombieHarness(crawler=true) {
  const h=harness(),z=Object.create(h.Zombie.prototype),obj=skeletonClone(sourceRig.scene),mixer=new THREE.AnimationMixer(obj),actions={};
  const names={crawl:'Crawl',crawlIdle:'CrawlIdle',crawlClimb:'CrawlClimb',crawlAttack:'CrawlAttack',crawlBash:'CrawlBash',crawlDeath:'CrawlDeath',climb:'Climb',death:'Death',idle:'Idle',walk:'Walk',run:'Run',attack:'Attack',attack2:'Attack2'};
  for(const [role,name]of Object.entries(names))actions[role]=mixer.clipAction(THREE.AnimationClip.parse(animationData.clips.find(c=>c.name===name)));
  obj.scale.setScalar(.96);obj.position.y=.99736*.96;
  const model={obj,mixer,actions,cur:null,hScale:1,headMeshes:[]};model.animator=new ZombieAnimator(model);
  const group=new THREE.Group();group.add(obj);
  Object.assign(z,{alive:true,dying:false,state:'chase',crawler,model,group,scale:1,x:0,z:0,yaw:0,speed:1.1,vel:{x:0,z:0},tmp:{x:0,z:0},T:{speed:1.55,anim:1,lean:.16},groanT:999,hitFlash:0,stuckT:0,walkRole:'walk',runRole:'run',phase:0,arms:[new THREE.Group(),new THREE.Group()],elbows:[],legs:[],knees:[],headG:new THREE.Group(),upper:new THREE.Group(),shadow:{visible:true}});
  h.G.state='playing';h.PL.pos={x:0,z:20};h.ZM.list=[z];h.SFX.bite=()=>{};h.FX.splat=()=>{};
  h.NAV.move=(p,x,z)=>{p.x+=x;p.z+=z;return false};h.NAV.los=()=>true;
  return {...h,z};
}
test('crawler completes the entire window sequence at 30, 60, and 120 Hz',()=>{
  for(const fps of [30,60,120]){
    const h=zombieHarness(),z=h.z,w={x:0,z:0,outer:{x:0,z:-.95},inner:{x:0,z:1.3},boards:0};
    z.x=0;z.z=-1.6;z.win=w;z.beginVault();let navigationCalls=0;h.NAV.move=()=>{navigationCalls++;return false;};
    const frames=Math.ceil(2.5*fps);
    for(let i=0;i<frames;i++){
      z.update(1/fps,i/fps);
      if(i===Math.floor(frames/2)){const x=z.x,previousZ=z.z;h.ZM.pushAway(x-.1,previousZ,5,2);assert.equal(z.x,x);assert.equal(z.z,previousZ);}
      if(z.vault>.02&&z.vault<.98)assert.equal(z.model.curRole,'crawlClimb');
      if(z.vault<.22)assert.ok(Math.abs(z.z+1.6)<1e-6);
    }
    // Floating-point accumulation may leave one final frame in the clip.
    if(z.state==='enter')z.update(1/fps,2.5);
    assert.equal(z.state,'chase');assert.equal(z.win,null);assert.ok(Math.abs(z.z-1.7)<1e-5);assert.equal(z.group.position.y,0);
    assert.ok(navigationCalls<=1,'generic navigation must not move an active vault');
  }
});
test('crawler attack applies damage once at contact; corpses finish their clip before sinking',()=>{
  const h=zombieHarness(),z=h.z;h.PL.pos={x:0,z:1};let hits=0;h.PL.damage=()=>hits++;
  z.beginAttack();assert.equal(z.atkRole,'crawlAttack');
  for(let i=0;i<28;i++)z.update(1/60,i/60);assert.equal(hits,0);
  for(let i=28;i<66;i++)z.update(1/60,i/60);assert.equal(hits,1);
  z.die(null,false);assert.equal(z.model.curRole,'crawlDeath');
  for(let i=0;i<120;i++)z.update(1/60,i/60);assert.equal(z.group.position.y,0);
  for(let i=0;i<30;i++)z.update(1/60,i/60);assert.ok(z.group.position.y<0);
});
test('first-person arm segments meet their joints throughout every weapon reload, knife, and throw',()=>{
  const h=harness(),w=h.WPN,a=h.ARMS;w.vm=new THREE.Group();w.slots=[{id:'sidearm',mag:4,reserve:40,pap:false},null];w.cur=0;a.init(w.vm);
  const endpoint=new THREE.Vector3();
  const check=()=>{
    a.group.updateWorldMatrix(true,true);
    for(const arm of [a.L,a.R]){
      arm.fore.localToWorld(endpoint.set(0,-.153,0));const wrist=arm.hand.getWorldPosition(new THREE.Vector3());
      assert.ok(endpoint.distanceTo(wrist)<1e-6,'forearm must end at wrist');
      arm.upper.localToWorld(endpoint.set(0,-.17,0));const elbow=arm.fore.localToWorld(new THREE.Vector3(0,.153,0));
      assert.ok(endpoint.distanceTo(elbow)<1e-6,'upper arm must end at elbow');
    }
  };
  for(const id of ['sidearm','viper','breacher','sentinel','warden','arc9','mauler','longbow','nova']){
    w.slots[0].id=id;w.reloadDur=1;w.meleeT=-1;a.nade=-1;
    for(let i=0;i<=20;i++){w.reloading=true;w.reloadT=i/20;a.update(0);check();}
  }
  w.reloading=false;
  for(let i=0;i<20;i++){w.meleeT=i/20;a.update(0);check();}
  w.meleeT=-1;h.GRENADES.launch=()=>{};
  for(let i=0;i<20;i++){a.nade=i/20*.78;a.update(0);check();}
});
test('player camera bob and footsteps stop when movement is blocked',()=>{
  const h=harness();h.PL.camera=new THREE.PerspectiveCamera();h.PL.keys.KeyW=true;h.PL.bob=0;h.PL.bobAmt=0;h.PL.hp=100;h.PL.maxHp=100;h.NAV.move=()=>true;
  let steps=0;h.SFX.footstep=()=>steps++;
  for(let i=0;i<90;i++)h.PL.update(1/60);
  assert.equal(h.PL.moving,false);assert.equal(h.PL.bob,0);assert.equal(steps,0);
});
