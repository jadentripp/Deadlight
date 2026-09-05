import * as THREE from 'three';
import {STRIDE} from './motion.js';
import {GroundContacts} from './ground-contacts.js';

// Action is authoritative. Posture selects a compatible clip within that action.
// Adding a locomotion style cannot bypass climbing, attacking, or dying.
export const ACTION_ROLES = Object.freeze({
  rise: {standing:['idle'], crawler:['crawlIdle','crawl','idle']},
  bash: {standing:['attack2','attack'], crawler:['crawlBash','crawlAttack','attack']},
  enter: {standing:['climb'], crawler:['crawlClimb','climb']},
  death: {standing:['death'], crawler:['crawlDeath','death']},
  idle: {standing:['idle'], crawler:['crawlIdle','crawl','idle']},
});
export function actionRole(action, crawler, actions) {
  const candidates = ACTION_ROLES[action]?.[crawler ? 'crawler' : 'standing'] || [];
  return candidates.find(role => actions[role]) || null;
}
const clamp = THREE.MathUtils.clamp;
const damp = (a,b,rate,dt) => THREE.MathUtils.lerp(a,b,1-Math.exp(-rate*dt));
const isGait = role => /^(walk2?|run2?|crawl)$/.test(role || '');

export class ZombieAnimator {
  constructor(model) {
    this.model = model; this.speed = 0; this.hitTime = 0;
    this.actions = [...new Set(Object.values(model.actions))];
    this.contacts = new GroundContacts(model.obj,model.profile);
  }
  play(role, rate=1, once=false, fade=.2) {
    const m=this.model, a=m.actions[role]; if (!a) return;
    if(once){m.hitAction?.stop();m.hitAction=null;this.hitTime=0;this.contacts.reset();}
    if (m.cur===a && !once) {a.timeScale=rate;m.curRole=role;return;}
    const prev=m.cur, phase=prev&&isGait(role)&&isGait(m.curRole) ? prev.time/prev.getClip().duration%1 : 0;
    a.reset().setEffectiveWeight(1);a.enabled=true;a.timeScale=rate;
    a.setLoop(once?THREE.LoopOnce:THREE.LoopRepeat,once?1:Infinity);a.clampWhenFinished=once;
    a.time=phase*a.getClip().duration;a.play();
    if(prev&&prev!==a)prev.crossFadeTo(a,fade,false);
    m.cur=a;m.curRole=role;
  }
  // Snapshot contains gameplay state and completed movement, never desired velocity.
  // Clocked actions sample the gameplay clock; the mixer only advances gaits/hits.
  update(s,dt) {
    const m=this.model,A=m.actions;
    const clocked = s.state==='enter'||s.state==='attack'||s.state==='bash';
    if(clocked) {
      const role=s.state==='attack'?s.attackRole:actionRole(s.state,s.crawler,A);
      if(role) {
        if(m.curRole!==role)this.play(role,0,true,.12);
        const phase=s.state==='enter'?s.vault:s.state==='bash'?s.bashElapsed/1.5:s.attackTime/s.attackDuration;
        m.cur.time=clamp(phase,0,.999999)*m.cur.getClip().duration;
      }
    } else if(s.state==='rise') {
      const role=actionRole('rise',s.crawler,A);if(m.curRole!==role)this.play(role);
    } else {
      this.speed=damp(this.speed,s.speed,14,dt);
      const idle=actionRole('idle',s.crawler,A), running=/^run/.test(m.curRole||'');
      const run=!s.crawler&&A[s.runRole]&&this.speed>(running?1.9:2.25);
      const moving=this.speed > (m.curRole === idle ? .16 : .07);
      const role=!moving?idle:s.crawler?'crawl':run?s.runRole:s.walkRole;
      if(m.curRole!==role)this.play(role);
      if(m.cur) {
        // Distance owns the phase. Smoothing this rate separately made feet
        // slide during acceleration and continue stepping against a wall.
        m.cur.timeScale=moving?Math.max(0,s.speed)*m.cur.getClip().duration/((m.profile?.stride[role]||STRIDE[role]||1.1)*s.scale):1;
      }
    }
    this.advance(dt);
    if(m.cur)this.contacts.update(m.curRole,m.cur.time/m.cur.getClip().duration,s.state,s.scale,m.cur.getEffectiveWeight());
  }
  advance(dt) {
    const m=this.model;
    if(m.hitAction) {
      this.hitTime-=dt;
      if(this.hitTime<=.1)m.hitAction.setEffectiveWeight(Math.max(0,this.hitTime/.1));
      if(this.hitTime<=0){m.hitAction.stop();m.hitAction=null;}
    }
    m.mixer.update(dt);
    for(const a of this.actions)if(a!==m.cur&&a!==m.hitAction&&a.isScheduled()&&a.getEffectiveWeight()<.001)a.stop();
  }
  hit(state) {
    const m=this.model,A=m.actions;
    if(!A.hit||this.hitTime>0||!['chase','toWindow'].includes(state))return;
    const a=A.hit2&&Math.random()<.5?A.hit2:A.hit;
    if(a.getClip().blendMode!==THREE.AdditiveAnimationBlendMode)return;
    a.reset().setLoop(THREE.LoopOnce,1).setEffectiveWeight(1).setEffectiveTimeScale(1).play();
    m.hitAction=a;this.hitTime=a.getClip().duration;
  }
}
