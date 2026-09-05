import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import * as THREE from 'three';
import {readRig} from './audit-animations.mjs';
const folder=process.argv[2]||'/tmp/deadlight-poses';mkdirSync(folder,{recursive:true});
const gltf=await readRig(),mixer=new THREE.AnimationMixer(gltf.scene);
const polished=JSON.parse(readFileSync(new URL('../assets/animations.json',import.meta.url))).clips.map(c=>THREE.AnimationClip.parse(c));
let mesh;gltf.scene.traverse(o=>{if(o.isSkinnedMesh)mesh=o;});
const samples=[];
for(const name of ['Idle','Walk','Walk2','Run','Run2','Attack','Attack2','Attack3','Crawl','Death','Climb','HitReact','HitReact2']) {
 for(const [version,clips] of [['Original',gltf.animations],['Polished',polished]]) {
  samples.push({name,version,clip:clips.find(c=>c.name===name),phase:name==='Death'?.95:name.startsWith('HitReact')?.25:.45});
 }
}
for(const name of ['CrawlAttack','CrawlDeath','CrawlClimb','CrawlBash'])for(const phase of [.05,.25,.5,.75,.95])samples.push({name,version:'Polished',clip:polished.find(c=>c.name===name),phase});
const indices=mesh.geometry.index.array;writeFileSync(folder+'/indices.bin',Buffer.from(new Uint32Array(indices).buffer));
const pos=new THREE.Vector3(),manifest=[];
for(let i=0;i<samples.length;i++) {
 const {name,version,clip,phase}=samples[i];mixer.stopAllAction();mesh.skeleton.pose();
 if(version==='Polished'&&name.startsWith('HitReact')){const idle=mixer.clipAction(polished.find(c=>c.name==='Idle'));idle.reset().play();idle.time=.4;idle.timeScale=0;}
 const a=mixer.clipAction(clip);a.reset().setLoop(THREE.LoopOnce,1);a.clampWhenFinished=true;a.play();a.time=phase*clip.duration;mixer.update(0);gltf.scene.updateMatrixWorld(true);mesh.skeleton.update();
 const vertices=new Float32Array(mesh.geometry.attributes.position.count*3);
 for(let j=0;j<vertices.length/3;j++){mesh.getVertexPosition(j,pos).applyMatrix4(mesh.matrixWorld);pos.y+=.99736;pos.toArray(vertices,j*3);}
 const file=`pose-${i}.bin`;writeFileSync(folder+'/'+file,Buffer.from(vertices.buffer));manifest.push({name,version,phase,file});
}
writeFileSync(folder+'/manifest.json',JSON.stringify(manifest));console.log(`Exported ${manifest.length} skinned poses to ${folder}`);
