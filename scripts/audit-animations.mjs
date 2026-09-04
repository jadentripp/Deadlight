import {readFileSync} from 'node:fs';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
export async function readRig() {
 const src=readFileSync(new URL('../assets/models/zombie_original.glb',import.meta.url));
 const len=src.readUInt32LE(12), json=JSON.parse(src.toString('utf8',20,20+len));
 delete json.materials;delete json.textures;delete json.images;
 for(const mesh of json.meshes)for(const p of mesh.primitives)delete p.material;
 const text=Buffer.from(JSON.stringify(json)), padded=Buffer.alloc(Math.ceil(text.length/4)*4,32);text.copy(padded);
 const bin=src.subarray(20+len), out=Buffer.alloc(20+padded.length+bin.length);
 out.write('glTF');out.writeUInt32LE(2,4);out.writeUInt32LE(out.length,8);out.writeUInt32LE(padded.length,12);out.write('JSON',16);padded.copy(out,20);bin.copy(out,20+padded.length);
 return new GLTFLoader().parseAsync(out.buffer,'');
}
if(process.argv[1]?.endsWith('audit-animations.mjs')) {
 const gltf=await readRig();const mixer=new THREE.AnimationMixer(gltf.scene);
 for(const clip of gltf.animations) {
   const action=mixer.clipAction(clip);action.setLoop(THREE.LoopOnce,1);action.clampWhenFinished=true;action.play();
   const feet=[gltf.scene.getObjectByName('footL'),gltf.scene.getObjectByName('footR')];
   const boneNames=[];gltf.scene.traverse(n=>{if(n.isBone)boneNames.push(n.name)});
   let seam=0,worst='';
   for(const t of clip.tracks)if(t.name.endsWith('.quaternion')){const q0=new THREE.Quaternion().fromArray(t.values,0),q1=new THREE.Quaternion().fromArray(t.values,t.values.length-4);const angle=q0.angleTo(q1)*180/Math.PI;if(angle>seam){seam=angle;worst=t.name}}
   const pose=[];for(const f of [0,.25,.5,.75,.99999]){action.time=clip.duration*f;mixer.update(0);gltf.scene.updateMatrixWorld(true);const p={phase:f};for(const n of boneNames.filter(n=>/foot|hand|hips|head/.test(n))){p[n]=gltf.scene.getObjectByName(n).getWorldPosition(new THREE.Vector3()).toArray().map(x=>+x.toFixed(3));}pose.push(p)}
   console.log(JSON.stringify({clip:clip.name,duration:clip.duration,seamDeg:+seam.toFixed(2),worst,pose}));
   mixer.stopAllAction();
 }
}
