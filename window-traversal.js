// Shared by gameplay, clip baking, and geometry regression checks.
import {CARETAKER_VAULT_HEIGHTS} from './caretaker-vault-data.js';
export const VAULT = Object.freeze({
  standing: {duration:1.9, start:0, end:1, approach:.95, landing:1.3},
  crawler: {duration:2.5, start:.22, end:.80, approach:1.60, landing:1.7},
});
const clamp=t=>Math.max(0,Math.min(1,t));
const ease=t=>{t=clamp(t);return t*t*(3-2*t);};
const CARETAKER_VAULT = Object.freeze({
  standing:{...VAULT.standing, approach:1.25, landing:1.50},
  crawler:{...VAULT.crawler, approach:1.75},
});
export function vaultConfig(crawler,profile) {
  return (profile?.id==='caretaker'?CARETAKER_VAULT:VAULT)[crawler?'crawler':'standing'];
}
export function climbPhase(phase,crawler) {
  const v=VAULT[crawler?'crawler':'standing'];
  return clamp((phase-v.start)/(v.end-v.start));
}
export function vaultPose(phase,crawler,scale=1,profile) {
  const p=climbPhase(phase,crawler);
  if(profile?.id==='caretaker') {
    const data=CARETAKER_VAULT_HEIGHTS[crawler?'crawler':'standing'];
    const s=clamp((scale-.88)/.22)*(data.length-1),si=Math.min(Math.floor(s),data.length-2);
    const t=clamp(phase)*100,ti=Math.min(Math.floor(t),99);
    const at=i=>data[i][ti]+(data[i][ti+1]-data[i][ti])*(t-ti);
    return {travel:crawler?ease(p):ease((phase-.23)/.55),height:at(si)+(at(si+1)-at(si))*(s-si)};
  }
  return {travel:crawler?ease(p):ease((p-.08)/.82),height:(.88+Math.max(0,.96-scale)*.35-Math.max(0,scale-.96)*.65)*Math.sin(Math.PI*p)};
}

export function windowPoint(window,crawler,inside=false,profile) {
  const dx=window.inner.x-window.outer.x,dz=window.inner.z-window.outer.z,d=Math.hypot(dx,dz);
  const v=vaultConfig(crawler,profile),distance=inside?v.landing:-v.approach;
  return {x:window.x+dx/d*distance,z:window.z+dz/d*distance};
}
