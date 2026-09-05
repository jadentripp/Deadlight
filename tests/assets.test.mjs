import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {clone} from 'three/addons/utils/SkeletonUtils.js';
import {readRig} from '../scripts/audit-animations.mjs';
import {applyCharacterLook,addWeaponLighting} from '../character-look.js';

test('all nine detailed weapon GLBs decode with complete geometry, UVs and muzzle attachments',async()=>{
  for(const id of ['sidearm','viper','breacher','sentinel','warden','arc9','mauler','longbow','nova']){
    const gltf=await readRig(id);let triangles=0;
    gltf.scene.traverse(mesh=>{if(mesh.isMesh){assert.ok(mesh.geometry.getAttribute('uv'),id);assert.ok(mesh.geometry.getAttribute('normal'),id);triangles+=(mesh.geometry.index?.count||mesh.geometry.attributes.position.count)/3;}});
    assert.ok(triangles>10000,id);assert.ok(gltf.scene.getObjectByName('Muzzle'),id);
    const box=new THREE.Box3().setFromObject(gltf.scene),size=box.getSize(new THREE.Vector3());
    assert.ok(size.x>.015&&size.y>.05&&size.z>.1&&size.z<2,id+' has plausible weapon dimensions');
  }
});
test('character looks preserve skinning, share geometry buffers and retain independent materials',async()=>{
  const gltf=await readRig(),a=clone(gltf.scene),b=clone(gltf.scene);applyCharacterLook(a,0);applyCharacterLook(b,0);
  let original,first,second;gltf.scene.traverse(o=>{if(o.isSkinnedMesh)original=o;});a.traverse(o=>{if(o.isSkinnedMesh)first=o;});b.traverse(o=>{if(o.isSkinnedMesh)second=o;});
  assert.equal(first.geometry,second.geometry);assert.equal(first.geometry.attributes.position,original.geometry.attributes.position);
  assert.equal(first.geometry.attributes.skinWeight,original.geometry.attributes.skinWeight);
  assert.notEqual(first.material,second.material);assert.equal(original.geometry.attributes.color,undefined);
  const c=first.geometry.attributes.color;assert.equal(c.count,original.geometry.attributes.position.count);
  assert.ok([...c.array].every(x=>Number.isFinite(x)&&x>.5&&x<1.5));
  const face=first.skeleton.bones.findIndex(b=>b.name==='head');let count=0;
  for(let i=0;i<c.count;i++)if(first.geometry.attributes.skinIndex.getX(i)===face&&first.geometry.attributes.skinWeight.getX(i)>.9){assert.ok(c.getX(i)>1.10);count++;}
  assert.ok(count>100,'preserved face brightness');
});
test('weapon lighting illuminates only the first-person layer',()=>{
  const camera=new THREE.PerspectiveCamera(),lights=addWeaponLighting(camera);
  assert.equal(lights.length,2);for(const light of lights){assert.equal(light.layers.mask,2);assert.equal(light.castShadow,false);assert.equal(light.target.parent,camera);}
});
