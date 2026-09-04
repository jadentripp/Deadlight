import {STRIDE} from './motion.js';

// A stride is the distance travelled in one complete left/right cycle.
// During stance, the contact moves backwards by precisely that distance per
// cycle. Translating the character forwards therefore leaves it on the floor.
export const GAITS = Object.freeze({
  walk: {stance:.62, lift:.105}, walk2: {stance:.65, lift:.075},
  run: {stance:.38, lift:.27}, run2: {stance:.42, lift:.22},
  crawl: {stance:.66, lift:.065},
});
export function contactPath(role, phase) {
  const {stance,lift}=GAITS[role], stride=STRIDE[role];
  const q=((phase%1)+1)%1, reach=stride*stance/2;
  if(q<=stance)return {z:reach-stride*q,y:0,planted:true,phase:q/stance};
  const span=1-stance,t=(q-stance)/span,t2=t*t,t3=t2*t;
  // Hermite return: match the stance velocity at lift-off and touchdown.
  const z=(2*t3-3*t2+1)*-reach+(t3-2*t2+t)*-stride*span
    +(-2*t3+3*t2)*reach+(t3-t2)*-stride*span;
  return {z,y:lift*Math.sin(Math.PI*t)**2,planted:false,phase:t};
}
