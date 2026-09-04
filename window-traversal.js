// Shared by gameplay, clip baking, and geometry regression checks.
export const VAULT = Object.freeze({
  standing: {duration:1.9, start:0, end:1, approach:.95, landing:1.3},
  crawler: {duration:2.5, start:.22, end:.80, approach:1.60, landing:1.7},
});
const clamp=t=>Math.max(0,Math.min(1,t));
const ease=t=>{t=clamp(t);return t*t*(3-2*t);};
export function climbPhase(phase,crawler) {
  const v=VAULT[crawler?'crawler':'standing'];
  return clamp((phase-v.start)/(v.end-v.start));
}
export function vaultPose(phase,crawler,scale=1) {
  const p=climbPhase(phase,crawler);
  return {travel:crawler?ease(p):ease((p-.08)/.82),height:(.88+Math.max(0,.96-scale)*.35-Math.max(0,scale-.96)*.65)*Math.sin(Math.PI*p)};
}

export function windowPoint(window,crawler,inside=false) {
  const dx=window.inner.x-window.outer.x,dz=window.inner.z-window.outer.z,d=Math.hypot(dx,dz);
  const v=VAULT[crawler?'crawler':'standing'],distance=inside?v.landing:-v.approach;
  return {x:window.x+dx/d*distance,z:window.z+dz/d*distance};
}
