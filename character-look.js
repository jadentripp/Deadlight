import * as THREE from 'three';

// Regional color variation preserves the original face/skin texture. A whole
// character tint previously crushed the face and clothing into the same color.
export const CHARACTER_LOOKS = Object.freeze([
  {name:'Scavenger',skin:[1.18,1.12,1.02],shirt:[.84,1.16,1.24],pants:[.88,.98,1.10]},
  {name:'Drifter',skin:[1.10,1.14,1.03],shirt:[1.22,.86,.78],pants:[.96,.99,1.04]},
  {name:'Worker',skin:[1.16,1.08,.96],shirt:[1.18,1.12,.80],pants:[.85,.96,1.12]},
]);
const geometryLooks=new WeakMap();
function geometryFor(mesh,index) {
  const source=mesh.geometry;
  let variants=geometryLooks.get(source);if(!variants){variants=[];geometryLooks.set(source,variants);}
  if(variants[index])return variants[index];
  const look=CHARACTER_LOOKS[index],weights=source.getAttribute('skinWeight'),joints=source.getAttribute('skinIndex');
  if(!weights||!joints||!mesh.skeleton)return source;
  const region=mesh.skeleton.bones.map(b=>/head|neck|hand|forearm|foot/i.test(b.name)?'skin':/hips|thigh|shin/i.test(b.name)?'pants':'shirt');
  const colors=new Float32Array(weights.count*3);
  for(let i=0;i<weights.count;i++)for(let j=0;j<4;j++){
    const weight=weights.getComponent(i,j),palette=look[region[joints.getComponent(i,j)]||'shirt'];
    for(let c=0;c<3;c++)colors[i*3+c]+=weight*palette[c];
  }
  // Share immutable vertex/skin buffers, with just one color buffer per look.
  const geometry=new THREE.BufferGeometry();geometry.setIndex(source.index);
  for(const [name,attribute] of Object.entries(source.attributes))geometry.setAttribute(name,attribute);
  geometry.setAttribute('color',new THREE.BufferAttribute(colors,3));
  geometry.groups=source.groups.map(g=>({...g}));geometry.boundingBox=source.boundingBox?.clone()||null;
  geometry.boundingSphere=source.boundingSphere?.clone()||null;
  variants[index]=geometry;return geometry;
}
export function applyCharacterLook(obj,index=0,profile) {
  index=((index%CHARACTER_LOOKS.length)+CHARACTER_LOOKS.length)%CHARACTER_LOOKS.length;
  const materials=new Map();
  obj.traverse(mesh=>{
    if(!mesh.isMesh)return;
    if(!profile)mesh.geometry=geometryFor(mesh,index);
    const copy=source=>{
      if(!materials.has(source)){
        const material=source.clone();
        if(profile?.id==='caretaker') {
          // Preserve the reviewed decay, cloudy eyes, skin and clothing maps.
          // Only subtle workwear tint varies between spawned characters.
          if(mesh.name==='Worn_workwear')material.color.multiply(new THREE.Color().setRGB(...[[1,1,1],[.94,.97,1.04],[1.04,.98,.92]][index]));
          materials.set(source,material);return material;
        }
        material.color.setRGB(1,1,1);
        material.vertexColors=!!mesh.geometry.getAttribute('color');
        material.metalness=0;material.roughness=.86;
        if(material.map)material.map.colorSpace=THREE.SRGBColorSpace;
        materials.set(source,material);
      }
      return materials.get(source);
    };
    mesh.material=Array.isArray(mesh.material)?mesh.material.map(copy):copy(mesh.material);
  });
}

// Only first-person objects use layer 1, so these lights reveal the authored
// gun surfaces without washing out the bunker or adding shadow-map work.
export function addWeaponLighting(camera) {
  const target=new THREE.Object3D();target.position.set(0,-.12,-1);camera.add(target);
  const lights=[];
  for(const [color,power,position]of [[0xffead3,2.0,[-1.5,2,1]],[0xb6d8f0,.65,[2,.5,-.6]]]){
    const light=new THREE.DirectionalLight(color,power);light.position.set(...position);
    light.target=target;light.layers.set(1);camera.add(light);lights.push(light);
  }
  return lights;
}
