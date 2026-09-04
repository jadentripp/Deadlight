import * as THREE from 'three';
import {contactPath} from './gait.js';
import {solveTwoBone} from './motion.js';

// Post-animation contact correction for the flat bunker floor. Actions own the
// rig during vaults, attacks and death; only locomotion may acquire floor pins.
export class GroundContacts {
  constructor(obj) {
    this.obj=obj;this.role=null;
    this.pins={L:{active:false,point:new THREE.Vector3()},R:{active:false,point:new THREE.Vector3()}};
    this.bones={};obj.traverse(b=>{if(b.isBone)this.bones[b.name]=b;});
    this.root=new THREE.Vector3();this.current=new THREE.Vector3();this.direction=new THREE.Vector3();
    this.pole=new THREE.Vector3();this.joint=new THREE.Vector3();this.end=new THREE.Vector3();
    this.rotation=new THREE.Quaternion();this.parentQ=new THREE.Quaternion();this.worldQ=new THREE.Quaternion();this.tipQ=new THREE.Quaternion();
  }
  reset() {this.role=null;this.pins.L.active=this.pins.R.active=false;}
  aim(bone,child,point) {
    bone.getWorldPosition(this.root);child.getWorldPosition(this.current);
    this.current.sub(this.root).normalize();this.direction.copy(point).sub(this.root).normalize();
    this.rotation.setFromUnitVectors(this.current,this.direction);
    bone.getWorldQuaternion(this.worldQ);bone.parent.getWorldQuaternion(this.parentQ).invert();
    bone.quaternion.copy(this.parentQ.multiply(this.rotation).multiply(this.worldQ));
    bone.updateWorldMatrix(false,true);
  }
  update(role,phase,state,scale,weight=1) {
    if(!/^(walk2?|run2?|crawl)$/.test(role||'')||!['chase','toWindow'].includes(state)||weight<.95){this.reset();return;}
    if(role!==this.role){this.reset();this.role=role;}
    this.obj.updateWorldMatrix(true,true);
    const crawl=role==='crawl';
    for(const side of ['L','R']) {
      const contact=contactPath(role,phase+(side==='R'?.5:0)),pin=this.pins[side];
      const upper=this.bones[(crawl?'upperarm':'thigh')+side],lower=this.bones[(crawl?'forearm':'shin')+side],tip=this.bones[(crawl?'hand':'foot')+side];
      if(!upper||!lower||!tip||!contact.planted){pin.active=false;continue;}
      if(!pin.active){tip.getWorldPosition(pin.point);pin.active=true;}
      upper.getWorldPosition(this.root);
      const a=lower.position.length()*scale,b=tip.position.length()*scale;
      // A shove or abrupt turn may exceed the planted limb's reach. Replant
      // instead of stretching the skeleton or pulling the character off-path.
      if(this.root.distanceTo(pin.point)>(a+b)*.995){tip.getWorldPosition(pin.point);}
      const sign=side==='L'?1:-1;
      this.pole.set(sign*(crawl?.5:.13),crawl?-.87:-.3,crawl?.25:.8);
      this.obj.localToWorld(this.pole);
      tip.getWorldQuaternion(this.tipQ);
      solveTwoBone(this.root,pin.point,this.pole,a,b,this.joint,this.end);
      this.aim(upper,lower,this.joint);this.aim(lower,tip,this.end);
      tip.parent.getWorldQuaternion(this.parentQ).invert();tip.quaternion.copy(this.parentQ.multiply(this.tipQ));
      tip.updateWorldMatrix(false,true);
    }
  }
}
