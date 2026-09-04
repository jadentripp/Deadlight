import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {MeshoptDecoder} from 'three/addons/libs/meshopt_decoder.module.js';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {clone} from 'three/addons/utils/SkeletonUtils.js';
import {applyCharacterLook} from './character-look.js';

const $=id=>document.getElementById(id),cache=new Map();
let renderer,scene,camera,controls,model,mixer,action,clips=[],refined=[],paused=false,request=0,oldTime=0;
const loader=new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
function release(){
  if(!model)return;mixer?.stopAllAction();mixer?.uncacheRoot(model);
  scene.remove(model);const materials=new Set(),skeletons=new Set();
  model.traverse(o=>{if(o.skeleton)skeletons.add(o.skeleton);if(o.userData.ownedMaterial)(Array.isArray(o.material)?o.material:[o.material]).forEach(m=>materials.add(m));});
  materials.forEach(m=>m.dispose());skeletons.forEach(s=>s.dispose());model=mixer=action=null;
}
async function showAsset(){
  const current=++request,id=$('asset').value,character=id==='zombie_original';
  $('status').hidden=false;$('status').textContent='Loading '+$('asset').selectedOptions[0].textContent+'…';
  try{
    if(!cache.has(id))cache.set(id,loader.loadAsync('./assets/models/'+id+'.glb').catch(e=>{cache.delete(id);throw e;}));
    const gltf=await cache.get(id);if(current!==request)return;release();
    model=character?clone(gltf.scene):gltf.scene.clone(true);
    if(character&&$('look').value!=='original'){
      applyCharacterLook(model,Number($('look').value));model.traverse(o=>{if(o.isMesh)o.userData.ownedMaterial=true;});
    }
    model.traverse(o=>{if(o.isMesh){o.frustumCulled=false;if(o.material.map)o.material.map.anisotropy=Math.min(4,renderer.capabilities.getMaxAnisotropy());}});
    model.updateMatrixWorld(true);const box=new THREE.Box3().setFromObject(model),center=box.getCenter(new THREE.Vector3()),size=box.getSize(new THREE.Vector3());
    const scale=character?2/size.y:2.1/Math.max(size.x,size.y,size.z);
    model.scale.multiplyScalar(scale);model.position.set(-center.x*scale,-box.min.y*scale,-center.z*scale);scene.add(model);
    $('poseControls').classList.toggle('hidden',!character);
    controls.target.set(0,character?1:.40,0);camera.position.set(character?2.4:2.9,character?1.65:1.15,character?3.7:1.7);controls.update();
    $('title').textContent=$('asset').selectedOptions[0].textContent;
    $('caption').textContent=character?'Drag to rotate · in-place clip preview · gameplay adds travel and floor contacts':'Original GLB asset · drag to rotate · pinch or scroll to zoom';
    if(character){mixer=new THREE.AnimationMixer(model);clips=$('version').value==='original'?gltf.animations:refined;chooseClips();}
    $('status').hidden=true;
  }catch(error){if(current!==request)return;$('status').textContent='This asset could not load. Choose another asset, or reload to try again.';console.error(error);}
}
function chooseClips(){
  const previous=$('clip').value||'Walk';$('clip').replaceChildren(...clips.map(c=>new Option(c.name,c.name)));
  $('clip').value=clips.some(c=>c.name===previous)?previous:clips[0].name;playClip();
}
function playClip(){
  if(!mixer)return;mixer.stopAllAction();const clip=clips.find(c=>c.name===$('clip').value);if(!clip)return;
  if(clip.blendMode===THREE.AdditiveAnimationBlendMode){const idle=clips.find(c=>c.name==='Idle');if(idle)mixer.clipAction(idle).reset().play();}
  action=mixer.clipAction(clip);action.reset().play();$('scrub').value='0';mixer.update(0);
}
function setPaused(value){paused=value;$('play').textContent=paused?'Play':'Pause';$('play').setAttribute('aria-pressed',String(paused));}
async function init(){
  renderer=new THREE.WebGLRenderer({canvas:$('viewer'),antialias:true});renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.1;
  scene=new THREE.Scene();scene.background=new THREE.Color(0x182329);camera=new THREE.PerspectiveCamera(42,1,.02,50);
  controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=true;controls.minDistance=.6;controls.maxDistance=8;controls.maxPolarAngle=Math.PI*.52;
  scene.add(new THREE.HemisphereLight(0xe9f1f4,0x4c4841,1.3));
  for(const [color,intensity,x,y,z] of [[0xffead3,2.8,-3,5,4],[0xb8dded,1.4,3,2,-2]]){const light=new THREE.DirectionalLight(color,intensity);light.position.set(x,y,z);scene.add(light);}
  const grid=new THREE.GridHelper(12,60,0x526c72,0x2c4147);grid.position.y=-.005;scene.add(grid);
  const resize=()=>{const w=$('stage').clientWidth,h=$('stage').clientHeight;renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix();};new ResizeObserver(resize).observe($('stage'));resize();
  const response=await fetch('./assets/animations.json');if(!response.ok)throw new Error('Animation download failed');refined=(await response.json()).clips.map(c=>THREE.AnimationClip.parse(c));
  for(const id of ['asset','look','version'])$(id).addEventListener('change',showAsset);
  $('clip').addEventListener('change',playClip);$('play').addEventListener('click',()=>setPaused(!paused));
  $('scrub').addEventListener('input',()=>{if(action){setPaused(true);action.time=Number($('scrub').value)*action.getClip().duration;mixer.update(0);}});
  renderer.domElement.addEventListener('webglcontextlost',event=>{event.preventDefault();setPaused(true);$('status').hidden=false;$('status').textContent='3D display interrupted. Reload to continue.';});
  await showAsset();
  renderer.setAnimationLoop(time=>{const dt=Math.min((time-oldTime)/1000,.05);oldTime=time;if(document.hidden)return;controls.update();if(mixer&&!paused){mixer.update(dt*Number($('speed').value));$('scrub').value=action.time/action.getClip().duration;}renderer.render(scene,camera);});
}
init().catch(error=>{$('status').hidden=false;$('status').textContent='The 3D preview could not start. Reload in a browser with hardware acceleration enabled.';console.error(error);});
