import * as THREE from 'three';

const ray=new THREE.Ray(),a=new THREE.Vector3(),b=new THREE.Vector3(),point=new THREE.Vector3();
const sphere=new THREE.Sphere(),axis=new THREE.Vector3(),offset=new THREE.Vector3();
function capsuleDistance(radius) {
  axis.subVectors(b,a);offset.subVectors(ray.origin,a);
  const length=axis.lengthSq(),along=axis.dot(ray.direction),origin=axis.dot(offset);
  const A=length-along*along,B=length*offset.dot(ray.direction)-origin*along;
  const C=length*(offset.lengthSq()-radius*radius)-origin*origin;
  let best=Infinity,disc=B*B-A*C;
  if(A>1e-8&&disc>=0) {
    const t=(-B-Math.sqrt(disc))/A,y=origin+t*along;
    if(t>=0&&y>0&&y<length)best=t;
  }
  for(const center of [a,b]) {
    sphere.set(center,radius);
    if(ray.intersectSphere(sphere,point))best=Math.min(best,point.distanceTo(ray.origin));
  }
  return best;
}

// Fixed radii follow anatomical joints. Animation can move a hit zone but
// cannot change navigation size or expand it with an outstretched attack arm.
export function caretakerHitTest(model,scale,headless,ox,oy,oz,dx,dy,dz,maxT) {
  ray.origin.set(ox,oy,oz);ray.direction.set(dx,dy,dz).normalize();
  const bones=model.bones;let best=maxT,head=false;
  for(const [start,end,radius] of [['hips','chest',.23],['thighL','shinL',.12],['thighR','shinR',.12],['shinL','footL',.095],['shinR','footR',.095]]) {
    bones[start].getWorldPosition(a);bones[end].getWorldPosition(b);
    const t=capsuleDistance(radius*scale);if(t<best)best=t;
  }
  if(!headless) {
    bones.head.localToWorld(a.set(0,.075,0));sphere.set(a,.165*scale);
    if(ray.intersectSphere(sphere,point)) {
      const t=point.distanceTo(ray.origin);if(t<maxT&&t<=best+.04){best=t;head=true;}
    }
  }
  return best<maxT?{t:best,head}:null;
}
