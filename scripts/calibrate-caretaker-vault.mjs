// Offline clearance envelopes. Runtime samples a small table, never mesh bounds.
import {writeFileSync} from 'node:fs';
import * as THREE from 'three';
import {readRig} from './audit-animations.mjs';
import {CARETAKER} from '../zombie-rig.js';
import {climbPhase,vaultConfig} from '../window-traversal.js';
const gltf=await readRig('caretaker'),mixer=new THREE.AnimationMixer(gltf.scene),meshes=[];
gltf.scene.traverse(o=>{if(o.isSkinnedMesh)meshes.push(o);});
const p=new THREE.Vector3(),data={};
const ease=t=>{t=Math.max(0,Math.min(1,t));return t*t*(3-2*t);};
for(const crawler of [false,true]) {
  const name=crawler?'crawler':'standing',clip=gltf.animations.find(c=>c.name===(crawler?'CrawlClimb':'Climb'));
  const v=vaultConfig(crawler,CARETAKER);mixer.stopAllAction();const action=mixer.clipAction(clip).play();
  const frames=[];
  for(let i=0;i<=100;i++) {
    action.time=Math.min(i/100,.999999)*clip.duration;mixer.update(0);gltf.scene.updateMatrixWorld(true);
    const vertices=[];
    for(const mesh of meshes) {mesh.skeleton.update();for(let j=0;j<mesh.geometry.attributes.position.count;j++) {
      mesh.getVertexPosition(j,p).applyMatrix4(mesh.matrixWorld);vertices.push(p.y,p.z);
    }}
    frames.push(vertices);
  }
  data[name]=[];
  for(let k=0;k<=11;k++) {
    const scale=.88+k*.02,low=[],high=[],heights=[];
    for(let i=0;i<=100;i++) {
      const phase=i/100,travel=crawler?ease(climbPhase(phase,true)):ease((phase-.23)/.55);
      const z=THREE.MathUtils.lerp(-v.approach,v.landing,travel);let min=Infinity,max=-Infinity;
      const points=frames[i];
      for(let j=0;j<points.length;j+=2)if(Math.abs(points[j+1]*scale+z)<.34) {
        min=Math.min(min,points[j]*scale);max=Math.max(max,points[j]*scale);
      }
      low[i]=Math.max(0,1.085-min);high[i]=Math.min(1.20,2.515-max);
      if(phase<=(crawler?.22:.12)||phase>=(crawler?.80:.88))high[i]=0;
      if(low[i]>high[i])throw new Error(`${name} cannot fit at scale ${scale}, phase ${phase}: ${low[i]}..${high[i]}`);
      heights[i]=low[i];
    }
    // Minimise curvature subject to the actual aperture envelope. Projecting
    // each update preserves clearance while smoothing the root's ascent/landing.
    for(let pass=0;pass<2500;pass++)for(let i=1;i<100;i++)heights[i]=THREE.MathUtils.clamp((heights[i-1]+heights[i+1])/2,low[i],high[i]);
    data[name].push(heights.map(h=>+h.toFixed(5)));
  }
}
writeFileSync(new URL('../caretaker-vault-data.js',import.meta.url),'// Generated from caretaker.glb by scripts/calibrate-caretaker-vault.mjs.\n// Metres of root lift, phases 0..1 in .01 steps; scales .88..1.10 in .02 steps.\nexport const CARETAKER_VAULT_HEIGHTS = '+JSON.stringify(data)+';\n');
console.log('Calibrated both window paths against all five skinned meshes at twelve spawn scales.');
