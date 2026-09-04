import * as THREE from 'three';
import { CONTACT, solveTwoBone, sampleMotion, canStartWeaponAction } from './motion.js';
import { ZombieAnimator, actionRole } from './zombie-animation.js';
import { VAULT, vaultPose, windowPoint } from './window-traversal.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as skeletonClone } from 'three/addons/utils/SkeletonUtils.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
// ===== 00_core.js =====

// ---------------------------------------------------------------- utils
const TAU = Math.PI * 2;
const rand = (a = 1, b) => (b === undefined ? Math.random() * a : a + Math.random() * (b - a));
const randi = (a, b) => Math.floor(rand(a, b + 1));
const choice = (arr) => arr[Math.floor(Math.random() * arr.length)];
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));
const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const dist2 = (ax, az, bx, bz) => { const dx = ax - bx, dz = az - bz; return dx * dx + dz * dz; };
const angleWrap = (a) => { a = a % TAU; if (a > Math.PI) a -= TAU; if (a < -Math.PI) a += TAU; return a; };
const angleLerp = (a, b, t) => a + angleWrap(b - a) * t;
const fmt = (n) => Math.round(n).toLocaleString('en-US');
const weighted = (items) => { // items: [{w, ...}]
  let total = 0; for (const it of items) total += it.w;
  let r = Math.random() * total;
  for (const it of items) { r -= it.w; if (r <= 0) return it; }
  return items[items.length - 1];
};

const Store = {
  get(k, d) { try { const v = localStorage.getItem('deadlight.' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('deadlight.' + k, JSON.stringify(v)); } catch (e) { /* sandboxed */ } },
};

const $ = (id) => document.getElementById(id);

// ---------------------------------------------------------------- procedural textures
function makeCanvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }

function addNoise(ctx, w, h, amp = 18, alpha = 1, mono = true) {
  const img = ctx.getImageData(0, 0, w, h); const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (Math.random() - 0.5) * 2 * amp;
    if (mono) { d[i] += n; d[i + 1] += n; d[i + 2] += n; }
    else { d[i] += n; d[i + 1] += (Math.random() - 0.5) * 2 * amp; d[i + 2] += (Math.random() - 0.5) * 2 * amp; }
  }
  ctx.putImageData(img, 0, 0);
}
function blotches(ctx, w, h, n, rMin, rMax, color, aMin, aMax) {
  for (let i = 0; i < n; i++) {
    const x = rand(w), y = rand(h), r = rand(rMin, rMax);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(${color},${rand(aMin, aMax)})`); g.addColorStop(1, `rgba(${color},0)`);
    ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
}
function cracks(ctx, w, h, n, color = 'rgba(20,20,20,0.55)') {
  ctx.strokeStyle = color; ctx.lineCap = 'round';
  for (let i = 0; i < n; i++) {
    let x = rand(w), y = rand(h); ctx.lineWidth = rand(0.6, 1.6); ctx.beginPath(); ctx.moveTo(x, y);
    const segs = randi(4, 12); let a = rand(TAU);
    for (let s = 0; s < segs; s++) { a += rand(-0.9, 0.9); const l = rand(6, 26); x += Math.cos(a) * l; y += Math.sin(a) * l; ctx.lineTo(x, y); }
    ctx.stroke();
  }
}
function finishTex(c, repeat = true, srgb = true) {
  const t = new THREE.CanvasTexture(c);
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
const TEX = {};
function buildTextures() {
  // concrete wall
  {
    const s = 512, c = makeCanvas(s, s), x = c.getContext('2d');
    x.fillStyle = '#5d5b57'; x.fillRect(0, 0, s, s);
    blotches(x, s, s, 40, 30, 160, '30,28,26', 0.05, 0.25); blotches(x, s, s, 30, 20, 90, '120,118,110', 0.04, 0.16);
    addNoise(x, s, s, 14); cracks(x, s, s, 14);
    // faint form-work seams
    x.strokeStyle = 'rgba(0,0,0,0.25)'; x.lineWidth = 2; for (let i = 0; i < 2; i++) { const y = (i + 1) * s / 3 + rand(-8, 8); x.beginPath(); x.moveTo(0, y); x.lineTo(s, y); x.stroke(); }
    blotches(x, s, s, 6, 40, 120, '70,40,20', 0.05, 0.2); // rust drips
    TEX.wall = finishTex(c);
    TEX.wallBump = finishTex(c, true, false);
  }
  // floor: concrete slabs with grout
  {
    const s = 512, c = makeCanvas(s, s), x = c.getContext('2d');
    x.fillStyle = '#4a4946'; x.fillRect(0, 0, s, s);
    blotches(x, s, s, 60, 20, 140, '20,20,20', 0.06, 0.3); blotches(x, s, s, 30, 20, 80, '110,105,95', 0.03, 0.12);
    addNoise(x, s, s, 12); cracks(x, s, s, 10);
    x.strokeStyle = 'rgba(15,15,15,0.7)'; x.lineWidth = 3; x.beginPath(); x.moveTo(0, 0); x.lineTo(s, 0); x.moveTo(0, 0); x.lineTo(0, s); x.moveTo(0, s / 2); x.lineTo(s, s / 2); x.moveTo(s / 2, 0); x.lineTo(s / 2, s); x.stroke();
    blotches(x, s, s, 5, 30, 90, '60,10,10', 0.08, 0.28); // old stains
    TEX.floor = finishTex(c); TEX.floorBump = finishTex(c, true, false);
  }
  // ceiling: dark panels
  {
    const s = 256, c = makeCanvas(s, s), x = c.getContext('2d');
    x.fillStyle = '#2b2c2e'; x.fillRect(0, 0, s, s); addNoise(x, s, s, 10);
    x.strokeStyle = 'rgba(0,0,0,0.6)'; x.lineWidth = 4; x.strokeRect(2, 2, s - 4, s - 4);
    blotches(x, s, s, 8, 20, 60, '60,40,20', 0.05, 0.2);
    TEX.ceil = finishTex(c);
  }
  // metal plate
  {
    const s = 256, c = makeCanvas(s, s), x = c.getContext('2d');
    x.fillStyle = '#3a3d40'; x.fillRect(0, 0, s, s); addNoise(x, s, s, 9);
    x.strokeStyle = 'rgba(0,0,0,0.5)'; x.lineWidth = 3; x.strokeRect(1, 1, s - 2, s - 2);
    x.fillStyle = 'rgba(0,0,0,0.5)'; for (const [px, py] of [[16, 16], [s - 16, 16], [16, s - 16], [s - 16, s - 16]]) { x.beginPath(); x.arc(px, py, 5, 0, TAU); x.fill(); }
    blotches(x, s, s, 6, 20, 70, '90,50,20', 0.08, 0.25);
    for (let i = 0; i < 20; i++) { x.strokeStyle = `rgba(255,255,255,${rand(0.03, 0.09)})`; x.lineWidth = 1; x.beginPath(); const a = rand(s), b = rand(s); x.moveTo(a, b); x.lineTo(a + rand(-40, 40), b + rand(-40, 40)); x.stroke(); }
    TEX.metal = finishTex(c);
  }
  // wood planks
  {
    const s = 256, c = makeCanvas(s, s), x = c.getContext('2d');
    x.fillStyle = '#5a3d22'; x.fillRect(0, 0, s, s);
    for (let i = 0; i < 90; i++) { x.strokeStyle = `rgba(${randi(20, 60)},${randi(10, 35)},${randi(5, 15)},${rand(0.2, 0.6)})`; x.lineWidth = rand(0.5, 2); x.beginPath(); const y = rand(s); x.moveTo(0, y); x.bezierCurveTo(s / 3, y + rand(-6, 6), 2 * s / 3, y + rand(-6, 6), s, y + rand(-4, 4)); x.stroke(); }
    addNoise(x, s, s, 10);
    TEX.wood = finishTex(c);
  }
  // hazard stripes
  {
    const s = 256, c = makeCanvas(s, 64), x = c.getContext('2d');
    x.fillStyle = '#c9a227'; x.fillRect(0, 0, s, 64); x.fillStyle = '#151515';
    for (let i = -1; i < 6; i++) { x.beginPath(); x.moveTo(i * 48, 0); x.lineTo(i * 48 + 24, 0); x.lineTo(i * 48 + 24 + 64, 64); x.lineTo(i * 48 + 64, 64); x.fill(); }
    addNoise(x, s, 64, 12); blotches(x, s, 64, 10, 10, 40, '0,0,0', 0.1, 0.4);
    TEX.hazard = finishTex(c);
  }
  // soft glow dot (particles / sprites)
  {
    const s = 64, c = makeCanvas(s, s), x = c.getContext('2d');
    const g = x.createRadialGradient(32, 32, 0, 32, 32, 32); g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.35, 'rgba(255,255,255,0.6)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g; x.fillRect(0, 0, s, s);
    TEX.glow = finishTex(c, false);
  }
  // muzzle flash
  {
    const s = 128, c = makeCanvas(s, s), x = c.getContext('2d'); x.translate(64, 64);
    const g = x.createRadialGradient(0, 0, 0, 0, 0, 60); g.addColorStop(0, 'rgba(255,255,240,1)'); g.addColorStop(0.25, 'rgba(255,220,140,0.9)'); g.addColorStop(0.6, 'rgba(255,140,40,0.25)'); g.addColorStop(1, 'rgba(255,100,0,0)');
    x.fillStyle = g; x.beginPath();
    for (let i = 0; i < 16; i++) { const a = (i / 16) * TAU, r = i % 2 ? 62 : 26; x.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
    x.closePath(); x.fill();
    x.fillStyle = 'rgba(255,255,255,0.95)'; x.beginPath(); x.arc(0, 0, 14, 0, TAU); x.fill();
    TEX.flash = finishTex(c, false);
  }
  // blood splat decal
  {
    const s = 256, c = makeCanvas(s, s), x = c.getContext('2d');
    for (let i = 0; i < 24; i++) { const r = rand(6, 60), px = 128 + rand(-70, 70), py = 128 + rand(-70, 70); const g = x.createRadialGradient(px, py, 0, px, py, r); g.addColorStop(0, `rgba(${randi(60, 110)},${randi(0, 12)},${randi(4, 14)},0.95)`); g.addColorStop(0.7, `rgba(70,4,8,0.7)`); g.addColorStop(1, 'rgba(60,0,4,0)'); x.fillStyle = g; x.fillRect(px - r, py - r, r * 2, r * 2); }
    for (let i = 0; i < 40; i++) { x.fillStyle = `rgba(${randi(50, 100)},2,6,${rand(0.5, 0.9)})`; x.beginPath(); x.arc(128 + rand(-110, 110), 128 + rand(-110, 110), rand(1, 5), 0, TAU); x.fill(); }
    TEX.splat = finishTex(c, false);
  }
  // dirt ground for outdoor / spawn pits
  {
    const s = 256, c = makeCanvas(s, s), x = c.getContext('2d');
    x.fillStyle = '#2e2620'; x.fillRect(0, 0, s, s); blotches(x, s, s, 60, 10, 60, '10,8,6', 0.1, 0.4); blotches(x, s, s, 30, 10, 40, '70,55,40', 0.05, 0.2); addNoise(x, s, s, 16);
    TEX.dirt = finishTex(c);
  }
}

// chalk outline of a weapon on the wall (wall-buy)
function texChalk(name, cost, drawFn) {
  const c = makeCanvas(512, 256), x = c.getContext('2d');
  x.clearRect(0, 0, 512, 256);
  x.save(); x.translate(256, 112); x.strokeStyle = 'rgba(235,235,225,0.85)'; x.lineWidth = 5; x.lineJoin = 'round'; x.lineCap = 'round';
  x.shadowColor = 'rgba(255,255,255,0.35)'; x.shadowBlur = 8;
  drawFn(x); x.restore();
  x.font = '700 40px "Barlow Condensed", Impact, sans-serif'; x.textAlign = 'center'; x.fillStyle = 'rgba(235,235,225,0.9)';
  x.fillText(name, 256, 222);
  x.font = '600 26px "Barlow Condensed", Impact, sans-serif'; x.fillStyle = 'rgba(229,181,58,0.95)'; x.fillText(String(cost), 256, 250);
  // chalk grit
  for (let i = 0; i < 600; i++) { x.fillStyle = `rgba(255,255,255,${rand(0.02, 0.08)})`; x.fillRect(rand(512), rand(256), 1, 1); }
  const t = finishTex(c, false); return t;
}
const CHALK = {
  smg(x) { x.beginPath(); x.moveTo(-120, -10); x.lineTo(60, -10); x.lineTo(70, -30); x.lineTo(140, -30); x.lineTo(140, -14); x.lineTo(80, -14); x.lineTo(80, 10); x.lineTo(20, 10); x.lineTo(10, 60); x.lineTo(-20, 60); x.lineTo(-14, 10); x.lineTo(-80, 10); x.lineTo(-90, 50); x.lineTo(-110, 50); x.lineTo(-100, 10); x.lineTo(-160, 10); x.lineTo(-160, -10); x.closePath(); x.stroke(); },
  shotgun(x) { x.beginPath(); x.moveTo(-190, -6); x.lineTo(120, -6); x.lineTo(120, 8); x.lineTo(40, 8); x.lineTo(30, 20); x.lineTo(-10, 20); x.lineTo(-20, 8); x.lineTo(-60, 8); x.lineTo(-90, 50); x.lineTo(-150, 54); x.lineTo(-150, 8); x.lineTo(-190, 8); x.closePath(); x.stroke(); x.beginPath(); x.moveTo(-40, -6); x.lineTo(20, -6); x.lineTo(20, -18); x.lineTo(-40, -18); x.closePath(); x.stroke(); },
  rifle(x) { x.beginPath(); x.moveTo(-180, 0); x.lineTo(170, 0); x.lineTo(170, 12); x.lineTo(50, 12); x.lineTo(40, 24); x.lineTo(10, 24); x.lineTo(0, 12); x.lineTo(-30, 12); x.lineTo(-40, 60); x.lineTo(-60, 60); x.lineTo(-55, 12); x.lineTo(-100, 12); x.lineTo(-130, 60); x.lineTo(-180, 60); x.closePath(); x.stroke(); x.beginPath(); x.rect(-40, -30, 90, 22); x.stroke(); x.beginPath(); x.moveTo(-10, -8); x.lineTo(-10, 0); x.stroke(); },
  lmg(x) { x.beginPath(); x.moveTo(-170, -14); x.lineTo(150, -14); x.lineTo(150, 6); x.lineTo(60, 6); x.lineTo(60, 26); x.lineTo(-10, 26); x.lineTo(-20, 6); x.lineTo(-40, 6); x.lineTo(-50, 60); x.lineTo(-80, 60); x.lineTo(-75, 6); x.lineTo(-120, 6); x.lineTo(-140, 50); x.lineTo(-170, 50); x.closePath(); x.stroke(); x.beginPath(); x.rect(-20, -40, 70, 26); x.stroke(); x.beginPath(); x.moveTo(90, 6); x.lineTo(70, 60); x.moveTo(110, 6); x.lineTo(130, 60); x.stroke(); },
};

// stencil text decal (zone names, warnings)
function texStencil(text, color = 'rgba(200,190,170,0.75)', size = 96, w = 1024, h = 192, font = 'Anton') {
  const c = makeCanvas(w, h), x = c.getContext('2d');
  x.font = `${size}px "${font}", Impact, sans-serif`; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillStyle = color;
  x.fillText(text, w / 2, h / 2);
  // weathering: erase random flecks
  x.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 900; i++) { x.fillStyle = `rgba(0,0,0,${rand(0.3, 1)})`; x.fillRect(rand(w), rand(h), rand(1, 4), rand(1, 3)); }
  for (let i = 0; i < 8; i++) { const px = rand(w), py = rand(h), r = rand(10, 40); const g = x.createRadialGradient(px, py, 0, px, py, r); g.addColorStop(0, 'rgba(0,0,0,0.9)'); g.addColorStop(1, 'rgba(0,0,0,0)'); x.fillStyle = g; x.fillRect(px - r, py - r, r * 2, r * 2); }
  return finishTex(c, false);
}
// glowing label sprite (power-ups, signs)
function texLabel(text, color = '#e5b53a', sub = '') {
  const c = makeCanvas(512, 160), x = c.getContext('2d');
  x.font = '64px "Anton", Impact, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.shadowColor = color; x.shadowBlur = 24; x.fillStyle = color; x.fillText(text, 256, sub ? 60 : 80);
  if (sub) { x.shadowBlur = 8; x.font = '600 30px "Barlow Condensed", sans-serif'; x.fillStyle = 'rgba(240,235,225,0.9)'; x.fillText(sub, 256, 118); }
  const t = finishTex(c, false); return t;
}
// small ring/arrow texture for interactable glow on floor
function texRing() {
  const s = 128, c = makeCanvas(s, s), x = c.getContext('2d');
  x.strokeStyle = 'rgba(255,255,255,0.9)'; x.lineWidth = 6; x.beginPath(); x.arc(64, 64, 52, 0, TAU); x.stroke();
  x.strokeStyle = 'rgba(255,255,255,0.35)'; x.lineWidth = 2; x.beginPath(); x.arc(64, 64, 40, 0, TAU); x.stroke();
  return finishTex(c, false);
}

// Box geometry with world-scaled UVs so tiled textures don't stretch.
function boxGeo(w, h, d, density = 0.45) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv; const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) { const [su, sv] = dims[f]; for (let i = 0; i < 4; i++) { const k = f * 4 + i; uv.setXY(k, uv.getX(k) * su * density, uv.getY(k) * sv * density); } }
  return g;
}

// ===== 10_audio.js =====
// ---------------------------------------------------------------- audio engine (fully synthesized)
class AudioEngine {
  constructor() { this.ctx = null; this.enabled = true; this.lastGroan = 0; this.listener = { x: 0, z: 0, yaw: 0 }; this.heartPhase = 0; this.ambientOn = false; this.creakT = 6; }
  init() {
    if (this.ctx) return;
    const C = window.AudioContext || window.webkitAudioContext; if (!C) return;
    const ctx = this.ctx = new C();
    this.master = ctx.createGain(); this.master.gain.value = this.enabled ? 0.85 : 0;
    this.comp = ctx.createDynamicsCompressor(); this.comp.threshold.value = -14; this.comp.ratio.value = 6; this.comp.attack.value = 0.003; this.comp.release.value = 0.2;
    this.master.connect(this.comp); this.comp.connect(ctx.destination);
    this.bus = ctx.createGain(); this.bus.connect(this.master);
    // reverb (bunker)
    this.verb = ctx.createConvolver(); this.verb.buffer = this._impulse(2.4, 2.6); const vg = ctx.createGain(); vg.gain.value = 0.55; this.verb.connect(vg); vg.connect(this.master);
    this.send = ctx.createGain(); this.send.gain.value = 1; this.send.connect(this.verb);
    // noise buffer
    const len = ctx.sampleRate * 2; const b = ctx.createBuffer(1, len, ctx.sampleRate); const d = b.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1; this.noise = b;
    // brown noise for ambience
    const bb = ctx.createBuffer(1, len, ctx.sampleRate); const bd = bb.getChannelData(0); let last = 0;
    for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; last = (last + 0.02 * w) / 1.02; bd[i] = last * 3.5; } this.brown = bb;
    this.startAmbient();
  }
  _impulse(dur, decay) {
    const ctx = this.ctx, len = ctx.sampleRate * dur, b = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) { const d = b.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay) * (i < 400 ? i / 400 : 1); }
    return b;
  }
  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); }
  setEnabled(b) { this.enabled = b; if (this.master) this.master.gain.setTargetAtTime(b ? 0.85 : 0, this.ctx.currentTime, 0.05); }
  get t() { return this.ctx.currentTime; }
  // position → stereo pan & distance gain
  spatial(x, z) {
    const L = this.listener; const dx = x - L.x, dz = z - L.z; const d = Math.sqrt(dx * dx + dz * dz);
    // camera forward = (-sin(yaw), -cos(yaw)); right = (cos(yaw), -sin(yaw))  [matches player yaw convention]
    const rx = Math.cos(L.yaw), rz = -Math.sin(L.yaw);
    const pan = d > 0.01 ? clamp((dx * rx + dz * rz) / d, -1, 1) * 0.8 : 0;
    const gain = 1 / (1 + d * d * 0.02);
    return { pan, gain, d };
  }
  _out(gain, pan = 0, sendAmt = 0.25) {
    const ctx = this.ctx; const g = ctx.createGain(); g.gain.value = gain;
    let node = g;
    if (pan !== 0 && ctx.createStereoPanner) { const p = ctx.createStereoPanner(); p.pan.value = pan; g.connect(p); node = p; }
    node.connect(this.bus); if (sendAmt > 0) { const s = ctx.createGain(); s.gain.value = sendAmt; node.connect(s); s.connect(this.send); }
    return g;
  }
  // noise burst through a sweeping filter
  burst({ dur = 0.2, f0 = 3000, f1 = 300, q = 0.8, type = 'lowpass', gain = 0.5, pan = 0, send = 0.25, t0 = 0, curve = 6, attack = 0.002 } = {}) {
    if (!this.ctx) return; const ctx = this.ctx, t = ctx.currentTime + t0;
    const src = ctx.createBufferSource(); src.buffer = this.noise; src.loop = true; src.playbackRate.value = rand(0.9, 1.1);
    const f = ctx.createBiquadFilter(); f.type = type; f.Q.value = q; f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const env = ctx.createGain(); env.gain.setValueAtTime(0.0001, t); env.gain.exponentialRampToValueAtTime(1, t + attack); env.gain.setTargetAtTime(0.0001, t + attack, dur / curve);
    const out = this._out(gain, pan, send);
    src.connect(f); f.connect(env); env.connect(out); src.start(t); src.stop(t + dur + 0.3);
  }
  tone({ type = 'sine', f0 = 200, f1, dur = 0.3, gain = 0.3, a = 0.005, pan = 0, send = 0.2, t0 = 0, detune = 0, release } = {}) {
    if (!this.ctx) return; const ctx = this.ctx, t = ctx.currentTime + t0;
    const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(f0, t); if (f1) o.frequency.exponentialRampToValueAtTime(Math.max(10, f1), t + dur); o.detune.value = detune;
    const env = ctx.createGain(); env.gain.setValueAtTime(0.0001, t); env.gain.linearRampToValueAtTime(1, t + a);
    const rel = release ?? dur * 0.6; env.gain.setValueAtTime(1, t + Math.max(a, dur - rel)); env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const out = this._out(gain, pan, send); o.connect(env); env.connect(out); o.start(t); o.stop(t + dur + 0.05);
    return o;
  }
  // ------------------------------------------------ weapons
  gunshot(kind, pap = false) {
    if (!this.ctx) return;
    const p = {
      pistol: { dur: 0.16, f0: 4200, f1: 320, g: 0.55, sub: 0.6, sf: 160 },
      smg: { dur: 0.11, f0: 3600, f1: 380, g: 0.42, sub: 0.45, sf: 140 },
      shotgun: { dur: 0.42, f0: 2600, f1: 180, g: 0.85, sub: 1.1, sf: 120 },
      rifle: { dur: 0.26, f0: 3400, f1: 260, g: 0.65, sub: 0.8, sf: 150 },
      lmg: { dur: 0.19, f0: 3000, f1: 300, g: 0.55, sub: 0.7, sf: 130 },
      sniper: { dur: 0.5, f0: 3800, f1: 160, g: 0.95, sub: 1.2, sf: 110 },
      energy: null, nova: null,
    }[kind];
    if (kind === 'energy') { this.tone({ type: 'sawtooth', f0: 1600, f1: 220, dur: 0.16, gain: 0.22, send: 0.3 }); this.tone({ type: 'sine', f0: 900, f1: 120, dur: 0.14, gain: 0.25 }); this.burst({ dur: 0.08, f0: 6000, f1: 1500, type: 'bandpass', q: 2, gain: 0.15 }); return; }
    if (kind === 'nova') { this.tone({ type: 'sawtooth', f0: 300, f1: 40, dur: 0.5, gain: 0.35, send: 0.5 }); this.tone({ type: 'square', f0: 90, f1: 30, dur: 0.45, gain: 0.3 }); this.burst({ dur: 0.35, f0: 1800, f1: 120, gain: 0.5, send: 0.5 }); this.tone({ type: 'sine', f0: 2400, f1: 300, dur: 0.25, gain: 0.12 }); return; }
    if (!p) return;
    const m = pap ? 1.15 : 1;
    this.burst({ dur: p.dur * m, f0: p.f0, f1: p.f1, gain: p.g, send: 0.3 });
    this.tone({ type: 'sine', f0: p.sf, f1: 38, dur: 0.13 * m, gain: p.sub * 0.6, a: 0.002, send: 0.1 });
    this.tone({ type: 'square', f0: 2200, f1: 900, dur: 0.012, gain: 0.12, send: 0 });
    if (pap) this.tone({ type: 'triangle', f0: 1200, f1: 400, dur: 0.12, gain: 0.08, send: 0.4 });
  }
  empty() { this.tone({ type: 'square', f0: 900, dur: 0.03, gain: 0.08, send: 0 }); this.tone({ type: 'square', f0: 600, dur: 0.03, gain: 0.08, t0: 0.07, send: 0 }); }
  reload(stage) { // 0 mag out, 1 mag in, 2 bolt
    if (stage === 0) { this.burst({ dur: 0.06, f0: 2500, f1: 800, type: 'bandpass', q: 3, gain: 0.25, send: 0.15 }); this.tone({ type: 'square', f0: 700, f1: 300, dur: 0.04, gain: 0.06 }); }
    else if (stage === 1) { this.burst({ dur: 0.05, f0: 1800, f1: 500, type: 'bandpass', q: 3, gain: 0.3, send: 0.15 }); this.tone({ type: 'square', f0: 400, f1: 200, dur: 0.05, gain: 0.1 }); }
    else { this.burst({ dur: 0.04, f0: 4000, f1: 1500, type: 'bandpass', q: 4, gain: 0.25 }); this.burst({ dur: 0.05, f0: 3000, f1: 900, type: 'bandpass', q: 4, gain: 0.25, t0: 0.09 }); }
  }
  hitmarker(kill, head) {
    if (head) this.burst({ dur: 0.07, f0: 1200, f1: 300, type: 'bandpass', q: 1.5, gain: 0.35, send: 0.1 });
    else this.burst({ dur: 0.04, f0: 900, f1: 300, type: 'lowpass', gain: 0.22, send: 0.05 });
    this.tone({ type: 'sine', f0: kill ? 1300 : 1700, dur: 0.035, gain: kill ? 0.16 : 0.09, send: 0 });
    if (kill) this.tone({ type: 'sine', f0: 900, dur: 0.05, gain: 0.1, t0: 0.03, send: 0 });
  }
  melee(hit) { this.burst({ dur: 0.12, f0: 5000, f1: 1200, type: 'bandpass', q: 1, gain: 0.25 }); if (hit) this.burst({ dur: 0.12, f0: 700, f1: 200, gain: 0.5, t0: 0.03 }); }
  explosion(dist = 0) {
    const g = clamp(1.2 / (1 + dist * 0.08), 0.2, 1.2);
    this.burst({ dur: 0.9, f0: 1500, f1: 60, gain: g, send: 0.6, curve: 4 });
    this.tone({ type: 'sine', f0: 110, f1: 25, dur: 0.6, gain: g * 0.9, a: 0.004, send: 0.3 });
    this.burst({ dur: 0.2, f0: 6000, f1: 2000, type: 'highpass', gain: g * 0.35 });
  }
  grenadeBounce() { this.tone({ type: 'triangle', f0: 800, f1: 400, dur: 0.05, gain: 0.12 }); }
  pin() { this.tone({ type: 'square', f0: 2400, f1: 1800, dur: 0.03, gain: 0.08, send: 0 }); }
  // ------------------------------------------------ zombies
  groan(x, z, force = false) {
    if (!this.ctx) return; const now = this.t; if (!force && now - this.lastGroan < 0.35) return; this.lastGroan = now;
    const { pan, gain } = this.spatial(x, z); if (gain < 0.03) return;
    const ctx = this.ctx, dur = rand(0.7, 1.6), f0 = rand(70, 140);
    const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(f0, now); o.frequency.linearRampToValueAtTime(f0 * rand(0.7, 1.1), now + dur);
    const lfo = ctx.createOscillator(); lfo.frequency.value = rand(4, 7); const lg = ctx.createGain(); lg.gain.value = rand(4, 9); lfo.connect(lg); lg.connect(o.frequency);
    const ws = ctx.createWaveShaper(); const curve = new Float32Array(256); for (let i = 0; i < 256; i++) { const v = i / 128 - 1; curve[i] = Math.tanh(v * 3); } ws.curve = curve;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 3; bp.frequency.setValueAtTime(rand(350, 500), now); bp.frequency.linearRampToValueAtTime(rand(700, 1000), now + dur * 0.5); bp.frequency.linearRampToValueAtTime(rand(300, 450), now + dur);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1800;
    const env = ctx.createGain(); env.gain.setValueAtTime(0.0001, now); env.gain.linearRampToValueAtTime(1, now + 0.18); env.gain.setValueAtTime(1, now + dur - 0.35); env.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    const out = this._out(0.42 * gain, pan, 0.45);
    o.connect(ws); ws.connect(bp); bp.connect(lp); lp.connect(env); env.connect(out);
    // breath noise
    const n = ctx.createBufferSource(); n.buffer = this.noise; n.loop = true; const nf = ctx.createBiquadFilter(); nf.type = 'bandpass'; nf.frequency.value = 900; nf.Q.value = 1; const ng = ctx.createGain(); ng.gain.value = 0.12;
    n.connect(nf); nf.connect(ng); ng.connect(env);
    o.start(now); lfo.start(now); n.start(now); o.stop(now + dur + 0.05); lfo.stop(now + dur + 0.05); n.stop(now + dur + 0.05);
  }
  bite() { this.burst({ dur: 0.18, f0: 600, f1: 120, gain: 0.7, send: 0.2 }); this.burst({ dur: 0.1, f0: 3000, f1: 800, type: 'bandpass', q: 2, gain: 0.3, t0: 0.02 }); }
  hurt() { this.tone({ type: 'sine', f0: 140, f1: 50, dur: 0.35, gain: 0.7, a: 0.003 }); this.burst({ dur: 0.25, f0: 500, f1: 100, gain: 0.4 }); }
  heartbeat() { this.tone({ type: 'sine', f0: 62, f1: 40, dur: 0.16, gain: 0.7, a: 0.01, send: 0 }); this.tone({ type: 'sine', f0: 55, f1: 36, dur: 0.16, gain: 0.55, a: 0.01, t0: 0.19, send: 0 }); }
  footstep(sprint) { this.burst({ dur: 0.07, f0: 700, f1: 200, gain: sprint ? 0.2 : 0.13, send: 0.15, attack: 0.004 }); }
  boardBreak(x, z) { const { pan, gain } = this.spatial(x, z); this.burst({ dur: 0.16, f0: 1600, f1: 300, type: 'bandpass', q: 1.2, gain: 0.7 * gain, pan, send: 0.35 }); this.tone({ type: 'triangle', f0: 220, f1: 90, dur: 0.12, gain: 0.35 * gain, pan }); }
  boardHit(x, z) { const { pan, gain } = this.spatial(x, z); this.burst({ dur: 0.08, f0: 900, f1: 250, gain: 0.45 * gain, pan, send: 0.3 }); }
  boardRepair() { this.burst({ dur: 0.06, f0: 2200, f1: 500, type: 'bandpass', q: 2, gain: 0.4, send: 0.3 }); this.tone({ type: 'triangle', f0: 320, f1: 160, dur: 0.08, gain: 0.25 }); }
  // ------------------------------------------------ UI / events
  purchase() { this.tone({ type: 'triangle', f0: 660, dur: 0.12, gain: 0.22, send: 0.3 }); this.tone({ type: 'triangle', f0: 990, dur: 0.22, gain: 0.22, t0: 0.09, send: 0.3 }); this.burst({ dur: 0.08, f0: 4000, f1: 1500, type: 'bandpass', q: 3, gain: 0.15 }); }
  deny() { this.tone({ type: 'square', f0: 180, dur: 0.16, gain: 0.14, send: 0 }); this.tone({ type: 'square', f0: 150, dur: 0.22, gain: 0.14, t0: 0.16, send: 0 }); }
  door() { this.burst({ dur: 0.8, f0: 900, f1: 90, gain: 0.7, send: 0.6, curve: 3 }); this.tone({ type: 'sawtooth', f0: 90, f1: 60, dur: 0.9, gain: 0.25, send: 0.4 }); this.tone({ type: 'triangle', f0: 400, f1: 200, dur: 0.15, gain: 0.3, t0: 0.85, send: 0.5 }); }
  roundStart() {
    if (!this.ctx) return;
    this.tone({ type: 'sine', f0: 70, f1: 28, dur: 1.4, gain: 0.9, a: 0.01, send: 0.3 });
    this.burst({ dur: 1.4, f0: 800, f1: 60, gain: 0.5, send: 0.7, curve: 3 });
    for (const [f, d] of [[110, 0], [164.8, 4], [220, -6], [329.6, 3]]) { this.tone({ type: 'sawtooth', f0: f, f1: f * 0.89, dur: 3.2, gain: 0.07, a: 0.7, t0: 0.15, detune: d, send: 0.8, release: 1.6 }); this.tone({ type: 'triangle', f0: f * 0.5, f1: f * 0.445, dur: 3.2, gain: 0.08, a: 0.7, t0: 0.15, send: 0.8, release: 1.6 }); }
  }
  roundEnd() { for (const [f, t0] of [[110, 0], [138.6, 0.25], [164.8, 0.5], [220, 0.75]]) this.tone({ type: 'triangle', f0: f, dur: 1.6, gain: 0.12, a: 0.15, t0, send: 0.8, release: 1 }); this.tone({ type: 'sine', f0: 55, dur: 2.4, gain: 0.35, a: 0.3, send: 0.6, release: 1.5 }); }
  powerup(type) {
    for (let i = 0; i < 5; i++) this.tone({ type: 'triangle', f0: [523, 659, 784, 1046, 1318][i], dur: 0.22, gain: 0.14, t0: i * 0.06, send: 0.5 });
    if (type === 'nuke') { this.explosion(0); this.tone({ type: 'sine', f0: 40, dur: 1.5, gain: 0.8, a: 0.02, send: 0.5 }); }
  }
  boxOpen() { this.tone({ type: 'triangle', f0: 392, dur: 0.5, gain: 0.15, send: 0.6 }); this.tone({ type: 'triangle', f0: 523, dur: 0.5, gain: 0.15, t0: 0.15, send: 0.6 }); this.tone({ type: 'triangle', f0: 659, dur: 0.7, gain: 0.15, t0: 0.3, send: 0.6 }); this.tone({ type: 'sine', f0: 65, dur: 1.2, gain: 0.5, a: 0.05, send: 0.5 }); this.burst({ dur: 0.5, f0: 1500, f1: 300, gain: 0.3, send: 0.6 }); }
  boxTick() { this.tone({ type: 'square', f0: rand(1800, 2400), dur: 0.025, gain: 0.05, send: 0.1 }); }
  boxDone() { this.tone({ type: 'triangle', f0: 880, dur: 0.3, gain: 0.18, send: 0.6 }); this.tone({ type: 'triangle', f0: 1320, dur: 0.5, gain: 0.14, t0: 0.12, send: 0.6 }); }
  papStart() { this.burst({ dur: 0.5, f0: 800, f1: 150, gain: 0.5, send: 0.5 }); this.tone({ type: 'sawtooth', f0: 80, f1: 160, dur: 2.6, gain: 0.12, a: 0.3, send: 0.6 }); for (let i = 0; i < 6; i++) this.tone({ type: 'square', f0: 200 + i * 90, dur: 0.15, gain: 0.05, t0: 0.4 + i * 0.35, send: 0.5 }); }
  papDone() { this.tone({ type: 'sine', f0: 60, f1: 30, dur: 0.6, gain: 0.7, send: 0.4 }); this.burst({ dur: 0.6, f0: 3000, f1: 200, gain: 0.5, send: 0.6 }); for (let i = 0; i < 4; i++) this.tone({ type: 'triangle', f0: [660, 880, 1100, 1320][i], dur: 0.4, gain: 0.12, t0: 0.1 + i * 0.08, send: 0.6 }); }
  powerOn() { this.tone({ type: 'sawtooth', f0: 40, f1: 110, dur: 2.2, gain: 0.3, a: 0.5, send: 0.6 }); this.burst({ dur: 0.3, f0: 2000, f1: 200, gain: 0.5, t0: 0.05, send: 0.5 }); for (let i = 0; i < 5; i++) this.burst({ dur: 0.12, f0: 5000, f1: 1500, type: 'bandpass', q: 4, gain: 0.25, t0: 1.2 + i * 0.28, send: 0.6 }); this.tone({ type: 'sine', f0: 55, dur: 3, gain: 0.5, a: 1.5, t0: 1.5, send: 0.3 }); }
  perk(color) { this.tone({ type: 'triangle', f0: 440, dur: 0.25, gain: 0.15, send: 0.5 }); this.tone({ type: 'triangle', f0: 554, dur: 0.25, gain: 0.15, t0: 0.12, send: 0.5 }); this.tone({ type: 'triangle', f0: 659, dur: 0.6, gain: 0.15, t0: 0.24, send: 0.6 }); this.burst({ dur: 0.7, f0: 2500, f1: 400, gain: 0.25, t0: 0.25, send: 0.6 }); }
  swap() { this.burst({ dur: 0.05, f0: 2200, f1: 700, type: 'bandpass', q: 3, gain: 0.2 }); }
  death() { this.tone({ type: 'sine', f0: 120, f1: 20, dur: 3, gain: 0.9, a: 0.02, send: 0.6 }); this.burst({ dur: 2.5, f0: 600, f1: 40, gain: 0.5, send: 0.8, curve: 3 }); }
  // ------------------------------------------------ ambience
  startAmbient() {
    if (!this.ctx || this.ambientOn) return; this.ambientOn = true; const ctx = this.ctx;
    const src = ctx.createBufferSource(); src.buffer = this.brown; src.loop = true;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 140;
    const g = ctx.createGain(); g.gain.value = 0.28; this.ambGain = g;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.07; const lg = ctx.createGain(); lg.gain.value = 0.1; lfo.connect(lg); lg.connect(g.gain);
    src.connect(lp); lp.connect(g); g.connect(this.master); src.start(); lfo.start();
    const sub = ctx.createOscillator(); sub.type = 'sine'; sub.frequency.value = 42; const sg = ctx.createGain(); sg.gain.value = 0.05; sub.connect(sg); sg.connect(this.master); sub.start();
    // faint electrical hum
    const hum = ctx.createOscillator(); hum.type = 'sawtooth'; hum.frequency.value = 60; const hf = ctx.createBiquadFilter(); hf.type = 'lowpass'; hf.frequency.value = 400; const hg = ctx.createGain(); hg.gain.value = 0.012; this.humGain = hg;
    hum.connect(hf); hf.connect(hg); hg.connect(this.master); hum.start();
  }
  update(dt, tense) {
    if (!this.ctx) return;
    this.creakT -= dt;
    if (this.creakT <= 0) { this.creakT = rand(7, 18); const a = rand(TAU); this.burst({ dur: rand(0.4, 1.1), f0: rand(300, 900), f1: rand(120, 300), type: 'bandpass', q: rand(6, 14), gain: 0.12, pan: Math.sin(a) * 0.7, send: 0.9 }); }
    if (this.ambGain) this.ambGain.gain.setTargetAtTime(tense ? 0.38 : 0.26, this.t, 0.5);
  }
}
const SFX = new AudioEngine();

// ===== 20_nav.js =====
// ---------------------------------------------------------------- navigation grid: collision + BFS flow field
const CS = 0.5, GX0 = -22, GZ0 = -18, GW = 128, GH = 112; // x∈[-22,42) z∈[-18,38)
const P_WALK = 1, Z_WALK = 2, ANY_WALK = 3;
const NAV = {
  grid: new Uint8Array(GW * GH),
  dist: new Uint16Array(GW * GH),
  queue: new Int32Array(GW * GH),
  flowStamp: 0,
  cx(x) { return Math.floor((x - GX0) / CS); },
  cz(z) { return Math.floor((z - GZ0) / CS); },
  idx(cx, cz) { return (cx < 0 || cz < 0 || cx >= GW || cz >= GH) ? -1 : cz * GW + cx; },
  cellOf(x, z) { return this.idx(this.cx(x), this.cz(z)); },
  center(i) { return { x: GX0 + (i % GW) * CS + CS / 2, z: GZ0 + Math.floor(i / GW) * CS + CS / 2 }; },
  fillRect(x1, z1, x2, z2, flags, mode = 'set') {
    const c0 = Math.round((x1 - GX0) / CS), c1 = Math.round((x2 - GX0) / CS), r0 = Math.round((z1 - GZ0) / CS), r1 = Math.round((z2 - GZ0) / CS);
    for (let r = Math.max(0, r0); r < Math.min(GH, r1); r++) for (let c = Math.max(0, c0); c < Math.min(GW, c1); c++) {
      const i = r * GW + c;
      if (mode === 'set') this.grid[i] = flags; else if (mode === 'or') this.grid[i] |= flags; else this.grid[i] &= ~flags;
    }
  },
  walkAt(x, z, mask) { const i = this.cellOf(x, z); return i >= 0 && (this.grid[i] & mask) !== 0; },
  // does a circle overlap any non-walkable cell?
  hits(x, z, r, mask) {
    const c0 = this.cx(x - r), c1 = this.cx(x + r), r0 = this.cz(z - r), r1 = this.cz(z + r);
    for (let cz = r0; cz <= r1; cz++) for (let cx = c0; cx <= c1; cx++) {
      const i = this.idx(cx, cz); if (i < 0) return true;
      if (this.grid[i] & mask) continue;
      const bx = GX0 + cx * CS, bz = GZ0 + cz * CS;
      const nx = clamp(x, bx, bx + CS), nz = clamp(z, bz, bz + CS);
      const dx = x - nx, dz = z - nz; if (dx * dx + dz * dz < r * r) return true;
    }
    return false;
  },
  // axis-separated slide move; returns true if blocked on any axis
  move(p, dx, dz, r, mask) {
    let blocked = false; const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dz)) / (r * 0.6)));
    const sx = dx / steps, sz = dz / steps;
    for (let s = 0; s < steps; s++) {
      if (!this.hits(p.x + sx, p.z, r, mask)) p.x += sx; else blocked = true;
      if (!this.hits(p.x, p.z + sz, r, mask)) p.z += sz; else blocked = true;
    }
    if (this.hits(p.x, p.z, r, mask)) this.depenetrate(p, r, mask);
    return blocked;
  },
  depenetrate(p, r, mask) {
    for (let ring = 1; ring <= 6; ring++) { const d = ring * 0.08; for (let k = 0; k < 12; k++) { const a = (k / 12) * TAU; const x = p.x + Math.cos(a) * d, z = p.z + Math.sin(a) * d; if (!this.hits(x, z, r, mask)) { p.x = x; p.z = z; return; } } }
  },
  // BFS from target cell across Z_WALK cells; 4-connected
  computeFlow(tx, tz) {
    const { grid, dist, queue } = this; dist.fill(65535);
    let start = this.cellOf(tx, tz);
    if (start < 0 || !(grid[start] & Z_WALK)) { // nearest zombie-walkable cell
      let best = -1, bd = 1e9; const cx = this.cx(tx), cz = this.cz(tz);
      for (let dz = -3; dz <= 3; dz++) for (let dx = -3; dx <= 3; dx++) { const i = this.idx(cx + dx, cz + dz); if (i >= 0 && (grid[i] & Z_WALK)) { const d = dx * dx + dz * dz; if (d < bd) { bd = d; best = i; } } }
      if (best < 0) return; start = best;
    }
    let head = 0, tail = 0; queue[tail++] = start; dist[start] = 0;
    while (head < tail) {
      const i = queue[head++]; const d = dist[i] + 1; const cx = i % GW;
      if (cx > 0) { const j = i - 1; if (dist[j] === 65535 && (grid[j] & Z_WALK)) { dist[j] = d; queue[tail++] = j; } }
      if (cx < GW - 1) { const j = i + 1; if (dist[j] === 65535 && (grid[j] & Z_WALK)) { dist[j] = d; queue[tail++] = j; } }
      if (i >= GW) { const j = i - GW; if (dist[j] === 65535 && (grid[j] & Z_WALK)) { dist[j] = d; queue[tail++] = j; } }
      if (i < GW * (GH - 1)) { const j = i + GW; if (dist[j] === 65535 && (grid[j] & Z_WALK)) { dist[j] = d; queue[tail++] = j; } }
    }
    this.flowStamp++;
  },
  // steering direction toward lower distance; writes into out {x,z}; returns false if none
  flowDir(x, z, out) {
    const i = this.cellOf(x, z); if (i < 0) return false; const { grid, dist } = this; const d0 = dist[i];
    if (d0 === 65535) return false;
    let sx = 0, sz = 0, any = false; const cx = i % GW, cz = (i - cx) / GW;
    for (let oz = -1; oz <= 1; oz++) for (let ox = -1; ox <= 1; ox++) {
      if (!ox && !oz) continue; const j = this.idx(cx + ox, cz + oz); if (j < 0 || !(grid[j] & Z_WALK)) continue;
      if (ox && oz) { const a = this.idx(cx + ox, cz), b = this.idx(cx, cz + oz); if (a < 0 || b < 0 || !(grid[a] & Z_WALK) || !(grid[b] & Z_WALK)) continue; }
      const dj = dist[j]; if (dj >= d0) continue;
      const w = (d0 - dj) * (ox && oz ? 0.7071 : 1); const c = this.center(j);
      let vx = c.x - x, vz = c.z - z; const L = Math.hypot(vx, vz) || 1; sx += (vx / L) * w; sz += (vz / L) * w; any = true;
    }
    if (!any) return false; const L = Math.hypot(sx, sz) || 1; out.x = sx / L; out.z = sz / L; return true;
  },
  distAt(x, z) { const i = this.cellOf(x, z); return i < 0 ? 65535 : this.dist[i]; },
  // grid line of sight (cells must satisfy mask)
  los(x1, z1, x2, z2, mask) {
    const dx = x2 - x1, dz = z2 - z1; const n = Math.ceil(Math.hypot(dx, dz) / (CS * 0.5)) || 1;
    for (let k = 1; k < n; k++) { const t = k / n; if (!this.walkAt(x1 + dx * t, z1 + dz * t, mask)) return false; }
    return true;
  },
};

// ===== 30_map.js =====
// ---------------------------------------------------------------- map: Bunker 09
const WALL_H = 4.2, T = 0.5;
const MAP = {
  group: null, solids: [], windows: [], risers: [], doors: [], interactables: [], lights: [], perkMachines: [], decals: [],
  zones: {
    A: { x1: -14, z1: -10, x2: 14, z2: 10, name: 'BARRACKS', open: true },
    B: { x1: 14.5, z1: -10, x2: 30, z2: 10, name: 'ARMORY', open: false },
    C: { x1: 14.5, z1: 10.5, x2: 34, z2: 30, name: 'LOADING DOCK', open: false },
  },
  mats: {}, box: null, pap: null, powerSwitch: null, powerOn: false,
  zoneAt(x, z) { for (const k in this.zones) { const zn = this.zones[k]; if (x >= zn.x1 && x <= zn.x2 && z >= zn.z1 && z <= zn.z2) return k; } return null; },
};

function buildMap(scene) {
  const g = MAP.group = new THREE.Group(); scene.add(g);
  const M = MAP.mats;
  M.wall = new THREE.MeshStandardMaterial({ map: TEX.wall, bumpMap: TEX.wallBump, bumpScale: 0.035, roughness: 0.95, color: 0xb6b2aa });
  M.floor = new THREE.MeshStandardMaterial({ map: TEX.floor, bumpMap: TEX.floorBump, bumpScale: 0.025, roughness: 0.68, metalness: 0.08, color: 0x89959a });
  M.ceil = new THREE.MeshStandardMaterial({ map: TEX.ceil, roughness: 1, color: 0x8d8d8d });
  M.metal = new THREE.MeshStandardMaterial({ map: TEX.metal, roughness: 0.55, metalness: 0.45, color: 0xd0d0d0 });
  M.metalDark = new THREE.MeshStandardMaterial({ color: 0x23262a, roughness: 0.6, metalness: 0.6 });
  M.wood = new THREE.MeshStandardMaterial({ map: TEX.wood, roughness: 0.9 });
  M.dark = new THREE.MeshStandardMaterial({ color: 0x15171a, roughness: 0.9 });
  M.hazard = new THREE.MeshStandardMaterial({ map: TEX.hazard, roughness: 0.8 });
  M.dirt = new THREE.MeshStandardMaterial({ map: TEX.dirt, roughness: 1, color: 0x8a7a6a });
  M.rubber = new THREE.MeshStandardMaterial({ color: 0x0c0c0e, roughness: 0.95 });
  M.canvas = new THREE.MeshStandardMaterial({ color: 0x4d5a3c, roughness: 1 });
  M.paint = new THREE.MeshStandardMaterial({ color: 0x5a6b4a, roughness: 0.7, metalness: 0.2 });

  NAV.grid.fill(0);
  // ---- zone interiors walkable
  for (const k in MAP.zones) { const z = MAP.zones[k]; NAV.fillRect(z.x1, z.z1, z.x2, z.z2, ANY_WALK); }

  const solidBox = (w, h, d, mat, x, y, z, opts = {}) => {
    const geo = boxGeo(w, h, d, opts.density ?? 0.45); const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z);
    if (opts.rotY) m.rotation.y = opts.rotY; g.add(m);
    if (opts.solid !== false) {
      let hw = w / 2, hd = d / 2; if (opts.rotY && Math.abs(Math.abs(opts.rotY) - Math.PI / 2) < 0.01) { hw = d / 2; hd = w / 2; }
      MAP.solids.push({ x1: x - hw, y1: y - h / 2, z1: z - hd, x2: x + hw, y2: y + h / 2, z2: z + hd });
      if (opts.grid !== false) NAV.fillRect(x - hw, z - hd, x + hw, z + hd, 0);
    }
    return m;
  };
  const wall = (x1, z1, x2, z2, h = WALL_H, y0 = 0) => solidBox(x2 - x1, h, z2 - z1, M.wall, (x1 + x2) / 2, y0 + h / 2, (z1 + z2) / 2);
  const cyl = (r, h, mat, x, y, z, solid = true) => { const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 14), mat); m.position.set(x, y, z); g.add(m); if (solid) { MAP.solids.push({ x1: x - r, y1: y - h / 2, z1: z - r, x2: x + r, y2: y + h / 2, z2: z + r }); NAV.fillRect(x - r, z - r, x + r, z + r, 0); } return m; };
  const plane = (w, h, mat, x, y, z, rotY = 0, rotX = 0) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat); m.position.set(x, y, z); m.rotation.set(rotX, rotY, 0); g.add(m); return m; };
  const decal = (tex, w, h, x, y, z, rotY = 0, rotX = 0, opacity = 1) => { const m = plane(w, h, new THREE.MeshStandardMaterial({ map: tex, transparent: true, opacity, roughness: 1, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }), x, y, z, rotY, rotX); MAP.decals.push(m); return m; };

  // ---- floors & ceilings
  const floorTile = (x1, z1, x2, z2, mat = M.floor, y = 0) => { const m = plane(x2 - x1, z2 - z1, mat, (x1 + x2) / 2, y, (z1 + z2) / 2, 0, -Math.PI / 2); const uv = m.geometry.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (x2 - x1) * 0.4, uv.getY(i) * (z2 - z1) * 0.4); return m; };
  const ceilTile = (x1, z1, x2, z2, y = WALL_H) => { const m = plane(x2 - x1, z2 - z1, M.ceil, (x1 + x2) / 2, y, (z1 + z2) / 2, 0, Math.PI / 2); const uv = m.geometry.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (x2 - x1) * 0.5, uv.getY(i) * (z2 - z1) * 0.5); return m; };
  floorTile(-14.5, -10.5, 14.5, 10.5); floorTile(14, -10.5, 30.5, 10.5); floorTile(14, 10, 34.5, 30.5);
  ceilTile(-14.5, -10.5, 14.5, 10.5); ceilTile(14, -10.5, 30.5, 10.5);
  // loading-dock canopy (partial roof) + open sky elsewhere
  ceilTile(14, 24, 34.5, 30.5, WALL_H + 0.8);
  solidBox(20.5, 0.4, 0.4, M.metalDark, 24.25, WALL_H + 0.6, 24, { solid: false });
  for (const cx of [15.6, 20.5, 28.0, 33.0]) solidBox(0.5, WALL_H + 0.8, 0.5, M.metalDark, cx, (WALL_H + 0.8) / 2, 24.5);

  // ---- ZONE A walls  (interior x -14..14, z -10..10)
  wall(-14.5, -10.5, -8, -10); wall(-6, -10.5, 6, -10); wall(8, -10.5, 14.5, -10);   // north w/ 2 window gaps
  wall(-14.5, 10, 14.5, 10.5);                                                      // south
  wall(-14.5, -10.5, -14, -1); wall(-14.5, 1, -14, 10.5);                            // west w/ window gap
  wall(14, -10.5, 14.5, -1.5); wall(14, 1.5, 14.5, 10.5);                            // east w/ door gap
  // ---- ZONE B walls (interior x 14.5..30, z -10..10)
  wall(14, -10.5, 21, -10); wall(23, -10.5, 30.5, -10);                              // north w/ window gap
  wall(30, -10.5, 30.5, -6); wall(30, -4, 30.5, 4); wall(30, 6, 30.5, 10.5);          // east w/ 2 window gaps
  wall(14, 10, 23, 10.5); wall(26, 10, 30.5, 10.5);                                  // south w/ door gap to C
  // ---- ZONE C walls (interior x 14.5..34, z 10.5..30)
  wall(14, 10, 14.5, 30.5);                                                          // west
  wall(30, 10, 34.5, 10.5);                                                          // north (east part)
  wall(34, 10, 34.5, 18); wall(34, 20, 34.5, 30.5);                                  // east w/ window gap
  wall(14, 30, 18, 30.5); wall(20, 30, 34.5, 30.5);                                  // south w/ window gap

  // ---- windows
  const addWindow = (id, zone, axis, cx, cz, pocket, lightColor = 0x4060a0) => {
    // axis 'z' → wall runs along x, opening 2 wide centered at cx, wall thickness along z at cz±0.25 ; interior direction sign
    const w = { id, zone, axis, x: cx, z: cz, boards: 6, planks: [], pocket, hp: 6, lastAttack: 0 };
    const interiorSign = zone === 'A' && axis === 'x' ? 1 : (axis === 'z' ? (cz < 0 ? 1 : -1) : (cx > 30 ? -1 : 1)); // toward zone interior
    if (axis === 'z') { // north/south walls
      solidBox(2, 1.0, T, M.wall, cx, 0.5, cz); solidBox(2, WALL_H - 2.6, T, M.wall, cx, (WALL_H + 2.6) / 2, cz, { grid: false });
      NAV.fillRect(cx - 1, cz - 0.25, cx + 1, cz + 0.25, Z_WALK); w.inner = { x: cx, z: cz + interiorSign * 1.3 }; w.outer = { x: cx, z: cz - interiorSign * 0.95 }; w.rot = 0;
    } else {
      solidBox(T, 1.0, 2, M.wall, cx, 0.5, cz); solidBox(T, WALL_H - 2.6, 2, M.wall, cx, (WALL_H + 2.6) / 2, cz, { grid: false });
      NAV.fillRect(cx - 0.25, cz - 1, cx + 0.25, cz + 1, Z_WALK); w.inner = { x: cx + interiorSign * 1.3, z: cz }; w.outer = { x: cx - interiorSign * 0.95, z: cz }; w.rot = Math.PI / 2;
    }
    // frame
    const frame = new THREE.Group(); frame.position.set(cx, 0, cz); frame.rotation.y = w.rot; g.add(frame);
    const fm = M.metalDark; const mk = (bw, bh, bd, x, y, z) => { const m = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, bd), fm); m.position.set(x, y, z); frame.add(m); };
    mk(2.3, 0.12, 0.6, 0, 1.0, 0); mk(2.3, 0.12, 0.6, 0, 2.6, 0); mk(0.12, 1.7, 0.6, -1.1, 1.8, 0); mk(0.12, 1.7, 0.6, 1.1, 1.8, 0);
    w.frame = frame;
    // planks
    for (let i = 0; i < 6; i++) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.2, 0.07), M.wood);
      p.userData.home = { y: 1.2 + i * 0.25, rz: rand(-0.22, 0.22), z: (i % 2 ? 0.08 : -0.08) };
      p.position.set(0, p.userData.home.y, p.userData.home.z); p.rotation.z = p.userData.home.rz; frame.add(p); w.planks.push(p);
    }
    // exterior pocket: dirt floor, walkable for zombies only, faint light, fence
    NAV.fillRect(pocket.x1, pocket.z1, pocket.x2, pocket.z2, Z_WALK);
    floorTile(pocket.x1, pocket.z1, pocket.x2, pocket.z2, M.dirt, -0.02);
    const L = new THREE.PointLight(lightColor, 120, 14, 2); L.position.set(w.outer.x + (w.outer.x - w.inner.x) * 0.3, 3.0, w.outer.z + (w.outer.z - w.inner.z) * 0.3); g.add(L);
    MAP.lights.push({ light: L, base: 120, mode: 'steady' });
    // rubble outside
    for (let i = 0; i < 4; i++) solidBox(rand(0.4, 0.9), rand(0.3, 0.6), rand(0.4, 0.9), M.wall, rand(pocket.x1 + 0.6, pocket.x2 - 0.6), 0.2, rand(pocket.z1 + 0.6, pocket.z2 - 0.6), { solid: false });
    MAP.windows.push(w);
    MAP.interactables.push({ kind: 'window', x: w.inner.x, z: w.inner.z, r: 2.2, win: w });
    return w;
  };
  addWindow('A1', 'A', 'z', -7, -10.25, { x1: -11, z1: -14.5, x2: -3, z2: -10.5 });
  addWindow('A2', 'A', 'z', 7, -10.25, { x1: 3, z1: -14.5, x2: 11, z2: -10.5 });
  addWindow('A3', 'A', 'x', -14.25, 0, { x1: -18.5, z1: -4, x2: -14.5, z2: 4 });
  addWindow('B1', 'B', 'z', 22, -10.25, { x1: 18, z1: -14.5, x2: 26, z2: -10.5 });
  addWindow('B2', 'B', 'x', 30.25, -5, { x1: 30.5, z1: -9, x2: 34.5, z2: -1 });
  addWindow('B3', 'B', 'x', 30.25, 5, { x1: 30.5, z1: 1, x2: 34.5, z2: 9 });
  addWindow('C1', 'C', 'x', 34.25, 19, { x1: 34.5, z1: 15, x2: 38.5, z2: 23 });
  addWindow('C2', 'C', 'z', 19, 30.25, { x1: 15, z1: 30.5, x2: 23, z2: 34.5 });
  // ---- riser spawns (zone C dirt patches)
  for (const [x, z] of [[17.5, 13.5], [31, 14], [17.5, 27], [31.5, 27.5], [24.5, 17]]) {
    const patch = plane(2.6, 2.6, M.dirt, x, 0.01, z, 0, -Math.PI / 2); MAP.risers.push({ x, z, zone: 'C' });
    const edge = new THREE.Mesh(new THREE.RingGeometry(1.2, 1.4, 20), M.dark); edge.rotation.x = -Math.PI / 2; edge.position.set(x, 0.012, z); g.add(edge);
  }

  // ---- doors
  const addDoor = (id, from, to, cost, x1, z1, x2, z2, style) => {
    const d = { id, from, to, cost, x1, z1, x2, z2, open: false, style, meshes: [], anim: 0 };
    NAV.fillRect(x1, z1, x2, z2, 0);
    const cx = (x1 + x2) / 2, cz = (z1 + z2) / 2; const along = (x2 - x1) > (z2 - z1) ? 'x' : 'z'; const len = along === 'x' ? x2 - x1 : z2 - z1;
    const grp = new THREE.Group(); grp.position.set(cx, 0, cz); if (along === 'z') grp.rotation.y = Math.PI / 2; g.add(grp); d.group = grp;
    if (style === 'gate') {
      const frame = new THREE.Mesh(new THREE.BoxGeometry(len + 0.3, 0.2, 0.3), M.metalDark); frame.position.y = 3.1; grp.add(frame);
      for (let i = 0; i <= 10; i++) { const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 3.0, 8), M.metalDark); bar.position.set(-len / 2 + i * (len / 10), 1.5, 0); grp.add(bar); }
      for (const y of [0.5, 1.5, 2.5]) { const rail = new THREE.Mesh(new THREE.BoxGeometry(len, 0.08, 0.1), M.metalDark); rail.position.y = y; grp.add(rail); }
      const sign = decal(texStencil('SECTOR B — LOCKED', 'rgba(220,200,90,0.9)', 70, 1024, 160), 2.4, 0.4, 0, 1.9, 0.08); grp.add(sign); MAP.decals.pop();
      const haz = new THREE.Mesh(new THREE.BoxGeometry(len, 0.35, 0.12), M.hazard); haz.position.y = 1.0; grp.add(haz);
    } else { // debris
      for (let i = 0; i < 9; i++) { const c = new THREE.Mesh(boxGeo(rand(0.7, 1.2), rand(0.5, 1.0), rand(0.6, 1.0)), i % 3 ? M.wood : M.metal); c.position.set(rand(-len / 2 + 0.5, len / 2 - 0.5), rand(0.3, 1.9), rand(-0.2, 0.2)); c.rotation.set(rand(-0.2, 0.2), rand(TAU), rand(-0.2, 0.2)); grp.add(c); }
      for (let i = 0; i < 4; i++) { const p = new THREE.Mesh(new THREE.BoxGeometry(len + 0.4, 0.2, 0.08), M.wood); p.position.set(0, 0.6 + i * 0.6, 0.25); p.rotation.z = rand(-0.3, 0.3); grp.add(p); }
      const sign = decal(texStencil('DEBRIS — CLEAR', 'rgba(220,200,90,0.9)', 70, 1024, 160), 2.2, 0.36, 0, 2.5, 0.35); grp.add(sign); MAP.decals.pop();
    }
    MAP.doors.push(d);
    MAP.interactables.push({ kind: 'door', x: cx, z: cz, r: 2.6, door: d });
    return d;
  };
  addDoor('D1', 'A', 'B', 750, 14, -1.5, 14.5, 1.5, 'gate');
  addDoor('D2', 'B', 'C', 1250, 23, 10, 26, 10.5, 'debris');

  // ---- props
  // zone A: barracks
  for (const [x, z] of [[-6, -3], [6, 3]]) solidBox(1, WALL_H, 1, M.wall, x, WALL_H / 2, z, { density: 0.6 });
  const bunk = (x, z) => { solidBox(1.0, 0.12, 2.1, M.canvas, x, 0.55, z); solidBox(1.0, 0.12, 2.1, M.canvas, x, 1.55, z, { grid: false }); for (const [ox, oz] of [[-0.45, -1], [0.45, -1], [-0.45, 1], [0.45, 1]]) solidBox(0.08, 1.9, 0.08, M.metalDark, x + ox, 0.95, z + oz, { solid: false }); };
  bunk(-13.4, -6.5); bunk(-13.4, 6.5); bunk(-9.5, -6.5);
  solidBox(1.2, 1.2, 1.2, M.wood, -11, 0.6, 7.5); solidBox(1.0, 1.0, 1.0, M.wood, -11.1, 1.7, 7.4, { grid: false }); solidBox(1.0, 1.0, 1.0, M.wood, -9.6, 0.5, 8.4);
  solidBox(1.6, 0.08, 0.8, M.wood, 3, 0.9, -6.5); solidBox(1.4, 0.85, 0.6, M.dark, 3, 0.43, -6.5);  // table
  cyl(0.36, 0.95, M.metal, 12.4, 0.475, -4.0); cyl(0.36, 0.95, M.metal, 12.9, 0.475, -5.0); cyl(0.36, 0.95, M.hazard, 11.8, 0.475, -5.1);
  solidBox(3.0, 0.9, 0.6, M.canvas, 0, 0.45, 9.6); // sandbag line at south wall
  // zone B: armory
  for (const [x, z] of [[22.5, -5], [22.5, 5]]) solidBox(1, WALL_H, 1, M.wall, x, WALL_H / 2, z, { density: 0.6 });
  solidBox(5, 2.1, 0.5, M.metal, 17.5, 1.05, 9.7); // lockers
  solidBox(0.4, 2.2, 3.0, M.metalDark, 29.7, 1.1, -1.0); // weapon rack
  solidBox(1.1, 1.1, 1.1, M.wood, 17, 0.55, 7); solidBox(1.1, 1.1, 1.1, M.wood, 18.2, 0.55, 7); solidBox(1.0, 1.0, 1.0, M.wood, 17.6, 1.6, 7, { grid: false });
  solidBox(0.5, 0.35, 0.3, M.paint, 26, 0.175, -8.9); solidBox(0.5, 0.35, 0.3, M.paint, 26.6, 0.175, -8.9); // ammo cans
  // zone C: loading dock
  const truck = (x, z) => { solidBox(2.6, 1.4, 6.0, M.paint, x, 1.3, z); solidBox(2.5, 1.5, 2.0, M.paint, x, 2.6, z - 1.9, { grid: false }); solidBox(2.4, 1.6, 3.6, M.canvas, x, 2.9, z + 1.1, { grid: false }); for (const [ox, oz] of [[-1.25, -2.2], [1.25, -2.2], [-1.25, 1.8], [1.25, 1.8]]) { const wh = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.4, 16), M.rubber); wh.rotation.z = Math.PI / 2; wh.position.set(x + ox, 0.55, z + oz); g.add(wh); } };
  truck(28, 22);
  solidBox(1.1, 1.1, 1.1, M.wood, 17, 0.55, 20); solidBox(1.1, 1.1, 1.1, M.wood, 18.2, 0.55, 20); solidBox(1.0, 1.0, 1.0, M.wood, 17.6, 1.6, 20, { grid: false });
  cyl(0.36, 0.95, M.metal, 32.2, 0.475, 17); cyl(0.36, 0.95, M.hazard, 33, 0.475, 17.7);
  solidBox(2.2, 1.4, 1.3, M.metalDark, 31.6, 0.7, 12.2); cyl(0.12, 2.4, M.metalDark, 32.5, 2.0, 12.6, false); // generator + exhaust

  // ---- ceiling pipes & lamps (decorative)
  const pipe = (x1, z1, x2, z2, y, r = 0.09) => { const len = Math.hypot(x2 - x1, z2 - z1); const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 8), M.metalDark); m.position.set((x1 + x2) / 2, y, (z1 + z2) / 2); m.rotation.z = Math.PI / 2; m.rotation.y = -Math.atan2(z2 - z1, x2 - x1); g.add(m); };
  pipe(-14, -8.5, 14, -8.5, 3.9); pipe(-14, 8.5, 14, 8.5, 3.85, 0.06); pipe(15, -7, 30, -7, 3.9); pipe(0, -10, 0, 10, 3.75, 0.07);
  const lamp = (x, z, color, base, mode, y = WALL_H - 0.55) => {
    const shade = new THREE.Mesh(new THREE.ConeGeometry(0.32, 0.25, 12, 1, true), M.metalDark); shade.position.set(x, y, z); g.add(shade);
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(2.6) })); bulb.position.set(x, y - 0.1, z); g.add(bulb);
    const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, WALL_H - y + 0.1, 5), M.dark); cord.position.set(x, (WALL_H + y) / 2 + 0.05, z); g.add(cord);
    const L = new THREE.PointLight(color, base, 16, 2); L.position.set(x, y - 0.25, z); g.add(L);
    MAP.lights.push({ light: L, base, mode, bulb, phase: rand(100), color: new THREE.Color(color).multiplyScalar(2.6) });
    return L;
  };
  // emergency lighting (always on)
  lamp(-7, 5, 0xffb374, 160, 'flicker'); lamp(7, -5, 0x79d9ea, 205, 'steady'); lamp(0, 0, 0xff5038, 75, 'flicker'); lamp(-8, -6, 0x95cbe8, 170, 'steady'); lamp(8, 6, 0xffb374, 155, 'flicker');
  lamp(18, -6, 0xffa050, 190, 'flicker'); lamp(26, 6, 0xffa050, 200, 'steady'); lamp(19, 5, 0xffa050, 160, 'steady');
  lamp(24, 27, 0xffa050, 220, 'flicker', WALL_H + 0.3); lamp(18, 14, 0xff9040, 160, 'steady', 3.6);
  // fluorescent tubes (need power)
  const tube = (x, z, rot = 0, y = WALL_H - 0.08) => {
    const t = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.06, 0.12), new THREE.MeshStandardMaterial({ color: 0x223344, emissive: 0x000000, roughness: 0.4 })); t.position.set(x, y, z); t.rotation.y = rot; g.add(t);
    const L = new THREE.PointLight(0xd4ecf4, 0, 14, 2); L.position.set(x, y - 0.4, z); g.add(L);
    MAP.lights.push({ light: L, base: 85, mode: 'power', tube: t, phase: rand(100) });
  };
  tube(-8, -6); tube(8, 6); tube(0, 7); tube(-9, 6); tube(22, 0, Math.PI / 2); tube(17, -3); tube(28, -4); tube(20, 6); tube(30, 27); tube(17, 27); tube(21, 27); tube(27, 27);
  // sodium pole light in dock (needs power)
  cyl(0.08, 5.5, M.metalDark, 22, 2.75, 16.5, false); { const L = new THREE.PointLight(0xffc070, 0, 24, 2); L.position.set(22, 5.2, 16.5); g.add(L); MAP.lights.push({ light: L, base: 300, mode: 'power' }); }

  // ---- signage / decals
  decal(texStencil('BARRACKS · SECTOR A', 'rgba(210,200,175,0.7)', 80), 6, 1.1, 0, 3.2, -9.97);
  decal(texStencil('ARMORY · SECTOR B', 'rgba(210,200,175,0.7)', 80), 5.5, 1.0, 26, 3.2, 9.97, Math.PI);
  decal(texStencil('LOADING DOCK · SECTOR C', 'rgba(210,200,175,0.7)', 80), 7, 1.2, 14.53, 3.2, 20, Math.PI / 2);
  decal(texStencil('09', 'rgba(193,18,31,0.65)', 150, 512, 256), 2.2, 1.1, -13.97, 2.6, 6, Math.PI / 2);
  decal(texStencil('KEEP OUT', 'rgba(193,18,31,0.6)', 90), 3.6, 0.7, -3, 2.3, 9.97, Math.PI);
  decal(texStencil('THEY COME AT NIGHT', 'rgba(120,10,15,0.7)', 64, 1024, 160, 'Barlow Condensed'), 3.2, 0.5, 29.97, 1.6, -8, -Math.PI / 2);
  for (let i = 0; i < 9; i++) { const zn = choice(['A', 'B', 'C']); const z = MAP.zones[zn]; decal(TEX.splat, rand(1.2, 2.6), rand(1.2, 2.6), rand(z.x1 + 2, z.x2 - 2), 0.015, rand(z.z1 + 2, z.z2 - 2), 0, -Math.PI / 2, rand(0.6, 0.95)).rotation.z = rand(TAU); }
  decal(TEX.splat, 2, 2, -13.98, 1.4, -4, Math.PI / 2, 0, 0.8); decal(TEX.splat, 1.6, 1.6, 8, 1.2, -9.98, 0, 0, 0.8);
  for (const [x1, z1, x2, z2] of [[-14, 9.9, 14, 10], [14.5, -10, 30, -9.9]]) { const m = new THREE.Mesh(new THREE.PlaneGeometry(x2 - x1, 0.3), M.hazard); m.position.set((x1 + x2) / 2, 0.16, (z1 + z2) / 2 + (z1 > 0 ? -0.02 : 0.02)); m.rotation.y = z1 > 0 ? Math.PI : 0; g.add(m); }

  // ---- wall-buys (chalk outlines)
  const wallBuy = (weaponId, x, z, rotY, chalk) => {
    const W = WEAPONS[weaponId];
    const m = plane(2.2, 1.1, new THREE.MeshBasicMaterial({ map: texChalk(W.name, W.cost, chalk), transparent: true, depthWrite: false, color: new THREE.Color(1.5, 1.5, 1.5) }), x, 1.75, z, rotY);
    const nx = Math.sin(rotY) * 0.8, nz = Math.cos(rotY) * 0.8; // plane normal (facing) direction → interaction point inside room
    MAP.interactables.push({ kind: 'wall', x: x + nx, z: z + nz, r: 2.0, weapon: weaponId, mesh: m });
  };
  wallBuy('viper', -5, 9.97, Math.PI, CHALK.smg);
  wallBuy('breacher', 17.5, -9.97, 0, CHALK.shotgun);
  wallBuy('sentinel', 14.53, 14.5, Math.PI / 2, CHALK.rifle);
  wallBuy('warden', 14.53, 27.0, Math.PI / 2, CHALK.lmg);

  // ---- perk machines
  const perkMachine = (id, x, z, rotY) => {
    const P = PERKS[id]; const grp = new THREE.Group(); grp.position.set(x, 0, z); grp.rotation.y = rotY; g.add(grp);
    const body = new THREE.Mesh(boxGeo(0.95, 1.95, 0.75), M.metal); body.position.y = 0.975; grp.add(body);
    const trim = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.12, 0.8), M.metalDark); trim.position.y = 1.95; grp.add(trim);
    const panelMat = new THREE.MeshStandardMaterial({ map: texLabel(P.name, P.color, P.tag), emissive: new THREE.Color(P.color), emissiveIntensity: 0, emissiveMap: null, roughness: 0.4, color: 0x222222 });
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(0.85, 0.55), panelMat); panel.position.set(0, 1.5, 0.381); grp.add(panel);
    const stripMat = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: new THREE.Color(P.color), emissiveIntensity: 0 });
    for (const sx of [-0.44, 0.44]) { const s = new THREE.Mesh(new THREE.BoxGeometry(0.05, 1.7, 0.05), stripMat); s.position.set(sx, 1.0, 0.37); grp.add(s); }
    const L = new THREE.PointLight(P.color, 0, 7, 2); L.position.set(0, 1.4, 0.9); grp.add(L);
    // footprint & interaction (facing direction = +z in local → world)
    const fx = Math.sin(rotY), fz = Math.cos(rotY);
    MAP.solids.push({ x1: x - 0.6, y1: 0, z1: z - 0.6, x2: x + 0.6, y2: 2.0, z2: z + 0.6 }); NAV.fillRect(x - 0.5, z - 0.5, x + 0.5, z + 0.5, 0);
    const pm = { id, group: grp, panelMat, stripMat, light: L, on: false };
    MAP.perkMachines.push(pm);
    MAP.interactables.push({ kind: 'perk', x: x + fx * 1.1, z: z + fz * 1.1, r: 1.9, perk: id, machine: pm });
  };
  perkMachine('secondwind', -12.5, -8.5, Math.PI / 4);
  perkMachine('ironhide', 29.0, -8.6, -Math.PI / 4);
  perkMachine('longstride', 29.0, 8.6, -Math.PI * 0.75);
  perkMachine('quickhands', 16.0, 29.2, Math.PI);
  perkMachine('hairtrigger', 32.6, 29.2, Math.PI);

  // ---- mystery box
  {
    const x = 22.5, z = 0; const grp = new THREE.Group(); grp.position.set(x, 0, z); grp.rotation.y = Math.PI / 2; g.add(grp);
    const base = new THREE.Mesh(boxGeo(1.3, 0.65, 0.8), M.wood); base.position.y = 0.325; grp.add(base);
    for (const bx of [-0.45, 0.45]) { const band = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.68, 0.84), M.metalDark); band.position.set(bx, 0.33, 0); grp.add(band); }
    const lid = new THREE.Group(); lid.position.set(0, 0.65, -0.4); grp.add(lid);
    const lidMesh = new THREE.Mesh(boxGeo(1.3, 0.16, 0.8), M.wood); lidMesh.position.set(0, 0.08, 0.4); lid.add(lidMesh);
    const seamMat = new THREE.MeshStandardMaterial({ color: 0x0a2030, emissive: 0x3fd0ff, emissiveIntensity: 1.6 });
    const seam = new THREE.Mesh(new THREE.BoxGeometry(1.24, 0.03, 0.74), seamMat); seam.position.y = 0.66; grp.add(seam);
    const beamMat = new THREE.MeshBasicMaterial({ color: 0x5fe3ff, transparent: true, opacity: 0.12, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.7, 6, 16, 1, true), beamMat); beam.position.y = 3.6; grp.add(beam);
    const L = new THREE.PointLight(0x5fe3ff, 70, 9, 2); L.position.set(0, 1.6, 0); grp.add(L);
    const wpnHolder = new THREE.Group(); wpnHolder.position.set(0, 1.35, 0); grp.add(wpnHolder);
    MAP.box = { x, z, group: grp, lid, seamMat, beamMat, light: L, holder: wpnHolder, state: 'idle', t: 0, weapon: null, display: null };
    MAP.solids.push({ x1: x - 0.5, y1: 0, z1: z - 0.75, x2: x + 0.5, y2: 0.8, z2: z + 0.75 }); NAV.fillRect(x - 0.5, z - 0.5, x + 0.5, z + 0.5, 0);
    MAP.interactables.push({ kind: 'box', x, z, r: 2.4 });
  }
  // ---- pack-a-punch
  {
    const x = 24, z = 29.2; const grp = new THREE.Group(); grp.position.set(x, 0, z); grp.rotation.y = Math.PI; g.add(grp);
    const body = new THREE.Mesh(boxGeo(1.9, 2.1, 1.0), M.metal); body.position.y = 1.05; grp.add(body);
    const glowMat = new THREE.MeshStandardMaterial({ color: 0x120a20, emissive: 0xb06cff, emissiveIntensity: 0 });
    for (const [sx, sy, w, h] of [[-0.85, 1.05, 0.06, 1.9], [0.85, 1.05, 0.06, 1.9], [0, 2.0, 1.7, 0.06], [0, 0.1, 1.7, 0.06]]) { const s = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.06), glowMat); s.position.set(sx, sy, 0.5); grp.add(s); }
    const slot = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.35, 0.3), M.dark); slot.position.set(0, 1.1, 0.52); grp.add(slot);
    const labelMat = new THREE.MeshStandardMaterial({ map: texLabel('PACK-A-PUNCH', '#b06cff', 'UPGRADE STATION · 5000'), emissive: 0xb06cff, emissiveIntensity: 0, roughness: 0.4, color: 0x222222, transparent: true });
    const label = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.47), labelMat); label.position.set(0, 1.65, 0.51); grp.add(label);
    const L = new THREE.PointLight(0xb06cff, 0, 9, 2); L.position.set(0, 1.6, 1.2); grp.add(L);
    const rollers = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.12, 0.7), M.metalDark); rollers.position.set(0, 0.95, 0.75); grp.add(rollers);
    const holder = new THREE.Group(); holder.position.set(0, 1.25, 0.6); grp.add(holder);
    MAP.pap = { x, z, group: grp, glowMat, labelMat, light: L, holder, state: 'idle', t: 0, weapon: null, display: null };
    MAP.solids.push({ x1: x - 0.95, y1: 0, z1: z - 0.5, x2: x + 0.95, y2: 2.1, z2: z + 0.5 }); NAV.fillRect(x - 1, z - 0.5, x + 1, z + 0.5, 0);
    MAP.interactables.push({ kind: 'pap', x, z: z - 1.1, r: 2.0 });
  }
  // ---- power switch
  {
    const x = 33.97, z = 14; const grp = new THREE.Group(); grp.position.set(x, 0, z); grp.rotation.y = -Math.PI / 2; g.add(grp);
    const panel = new THREE.Mesh(new THREE.BoxGeometry(1.0, 1.4, 0.16), M.metal); panel.position.set(0, 1.5, 0.08); grp.add(panel);
    const hz = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 0.18), M.hazard); hz.position.set(0, 2.28, 0.161); grp.add(hz);
    const lever = new THREE.Group(); lever.position.set(0, 1.25, 0.18); grp.add(lever);
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.7, 0.1), M.metalDark); handle.position.y = 0.35; lever.add(handle);
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 10), new THREE.MeshStandardMaterial({ color: 0xc1121f, roughness: 0.4 })); knob.position.y = 0.7; lever.add(knob);
    lever.rotation.x = 0.9;
    const lbl = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.28), new THREE.MeshBasicMaterial({ map: texLabel('MAIN POWER', '#e9e4da'), transparent: true })); lbl.position.set(0, 1.98, 0.165); grp.add(lbl);
    const lampMat = new THREE.MeshStandardMaterial({ color: 0x300000, emissive: 0xff2020, emissiveIntensity: 1.2 }); const lampM = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 8), lampMat); lampM.position.set(0.35, 1.8, 0.17); grp.add(lampM);
    MAP.powerSwitch = { x, z, group: grp, lever, lampMat, done: false };
    MAP.interactables.push({ kind: 'power', x: x - 1.0, z, r: 1.8 });
  }

  // fence silhouettes behind pockets
  const fenceMat = new THREE.MeshStandardMaterial({ color: 0x777777, wireframe: true, roughness: 1 });
  for (const w of MAP.windows) { const p = w.pocket; const fx = (p.x1 + p.x2) / 2, fz = (p.z1 + p.z2) / 2; const far = w.axis === 'z' ? { x: fx, z: w.z < 0 ? p.z1 + 0.2 : p.z2 - 0.2, rot: 0, len: p.x2 - p.x1 } : { x: w.x > 20 ? p.x2 - 0.2 : p.x1 + 0.2, z: fz, rot: Math.PI / 2, len: p.z2 - p.z1 }; const f = new THREE.Mesh(new THREE.PlaneGeometry(far.len, 2.4, Math.round(far.len * 3), 7), fenceMat); f.position.set(far.x, 1.2, far.z); f.rotation.y = far.rot; g.add(f); }

  return g;
}

// ---- runtime map updates
function updateMapLights(dt, time) {
  for (const e of MAP.lights) {
    const L = e.light;
    if (e.mode === 'flicker') {
      const n = Math.sin(time * 17 + e.phase) * Math.sin(time * 5.3 + e.phase * 2) * 0.5 + 0.5; let k = 0.7 + 0.3 * n;
      if (!G.reducedMotion && Math.random() < dt * 0.6) e.drop = 0.08 + Math.random() * 0.12; if (e.drop > 0) { e.drop -= dt; k = 0.05; }
      L.intensity = e.base * k; if (e.bulb) { if (k < 0.2) e.bulb.material.color.setHex(0x222222); else e.bulb.material.color.copy(e.color); }
    } else if (e.mode === 'power') {
      if (MAP.powerOn) { e.warm = Math.min(1, (e.warm || 0) + dt * 0.6); const flick = e.warm < 1 && !G.reducedMotion ? (Math.random() < 0.5 ? 0 : 1) : 1; L.intensity = e.base * e.warm * flick; if (e.tube) { e.tube.material.emissive.setHex(0xcfe6ff); e.tube.material.emissiveIntensity = 1.4 * e.warm * flick; } }
    }
  }
  if (MAP.powerOn) {
    for (const pm of MAP.perkMachines) { const P = PERKS[pm.id]; pm.warm = Math.min(1, (pm.warm || 0) + dt * 0.8); const pulse = 0.8 + 0.2 * Math.sin(time * 2 + pm.group.position.x); pm.panelMat.emissiveIntensity = 1.1 * pm.warm * pulse; pm.stripMat.emissiveIntensity = 1.8 * pm.warm * pulse; pm.light.intensity = 50 * pm.warm * pulse; }
    const pap = MAP.pap; pap.warm = Math.min(1, (pap.warm || 0) + dt * 0.8); const pulse = 0.75 + 0.25 * Math.sin(time * 3.1); pap.glowMat.emissiveIntensity = 2.2 * pap.warm * pulse; pap.labelMat.emissiveIntensity = 0.9 * pap.warm; pap.light.intensity = 70 * pap.warm * pulse;
  }
  const b = MAP.box; if (b) { const pulse = 0.85 + 0.15 * Math.sin(time * 2.4); b.seamMat.emissiveIntensity = 1.6 * pulse; b.beamMat.opacity = 0.09 + 0.04 * Math.sin(time * 1.7); }
  // doors animation
  for (const d of MAP.doors) if (d.open && d.anim < 1) { d.anim = Math.min(1, d.anim + dt * 0.8); const e = d.anim * d.anim; if (d.style === 'gate') d.group.position.y = e * 3.6; else { d.group.position.y = -e * 2.6; d.group.rotation.z = e * 0.3; } if (d.anim >= 1) d.group.visible = false; }
  // planks anim (falling)
  for (const w of MAP.windows) for (const p of w.planks) {
    if (p.userData.fall !== undefined) { p.userData.fall += dt; const f = p.userData.fall; p.position.y = p.userData.home.y - 4.9 * f * f; p.rotation.z += dt * 3; p.position.z += dt * 1.5; if (f > 0.7) { p.visible = false; p.userData.fall = undefined; } }
    if (p.userData.rise !== undefined) { p.userData.rise = Math.min(1, p.userData.rise + dt * 3); const r = p.userData.rise; p.position.y = lerp(-0.3, p.userData.home.y, r); p.rotation.z = lerp(0.8, p.userData.home.rz, r); if (r >= 1) p.userData.rise = undefined; }
  }
}
function windowRemoveBoard(w) {
  if (w.boards <= 0) return false; w.boards--; const p = w.planks[w.boards]; p.userData.fall = 0; p.userData.rise = undefined; SFX.boardBreak(w.x, w.z);
  FX.burst(w.x, 1.6, w.z, 10, 0x8a5a2a, 2.5, 0.06, 0.5); return true;
}
function windowAddBoard(w) {
  if (w.boards >= 6) return false; const p = w.planks[w.boards]; w.boards++; p.visible = true; p.position.z = p.userData.home.z; p.userData.fall = undefined; p.userData.rise = 0; SFX.boardRepair(); return true;
}
function openDoor(d) {
  d.open = true; NAV.fillRect(d.x1, d.z1, d.x2, d.z2, ANY_WALK); MAP.zones[d.to].open = true;
  MAP.solids = MAP.solids.filter((s) => !(s.x1 >= d.x1 - 0.01 && s.x2 <= d.x2 + 0.01 && s.z1 >= d.z1 - 0.01 && s.z2 <= d.z2 + 0.01));
  SFX.door(); FX.burst((d.x1 + d.x2) / 2, 1.5, (d.z1 + d.z2) / 2, 30, 0x777777, 2, 0.08, 1.2);
}
function turnOnPower() {
  MAP.powerOn = true; MAP.powerSwitch.done = true; SFX.powerOn();
  MAP.powerSwitch.lampMat.emissive.setHex(0x30ff60); MAP.powerSwitch.lampMat.color.setHex(0x003010);
  FX.burst(MAP.powerSwitch.x - 0.3, 1.9, MAP.powerSwitch.z, 40, 0xffd080, 4, 0.05, 0.7);
}
// ray vs static solids → nearest t (or Infinity)
function rayMap(ox, oy, oz, dx, dy, dz, maxT = 200) {
  let best = maxT;
  for (const s of MAP.solids) {
    let t0 = 0, t1 = best;
    // slab tests
    if (dx !== 0) { const inv = 1 / dx; let a = (s.x1 - ox) * inv, b = (s.x2 - ox) * inv; if (a > b) { const c = a; a = b; b = c; } if (a > t0) t0 = a; if (b < t1) t1 = b; if (t0 > t1) continue; } else if (ox < s.x1 || ox > s.x2) continue;
    if (dy !== 0) { const inv = 1 / dy; let a = (s.y1 - oy) * inv, b = (s.y2 - oy) * inv; if (a > b) { const c = a; a = b; b = c; } if (a > t0) t0 = a; if (b < t1) t1 = b; if (t0 > t1) continue; } else if (oy < s.y1 || oy > s.y2) continue;
    if (dz !== 0) { const inv = 1 / dz; let a = (s.z1 - oz) * inv, b = (s.z2 - oz) * inv; if (a > b) { const c = a; a = b; b = c; } if (a > t0) t0 = a; if (b < t1) t1 = b; if (t0 > t1) continue; } else if (oz < s.z1 || oz > s.z2) continue;
    if (t0 < best && t0 > 0) best = t0;
  }
  // floor / ceiling
  if (dy < 0) { const t = -oy / dy; if (t < best) best = t; }
  return best;
}

// ===== 40_fx.js =====
// ---------------------------------------------------------------- effects: particles, tracers, decals, flashes
class ParticleSystem {
  constructor(scene, n, additive) {
    this.n = n; this.head = 0;
    this.pos = new Float32Array(n * 3); this.col = new Float32Array(n * 3); this.size = new Float32Array(n); this.alpha = new Float32Array(n);
    this.vel = new Float32Array(n * 3); this.life = new Float32Array(n); this.maxLife = new Float32Array(n); this.grav = new Float32Array(n); this.baseSize = new Float32Array(n); this.drag = new Float32Array(n);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1));
    this.mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: TEX.glow }, uScale: { value: 600 } },
      vertexShader: `attribute vec3 aColor; attribute float aSize; attribute float aAlpha; varying vec3 vColor; varying float vAlpha; uniform float uScale;
        void main(){ vColor=aColor; vAlpha=aAlpha; vec4 mv=modelViewMatrix*vec4(position,1.0); gl_PointSize = aSize*uScale/max(0.1,-mv.z); gl_Position=projectionMatrix*mv; }`,
      fragmentShader: `uniform sampler2D map; varying vec3 vColor; varying float vAlpha; void main(){ vec4 t=texture2D(map,gl_PointCoord); if(t.a*vAlpha<0.01) discard; gl_FragColor=vec4(vColor, t.a*vAlpha); }`,
      transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(geo, this.mat); this.points.frustumCulled = false; scene.add(this.points);
    this.tmpC = new THREE.Color();
  }
  emit(x, y, z, vx, vy, vz, color, size, life, grav = 1, drag = 0) {
    const i = this.head; this.head = (this.head + 1) % this.n; const c = this.tmpC.set(color);
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z; this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.col[i * 3] = c.r; this.col[i * 3 + 1] = c.g; this.col[i * 3 + 2] = c.b; this.size[i] = this.baseSize[i] = size; this.alpha[i] = 1; this.life[i] = this.maxLife[i] = life; this.grav[i] = grav; this.drag[i] = drag;
  }
  update(dt) {
    const { pos, vel, life, maxLife, alpha, size, baseSize, grav, drag, n } = this; let any = false;
    for (let i = 0; i < n; i++) {
      if (life[i] <= 0) continue; any = true; life[i] -= dt;
      if (life[i] <= 0) { alpha[i] = 0; continue; }
      const k = i * 3; vel[k + 1] -= grav[i] * 9.8 * dt; if (drag[i]) { const f = Math.max(0, 1 - drag[i] * dt); vel[k] *= f; vel[k + 1] *= f; vel[k + 2] *= f; }
      pos[k] += vel[k] * dt; pos[k + 1] += vel[k + 1] * dt; pos[k + 2] += vel[k + 2] * dt;
      if (pos[k + 1] < 0.02 && grav[i] > 0) { pos[k + 1] = 0.02; vel[k + 1] *= -0.25; vel[k] *= 0.5; vel[k + 2] *= 0.5; }
      const t = life[i] / maxLife[i]; alpha[i] = t < 0.5 ? t * 2 : 1; size[i] = baseSize[i] * (0.5 + 0.5 * t);
    }
    if (any) { const g = this.points.geometry; g.attributes.position.needsUpdate = true; g.attributes.aAlpha.needsUpdate = true; g.attributes.aSize.needsUpdate = true; g.attributes.aColor.needsUpdate = true; }
  }
}

const FX = {
  init(scene) {
    this.scene = scene;
    this.ps = new ParticleSystem(scene, 2400, false);
    this.glow = new ParticleSystem(scene, 1200, true);
    // tracers
    this.tracers = []; const tg = new THREE.BoxGeometry(1, 1, 1);
    for (let i = 0; i < 40; i++) { const m = new THREE.Mesh(tg, new THREE.MeshBasicMaterial({ color: 0xffd9a0, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false, fog: false })); m.visible = false; m.frustumCulled = false; scene.add(m); this.tracers.push({ m, life: 0, max: 0.07 }); }
    // floor decals
    this.decals = []; const dg = new THREE.PlaneGeometry(1, 1);
    for (let i = 0; i < 60; i++) { const m = new THREE.Mesh(dg, new THREE.MeshBasicMaterial({ map: TEX.splat, transparent: true, opacity: 0.9, depthWrite: false, color: 0x8a1010 })); m.rotation.x = -Math.PI / 2; m.visible = false; m.renderOrder = 1; scene.add(m); this.decals.push({ m, life: 0 }); }
    this.decalHead = 0; this.decalY = 0.02;
    // flash lights
    this.lights = []; for (let i = 0; i < 4; i++) { const L = new THREE.PointLight(0xffc070, 0, 14, 2); L.layers.enable(1); scene.add(L); this.lights.push({ L, life: 0, max: 0.06, peak: 0 }); }
    this.tmp = new THREE.Vector3();
  },
  setScale(h, fovDeg) { const s = h / (2 * Math.tan(fovDeg * Math.PI / 360)); this.ps.mat.uniforms.uScale.value = s; this.glow.mat.uniforms.uScale.value = s; },
  burst(x, y, z, count, color, speed = 3, size = 0.08, life = 0.6, grav = 1, additive = false) {
    const S = additive ? this.glow : this.ps;
    for (let i = 0; i < count; i++) { const a = rand(TAU), b = rand(-1, 1), r = Math.sqrt(1 - b * b), sp = speed * rand(0.3, 1); S.emit(x, y, z, Math.cos(a) * r * sp, b * sp + speed * 0.3, Math.sin(a) * r * sp, color, size * rand(0.6, 1.4), life * rand(0.6, 1.3), grav, 0.6); }
  },
  blood(x, y, z, dx, dy, dz, count = 12, big = false) {
    for (let i = 0; i < count; i++) { const sp = rand(1.5, 5) * (big ? 1.5 : 1); this.ps.emit(x, y, z, dx * sp + rand(-1.6, 1.6), dy * sp + rand(-0.6, 2.2), dz * sp + rand(-1.6, 1.6), choice([0x6a0a0e, 0x8c1016, 0x4a0608, 0x9a1a1a]), rand(0.06, 0.16) * (big ? 1.6 : 1), rand(0.4, 0.9), 1.4, 0.8); }
    for (let i = 0; i < 3; i++) this.ps.emit(x, y, z, dx * 1.5 + rand(-0.5, 0.5), rand(0, 1), dz * 1.5 + rand(-0.5, 0.5), 0x5a0a0c, rand(0.25, 0.45), 0.35, 0.2, 2);
  },
  sparks(x, y, z, nx, ny, nz) {
    for (let i = 0; i < 9; i++) { const sp = rand(2, 7); this.glow.emit(x, y, z, nx * sp + rand(-2.5, 2.5), ny * sp + rand(-1, 3), nz * sp + rand(-2.5, 2.5), choice([0xffc36a, 0xffe6a8, 0xff9a3a]), rand(0.025, 0.05), rand(0.15, 0.4), 1.6, 0.5); }
    for (let i = 0; i < 4; i++) this.ps.emit(x, y, z, nx * 0.8 + rand(-0.5, 0.5), rand(0.2, 0.9), nz * 0.8 + rand(-0.5, 0.5), 0x8a8578, rand(0.18, 0.32), rand(0.5, 0.9), 0.05, 1.5);
  },
  dirt(x, z, count = 14) { for (let i = 0; i < count; i++) this.ps.emit(x + rand(-0.5, 0.5), 0.05, z + rand(-0.5, 0.5), rand(-1.2, 1.2), rand(1, 3.5), rand(-1.2, 1.2), choice([0x5a4632, 0x3d2f22, 0x6b5640]), rand(0.08, 0.2), rand(0.6, 1.2), 1.2, 0.5); },
  smoke(x, y, z, count = 12, color = 0x555049, size = 0.7) { for (let i = 0; i < count; i++) this.ps.emit(x + rand(-0.4, 0.4), y + rand(-0.2, 0.4), z + rand(-0.4, 0.4), rand(-1, 1), rand(0.6, 2), rand(-1, 1), color, size * rand(0.6, 1.4), rand(1, 2), -0.05, 1.2); },
  explosion(x, y, z, scale = 1, color = 0xff9a3a) {
    for (let i = 0; i < 50; i++) { const a = rand(TAU), b = rand(-1, 1), r = Math.sqrt(1 - b * b), sp = rand(3, 11) * scale; this.glow.emit(x, y, z, Math.cos(a) * r * sp, b * sp + 2, Math.sin(a) * r * sp, choice([color, 0xffe08a, 0xffffff, 0xff5a1a]), rand(0.15, 0.4) * scale, rand(0.25, 0.6), 0.6, 1.5); }
    this.smoke(x, y + 0.3, z, 22, 0x3a3835, 1.1 * scale); this.sparks(x, y, z, 0, 1, 0); this.sparks(x, y, z, 0, 1, 0);
    this.light(x, y + 0.6, z, color, 2200 * scale, 0.28, 18);
  },
  nova(x, y, z, scale = 1) {
    for (let i = 0; i < 40; i++) { const a = rand(TAU), b = rand(-1, 1), r = Math.sqrt(1 - b * b), sp = rand(2, 8) * scale; this.glow.emit(x, y, z, Math.cos(a) * r * sp, b * sp, Math.sin(a) * r * sp, choice([0x7cff6a, 0xc8ffb0, 0x3aff9a, 0xffffff]), rand(0.1, 0.3) * scale, rand(0.2, 0.5), 0.1, 2); }
    this.light(x, y, z, 0x7cff6a, 1500 * scale, 0.22, 14);
  },
  light(x, y, z, color, intensity, dur, dist = 12) {
    let e = this.lights.find((l) => l.life <= 0) || this.lights[0];
    e.L.position.set(x, y, z); e.L.color.set(color); e.L.intensity = intensity; e.L.distance = dist; e.life = e.max = dur; e.peak = intensity;
  },
  tracer(x0, y0, z0, x1, y1, z1, color = 0xffd9a0, width = 0.016, life = 0.06) {
    let t = this.tracers.find((tr) => tr.life <= 0) || this.tracers[0];
    const dx = x1 - x0, dy = y1 - y0, dz = z1 - z0, len = Math.hypot(dx, dy, dz); if (len < 0.2) return;
    const m = t.m; m.visible = true; m.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2); m.lookAt(x1, y1, z1); m.scale.set(width, width, len); m.material.color.set(color).multiplyScalar(2.2); m.material.opacity = 0.9; t.life = t.max = life;
  },
  splat(x, z, scale = 1.4) {
    const d = this.decals[this.decalHead]; this.decalHead = (this.decalHead + 1) % this.decals.length; this.decalY = 0.02 + ((this.decalHead % 10) * 0.0015);
    d.m.visible = true; d.m.position.set(x, this.decalY, z); d.m.rotation.z = rand(TAU); d.m.scale.set(scale * rand(0.8, 1.3), scale * rand(0.8, 1.3), 1); d.m.material.opacity = 0.9; d.life = 40;
  },
  update(dt) {
    this.ps.update(dt); this.glow.update(dt);
    for (const t of this.tracers) if (t.life > 0) { t.life -= dt; t.m.material.opacity = Math.max(0, t.life / t.max) * 0.9; if (t.life <= 0) t.m.visible = false; }
    for (const d of this.decals) if (d.life > 0) { d.life -= dt; if (d.life < 8) d.m.material.opacity = 0.9 * d.life / 8; if (d.life <= 0) d.m.visible = false; }
    for (const e of this.lights) if (e.life > 0) { e.life -= dt; e.L.intensity = e.peak * Math.max(0, e.life / e.max); if (e.life <= 0) e.L.intensity = 0; }
  },
};

// ===== 45_models.js =====

// ---------------------------------------------------------------- online character models (CC0)
// Original character data is served from assets/models; animation corrections are baked separately.
const ZOMBIE_CLIPS = { idle: ['Idle', 'idle'], walk: ['Walk', 'walk', 'Zombie_Walk', 'Walking'], walk2: ['Walk2', 'Limp', 'WalkB'], run: ['Run', 'run', 'Running', 'Sprint'], run2: ['Run2', 'Sprint2', 'RunB'], attack: ['Attack', 'attack', 'Punch', 'Bite', 'Hit'], attack2: ['Attack2', 'Swipe'], attack3: ['Attack3', 'Slam'], hit: ['HitReact', 'HitRecieve', 'Hit_React', 'Damage'], hit2: ['HitReact2', 'Hit2'], death: ['Death', 'death', 'Die', 'Dead'], rise: ['Rise', 'GetUp', 'StandUp'], crawl: ['Crawl', 'crawl'], climb: ['Climb', 'Vault'], crawlIdle: ['CrawlIdle'], crawlAttack: ['CrawlAttack'], crawlDeath: ['CrawlDeath'], crawlClimb: ['CrawlClimb'], crawlBash: ['CrawlBash'] };
// per-instance tints so a horde of three meshes reads as many different zombies
const ZOMBIE_TINTS = [[1, 1, 1], [0.78, 0.92, 0.78], [0.72, 0.76, 0.82], [0.92, 0.8, 0.76], [0.66, 0.7, 0.62], [0.86, 0.9, 0.7], [0.6, 0.62, 0.66]];
const MODEL_URLS = {
  "zombie_original": "assets/models/zombie_original.glb"
};

const GUN_URLS = {
  "sidearm": "assets/models/sidearm.glb",
  "viper": "assets/models/viper.glb",
  "breacher": "assets/models/breacher.glb",
  "sentinel": "assets/models/sentinel.glb",
  "warden": "assets/models/warden.glb",
  "arc9": "assets/models/arc9.glb",
  "mauler": "assets/models/mauler.glb",
  "longbow": "assets/models/longbow.glb",
  "nova": "assets/models/nova.glb"
};

const assetRequests = new Map();
function loadGLB(loader, path) {
  if (!path) return Promise.reject(new Error('Missing model URL'));
  if (!assetRequests.has(path)) {
    const task = (async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30000);
      try {
        const response = await fetch(new URL(path, import.meta.url), { signal: controller.signal });
        if (!response.ok) throw new Error(`Model request failed (${response.status})`);
        const bytes = await response.arrayBuffer();
        return await loader.parseAsync(bytes, new URL('./', import.meta.url).href);
      } finally { clearTimeout(timeout); }
    })();
    assetRequests.set(path, task);
    task.catch(() => assetRequests.delete(path));
  }
  return assetRequests.get(path);
}

const MODEL_DEFS = [
  { id: 'zombie_a', kind: 'zombie', asset: 'zombie_original', weight: 3, height: 1.86, clips: ZOMBIE_CLIPS, headMeshes: [], mobile: true },
  { id: 'zombie_b', kind: 'zombie', asset: 'zombie_original', weight: 2, height: 1.9, clips: ZOMBIE_CLIPS, headMeshes: [], mobile: true },
  { id: 'zombie_c', kind: 'zombie', asset: 'zombie_original', weight: 1.6, height: 1.84, clips: ZOMBIE_CLIPS, headMeshes: [], mobile: true },
];
function pickClip(anims, names) {
  if (!anims || !anims.length) return null;
  for (const n of names) { const c = anims.find((a) => a.name === n); if (c) return c; }
  for (const n of names) { const c = anims.find((a) => a.name.toLowerCase().includes(n.toLowerCase())); if (c) return c; }
  return null;
}
const MODELS = {
  loaded: {}, ready: [], progress: { done: 0, total: 0 }, failed: [], enabled: true,
  init() { this.loader = new GLTFLoader(); },
  animationClips() {
    if (!this.animationRequest) this.animationRequest = fetch(new URL('./assets/animations.json', import.meta.url))
      .then(r => { if (!r.ok) throw new Error('Animation download failed'); return r.json(); })
      .then(data => data.clips.map(c => THREE.AnimationClip.parse(c)))
      .catch(error => { console.warn(error); this.animationRequest = null; return null; });
    return this.animationRequest;
  },
  loadAll(mobileOnly = false) {
    const defs = MODEL_DEFS.filter((d) => !mobileOnly || d.mobile);
    return Promise.all(defs.map((d) => this.load(d)));
  },
  async load(def) {
    this.progress.total++;
    try {
      const [gltf, animations] = await Promise.all([loadGLB(this.loader, MODEL_URLS[def.asset] || def.url), this.animationClips()]);
      this.register(def, animations ? {...gltf, animations} : gltf);
      return true;
    } catch (e) {
      console.warn('Character unavailable:', def.id, e.message);
      this.failed.push(def.id);
      return false;
    } finally { this.progress.done++; updateAssetsLabel(); }
  },
  register(def, gltf) {
    const scene = gltf.scene; scene.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(scene); const height = Math.max(0.5, box.max.y - box.min.y); const footY = box.min.y; const centerX = (box.min.x + box.max.x) / 2, centerZ = (box.min.z + box.max.z) / 2;
    const mats = new Set();
    scene.traverse((o) => {
      if (o.isMesh || o.isSkinnedMesh) { o.frustumCulled = false; o.castShadow = false; o.receiveShadow = false; if (Array.isArray(o.material)) o.material.forEach((m) => mats.add(m)); else if (o.material) mats.add(o.material); }
    });
    for (const m of mats) {
      const nm = (m.name || '').toLowerCase();
      if (/glow|eye/.test(nm)) { m.emissive = new THREE.Color(0xff8a20); m.emissiveIntensity = 3.2; m.color.setHex(0x201008); }
      else { if (m.map) { m.map.colorSpace = THREE.SRGBColorSpace; } m.roughness = Math.max(0.7, m.roughness ?? 0.8); m.metalness = 0; }
      m.needsUpdate = true;
    }
    const clips = {}; for (const role in def.clips) clips[role] = pickClip(gltf.animations, def.clips[role]);
    if (!clips.walk) clips.walk = gltf.animations[0] || null;
    if (!clips.run) clips.run = clips.walk;
    if (!clips.attack) clips.attack = clips.walk;
    this.loaded[def.id] = { def, scene, animations: gltf.animations, clips, height, footY, centerX, centerZ, names: gltf.animations.map((a) => a.name) };
    this.ready.push(def.id);
  },
  pick() {
    if (!this.enabled || !this.ready.length) return null;
    const items = this.ready.map((id) => ({ w: this.loaded[id].def.weight, id })); return weighted(items).id;
  },
  instance(id) {
    const L = this.loaded[id]; const obj = skeletonClone(L.scene); const mixer = new THREE.AnimationMixer(obj); const actions = {};
    for (const role in L.clips) if (L.clips[role]) actions[role] = mixer.clipAction(L.clips[role]);
    const headMeshes = []; obj.traverse((o) => { if ((o.isMesh || o.isSkinnedMesh) && L.def.headMeshes && L.def.headMeshes.some((n) => o.name.includes(n))) headMeshes.push(o); });
    let headBone = null; obj.traverse((o) => { if (!headBone && o.isBone && /head/i.test(o.name)) headBone = o; });
    // per-instance material variation (tint + darkening); materials are cloned so instances differ
    const tint = choice(ZOMBIE_TINTS), dark = rand(0.78, 1.0); const cloned = new Map();
    obj.traverse((o) => { if (!(o.isMesh || o.isSkinnedMesh) || !o.material) return; const fix = (m) => { if (!cloned.has(m)) { const c = m.clone(); if (!/glow|eye/.test((m.name || '').toLowerCase())) c.color.multiply(new THREE.Color(tint[0] * dark, tint[1] * dark, tint[2] * dark)); cloned.set(m, c); } return cloned.get(m); }; o.material = Array.isArray(o.material) ? o.material.map(fix) : fix(o.material); });
    const chestBone = obj.getObjectByName('chest') || headBone;
    const model = { id, obj, mixer, actions, headMeshes, headBone, chestBone, L, cur: null };
    model.animator = new ZombieAnimator(model); return model;
  },
};

// ===== 50_zombies.js =====
// ---------------------------------------------------------------- zombies (organic procedural rig)
const ZTYPES = { walker: { speed: 1.55, anim: 1.0, lean: 0.16, armSwing: 0.18 }, jogger: { speed: 2.9, anim: 1.7, lean: 0.24, armSwing: 0.3 }, runner: { speed: 4.8, anim: 2.5, lean: 0.38, armSwing: 0.45 } };
function zombieTypeFor(round) {
  const w = round <= 2 ? { walker: 1 } : round <= 4 ? { walker: 0.7, jogger: 0.3 } : round <= 7 ? { walker: 0.4, jogger: 0.5, runner: 0.1 } : round <= 12 ? { walker: 0.2, jogger: 0.5, runner: 0.3 } : { walker: 0.1, jogger: 0.4, runner: 0.5 };
  return weighted(Object.keys(w).map((k) => ({ w: w[k], k }))).k;
}
const zombieHealth = (r) => (r < 10 ? 120 + (r - 1) * 85 : Math.round(885 * Math.pow(1.09, r - 10)));
const zombieCount = (r) => Math.floor(0.1 * r * r + 2.5 * r + 3.5);
const ZOMBIE_DMG = 50;

// ---- procedural skin & rag textures
function texSkin(base) {
  const s = 256, c = makeCanvas(s, s), x = c.getContext('2d');
  x.fillStyle = `rgb(${base.join(',')})`; x.fillRect(0, 0, s, s);
  blotches(x, s, s, 36, 10, 48, '58,68,58', 0.08, 0.28);      // necrotic mottling
  blotches(x, s, s, 26, 8, 30, '190,185,165', 0.05, 0.2);     // pallid patches
  blotches(x, s, s, 12, 6, 26, '102,48,84', 0.12, 0.32);      // bruising
  cracks(x, s, s, 30, 'rgba(88,34,70,0.45)');                 // veins
  for (let i = 0; i < 6; i++) { const px = rand(s), py = rand(s), r = rand(6, 16); const g = x.createRadialGradient(px, py, 0, px, py, r); g.addColorStop(0, 'rgba(120,10,14,0.95)'); g.addColorStop(0.5, 'rgba(70,6,10,0.85)'); g.addColorStop(1, 'rgba(40,4,6,0)'); x.fillStyle = g; x.fillRect(px - r, py - r, r * 2, r * 2); }
  addNoise(x, s, s, 9);
  const t = finishTex(c); const b = finishTex(c, true, false); return { map: t, bump: b };
}
function texRag(rgb) {
  const s = 256, c = makeCanvas(s, s), x = c.getContext('2d');
  x.fillStyle = `rgb(${rgb.join(',')})`; x.fillRect(0, 0, s, s); addNoise(x, s, s, 16);
  blotches(x, s, s, 22, 10, 60, '18,14,10', 0.1, 0.42); blotches(x, s, s, 7, 10, 42, '88,8,10', 0.2, 0.55);
  for (let i = 0; i < 40; i++) { x.strokeStyle = `rgba(0,0,0,${rand(0.05, 0.2)})`; x.lineWidth = 1; x.beginPath(); const a = rand(s); x.moveTo(a, 0); x.lineTo(a + rand(-20, 20), s); x.stroke(); }
  x.globalCompositeOperation = 'destination-out';
  x.beginPath(); x.moveTo(0, s); for (let px = 0; px <= s; px += 6) x.lineTo(px, s - rand(8, 58)); x.lineTo(s, s); x.closePath(); x.fill(); // ragged hem
  for (let i = 0; i < 16; i++) { x.beginPath(); const px = rand(s), py = rand(s * 0.25, s * 0.9), r = rand(3, 13); for (let k = 0; k < 9; k++) { const a = (k / 9) * TAU, rr = r * rand(0.6, 1.3); x.lineTo(px + Math.cos(a) * rr, py + Math.sin(a) * rr); } x.closePath(); x.fill(); } // holes
  return finishTex(c);
}

let ZGEO = null, ZMAT = null; const ZTMP = new THREE.Vector3();
function zombieAssets() {
  if (ZGEO) return;
  const lathe = (pts, seg = 18) => new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), seg);
  ZGEO = {
    pelvis: new THREE.SphereGeometry(0.17, 12, 10),
    torso: lathe([[0.13, -0.02], [0.145, 0.1], [0.19, 0.26], [0.205, 0.38], [0.19, 0.48], [0.12, 0.54], [0.06, 0.57]]),
    shirt: lathe([[0.17, -0.16], [0.175, -0.04], [0.18, 0.12], [0.215, 0.28], [0.228, 0.4], [0.21, 0.5], [0.13, 0.555]]),
    neck: new THREE.CylinderGeometry(0.052, 0.068, 0.13, 10),
    skull: new THREE.SphereGeometry(0.115, 18, 14),
    jaw: new THREE.SphereGeometry(0.072, 12, 8),
    socket: new THREE.SphereGeometry(0.036, 8, 8),
    eye: new THREE.SphereGeometry(0.019, 8, 8),
    mouth: new THREE.SphereGeometry(0.03, 8, 6),
    hair: new THREE.SphereGeometry(0.124, 14, 8, 0, TAU, 0, Math.PI * 0.52),
    teeth: new THREE.BoxGeometry(0.056, 0.011, 0.012),
    brow: new THREE.BoxGeometry(0.15, 0.022, 0.035),
    upperArm: new THREE.CapsuleGeometry(0.052, 0.2, 4, 10),
    forearm: new THREE.CapsuleGeometry(0.042, 0.2, 4, 10),
    palm: new THREE.SphereGeometry(0.05, 8, 8),
    finger: new THREE.CapsuleGeometry(0.009, 0.055, 2, 6),
    thigh: new THREE.CapsuleGeometry(0.076, 0.28, 4, 10),
    shin: new THREE.CapsuleGeometry(0.056, 0.28, 4, 10),
    foot: new THREE.CapsuleGeometry(0.05, 0.16, 3, 8),
    shadow: new THREE.CircleGeometry(0.45, 16),
  };
  const skins = [[126, 136, 114], [142, 128, 118], [116, 132, 128], [146, 142, 124]].map((b) => texSkin(b));
  ZMAT = {
    skin: skins.map((t) => new THREE.MeshStandardMaterial({ map: t.map, bumpMap: t.bump, bumpScale: 0.012, roughness: 0.96 })),
    shirt: [[74, 77, 58], [78, 54, 40], [58, 60, 66], [76, 32, 34], [60, 70, 80]].map((rgb) => new THREE.MeshStandardMaterial({ map: texRag(rgb), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 1 })),
    pants: [0x1e1f26, 0x2a2320, 0x23282a].map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 1, map: TEX.dirt })),
    dark: new THREE.MeshStandardMaterial({ color: 0x060304, roughness: 1 }),
    hair: [0x1a1410, 0x2a2018, 0x3a3630, 0x0f0f12, 0x4a4238].map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 1 })),
    teeth: new THREE.MeshStandardMaterial({ color: 0xd9d0b8, roughness: 0.5 }),
    eye: new THREE.MeshBasicMaterial({ color: new THREE.Color(2.6, 1.35, 0.4) }),
    shadow: new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.55, depthWrite: false }),
  };
}

class Zombie {
  constructor(scene) {
    zombieAssets(); const g = this.group = new THREE.Group(); scene.add(g); g.visible = false;
    const M = (geo, mat) => new THREE.Mesh(geo, mat);
    const body = this.body = new THREE.Group(); g.add(body);
    const hips = this.hips = new THREE.Group(); hips.position.y = 0.95; body.add(hips);
    this.pelvis = M(ZGEO.pelvis, ZMAT.pants[0]); this.pelvis.scale.set(1, 0.62, 0.78); this.pelvis.position.y = -0.03; hips.add(this.pelvis);
    const upper = this.upper = new THREE.Group(); hips.add(upper);
    this.torso = M(ZGEO.torso, ZMAT.skin[0]); upper.add(this.torso);
    this.shirt = M(ZGEO.shirt, ZMAT.shirt[0]); upper.add(this.shirt);
    this.neck = M(ZGEO.neck, ZMAT.skin[0]); this.neck.position.y = 0.6; upper.add(this.neck);
    const headG = this.headG = new THREE.Group(); headG.position.y = 0.65; upper.add(headG);
    this.skull = M(ZGEO.skull, ZMAT.skin[0]); this.skull.scale.set(1, 1.12, 1.05); this.skull.position.y = 0.1; headG.add(this.skull);
    this.jawG = new THREE.Group(); this.jawG.position.set(0, 0.03, -0.01); headG.add(this.jawG);
    this.jaw = M(ZGEO.jaw, ZMAT.skin[0]); this.jaw.scale.set(1.15, 0.62, 1.1); this.jaw.position.set(0, -0.025, 0.04); this.jawG.add(this.jaw);
    this.mouth = M(ZGEO.mouth, ZMAT.dark); this.mouth.scale.set(1.6, 0.6, 0.8); this.mouth.position.set(0, 0.035, 0.1); headG.add(this.mouth);
    this.teeth = M(ZGEO.teeth, ZMAT.teeth); this.teeth.position.set(0, 0.046, 0.109); headG.add(this.teeth);
    this.brow = M(ZGEO.brow, ZMAT.skin[0]); this.brow.position.set(0, 0.158, 0.09); this.brow.rotation.x = 0.35; headG.add(this.brow);
    this.hair = M(ZGEO.hair, ZMAT.hair[0]); this.hair.position.set(0, 0.115, -0.012); this.hair.rotation.x = -0.28; this.hair.scale.set(1, 1.02, 1.06); headG.add(this.hair);
    this.eyes = []; this.sockets = [];
    for (const sx of [-0.046, 0.046]) { const so = M(ZGEO.socket, ZMAT.dark); so.position.set(sx, 0.125, 0.085); headG.add(so); this.sockets.push(so); const e = M(ZGEO.eye, ZMAT.eye); e.position.set(sx, 0.125, 0.104); headG.add(e); this.eyes.push(e); }
    this.headParts = [this.skull, this.jawG, this.mouth, this.teeth, this.brow, this.hair, ...this.sockets, ...this.eyes];
    // arms: shoulder → elbow → hand
    this.arms = []; this.elbows = []; this.hands = [];
    for (const sx of [-0.21, 0.21]) {
      const sh = new THREE.Group(); sh.position.set(sx, 0.5, 0); upper.add(sh);
      const ua = M(ZGEO.upperArm, ZMAT.skin[0]); ua.position.y = -0.15; sh.add(ua);
      const el = new THREE.Group(); el.position.y = -0.3; sh.add(el);
      const fa = M(ZGEO.forearm, ZMAT.skin[0]); fa.position.y = -0.14; el.add(fa);
      const hand = new THREE.Group(); hand.position.y = -0.29; el.add(hand);
      const palm = M(ZGEO.palm, ZMAT.skin[0]); palm.scale.set(0.9, 1.15, 0.45); palm.position.y = -0.03; hand.add(palm);
      for (let f = 0; f < 3; f++) { const fg = M(ZGEO.finger, ZMAT.skin[0]); fg.position.set((f - 1) * 0.024, -0.1, 0.01); fg.rotation.x = 0.35 + f * 0.05; hand.add(fg); }
      sh.userData = { upper: ua, fore: fa, palm }; this.arms.push(sh); this.elbows.push(el); this.hands.push(hand);
    }
    // legs: hip → knee → foot
    this.legs = []; this.knees = []; this.feet = [];
    for (const sx of [-0.1, 0.1]) {
      const hip = new THREE.Group(); hip.position.set(sx, -0.03, 0); hips.add(hip);
      const th = M(ZGEO.thigh, ZMAT.pants[0]); th.position.y = -0.21; hip.add(th);
      const kn = new THREE.Group(); kn.position.y = -0.43; hip.add(kn);
      const sn = M(ZGEO.shin, ZMAT.pants[0]); sn.position.y = -0.2; kn.add(sn);
      const ft = M(ZGEO.foot, ZMAT.dark); ft.rotation.x = Math.PI / 2; ft.position.set(0, -0.44, 0.06); kn.add(ft);
      hip.userData = { thigh: th, shin: sn }; this.legs.push(hip); this.knees.push(kn); this.feet.push(ft);
    }
    this.shadow = M(ZGEO.shadow, ZMAT.shadow); this.shadow.rotation.x = -Math.PI / 2; this.shadow.position.y = 0.015; g.add(this.shadow);
    this.alive = false; this.vel = { x: 0, z: 0 }; this.tmp = { x: 0, z: 0 }; this.model = null; this.hitAnimT = 0;
  }
  setSkin(skin, shirt, pants) {
    for (const m of [this.torso, this.neck, this.skull, this.jaw, this.brow]) m.material = skin;
    for (const sh of this.arms) { sh.userData.upper.material = shirt.sleeves ? shirt.mat : skin; sh.userData.fore.material = skin; sh.userData.palm.material = skin; }
    for (const hand of this.hands) for (const c of hand.children) c.material = skin;
    this.shirt.material = shirt.mat; this.pelvis.material = pants; for (const l of this.legs) { l.userData.thigh.material = pants; l.userData.shin.material = pants; }
  }
  spawn(o) {
    this.alive = true; this.dying = false; this.hp = this.maxHp = o.hp; this.type = o.type; this.T = ZTYPES[o.type]; this.speed = this.T.speed * rand(0.9, 1.12);
    this.x = o.x; this.z = o.z; this.yaw = rand(TAU); this.scale = rand(0.94, 1.08); this.phase = rand(TAU); this.groanT = rand(1, 6); this.attackT = 0; this.bashT = rand(0.6, 1.4); this.hitFlash = 0; this.deadT = 0; this.stuckT = 0; this.bashHitT = 1; this.vault = 0;
    this.vel.x = this.vel.z = this.motionSpeed = 0; this.struck = false; this.atkRole = null; this.vaultStart = null; this.bashElapsed = 0; this.bashPeriod = rand(1.7, 2.4); this.bashStruck = false; this.bashRole = null;
    this.win = o.win || null; this.state = o.mode === 'rise' ? 'rise' : 'toWindow'; this.riseT = 0; this.headless = false; this.crawler = false;
    this.armStyle = this.type === 'runner' ? 'run' : choice(['reach', 'reach', 'hang', 'oneUp']); this.limp = this.type === 'walker' ? rand(0, 0.55) : rand(0, 0.15);
    this.headTilt = rand(-0.32, 0.32); this.hunch = rand(0.06, 0.3); this.jawPhase = rand(TAU); this.twitch = rand(0.6, 1.4);
    this.setSkin(choice(ZMAT.skin), { mat: choice(ZMAT.shirt), sleeves: Math.random() < 0.5 }, choice(ZMAT.pants));
    this.attachModel();
    for (const p of this.headParts) p.visible = true; this.headG.visible = true;
    this.hair.visible = Math.random() < 0.72; this.hair.material = choice(ZMAT.hair); this.skull.scale.set(rand(0.96, 1.04), 1.12 * rand(0.96, 1.1), 1.05 * rand(0.97, 1.06));
    this.group.visible = true; this.group.scale.setScalar(this.scale); this.group.rotation.set(0, this.yaw, 0); this.group.position.set(this.x, this.state === 'rise' ? -1.9 : 0, this.z);
    this.body.rotation.set(0, 0, 0); this.upper.rotation.set(0, 0, 0); this.shadow.visible = true;
    for (const a of this.arms) a.rotation.set(0, 0, 0); for (const e of this.elbows) e.rotation.set(0, 0, 0); for (const l of this.legs) l.rotation.set(0, 0, 0); for (const k of this.knees) k.rotation.set(0, 0, 0);
    if (this.state === 'rise') FX.dirt(this.x, this.z, 18);
  }
  // ---- online model attachment (GLTF, animated) with procedural fallback
  attachModel() {
    this.detachModel(); const id = MODELS.pick(); if (!id) { this.body.visible = true; return; }
    const inst = MODELS.instance(id); const L = inst.L; const targetH = L.def.height * rand(0.94, 1.06); inst.hScale = targetH / 1.8; const sc = targetH / L.height;
    inst.obj.scale.setScalar(sc); inst.obj.position.set(-L.centerX * sc, -L.footY * sc, -L.centerZ * sc); inst.obj.rotation.set(0, 0, 0);
    this.group.add(inst.obj); this.model = inst; this.body.visible = false; this.hitAnimT = 0;
    this.crawler = !!inst.actions.crawl && this.type === 'walker' && Math.random() < 0.24; if (this.crawler) this.speed *= 0.65;
    this._climbed = false; this.walkRole = inst.actions.walk2 && Math.random() < 0.45 ? 'walk2' : 'walk';
    this.runRole = inst.actions.run2 && Math.random() < 0.5 ? 'run2' : 'run';
    this.playModel(this.state === 'rise' && inst.actions.rise ? 'rise' : (this.crawler ? 'crawl' : this.walkRole), 1, this.state === 'rise');
  }
  detachModel() {
    if (!this.model) return;
    const { mixer, obj } = this.model;
    mixer.stopAllAction(); mixer.uncacheRoot(obj);
    const materials = new Set(), skeletons = new Set();
    obj.traverse(o => {
      if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => materials.add(m));
      if (o.skeleton) skeletons.add(o.skeleton);
    });
    materials.forEach(m => m.dispose()); skeletons.forEach(sk => sk.dispose());
    this.group.remove(obj); this.model = null; this.body.visible = true;
  }
  playModel(role, rate = 1, once = false, fade = .2) { this.model?.animator.play(role, rate, once, fade); }
  beginVault() {
    if (!this.win || this.win.boards > 0) return;
    this.state = 'enter'; this.vault = 0; this.vaultElapsed = 0;
    this.vaultStart = {x:this.x, z:this.z};
    this.vaultDuration = VAULT[this.crawler ? 'crawler' : 'standing'].duration;
    this.vaultEnd = windowPoint(this.win, this.crawler, true);
    this.vel.x = this.vel.z = 0;
  }
  beginAttack() {
    const A = this.model?.actions;
    const pool = this.crawler && A?.crawlAttack ? ['crawlAttack'] : ['attack', 'attack2', 'attack3'].filter(r => A?.[r]);
    this.atkRole = pool.length ? choice(pool) : 'attack';
    this.atkDur = A?.[this.atkRole]?.getClip().duration || 1.15;
    this.atkStrike = this.atkDur * (CONTACT[this.atkRole] || .48);
    this.state = 'attack'; this.attackT = 0; this.struck = false;
    if (this.model) this.playModel(this.atkRole, 0, true, .12);
  }
  animateModel(dt, speed) {
    const m = this.model;
    m.animator.update({state:this.state, crawler:this.crawler, speed,
      scale:this.scale * m.obj.scale.y, walkRole:this.walkRole, runRole:this.runRole,
      attackRole:this.atkRole, attackTime:this.attackT, attackDuration:this.atkDur,
      vault:this.vault, bashElapsed:this.bashElapsed}, dt);
  }
  modelHit() { this.model?.animator.hit(this.state); }
  // ray test: returns {t, head} or null
  hitTest(ox, oy, oz, dx, dy, dz, maxT) {
    if (!this.alive || this.dying) return null; const s = this.scale * (this.model ? this.model.hScale : 1); const gy = this.group.position.y;
    let best = null; const r = (this.crawler ? 0.5 : 0.3) * s, cx = this.x, cz = this.z;
    const fx = ox - cx, fz = oz - cz; const a = dx * dx + dz * dz, b = 2 * (fx * dx + fz * dz), c = fx * fx + fz * fz - r * r;
    if (a > 1e-6) { const disc = b * b - 4 * a * c; if (disc >= 0) { const t = (-b - Math.sqrt(disc)) / (2 * a); if (t > 0 && t < maxT) { const y = oy + dy * t; if (y > gy && y < gy + (this.crawler ? .85 : 1.55) * s) best = { t, head: false }; } } }
    if (!this.headless) {
      let hx, hy, hz, hr;
      if (this.model && this.model.headBone) { this.model.headBone.getWorldPosition(ZTMP); hx = ZTMP.x; hy = ZTMP.y + 0.06 * s; hz = ZTMP.z; hr = 0.19 * s; }
      else { const lean = this.upper.rotation.x; hx = cx + Math.sin(this.yaw) * Math.sin(lean) * 0.75 * s; hz = cz + Math.cos(this.yaw) * Math.sin(lean) * 0.75 * s; hy = gy + (0.95 + 0.75 * Math.cos(lean)) * s; hr = 0.165 * s; }
      const px = ox - hx, py = oy - hy, pz = oz - hz; const bb = 2 * (px * dx + py * dy + pz * dz), cc = px * px + py * py + pz * pz - hr * hr; const disc = bb * bb - 4 * cc;
      if (disc >= 0) { const t = (-bb - Math.sqrt(disc)) / 2; if (t > 0 && t < maxT && (!best || t < best.t + 0.05)) best = { t, head: true }; }
    }
    return best;
  }
  poseArms(ph, vmag, dt) {
    const [L, R] = this.arms, [eL, eR] = this.elbows; const sw = this.T.armSwing; const k = 1 - Math.exp(-dt * 6);
    const set = (grp, tx, tz) => { grp.rotation.x += (tx - grp.rotation.x) * k; grp.rotation.z += (tz - grp.rotation.z) * k; };
    const setE = (grp, tx) => { grp.rotation.x += (tx - grp.rotation.x) * k; };
    const style = this.armStyle;
    if (style === 'run') { set(L, -0.4 + Math.sin(ph) * 0.9, 0.18); set(R, -0.4 - Math.sin(ph) * 0.9, -0.18); setE(eL, -1.25); setE(eR, -1.25); }
    else if (style === 'hang') { set(L, -0.45 + Math.sin(ph + 1) * sw, 0.14); set(R, -0.35 + Math.sin(ph + 2.4) * sw, -0.14); setE(eL, -1.0 - Math.abs(Math.sin(ph * 0.5)) * 0.2); setE(eR, -0.85 - Math.abs(Math.cos(ph * 0.5)) * 0.2); }
    else if (style === 'oneUp') { set(L, -1.2 + Math.sin(ph + 1) * sw * 0.6, 0.22); set(R, -0.3 + Math.sin(ph + 2.4) * sw, -0.2); setE(eL, -0.6); setE(eR, -1.1); }
    else { set(L, -1.15 + Math.sin(ph + 1) * sw * 0.7, 0.26 + Math.sin(ph * 0.5) * 0.06); set(R, -1.0 + Math.sin(ph + 2.4) * sw * 0.7, -0.24 - Math.sin(ph * 0.5 + 1) * 0.06); setE(eL, -0.75 + Math.sin(ph * 0.7) * 0.15); setE(eR, -0.9 + Math.cos(ph * 0.6) * 0.15); }
    for (const h of this.hands) h.rotation.x = -0.4 + Math.sin(ph * 1.3 + this.jawPhase) * 0.15;
  }
  update(dt, time) {
    if (!this.alive) return;
    const g = this.group, P = PL.pos;
    if (this.dying) {
      this.deadT += dt;
      if (this.model) { this.model.animator.advance(dt); if (!this.model.actions.death) { const f = Math.min(1, this.deadT / 0.55); const e = 1 - (1 - f) * (1 - f); g.rotation.x = this.fallDir * e * (Math.PI / 2) * 0.96; g.rotation.z = this.fallTwist * e; } }
      else { const f = Math.min(1, this.deadT / 0.55); const e = 1 - (1 - f) * (1 - f); g.rotation.x = this.fallDir * e * (Math.PI / 2) * 0.96; g.rotation.z = this.fallTwist * e; }
      if (this.deadT > (this.deathDuration || .6) + .75) { g.position.y -= dt * 0.9; if (g.position.y < -2.3) { this.alive = false; g.visible = false; this.detachModel(); } }
      return;
    }
    this.hitFlash = Math.max(0, this.hitFlash - dt * 6);
    this.groanT -= dt; if (this.groanT <= 0) { this.groanT = rand(3, 9); SFX.groan(this.x, this.z); }
    const dxP = P.x - this.x, dzP = P.z - this.z, dP = Math.hypot(dxP, dzP);
    let moveX = 0, moveZ = 0, speedK = 1, animate = true, armsFree = true;
    if (this.state === 'rise') {
      this.riseT += dt; const k = Math.min(1, this.riseT / 1.4); g.position.y = (this.model && this.model.actions.rise) ? 0 : -1.9 * (1 - k * k); this.yaw = angleLerp(this.yaw, Math.atan2(dxP, dzP), dt * 3);
      for (const a of this.arms) a.rotation.x = -2.7 + k * 1.3; for (const e of this.elbows) e.rotation.x = -0.4; animate = false; armsFree = false;
      if (Math.random() < dt * 8) FX.dirt(this.x, this.z, 2);
      if (k >= 1) { this.state = 'chase'; g.position.y = 0; }
    } else if (this.state === 'toWindow') {
      const w = this.win, approach = windowPoint(w, this.crawler);
      const dx = approach.x - this.x, dz = approach.z - this.z, d = Math.hypot(dx, dz);
      if (d < .12) { this.vel.x = this.vel.z = 0; if (w.boards > 0) { this.state = 'bash'; this.bashElapsed = 0; this.bashStruck = false; } else this.beginVault(); } else { moveX = dx / d; moveZ = dz / d; speedK = Math.min(.9, d * 2); }
    } else if (this.state === 'bash') {
      const w = this.win; animate = false; armsFree = false; this.yaw = angleLerp(this.yaw, Math.atan2(w.inner.x - this.x, w.inner.z - this.z), dt * 6);
      this.bashElapsed += dt;
      const ph = clamp(this.bashElapsed / 1.5, 0, 1), hammer = Math.sin(ph * Math.PI);
      for (const a of this.arms) a.rotation.x = -.7 - hammer * 1.4;
      for (const e of this.elbows) e.rotation.x = -.6 + hammer * .3;
      this.upper.rotation.x = this.T.lean + .15 + hammer * .2;
      const contact = this.crawler ? CONTACT.crawlBash : CONTACT.attack2;
      if (!this.bashStruck && ph >= contact) {
        this.bashStruck = true;
        if (w.boards > 0) { windowRemoveBoard(w); SFX.boardHit(w.x, w.z); }
        if (dP < 1.9) { PL.damage(ZOMBIE_DMG * .6, this.x, this.z); SFX.bite(); }
      }
      if (w.boards <= 0 && this.bashElapsed >= 1.5) this.beginVault();
      else if (this.bashElapsed >= this.bashPeriod) { this.bashElapsed = 0; this.bashStruck = false; this.bashPeriod = rand(1.7, 2.4); }
    } else if (this.state === 'enter') {
      const w = this.win;
      if (!this.vaultStart) this.beginVault();
      this.vaultElapsed += dt; this.vault = clamp(this.vaultElapsed / this.vaultDuration, 0, 1);
      const {travel} = vaultPose(this.vault, this.crawler);
      this.x = lerp(this.vaultStart.x, this.vaultEnd.x, travel); this.z = lerp(this.vaultStart.z, this.vaultEnd.z, travel);
      this.yaw = angleLerp(this.yaw, Math.atan2(w.inner.x - w.outer.x, w.inner.z - w.outer.z), 1 - Math.exp(-dt * 14));
      if (this.vault >= 1) { this.state = 'chase'; this.win = null; this.vaultStart = null; g.position.y = 0; }
    } else if (this.state === 'chase') {
      if (dP < 1.55) this.beginAttack();
      else {
        let got = false;
        if (dP < 9 && NAV.los(this.x, this.z, P.x, P.z, Z_WALK)) { moveX = dxP / dP; moveZ = dzP / dP; got = true; }
        else if (NAV.flowDir(this.x, this.z, this.tmp)) { moveX = this.tmp.x; moveZ = this.tmp.z; got = true; }
        if (!got) { moveX = dxP / (dP || 1); moveZ = dzP / (dP || 1); }
      }
    } else if (this.state === 'attack') {
      animate = false; armsFree = false; this.attackT += dt; this.yaw = angleLerp(this.yaw, Math.atan2(dxP, dzP), dt * 10);
      const t = this.attackT; const swing = t < 0.45 ? -1.5 + (t / 0.45) * 0.3 : t < 0.6 ? -1.2 + ((t - 0.45) / 0.15) * 1.0 : -0.2 - Math.min(1, (t - 0.6) / 0.5) * 1.3;
      this.arms[0].rotation.x = swing; this.arms[1].rotation.x = swing - 0.25; for (const e of this.elbows) e.rotation.x = t < 0.45 ? -0.9 : -0.2; this.upper.rotation.x = this.T.lean + (t > 0.45 && t < 0.7 ? 0.4 : 0.1);
      if (!this.struck && t >= (this.atkStrike || 0.47)) { this.struck = true; if (dP < 2.1) { PL.damage(ZOMBIE_DMG, this.x, this.z); SFX.bite(); } }
      if (t > (this.atkDur || 1.15)) { this.struck = false; this.state = 'chase'; }
      if (dP > 3 && t > 0.6) { this.struck = false; this.state = 'chase'; }
    }
    // ---- steering
    const spd = this.speed * speedK * (G.slowmo || 1);
    const tvx = moveX * spd, tvz = moveZ * spd; const k = 1 - Math.exp(-dt * 8); this.vel.x += (tvx - this.vel.x) * k; this.vel.z += (tvz - this.vel.z) * k;
    let sx = 0, sz = 0;
    for (const o of ZM.list) { if (o === this || !o.alive || o.dying) continue; const dx = this.x - o.x, dz = this.z - o.z, d2 = dx * dx + dz * dz; if (d2 < 0.8 * 0.8 && d2 > 1e-4) { const d = Math.sqrt(d2); const f = (0.8 - d) / d; sx += dx * f; sz += dz * f; } }
    if (dP < 0.75 && dP > 1e-3) { const f = (0.75 - dP) / dP; sx += -dxP * f * 1.5; sz += -dzP * f * 1.5; }
    const freeMove = this.state === 'chase' || this.state === 'toWindow';
    if (!freeMove) this.vel.x = this.vel.z = 0;
    const mx = freeMove ? this.vel.x * dt + sx * dt * 8 : 0, mz = freeMove ? this.vel.z * dt + sz * dt * 8 : 0;
    const before = { x: this.x, z: this.z }; const p = { x: this.x, z: this.z };
    const blocked = freeMove ? NAV.move(p, mx, mz, 0.33, Z_WALK) : false; this.x = p.x; this.z = p.z;
    const moved = Math.hypot(this.x - before.x, this.z - before.z);
    if (blocked && moved < spd * dt * 0.2 && (moveX || moveZ)) { this.stuckT += dt; if (this.stuckT > 1.2) { this.stuckT = 0; NAV.depenetrate(p, 0.5, Z_WALK); this.x = p.x; this.z = p.z; } } else this.stuckT = 0;
    if (moveX || moveZ) this.yaw = angleLerp(this.yaw, Math.atan2(this.vel.x, this.vel.z), dt * 6);
    g.position.x = this.x; g.position.z = this.z; g.rotation.y = this.yaw;
    // ---- animation
    const vmag = moved / Math.max(dt, 1e-5); const animSpeed = this.T.anim * clamp(vmag / this.T.speed, 0, 1.4);
    const ph = this.phase;
    if (this.model) {
      this.animateModel(dt, vmag);
      if (this.state === 'enter') g.position.y = vaultPose(this.vault, this.crawler, this.scale * this.model.obj.scale.y).height;
      this.model.obj.updateWorldMatrix(true, true); return;
    }
    if (animate) {
      this.phase += dt * (3.4 + animSpeed * 4.6) * (vmag > 0.2 ? 1 : 0.25);
      const amp = 0.52 * clamp(vmag / 1.2, 0.2, 1.1);
      const [lL, lR] = this.legs, [kL, kR] = this.knees;
      const sL = Math.sin(ph), sR = -Math.sin(ph);
      lL.rotation.x = sL * amp * (1 - this.limp * 0.7); lR.rotation.x = sR * amp;
      kL.rotation.x = -Math.max(0, -sL) * 0.95 * clamp(vmag / 1.5, 0.3, 1) * (1 - this.limp * 0.5); kR.rotation.x = -Math.max(0, -sR) * 0.95 * clamp(vmag / 1.5, 0.3, 1);
      lL.rotation.z = 0.06 + this.limp * 0.12; lR.rotation.z = -0.06;
      this.upper.rotation.x = this.T.lean + this.hunch + Math.sin(ph * 2) * 0.03; this.upper.rotation.y = Math.sin(ph) * 0.09; this.upper.rotation.z = Math.sin(ph) * 0.05 + this.limp * 0.08;
      this.hips.rotation.y = -Math.sin(ph) * 0.07;
      g.position.y = Math.abs(Math.sin(ph)) * 0.03 * clamp(vmag, 0, 1) - this.limp * 0.02 * Math.max(0, Math.sin(ph));
    }
    if (armsFree) this.poseArms(ph, vmag, dt);
    // head: tilt, nod, twitch, jaw
    this.headG.rotation.z = this.headTilt + Math.sin(ph * 0.7) * 0.08; this.headG.rotation.x = -0.12 - this.hunch * 0.6 + Math.sin(ph * 1.3) * 0.05 + (Math.sin(time * 9 * this.twitch) > 0.97 ? 0.12 : 0);
    this.headG.rotation.y = Math.sin(time * 0.9 * this.twitch + this.jawPhase) * 0.18;
    this.jawG.rotation.x = 0.12 + Math.max(0, Math.sin(time * 1.7 * this.twitch + this.jawPhase)) * 0.5 + (this.state === 'attack' ? 0.4 : 0);
    if (this.state === 'enter') { const v = Math.sin(this.vault * Math.PI); g.position.y = v * 1.05; this.upper.rotation.x = 0.4 + v * 0.5; for (const a of this.arms) a.rotation.x = -2.0 + v * 0.7; for (const e of this.elbows) e.rotation.x = -0.4; this.legs[0].rotation.x = -v * 1.0; this.legs[1].rotation.x = v * 0.5; this.knees[0].rotation.x = -v * 1.3; this.knees[1].rotation.x = -v * 0.6; }
    if (this.hitFlash > 0) { this.headG.rotation.x -= this.hitFlash * 0.35; this.upper.rotation.x -= this.hitFlash * 0.12; }
  }
  die(dir, head) {
    this.dying = true; this.deadT = 0; this.fallDir = Math.random() < 0.65 ? -1 : 1; this.fallTwist = rand(-0.4, 0.4);
    if (dir) { const forward = Math.sin(this.yaw) * dir.x + Math.cos(this.yaw) * dir.z; this.fallDir = forward > 0 ? 1 : -1; } // knocked away from the shooter
    if (head) { this.headless = true; this.headG.visible = false; if (this.model) for (const m of this.model.headMeshes) m.visible = false; }
    if (this.model) {
      this.model.hitAction?.stop(); this.model.hitAction = null;
      const role = actionRole('death', this.crawler, this.model.actions);
      this.playModel(role, 1, true, .12); this.deathDuration = this.model.cur.getClip().duration;
    } else this.deathDuration = .6;
    for (const a of this.arms) { a.rotation.x = rand(-1.2, 0.4); a.rotation.z = rand(-0.6, 0.6); } for (const e of this.elbows) e.rotation.x = rand(-1.2, 0);
    for (const l of this.legs) l.rotation.x = rand(-0.3, 0.5); for (const k of this.knees) k.rotation.x = rand(-0.9, 0);
    this.upper.rotation.set(0.05, rand(-0.3, 0.3), 0); this.shadow.visible = false; this.group.position.y = 0;
    FX.splat(this.x, this.z, 1.5 + Math.random());
  }
}

const ZM = {
  list: [], toSpawn: 0, spawned: 0, spawnT: 0, round: 1, maxAlive: 24,
  init(scene) { this.scene = scene; for (let i = 0; i < 30; i++) this.list.push(new Zombie(scene)); },
  reset() { for (const z of this.list) { z.alive = false; z.dying = false; z.group.visible = false; z.shadow.visible = true; z.detachModel(); } this.toSpawn = 0; this.spawned = 0; },
  alive() { let n = 0; for (const z of this.list) if (z.alive && !z.dying) n++; return n; },
  startRound(r) { this.round = r; this.toSpawn = zombieCount(r); this.spawned = 0; this.spawnT = 1.2; this.maxAlive = Math.min(24, 8 + r * 2); },
  pickSpawn() {
    const P = PL.pos; const c = [];
    for (const w of MAP.windows) { if (!MAP.zones[w.zone].open) continue; let queued = 0; for (const z of this.list) if (z.alive && z.win === w) queued++; if (queued >= 3) continue; const d = Math.hypot(w.inner.x - P.x, w.inner.z - P.z); c.push({ w: 1.2 / (1 + d * 0.06), kind: 'window', win: w }); }
    for (const r of MAP.risers) { if (!MAP.zones[r.zone].open) continue; const d = Math.hypot(r.x - P.x, r.z - P.z); if (d < 6) continue; c.push({ w: 1.0 / (1 + d * 0.06), kind: 'rise', r }); }
    return c.length ? weighted(c) : null;
  },
  spawnOne() {
    const s = this.pickSpawn(); if (!s) return false; const z = this.list.find((q) => !q.alive); if (!z) return false;
    const type = zombieTypeFor(this.round), hp = zombieHealth(this.round);
    if (s.kind === 'window') { const p = s.win.pocket; z.spawn({ x: rand(p.x1 + 0.6, p.x2 - 0.6), z: rand(p.z1 + 0.6, p.z2 - 0.6), mode: 'window', win: s.win, type, hp }); }
    else z.spawn({ x: s.r.x + rand(-0.6, 0.6), z: s.r.z + rand(-0.6, 0.6), mode: 'rise', type, hp });
    this.spawned++; return true;
  },
  update(dt, time) {
    if (G.roundState === 'active' && this.spawned < this.toSpawn && this.alive() < this.maxAlive) {
      this.spawnT -= dt; if (this.spawnT <= 0) { if (this.spawnOne()) this.spawnT = Math.max(0.45, 2.3 - this.round * 0.12) * rand(0.7, 1.3); else this.spawnT = 0.5; }
    }
    for (const z of this.list) if (z.alive) z.update(dt, time);
  },
  raycast(ox, oy, oz, dx, dy, dz, maxT) { let best = null; for (const z of this.list) { if (!z.alive || z.dying) continue; const h = z.hitTest(ox, oy, oz, dx, dy, dz, maxT); if (h && (!best || h.t < best.t)) { best = h; best.z = z; } } return best; },
  damage(z, amount, head, px, py, pz, dir, source = 'bullet') {
    if (!z.alive || z.dying) return false;
    if (G.instakill > 0) amount = z.hp + 1;
    z.hp -= amount; z.hitFlash = 1; z.modelHit();
    FX.blood(px, py, pz, dir ? dir.x : 0, dir ? dir.y : 0.3, dir ? dir.z : 0, head ? 18 : 10, head);
    if (source === 'bullet') PL.addPoints(10, false);
    if (z.hp <= 0) {
      const pts = source === 'melee' ? 130 : source === 'grenade' || source === 'splash' ? 50 : head ? 100 : 60;
      PL.addPoints(pts); G.kills++; if (head) G.headshots++;
      z.die(dir, head && source === 'bullet'); if (head) FX.blood(px, py, pz, 0, 1, 0, 16, true);
      SFX.hitmarker(true, head); HUD.hitmarker(true); HUD.kills(G.kills);
      PU.maybeDrop(z.x, z.z); return true;
    }
    if (source === 'bullet' || source === 'melee') { SFX.hitmarker(false, head); HUD.hitmarker(false); }
    return false;
  },
  killAll(source) { let n = 0; for (const z of this.list) if (z.alive && !z.dying) { z.hp = 0; z.die(null, false); FX.blood(z.x, 1.1, z.z, 0, 1, 0, 14, true); n++; G.kills++; } HUD.kills(G.kills); return n; },
  pushAway(x, z, radius, force) { for (const q of this.list) { if (!q.alive || q.dying || q.state === 'enter') continue; const dx = q.x - x, dz = q.z - z, d = Math.hypot(dx, dz); if (d < radius && d > 0.01) { const p = { x: q.x, z: q.z }; NAV.move(p, (dx / d) * force, (dz / d) * force, 0.33, Z_WALK); q.x = p.x; q.z = p.z; if (q.state === 'attack') { q.state = 'chase'; q.struck = false; } } } },
};

// ===== 60_weapons.js =====
// ---------------------------------------------------------------- weapons
// ---- original GLB gun models; procedural guns remain as a network fallback
const GUNS = {
  scenes: {}, failed: [], loader: null,
  init() { this.loader = new GLTFLoader(); if (typeof MeshoptDecoder !== 'undefined') this.loader.setMeshoptDecoder(MeshoptDecoder); },
  async loadAll() {
    // Bound simultaneous texture decoding on memory-constrained phones.
    for (const id of Object.keys(GUN_URLS)) { await this.load(id); updateAssetsLabel(); }
  },
  async load(id) {
    if (this.scenes[id]) return true;
    try {
      const gltf = await loadGLB(this.loader, GUN_URLS[id]);
      gltf.scene.traverse((o) => { if (o.isMesh) { o.frustumCulled = false; o.castShadow = false; o.receiveShadow = false; } });
      this.scenes[id] = gltf.scene;
      // A player may already be using the fallback while a slow download finishes.
      if (WPN.inv?.id === id && WPN.vm) WPN.equip();
      return true;
    } catch (e) {
      if (!this.failed.includes(id)) this.failed.push(id);
      console.warn('Weapon unavailable:', id, e.message);
      return false;
    }
  },
  build(id, pap = false) {
    const src = this.scenes[id]; if (!src) return null;
    const g = src.clone(true);
    let muzzle = g.getObjectByName('Muzzle'); if (!muzzle) { muzzle = new THREE.Object3D(); g.add(muzzle); }
    g.userData.muzzle = muzzle;
    if (pap) {
      const cloned = new Map();
      g.traverse((o) => { if (o.isMesh && o.material) { if (!cloned.has(o.material)) { const c = o.material.clone(); c.color.multiply(new THREE.Color(0.3, 0.24, 0.45)); c.emissive = new THREE.Color(0x8a4cf0); c.emissiveIntensity = 0.09; cloned.set(o.material, c); } o.material = cloned.get(o.material); } });
    }
    return g;
  },
};

const WEAPONS = {
  sidearm: { id: 'sidearm', name: 'M-11 SIDEARM', kind: 'pistol', dmg: 35, headMul: 2.5, rpm: 420, mag: 8, reserve: 64, reload: 1.25, spread: 0.7, auto: false, pellets: 1, cost: 0, kick: 0.9, box: false, tracer: 0xffd9a0,
    pap: { name: 'THE ARBITER', dmg: 110, mag: 16, reserve: 160, auto: true, rpm: 520 } },
  viper: { id: 'viper', name: 'VIPER SMG', kind: 'smg', dmg: 30, headMul: 2.5, rpm: 820, mag: 32, reserve: 192, reload: 1.8, spread: 1.5, auto: true, pellets: 1, cost: 750, kick: 0.55, box: true, boxW: 1, tracer: 0xffd9a0,
    pap: { name: 'VIPER · NIGHTFANG', dmg: 85, mag: 40, reserve: 360, rpm: 880 } },
  breacher: { id: 'breacher', name: 'BREACHER 12G', kind: 'shotgun', dmg: 26, headMul: 1.8, rpm: 80, mag: 6, reserve: 36, reload: 2.3, spread: 5.5, auto: false, pellets: 8, cost: 1500, kick: 2.4, box: true, boxW: 1, tracer: 0xffd9a0,
    pap: { name: 'HELLGATE', dmg: 42, mag: 10, reserve: 60, pellets: 10, rpm: 110 } },
  sentinel: { id: 'sentinel', name: 'SENTINEL DMR', kind: 'rifle', dmg: 80, headMul: 3.5, rpm: 320, mag: 20, reserve: 140, reload: 1.9, spread: 0.35, auto: false, pellets: 1, cost: 1500, kick: 1.3, box: true, boxW: 1, tracer: 0xffd9a0,
    pap: { name: 'JUDICATOR', dmg: 240, mag: 30, reserve: 270, auto: true, rpm: 460 } },
  warden: { id: 'warden', name: 'WARDEN LMG', kind: 'lmg', dmg: 48, headMul: 2.5, rpm: 640, mag: 100, reserve: 300, reload: 3.8, spread: 2.0, auto: true, pellets: 1, cost: 2500, kick: 0.8, box: true, boxW: 0.8, tracer: 0xffd9a0,
    pap: { name: 'IRON CHOIR', dmg: 130, mag: 150, reserve: 450 } },
  arc9: { id: 'arc9', name: 'ARC-9 PULSE', kind: 'energy', dmg: 60, headMul: 2.5, rpm: 700, mag: 40, reserve: 240, reload: 2.0, spread: 0.9, auto: true, pellets: 1, cost: 0, kick: 0.4, box: true, boxW: 0.9, tracer: 0x5fe3ff,
    pap: { name: 'ARC-9 · STORMCALLER', dmg: 170, mag: 60, reserve: 420 } },
  mauler: { id: 'mauler', name: 'MAULER AUTO-12', kind: 'shotgun', dmg: 22, headMul: 1.8, rpm: 260, mag: 12, reserve: 60, reload: 2.8, spread: 6.5, auto: true, pellets: 7, cost: 0, kick: 1.6, box: true, boxW: 0.8, tracer: 0xffd9a0,
    pap: { name: 'GRAVEDIGGER', dmg: 38, mag: 20, reserve: 120, pellets: 9 } },
  longbow: { id: 'longbow', name: 'LONGBOW .338', kind: 'sniper', dmg: 450, headMul: 4, rpm: 45, mag: 5, reserve: 40, reload: 2.9, spread: 0.1, auto: false, pellets: 1, cost: 0, kick: 3.2, box: true, boxW: 0.7, tracer: 0xffe9c0,
    pap: { name: 'WIDOWMAKER', dmg: 1400, mag: 8, reserve: 64, rpm: 60 } },
  nova: { id: 'nova', name: 'NOVA LANCE', kind: 'nova', dmg: 700, headMul: 1, rpm: 130, mag: 20, reserve: 160, reload: 2.6, spread: 0.5, auto: false, pellets: 1, cost: 0, kick: 2.0, box: true, boxW: 0.28, splash: 2.6, tracer: 0x7cff6a,
    pap: { name: 'NOVA LANCE · SUPERNOVA', dmg: 1800, mag: 30, reserve: 300, splash: 3.4, rpm: 170 } },
};
const BOX_POOL = Object.values(WEAPONS).filter((w) => w.box);
function weaponStats(inv) { const W = WEAPONS[inv.id]; return inv.pap ? { ...W, ...W.pap, isPap: true } : { ...W, isPap: false }; }

// ---- procedural gun meshes
let GMAT = null;
function gunMats() {
  if (GMAT) return GMAT;
  GMAT = {
    metal: new THREE.MeshStandardMaterial({ color: 0x2b2e33, metalness: 0.8, roughness: 0.38 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x111214, roughness: 0.85, metalness: 0.2 }),
    wood: new THREE.MeshStandardMaterial({ map: TEX.wood, roughness: 0.8 }),
    steel: new THREE.MeshStandardMaterial({ color: 0x777c84, metalness: 0.9, roughness: 0.3 }),
    papMetal: new THREE.MeshStandardMaterial({ color: 0x1a1020, metalness: 0.85, roughness: 0.3 }),
    papGlow: new THREE.MeshStandardMaterial({ color: 0x2a1040, emissive: 0xb06cff, emissiveIntensity: 2.2 }),
    cyan: new THREE.MeshStandardMaterial({ color: 0x0a2a33, emissive: 0x5fe3ff, emissiveIntensity: 2.0 }),
    green: new THREE.MeshStandardMaterial({ color: 0x0a2a10, emissive: 0x7cff6a, emissiveIntensity: 2.4 }),
    lens: new THREE.MeshStandardMaterial({ color: 0x102030, emissive: 0x3060a0, emissiveIntensity: 0.8, metalness: 0.9, roughness: 0.1 }),
  };
  return GMAT;
}
function buildGunMeshProcedural(kind, pap = false) {
  const M = gunMats(); const g = new THREE.Group();
  const metal = pap ? M.papMetal : M.metal;
  const part = (w, h, d, mat, x, y, z, rx = 0) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); m.rotation.x = rx; g.add(m); return m; };
  const tube = (r, len, mat, x, y, z) => { const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 12), mat); m.rotation.x = Math.PI / 2; m.position.set(x, y, z); g.add(m); return m; };
  const muzzle = new THREE.Object3D(); g.add(muzzle); g.userData.muzzle = muzzle;
  const sights = (zf, zr, y) => { part(0.008, 0.016, 0.008, M.steel, 0, y, zf); part(0.03, 0.012, 0.008, M.steel, 0, y, zr); };
  switch (kind) {
    case 'pistol':
      part(0.046, 0.05, 0.2, metal, 0, 0.03, -0.02); part(0.04, 0.04, 0.16, M.dark, 0, -0.01, 0); part(0.04, 0.11, 0.06, M.dark, 0, -0.085, 0.06, 0.25); part(0.03, 0.03, 0.05, M.dark, 0, -0.04, -0.01);
      tube(0.012, 0.03, M.steel, 0, 0.03, -0.125); sights(-0.11, 0.07, 0.062); muzzle.position.set(0, 0.03, -0.14); break;
    case 'smg':
      part(0.06, 0.09, 0.42, metal, 0, 0, -0.05); tube(0.014, 0.14, M.steel, 0, 0.02, -0.33); part(0.035, 0.18, 0.06, M.dark, 0, -0.13, 0.02, 0.1); part(0.04, 0.1, 0.05, M.dark, 0, -0.09, 0.14, 0.2);
      part(0.04, 0.05, 0.16, M.dark, 0, 0.01, 0.26); part(0.03, 0.06, 0.03, M.dark, 0, -0.075, -0.16); part(0.02, 0.03, 0.14, M.dark, 0, 0.06, -0.02); sights(-0.24, 0.1, 0.085); muzzle.position.set(0, 0.02, -0.41); break;
    case 'shotgun':
      tube(0.016, 0.55, metal, 0, 0.03, -0.3); tube(0.014, 0.5, M.dark, 0, -0.005, -0.28); part(0.05, 0.07, 0.2, metal, 0, 0.01, 0.02); part(0.05, 0.055, 0.12, M.wood, 0, -0.01, -0.2);
      part(0.045, 0.07, 0.22, M.wood, 0, -0.02, 0.22, 0.12); sights(-0.55, 0.0, 0.058); muzzle.position.set(0, 0.03, -0.58); break;
    case 'rifle':
      part(0.05, 0.07, 0.5, metal, 0, 0, -0.05); tube(0.013, 0.3, M.steel, 0, 0.02, -0.45); tube(0.026, 0.2, M.dark, 0, 0.085, -0.05); { const lens = new THREE.Mesh(new THREE.CircleGeometry(0.022, 12), M.lens); lens.position.set(0, 0.085, -0.151); lens.rotation.y = Math.PI; g.add(lens); }
      part(0.035, 0.15, 0.07, M.dark, 0, -0.1, 0.0, 0.15); part(0.04, 0.1, 0.05, M.dark, 0, -0.085, 0.13, 0.2); part(0.045, 0.07, 0.2, M.dark, 0, -0.01, 0.3); muzzle.position.set(0, 0.02, -0.61); break;
    case 'lmg':
      part(0.07, 0.1, 0.5, metal, 0, 0, -0.02); tube(0.016, 0.32, M.steel, 0, 0.02, -0.42); tube(0.03, 0.2, M.dark, 0, 0.02, -0.32); part(0.06, 0.12, 0.14, M.dark, -0.06, -0.09, 0.0); part(0.04, 0.1, 0.05, M.dark, 0, -0.095, 0.14, 0.2);
      part(0.05, 0.08, 0.18, M.dark, 0, 0, 0.32); part(0.015, 0.04, 0.12, M.dark, 0, 0.075, -0.05); part(0.012, 0.16, 0.012, M.steel, -0.03, -0.09, -0.4, 0.3); part(0.012, 0.16, 0.012, M.steel, 0.03, -0.09, -0.4, 0.3); muzzle.position.set(0, 0.02, -0.59); break;
    case 'sniper':
      tube(0.014, 0.6, metal, 0, 0.02, -0.5); part(0.05, 0.07, 0.45, metal, 0, 0, 0); tube(0.03, 0.26, M.dark, 0, 0.09, -0.05); { const lens = new THREE.Mesh(new THREE.CircleGeometry(0.026, 12), M.lens); lens.position.set(0, 0.09, -0.181); lens.rotation.y = Math.PI; g.add(lens); }
      part(0.035, 0.12, 0.06, M.dark, 0, -0.09, 0.0, 0.1); part(0.04, 0.1, 0.05, M.dark, 0, -0.085, 0.13, 0.2); part(0.045, 0.08, 0.24, M.wood, 0, -0.01, 0.34); muzzle.position.set(0, 0.02, -0.81); break;
    case 'energy':
      part(0.06, 0.08, 0.5, metal, 0, 0, -0.05); part(0.006, 0.02, 0.4, M.cyan, 0.031, 0.0, -0.05); part(0.006, 0.02, 0.4, M.cyan, -0.031, 0.0, -0.05); part(0.03, 0.03, 0.2, M.dark, 0, 0.02, -0.4); { const ring = new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.006, 8, 16), M.cyan); ring.position.set(0, 0.02, -0.44); g.add(ring); }
      part(0.035, 0.16, 0.06, M.dark, 0, -0.12, 0.02, 0.1); part(0.04, 0.1, 0.05, M.dark, 0, -0.09, 0.14, 0.2); part(0.04, 0.06, 0.16, M.dark, 0, 0.0, 0.27); part(0.02, 0.03, 0.14, M.dark, 0, 0.055, -0.05); muzzle.position.set(0, 0.02, -0.51); break;
    case 'nova':
      part(0.08, 0.1, 0.42, metal, 0, 0, 0.0); { const core = new THREE.Mesh(new THREE.SphereGeometry(0.032, 12, 12), M.green); core.position.set(0, 0.02, -0.38); g.add(core); }
      for (let i = 0; i < 3; i++) { const a = (i / 3) * TAU; const p = tube(0.008, 0.2, M.steel, Math.cos(a) * 0.045, 0.02 + Math.sin(a) * 0.045, -0.32); }
      part(0.006, 0.03, 0.3, M.green, 0.041, 0.0, 0.0); part(0.006, 0.03, 0.3, M.green, -0.041, 0.0, 0.0); part(0.04, 0.1, 0.05, M.dark, 0, -0.095, 0.12, 0.2); part(0.05, 0.07, 0.14, M.dark, 0, 0, 0.26); muzzle.position.set(0, 0.02, -0.5); break;
  }
  if (pap) { part(0.004, 0.012, 0.3, M.papGlow, 0.032, 0.03, -0.05); part(0.004, 0.012, 0.3, M.papGlow, -0.032, 0.03, -0.05); part(0.02, 0.004, 0.2, M.papGlow, 0, 0.056, -0.1); }
  return g;
}
function buildGunMesh(kind, pap = false, id = null) {
  const glb = id ? GUNS.build(id, pap) : null;
  return glb || buildGunMeshProcedural(kind, pap);
}
const VM_POS = { pistol: [0.27, -0.26, -0.5], smg: [0.25, -0.25, -0.55], shotgun: [0.24, -0.24, -0.58], rifle: [0.24, -0.23, -0.6], lmg: [0.27, -0.27, -0.56], sniper: [0.22, -0.23, -0.62], energy: [0.25, -0.25, -0.55], nova: [0.26, -0.26, -0.55] };

const WPN = {
  slots: [null, null], cur: 0, vm: null, mesh: null, fireT: 0, heat: 0, reloading: false, reloadT: 0, reloadDur: 0, reloadStage: 0, swapping: false, swapT: 0, swapTo: 0, swapDone: false, meleeT: -1, meleeHit: false, kickZ: 0, kickR: 0, ads: 0, trigger: false, semiReady: true, wantAds: false, holstered: false, flashT: 0, meleeCd: 0, touchTarget: null, afFire: false, afT: 0,
  init(camera) {
    this.camera = camera; this.vm = new THREE.Group(); camera.add(this.vm);
    this.flash = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.34), new THREE.MeshBasicMaterial({ map: TEX.flash, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, side: THREE.DoubleSide, color: new THREE.Color(1.9, 1.9, 1.9) })); this.flash.visible = false; this.vm.add(this.flash);
    this.flashLight = new THREE.PointLight(0xffb060, 0, 11, 2); this.flashLight.position.set(0.15, -0.05, -1.4); this.flashLight.layers.enable(1); camera.add(this.flashLight);
    this.tmpV = new THREE.Vector3(); this.tmpV2 = new THREE.Vector3(); this.tmpD = new THREE.Vector3(); this.tmpQ = new THREE.Quaternion();
    ARMS.init(this.vm);
  },
  reset() { this.slots = [{ id: 'sidearm', mag: 8, reserve: 64, pap: false }, null]; this.cur = 0; this.reloading = false; this.swapping = false; this.meleeT = -1; this.holstered = false; this.heat = 0; this.kickZ = this.kickR = 0; this.ads = 0; this.fireT = 0; this.autoReload = 0; this.meleeCd = 0; this.flashT = 0; this.flash.visible = false; this.flashLight.intensity = 0; this.equip(); },
  get inv() { return this.slots[this.cur]; },
  get stats() { return weaponStats(this.inv); },
  equip() {
    if (this.mesh) { this.vm.remove(this.mesh); }
    const S = this.stats; this.mesh = buildGunMesh(S.kind, S.isPap, this.inv.id); this.vm.add(this.mesh); this.vm.traverse((o) => o.layers.set(1));
    this.base = VM_POS[S.kind]; this.flash.position.copy(this.mesh.userData.muzzle.position);
    HUD.weapon(S.name, S.isPap); HUD.ammo(this.inv.mag, this.inv.reserve, S.mag); HUD.slots(this.cur, this.slots);
  },
  give(id) {
    const W = WEAPONS[id]; const inv = { id, mag: W.mag, reserve: W.reserve, pap: false };
    const empty = this.slots.findIndex((s) => !s); const slot = empty >= 0 ? empty : this.cur; this.slots[slot] = inv; this.cur = slot;
    this.reloading = false; this.swapping = false; this.equip(); SFX.swap(); return inv;
  },
  owns(id) { return this.slots.findIndex((s) => s && s.id === id); },
  maxAmmo() { for (const s of this.slots) if (s) { const S = weaponStats(s); s.reserve = S.reserve; if (s.mag === 0) s.mag = S.mag; } HUD.ammo(this.inv.mag, this.inv.reserve, this.stats.mag); },
  applyPap() { const inv = this.inv; inv.pap = true; const S = weaponStats(inv); inv.mag = S.mag; inv.reserve = S.reserve; this.equip(); },
  canStart(action) { return canStartWeaponAction(action, {holstered:this.holstered, swapping:this.swapping, reloading:this.reloading, meleeT:this.meleeT, grenadeT:ARMS.nade}); },
  swap(to) { if (to === this.cur || !this.slots[to] || !this.canStart('swap')) return; this.swapping = true; this.swapT = 0; this.swapTo = to; this.swapDone = false; this.reloading = false; SFX.swap(); },
  startReload() {
    const S = this.stats, inv = this.inv; if (!this.canStart('reload') || inv.mag >= S.mag || inv.reserve <= 0) return;
    this.reloading = true; this.reloadT = 0; this.reloadStage = 0; this.reloadDur = S.reload * (PL.hasPerk('quickhands') ? 0.55 : 1);
  },
  melee() { if (!this.canStart('melee') || this.meleeCd > 0) return; this.meleeT = 0; this.meleeHit = false; this.reloading = false; SFX.melee(false); },
  forwardDir(out) { const c = this.camera; out.set(0, 0, -1).applyQuaternion(c.quaternion); return out; },
  fire() {
    const S = this.stats, inv = this.inv; if (inv.mag <= 0) { if (inv.reserve > 0) this.startReload(); else if (this.semiReady) { SFX.empty(); this.semiReady = false; } return; }
    inv.mag--; const rpm = S.rpm * (PL.hasPerk('hairtrigger') ? 1.3 : 1); this.fireT = 60 / rpm; this.heat = Math.min(1, this.heat + (S.kind === 'shotgun' ? 0.5 : 0.16)); this.semiReady = false;
    this.kickZ += 0.045 * S.kick; this.kickR += 0.07 * S.kick; PL.recoil(S.kick * (0.45 + Math.random() * 0.3)); G.shots++;
    SFX.gunshot(S.kind, S.isPap); this.flashT = 0.045; this.flash.visible = true; this.flash.rotation.z = rand(TAU); this.flash.scale.setScalar(rand(0.7, 1.3) * (S.kind === 'shotgun' || S.kind === 'sniper' ? 1.5 : 1)); this.flashLight.intensity = S.kind === 'energy' || S.kind === 'nova' ? 28 : 40; this.flashLight.color.setHex(S.kind === 'energy' ? 0x5fe3ff : S.kind === 'nova' ? 0x7cff6a : 0xffb060);
    const c = this.camera; c.getWorldPosition(this.tmpV); const o = this.tmpV; const fwd = this.forwardDir(this.tmpD);
    const dmgMul = PL.hasPerk('hairtrigger') ? 1.25 : 1; const moving = PL.moving ? 1.5 : 1; const spreadDeg = S.spread * (1 + this.heat * 1.6) * moving * lerp(1, 0.3, this.ads) * (S.kind === 'shotgun' ? 1 : 1);
    this.mesh.userData.muzzle.getWorldPosition(this.tmpV2); const mz = this.tmpV2; let anyHit = false;
    for (let p = 0; p < S.pellets; p++) {
      const d = fwd.clone(); const sp = spreadDeg * Math.PI / 180; if (sp > 0) { const a = rand(TAU), r = Math.sqrt(Math.random()) * sp; const right = new THREE.Vector3(1, 0, 0).applyQuaternion(c.quaternion), up = new THREE.Vector3(0, 1, 0).applyQuaternion(c.quaternion); d.addScaledVector(right, Math.cos(a) * Math.tan(r)).addScaledVector(up, Math.sin(a) * Math.tan(r)).normalize(); }
      const zh = ZM.raycast(o.x, o.y, o.z, d.x, d.y, d.z, 120); const tm = rayMap(o.x, o.y, o.z, d.x, d.y, d.z, 120); let t = Math.min(tm, 120);
      if (zh && zh.t < tm) { t = zh.t; const px = o.x + d.x * t, py = o.y + d.y * t, pz = o.z + d.z * t; const dmg = S.dmg * dmgMul * (zh.head ? S.headMul : 1); ZM.damage(zh.z, dmg, zh.head, px, py, pz, d, 'bullet'); anyHit = true; if (S.kind === 'nova') this.novaSplash(px, py, pz, S, zh.z); }
      else if (t < 120) { const px = o.x + d.x * t, py = o.y + d.y * t, pz = o.z + d.z * t; if (S.kind === 'nova') this.novaSplash(px, py, pz, S, null); else FX.sparks(px, py, pz, -d.x, -d.y, -d.z); }
      FX.tracer(mz.x, mz.y, mz.z, o.x + d.x * t, o.y + d.y * t, o.z + d.z * t, S.tracer, S.kind === 'nova' ? 0.06 : S.kind === 'energy' ? 0.03 : 0.014, S.kind === 'nova' ? 0.12 : 0.06);
    }
    if (anyHit) G.hits++;
    HUD.ammo(inv.mag, inv.reserve, S.mag);
    if (inv.mag === 0 && inv.reserve > 0) this.autoReload = 0.3;
  },
  novaSplash(x, y, z, S, direct) {
    FX.nova(x, y, z, S.isPap ? 1.5 : 1); const R = S.splash;
    for (const q of ZM.list) { if (!q.alive || q.dying || q === direct) continue; const d = Math.hypot(q.x - x, q.z - z); if (d < R) { const dmg = S.dmg * 0.6 * (1 - d / R) + 60; const dir = { x: (q.x - x) / (d || 1), y: 0.4, z: (q.z - z) / (d || 1) }; ZM.damage(q, dmg, false, q.x, 1.1, q.z, dir, 'splash'); } }
    SFX.explosion(Math.hypot(PL.pos.x - x, PL.pos.z - z) * 0.5);
  },
  doMelee() {
    const c = this.camera; c.getWorldPosition(this.tmpV); const o = this.tmpV; const fwd = this.forwardDir(this.tmpD); let best = null, bd = 2.1;
    for (const q of ZM.list) { if (!q.alive || q.dying) continue; const dx = q.x - o.x, dz = q.z - o.z, d = Math.hypot(dx, dz); if (d < bd) { const dot = (dx * fwd.x + dz * fwd.z) / (d || 1); if (dot > 0.6) { best = q; bd = d; } } }
    if (best) { const dmg = G.round <= 1 ? 150 : 150 + G.round * 15; ZM.damage(best, dmg, false, best.x - fwd.x * 0.3, 1.2, best.z - fwd.z * 0.3, { x: fwd.x, y: 0.2, z: fwd.z }, 'melee'); SFX.melee(true); this.kickZ += 0.03; }
  },
  update(dt) {
    const S = this.stats, inv = this.inv;
    this.fireT -= dt; this.heat = damp(this.heat, 0, 5, dt); this.meleeCd -= dt;
    if (this.flashT > 0) { this.flashT -= dt; if (this.flashT <= 0) { this.flash.visible = false; this.flashLight.intensity = 0; } }
    if (this.autoReload > 0) { this.autoReload -= dt; if (this.autoReload <= 0) this.startReload(); }
    // reload
    if (this.reloading) {
      this.reloadT += dt; const f = this.reloadT / this.reloadDur;
      if (this.reloadStage === 0 && f >= CONTACT.reloadOut) { this.reloadStage = 1; SFX.reload(0); }
      if (this.reloadStage === 1 && f >= CONTACT.reloadIn) { this.reloadStage = 2; SFX.reload(1); }
      if (this.reloadStage === 2 && f >= CONTACT.reloadBolt) { this.reloadStage = 3; SFX.reload(2); }
      if (f >= 1) { this.reloading = false; const need = S.mag - inv.mag, take = Math.min(need, inv.reserve); inv.mag += take; inv.reserve -= take; HUD.ammo(inv.mag, inv.reserve, S.mag); }
    }
    // swap
    if (this.swapping) { this.swapT += dt / 0.4; if (!this.swapDone && this.swapT >= 0.5) { this.swapDone = true; this.cur = this.swapTo; this.equip(); } if (this.swapT >= 1) this.swapping = false; }
    // melee
    if (this.meleeT >= 0) { this.meleeT += dt / 0.55; if (!this.meleeHit && this.meleeT >= CONTACT.melee) { this.meleeHit = true; this.doMelee(); } if (this.meleeT >= 1) { this.meleeT = -1; this.meleeCd = 0.25; } }
    if (G.mobile) this.touchAssist(dt);
    // firing
    if (G.state === 'playing' && (this.trigger || this.afFire) && !this.holstered && !this.reloading && !this.swapping && this.meleeT < 0 && ARMS.nade < 0 && this.fireT <= 0 && (S.auto || this.semiReady || this.afFire || G.mobile)) this.fire();
    // ads
    this.ads = damp(this.ads, this.wantAds && !this.reloading && !this.swapping && this.meleeT < 0 && ARMS.nade < 0 ? 1 : 0, 12, dt);
    this.kickZ = damp(this.kickZ, 0, 12, dt); this.kickR = damp(this.kickR, 0, 10, dt);
    // view model transform
    const vm = this.vm; const b = this.base || [0.25, -0.25, -0.55]; const adsPos = [0, -0.165, -0.42];
    let x = lerp(b[0], adsPos[0], this.ads), y = lerp(b[1], adsPos[1], this.ads), z = lerp(b[2], adsPos[2], this.ads);
    const bobA = (1 - this.ads * 0.8) * PL.bobAmt; x += Math.sin(PL.bob) * 0.012 * bobA; y += Math.abs(Math.cos(PL.bob)) * 0.01 * bobA - 0.006 * bobA;
    x += PL.swayX * 0.6 * (1 - this.ads); y += PL.swayY * 0.6 * (1 - this.ads);
    let rx = -this.kickR, ry = 0, rz = 0; z += this.kickZ;
    if (this.reloading) { const f = this.reloadT / this.reloadDur; const s = Math.sin(f * Math.PI); y -= 0.16 * s; rx -= 0.6 * s; rz += 0.3 * s; z += 0.05 * s; }
    if (this.swapping) { const s = Math.sin(this.swapT * Math.PI); y -= 0.32 * s; rx -= 0.9 * s; }
    if (this.meleeT >= 0) { const s = Math.sin(this.meleeT * Math.PI); x -= 0.2 * s; z -= 0.28 * s; ry += 0.9 * s; rz -= 0.5 * s; rx -= 0.2 * s; }
    if (this.holstered) { y -= 0.6; }
    if (ARMS.nade >= 0) { const s = Math.sin(Math.min(1, ARMS.nade / 0.78) * Math.PI); y -= 0.09 * s; rx -= 0.28 * s; }
    vm.position.set(x, y, z); vm.rotation.set(rx, ry, rz);
    if (this.mesh) { this.mesh.rotation.y = 0; }
    ARMS.update(dt);
  },
  touchAssist(dt) {
    // touch-only: soft target = zombie chest nearest the crosshair
    let best = null, bestAng = 0.085;
    if (G.state === 'playing' && !this.holstered) {
      const fwd = this.forwardDir(this.tmpD); const c = this.camera; c.getWorldPosition(this.tmpV); const o = this.tmpV;
      for (const z of ZM.list) {
        if (!z.alive || z.dying) continue;
        const scale = z.scale * (z.model ? z.model.hScale : 1);
        if (z.model?.chestBone) z.model.chestBone.getWorldPosition(ZTMP);
        else ZTMP.set(z.x, z.group.position.y + (z.crawler ? .4 : 1.1) * scale, z.z);
        const dx = ZTMP.x - o.x, dy = ZTMP.y - o.y, dz = ZTMP.z - o.z;
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz); if (d > 32 || d < 0.01) continue;
        const ang = Math.acos(clamp((dx * fwd.x + dy * fwd.y + dz * fwd.z) / d, -1, 1));
        if (ang < bestAng && rayMap(o.x, o.y, o.z, dx / d, dy / d, dz / d, d) >= d - 0.15) { bestAng = ang; best = { dx, dy, dz, d }; }
      }
    }
    this.touchTarget = best;
    if (best && (this.trigger || this.ads > 0.4)) { // subtle pull toward chest
      const ty = Math.atan2(-best.dx, -best.dz), tp = Math.asin(clamp(best.dy / best.d, -1, 1));
      const k = 1 - Math.exp(-dt * 5.5);
      PL.yaw = angleLerp(PL.yaw, ty, k * 0.35); PL.pitch = clamp(lerp(PL.pitch, tp, k * 0.3), -1.45, 1.45);
    }
    if (G.autofire && !this.holstered && !this.reloading && !this.swapping && this.meleeT < 0) { // auto-fire dwell (~100ms)
      this.afT = best ? this.afT + dt : 0; this.afFire = !!(best && this.afT > 0.1);
    } else { this.afFire = false; this.afT = 0; }
  },
};

// ---------------------------------------------------------------- first-person arms (original procedural viewmodel rig)
const ARMS = {
  nade: -1, nadeLaunched: false, built: false,
  init(vm) {
    this.vm = vm; const g = this.group = new THREE.Group(); vm.add(g);
    const sleeveMat = new THREE.MeshStandardMaterial({ color: 0x495040, roughness: 0.95 });
    const gloveMat = new THREE.MeshStandardMaterial({ color: 0x35373f, roughness: 0.8 });
    const mk = (geo, mat) => { const m = new THREE.Mesh(geo, mat); m.frustumCulled = false; return m; };
    const buildArm = (side) => {
      const upper = new THREE.Group(); g.add(upper);
      upper.add(mk(new THREE.CapsuleGeometry(0.05, 0.24, 4, 10), sleeveMat));
      const fore = new THREE.Group(); g.add(fore);
      fore.add(mk(new THREE.CapsuleGeometry(0.043, 0.22, 4, 10), sleeveMat));
      const cuff = mk(new THREE.CylinderGeometry(0.052, 0.056, 0.07, 10), gloveMat); cuff.position.y = -0.13; fore.add(cuff);
      const hand = new THREE.Group(); g.add(hand);
      const palm = mk(new THREE.BoxGeometry(0.08, 0.04, 0.115), gloveMat); hand.add(palm);
      const fingers = mk(new THREE.BoxGeometry(0.074, 0.034, 0.075), gloveMat); fingers.position.set(0, 0.012, -0.075); fingers.rotation.x = -0.55; hand.add(fingers);
      const thumb = mk(new THREE.CapsuleGeometry(0.014, 0.05, 3, 6), gloveMat); thumb.position.set(-side * 0.048, 0.004, -0.02); thumb.rotation.z = side * 1.0; hand.add(thumb);
      return { upper, fore, hand };
    };
    this.R = buildArm(1); this.L = buildArm(-1);
    const bladeMat = new THREE.MeshStandardMaterial({ color: 0xaab2bc, roughness: 0.32, metalness: 0.85 });
    const gripMat = new THREE.MeshStandardMaterial({ color: 0x1c1a16, roughness: 0.9 });
    const knife = new THREE.Group();
    const blade = mk(new THREE.BoxGeometry(0.009, 0.037, 0.24), bladeMat); blade.position.set(0, 0.03, -0.2);
    const tip = mk(new THREE.ConeGeometry(0.018, 0.075, 4), bladeMat); tip.rotation.x = -Math.PI / 2; tip.position.set(0, 0.03, -0.36); tip.scale.set(0.5, 1, 1);
    const guard = mk(new THREE.BoxGeometry(0.016, 0.06, 0.02), gripMat); guard.position.set(0, 0.02, -0.075);
    const grip = mk(new THREE.CylinderGeometry(0.017, 0.019, 0.11, 8), gripMat); grip.rotation.x = Math.PI / 2; grip.position.set(0, 0.015, 0.0);
    knife.add(blade, tip, guard, grip); knife.visible = false; this.R.hand.add(knife); this.knife = knife;
    const nade = mk(new THREE.SphereGeometry(0.055, 10, 10), new THREE.MeshStandardMaterial({ color: 0x2f3a2a, roughness: 0.6, metalness: 0.4 }));
    nade.position.set(0, 0.05, -0.02); nade.visible = false; this.L.hand.add(nade); this.nadeMesh = nade;
    const mag = mk(new THREE.BoxGeometry(0.032, 0.1, 0.052), new THREE.MeshStandardMaterial({ color: 0x14161c, roughness: 0.5, metalness: 0.3 }));
    mag.position.set(0, 0.06, -0.02); mag.visible = false; this.L.hand.add(mag); this.magMesh = mag;
    this.tmpA = new THREE.Vector3(); this.tmpB = new THREE.Vector3(); this.upNeg = new THREE.Vector3(0, -1, 0);
    this.RS = new THREE.Vector3(.26, -.3, .34); this.LS = new THREE.Vector3(-.26, -.3, .34);
    this.rw = new THREE.Vector3(); this.lw = new THREE.Vector3(); this.re = new THREE.Vector3(); this.le = new THREE.Vector3();
    this.rEnd = new THREE.Vector3(); this.lEnd = new THREE.Vector3();
    this.rPole = new THREE.Vector3(.7, -.65, .45); this.lPole = new THREE.Vector3(-.7, -.65, .45);
    this.built = true;
  },
  startNade() { if (this.nade >= 0 || !this.built) return false; this.nade = 0; this.nadeLaunched = false; return true; },
  place(grp, from, to, restLength) {
    grp.position.copy(from).lerp(to, .5); this.tmpA.copy(to).sub(from);
    const length = this.tmpA.length(); grp.scale.y = length / restLength;
    grp.quaternion.setFromUnitVectors(this.upNeg, this.tmpA.divideScalar(Math.max(length, 1e-6)));
  },
  update(dt) {
    if (!this.built || !this.vm.visible) return;
    const kind = WPN.stats.kind;
    // --- base wrist anchors (vm local; gun at origin pointing -Z)
    const RW = { x: 0.015, y: -0.028, z: 0.03 }, RH = { x: 0.42, y: 0.1, z: -0.15 };
    const LW2 = { x: -0.015, y: -0.05, z: -0.21 }, LH2 = { x: 0.9, y: 0, z: 0.35 };
    const LWP = { x: -0.055, y: -0.06, z: 0.08 }, LHP = { x: 0.35, y: 0.45, z: 0.6 };
    let rw = { ...RW }, rh = { ...RH };
    let lw = kind === 'pistol' ? { ...LWP } : { ...LW2 }, lh = kind === 'pistol' ? { ...LHP } : { ...LH2 };
    // --- reload: left hand mag-swap path
    const rl = WPN.reloading ? clamp(WPN.reloadT / WPN.reloadDur, 0, 1) : -1;
    this.magMesh.visible = rl >= 0 && rl > 0.18 && rl < 0.8;
    if (rl >= 0) {
      const magwell = kind === 'pistol' ? { x: 0.0, y: -0.17, z: 0.06 } : { x: 0.0, y: -0.16, z: -0.06 };
      const belt = { x: -0.16, y: -0.38, z: 0.2 };
      const keys = [[0, lw], [0.18, magwell], [0.42, belt], [0.62, belt], [0.78, magwell], [0.9, kind === 'pistol' ? magwell : { x: -0.03, y: -0.1, z: -0.16 }], [1, kind === 'pistol' ? { ...LWP } : { ...LW2 }]];
      lw = sampleKeys(keys, rl); lh = { x: 0.6, y: 0, z: 0.3 };
    }
    // --- melee: right hand knife slash
    const ml = WPN.meleeT;
    this.knife.visible = ml >= 0;
    if (ml >= 0) {
      const keys = [[0, { ...RW }], [0.2, { x: 0.2, y: -0.18, z: 0.14 }], [0.42, { x: -0.24, y: -0.02, z: -0.18 }], [0.62, { x: -0.1, y: -0.04, z: -0.12 }], [1, { ...RW }]];
      rw = sampleKeys(keys, ml);
      const hkeys = [[0, { ...RH }], [0.2, { x: 0.2, y: -0.5, z: -1.2 }], [0.42, { x: 0.3, y: 0.9, z: 0.9 }], [0.62, { x: 0.35, y: 0.3, z: 0 }], [1, { ...RH }]];
      rh = sampleKeys(hkeys, ml);
    }
    // --- grenade: left hand windup + throw
    if (this.nade >= 0) {
      this.nade += dt; const nd = clamp(this.nade / 0.78, 0, 1);
      if (!this.nadeLaunched && nd >= CONTACT.grenade) { this.nadeLaunched = true; GRENADES.launch(); }
      if (nd >= 1) this.nade = -1;
      this.nadeMesh.visible = nd < CONTACT.grenade;
      const keys = [[0, kind === 'pistol' ? { ...LWP } : { ...LW2 }], [0.22, { x: -0.06, y: -0.2, z: 0.02 }], [0.42, { x: -0.16, y: -0.24, z: 0.22 }], [0.62, { x: -0.02, y: -0.04, z: -0.34 }], [0.8, { x: -0.03, y: -0.1, z: -0.2 }], [1, kind === 'pistol' ? { ...LWP } : { ...LW2 }]];
      lw = sampleKeys(keys, nd); lh = { x: 0.5, y: 0, z: 0.2 };
    } else this.nadeMesh.visible = false;
    // Wrist anchors stay on the weapon; an anatomical bend plane solves elbows.
    this.rw.set(rw.x, rw.y, rw.z); this.lw.set(lw.x, lw.y, lw.z);
    solveTwoBone(this.RS, this.rw, this.rPole, .36, .4, this.re, this.rEnd);
    solveTwoBone(this.LS, this.lw, this.lPole, .36, .4, this.le, this.lEnd);
    this.place(this.R.upper, this.RS, this.re, .34); this.place(this.R.fore, this.re, this.rEnd, .306);
    this.R.hand.position.copy(this.rEnd); this.R.hand.rotation.set(rh.x, rh.y, rh.z);
    this.place(this.L.upper, this.LS, this.le, .34); this.place(this.L.fore, this.le, this.lEnd, .306);
    this.L.hand.position.copy(this.lEnd); this.L.hand.rotation.set(lh.x, lh.y, lh.z);
  },
};
const sampleKeys = sampleMotion;

// ---------------------------------------------------------------- grenades
const GRENADES = {
  list: [], geo: null, mat: null,
  init(scene) { this.scene = scene; this.geo = new THREE.SphereGeometry(0.07, 10, 10); this.mat = new THREE.MeshStandardMaterial({ color: 0x2f3a2a, roughness: 0.6, metalness: 0.4 }); this.tmpV = new THREE.Vector3(); this.tmpD = new THREE.Vector3(); },
  throw() {
    if (PL.nades <= 0 || this.cd > 0 || !WPN.canStart('grenade')) return; this.cd = 0.8; WPN.reloading = false;
    if (!ARMS.startNade()) this.launch();
  },
  launch() {
    PL.nades--; HUD.nades(PL.nades); SFX.pin();
    const c = WPN.camera; c.getWorldPosition(this.tmpV); const f = WPN.forwardDir(this.tmpD);
    const m = new THREE.Mesh(this.geo, this.mat); m.position.copy(this.tmpV).addScaledVector(f, 0.5); m.position.y -= 0.15; this.scene.add(m);
    this.list.push({ m, vx: f.x * 13, vy: f.y * 13 + 3.5, vz: f.z * 13, fuse: 2.4, bounced: 0 });
  },
  update(dt) {
    this.cd = (this.cd || 0) - dt;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const gr = this.list[i]; const m = gr.m; gr.vy -= 15 * dt;
      const p = { x: m.position.x, z: m.position.z };
      if (NAV.hits(p.x + gr.vx * dt, p.z, 0.08, ANY_WALK)) { gr.vx *= -0.45; if (Math.abs(gr.vx) > 1.5) SFX.grenadeBounce(); } else p.x += gr.vx * dt;
      if (NAV.hits(p.x, p.z + gr.vz * dt, 0.08, ANY_WALK)) { gr.vz *= -0.45; if (Math.abs(gr.vz) > 1.5) SFX.grenadeBounce(); } else p.z += gr.vz * dt;
      let y = m.position.y + gr.vy * dt; if (y < 0.07) { y = 0.07; if (Math.abs(gr.vy) > 1.2) SFX.grenadeBounce(); gr.vy *= -0.4; gr.vx *= 0.7; gr.vz *= 0.7; }
      m.position.set(p.x, y, p.z); m.rotation.x += gr.vx * dt * 2; m.rotation.z += gr.vz * dt * 2;
      gr.fuse -= dt;
      if (gr.fuse <= 0) { this.explode(p.x, y, p.z); this.scene.remove(m); this.list.splice(i, 1); }
    }
  },
  explode(x, y, z) {
    FX.explosion(x, y + 0.2, z, 1); const dP = Math.hypot(PL.pos.x - x, PL.pos.z - z); SFX.explosion(dP); PL.shakeCam(clamp(1.4 - dP * 0.1, 0.2, 1.2));
    for (const q of ZM.list) { if (!q.alive || q.dying) continue; const d = Math.hypot(q.x - x, q.z - z); if (d < 4.8) { const dmg = 650 * (1 - d / 4.8) + 150; const dir = { x: (q.x - x) / (d || 1), y: 0.6, z: (q.z - z) / (d || 1) }; ZM.damage(q, dmg, false, q.x, 1.0, q.z, dir, 'grenade'); } }
    if (dP < 3.2) PL.damage(Math.round(35 * (1 - dP / 3.2) + 10), x, z, true);
    for (const w of MAP.windows) { /* grenades don't damage boards */ }
  },
};

// ===== 70_player.js =====
// ---------------------------------------------------------------- perks & player
const PERKS = {
  secondwind: { name: 'SECOND WIND', tag: 'SELF-REVIVE · SOLO', cost: 500, color: '#5fe3ff', glyph: 'SW', power: false },
  ironhide: { name: 'IRONHIDE', tag: 'ARMOR · MAX HEALTH', cost: 2500, color: '#c1121f', glyph: 'IH', power: true },
  quickhands: { name: 'QUICKHANDS', tag: 'FAST RELOAD', cost: 3000, color: '#3ecf6a', glyph: 'QH', power: true },
  hairtrigger: { name: 'HAIR TRIGGER', tag: 'FIRE RATE · DAMAGE', cost: 2000, color: '#e5b53a', glyph: 'HT', power: true },
  longstride: { name: 'LONGSTRIDE', tag: 'SPRINT SPEED', cost: 2000, color: '#ff8a2a', glyph: 'LS', power: true },
};
const PL = {
  pos: { x: 0, z: 5 }, yaw: 0, pitch: 0, vel: { x: 0, z: 0 }, hp: 100, maxHp: 100, points: 500, perks: new Set(), nades: 4, alive: true, lastHit: -99, bob: 0, bobAmt: 0, stepPhase: 0, moving: false, shake: 0, recoilP: 0, recoilV: 0, swayX: 0, swayY: 0, invuln: 0, keys: {}, sens: 1, speedK: 1, deathT: 0, touchMove: null,
  init(camera) { this.camera = camera; camera.rotation.order = 'YXZ'; },
  reset() {
    this.pos.x = 0; this.pos.z = 5; this.yaw = 0; this.pitch = 0; this.vel.x = this.vel.z = 0; this.hp = this.maxHp = 100; this.points = 500; this.perks.clear(); this.nades = 4; this.alive = true; this.lastHit = -99; this.shake = 0; this.recoilP = 0; this.invuln = 0; this.deathT = 0; this.keys = {}; this.recoilV = 0; this.bob = this.bobAmt = this.stepPhase = 0; this.swayX = this.swayY = 0;
    HUD.points(this.points); HUD.perks(this.perks); HUD.nades(this.nades); HUD.hp(this.hp, this.maxHp);
  },
  hasPerk(id) { return this.perks.has(id); },
  look(dx, dy) { if (!this.alive) return; const k = 0.0021 * this.sens * lerp(1, 0.6, WPN.ads); this.yaw -= dx * k; this.pitch = clamp(this.pitch - dy * k, -1.45, 1.45); this.swayX = clamp(this.swayX - dx * 0.00025, -0.03, 0.03); this.swayY = clamp(this.swayY + dy * 0.00025, -0.03, 0.03); },
  recoil(k) { this.recoilV += k * 0.9; },
  shakeCam(k) { this.shake = Math.min(1.5, this.shake + (G.reducedMotion ? k * 0.12 : k)); },
  addPoints(n, popup = true) { if (G.doublepts > 0) n *= 2; this.points += n; G.ptsEarned += Math.max(0, n); HUD.points(this.points); if (popup) HUD.popup(n); },
  spend(n) { if (this.points < n) { SFX.deny(); HUD.hint('NOT ENOUGH POINTS'); HUD.msg(`NEED ${fmt(n - this.points)} MORE POINTS`, '#ff5a5a'); return false; } this.points -= n; HUD.points(this.points); HUD.popup(-n); return true; },
  damage(amount, fx, fz, self = false) {
    if (!this.alive || this.invuln > 0 || G.state !== 'playing') return;
    this.hp -= amount; this.lastHit = G.time; SFX.hurt(); HUD.flash(); this.shakeCam(0.5);
    if (fx !== undefined) HUD.dmgDir(Math.atan2(fx - this.pos.x, fz - this.pos.z), this.yaw);
    if (this.hp <= 0) this.down();
    HUD.hp(Math.max(0, Math.round(this.hp)), this.maxHp);
  },
  down() {
    if (this.perks.has('secondwind')) {
      this.perks.clear(); this.maxHp = 100; this.hp = 100; this.invuln = 3; HUD.perks(this.perks); HUD.msg('SECOND WIND', '#5fe3ff'); SFX.perk(); ZM.pushAway(this.pos.x, this.pos.z, 6, 3.5); FX.burst(this.pos.x, 1.2, this.pos.z, 60, 0x5fe3ff, 6, 0.12, 0.8, 0.2, true); FX.light(this.pos.x, 1.6, this.pos.z, 0x5fe3ff, 1400, 0.5, 14); return;
    }
    this.hp = 0; this.alive = false; this.deathT = 0; SFX.death(); onPlayerDeath();
  },
  update(dt) {
    const c = this.camera; const k = this.keys;
    if (!this.alive) {
      this.deathT += dt; const f = Math.min(1, this.deathT / 1.6); const e = f * f;
      c.position.set(this.pos.x, lerp(1.7, 0.35, e), this.pos.z); c.rotation.set(this.pitch * (1 - e) + e * 0.35, this.yaw, e * 1.1); return;
    }
    this.invuln = Math.max(0, this.invuln - dt);
    // movement
    let fx = 0, fz = 0; if (k.KeyW || k.ArrowUp) fz += 1; if (k.KeyS || k.ArrowDown) fz -= 1; if (k.KeyD) fx += 1; if (k.KeyA) fx -= 1;
    let mag = 1; const tm = this.touchMove;
    if (tm && (Math.abs(tm.x) > 0.05 || Math.abs(tm.y) > 0.05)) { fx = tm.x; fz = tm.y; mag = clamp(Math.hypot(fx, fz), 0, 1); }
    const L = Math.hypot(fx, fz); if (L > 0) { fx /= L; fz /= L; }
    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    const wx = (-sy) * fz + cy * fx, wz = (-cy) * fz + (-sy) * fx;
    const sprint = ((k.ShiftLeft || k.ShiftRight) || (tm && tm.y > 0.88) || (tm && tm.sprint)) && fz > 0.5 && !WPN.wantAds && !WPN.reloading;
    const speed = 4.6 * mag * (sprint ? (this.perks.has('longstride') ? 1.6 : 1.4) : 1) * lerp(1, 0.55, WPN.ads) * (WPN.reloading ? 0.92 : 1);
    const tx = wx * speed, tz = wz * speed; const a = 1 - Math.exp(-dt * 11); this.vel.x += (tx - this.vel.x) * a; this.vel.z += (tz - this.vel.z) * a;
    const beforeX = this.pos.x, beforeZ = this.pos.z;
    NAV.move(this.pos, this.vel.x * dt, this.vel.z * dt, 0.38, P_WALK);
    const v = Math.hypot(this.pos.x - beforeX, this.pos.z - beforeZ) / Math.max(dt, 1e-5); this.moving = v > 0.6; this.sprinting = sprint && this.moving;
    const bobRate = sprint ? 11 : 8.2; if (v > 0.3) this.bob += dt * bobRate * clamp(v / 4.6, 0.4, 1.6); this.bobAmt = damp(this.bobAmt, G.reducedMotion ? 0 : clamp(v / 4.6, 0, 1.3), 8, dt);
    // footsteps
    const ph = Math.floor(this.bob / Math.PI); if (ph !== this.stepPhase) { this.stepPhase = ph; if (v > 1) SFX.footstep(sprint); }
    // regen
    if (G.time - this.lastHit > 3.6 && this.hp < this.maxHp) { this.hp = Math.min(this.maxHp, this.hp + dt * 55); HUD.hp(Math.round(this.hp), this.maxHp); }
    // camera
    this.recoilP += this.recoilV * dt * 8; this.recoilV = damp(this.recoilV, 0, 18, dt); this.recoilP = damp(this.recoilP, 0, 7, dt);
    this.shake = damp(this.shake, 0, 6, dt); this.swayX = damp(this.swayX, 0, 8, dt); this.swayY = damp(this.swayY, 0, 8, dt);
    const sh = this.shake * 0.03; const t = G.time * 37;
    const bobY = Math.abs(Math.sin(this.bob)) * 0.045 * this.bobAmt * (1 - WPN.ads * 0.7), bobX = Math.cos(this.bob * 0.5) * 0.02 * this.bobAmt * (1 - WPN.ads * 0.7);
    c.position.set(this.pos.x + bobX * cy + Math.sin(t) * sh, 1.7 + bobY + Math.sin(t * 1.3) * sh, this.pos.z - bobX * sy + Math.cos(t * 0.7) * sh);
    c.rotation.set(this.pitch + this.recoilP * 0.02 + Math.sin(t * 1.7) * sh * 0.5, this.yaw + Math.cos(t * 1.1) * sh * 0.5, Math.sin(this.bob * 0.5) * 0.004 * this.bobAmt + (fx * (G.reducedMotion ? 0 : -0.012)) + Math.sin(t * 0.9) * sh * 0.4);
    SFX.listener.x = this.pos.x; SFX.listener.z = this.pos.z; SFX.listener.yaw = this.yaw;
  },
};

// ===== 80_hud.js =====
// ---------------------------------------------------------------- HUD (DOM)
const HUD = {
  el: {}, lastPoints: null, lastAmmo: '', heartT: 0, hintT: 0,
  init() { for (const id of ['hud', 'vignette', 'blood', 'flash', 'dmgdir', 'xh', 'hm', 'lowammo', 'pups', 'killn', 'bannerbig', 'bannersub', 'msg', 'prompt', 'popups', 'perks', 'points', 'round', 'wname', 'mag', 'res', 'nades', 'hp', 'slots', 'hint', 'fallbacktip']) this.el[id] = $(id); this.el.hpLbl = $('hp'); this.el.tbUse = document.body.classList.contains('mobile') ? $('tbUse') : null; },
  show() { this.el.hud.classList.add('on'); }, hide() { this.el.hud.classList.remove('on'); },
  points(v) { if (v === this.lastPoints) return; this.lastPoints = v; this.el.points.innerHTML = `${fmt(v)}<small>PTS</small>`; },
  popup(n) { const d = document.createElement('div'); d.className = 'pop' + (n < 0 ? ' neg' : ''); d.textContent = (n > 0 ? '+' : '') + fmt(n); d.style.left = (10 + Math.random() * 60) + 'px'; this.el.popups.appendChild(d); setTimeout(() => d.remove(), 1000); },
  round(n) {
    const r = this.el.round; let html = '';
    if (n <= 5) {
      const w = 26 * n + 16; html = `<svg viewBox="0 0 ${w} 120" height="110" xmlns="http://www.w3.org/2000/svg">`;
      for (let i = 0; i < Math.min(n, 4); i++) { const x = 16 + i * 26; html += `<path d="M ${x + rand(-2, 2)} ${10 + rand(0, 6)} L ${x + rand(-3, 3)} ${108 + rand(-4, 4)}" stroke="#c1121f" stroke-width="${rand(8, 11)}" stroke-linecap="round" fill="none"/>`; }
      if (n === 5) html += `<path d="M 4 ${100 + rand(-4, 4)} L ${w - 4} ${18 + rand(-4, 4)}" stroke="#c1121f" stroke-width="9" stroke-linecap="round" fill="none"/>`;
      html += '</svg>';
    } else html = `<div class="num">${n}</div>`;
    r.innerHTML = html; r.classList.remove('change'); void r.offsetWidth; r.classList.add('change');
  },
  ammo(mag, res, magMax) { const key = mag + '/' + res; if (key === this.lastAmmo) return; this.lastAmmo = key; this.el.mag.textContent = mag; this.el.res.textContent = res; this.el.mag.className = mag === 0 ? 'empty' : mag <= Math.max(1, Math.floor(magMax * 0.25)) ? 'low' : ''; this.el.lowammo.classList.toggle('on', mag === 0 && res > 0); if (mag === 0 && res === 0) { this.el.lowammo.textContent = 'NO AMMO'; this.el.lowammo.classList.add('on'); } else this.el.lowammo.textContent = 'RELOAD'; },
  weapon(name, pap) { this.el.wname.textContent = name; this.el.wname.classList.toggle('pap', !!pap); },
  slots(cur, slots) { this.el.slots.innerHTML = slots.map((s, i) => `<span class="${i === cur ? 'on' : ''}" style="${s ? '' : 'opacity:.25'}"></span>`).join(''); },
  nades(n) { this.el.nades.textContent = n; },
  hp(hp, max) { this.el.hpLbl.textContent = hp; $('healthFill').style.transform = `scaleX(${clamp(hp / max, 0, 1)})`; $('healthTrack').classList.toggle('critical', hp / max < 0.5); const f = 1 - hp / max; this.el.vignette.style.opacity = f > 0.15 ? (f - 0.15) * 1.4 : 0; this.el.blood.style.opacity = f > 0.5 ? (f - 0.5) * 1.6 : 0; },
  perks(set) { this.el.perks.innerHTML = [...set].map((id) => { const P = PERKS[id]; return `<div class="perk" style="--c:${P.color}" title="${P.name}">${P.glyph}</div>`; }).join(''); },
  prompt(html, progress) { const p = this.el.prompt; const use = this.el.tbUse; const actionable = !!html && html.includes('<kbd>'); if (use) { use.classList.toggle('hidden', !actionable); use.classList.toggle('pulse', actionable); } if (!html) { p.classList.remove('on'); return; } const full = html + (progress !== undefined ? `<span class="bar"><i style="width:${Math.round(progress * 100)}%"></i></span>` : ''); if (p.innerHTML !== full) p.innerHTML = full; p.classList.add('on'); },
  banner(big, sub) { const b = this.el.bannerbig, s = this.el.bannersub; b.textContent = big; s.textContent = sub || ''; for (const e of [b, s]) { e.classList.remove('show'); void e.offsetWidth; e.classList.add('show'); } },
  msg(text, color = '#e5b53a') { const m = this.el.msg; m.textContent = text; m.style.color = color; m.style.textShadow = `0 0 24px ${color}99, 0 3px 3px #000`; m.classList.remove('show'); void m.offsetWidth; m.classList.add('show'); },
  hint(text) { this.el.hint.textContent = text; this.hintT = 1.6; },
  hitmarker(kill) { const h = this.el.hm; h.classList.toggle('kill', !!kill); h.classList.remove('show'); void h.offsetWidth; h.classList.add('show'); },
  flash() { const f = this.el.flash; f.style.transition = 'none'; f.style.opacity = 1; requestAnimationFrame(() => { f.style.transition = 'opacity .45s'; f.style.opacity = 0; }); },
  dmgDir(worldAngle, yaw) { const rel = angleWrap(worldAngle - yaw - Math.PI); const d = this.el.dmgdir; d.style.transform = `rotate(${-rel}rad)`; d.style.transition = 'none'; d.style.opacity = 1; requestAnimationFrame(() => { d.style.transition = 'opacity .8s'; d.style.opacity = 0; }); },
  crosshair(spread, ads) { this.el.xh.style.setProperty('--gap', (5 + spread * 22) + 'px'); this.el.xh.classList.toggle('ads', ads > 0.5); },
  kills(n) { this.el.killn.textContent = n; },
  pups(list) { // [{name,color,t,max}]
    const html = list.map((p) => `<div class="pup ${p.t < 5 ? 'ending' : ''}" style="--c:${p.color}"><b>${p.name}</b><i><b style="width:${Math.round(100 * p.t / p.max)}%"></b></i></div>`).join('');
    if (this.el.pups.innerHTML !== html) this.el.pups.innerHTML = html;
  },
  fallbackTip(text) { const t = this.el.fallbacktip; if (!text) { t.classList.add('hidden'); return; } t.textContent = text; t.classList.remove('hidden'); },
  update(dt) { if (this.hintT > 0) { this.hintT -= dt; if (this.hintT <= 0) this.el.hint.textContent = ''; } updateCombatHUD(dt); },
};

// ===== 90_main.js =====
// ---------------------------------------------------------------- main
const G = { state: 'loading', round: 0, kills: 0, headshots: 0, shots: 0, hits: 0, ptsEarned: 0, time: 0, instakill: 0, doublepts: 0, roundState: 'idle', roundTimer: 0, fallback: false, bloom: true, slowmo: 1, flash: 0, dyingT: 0, flowT: 0, lockFails: 0, mobile: false };
const QS = new URLSearchParams(location.search);
function detectMobile() { if (QS.get('mobile') === '1') return true; if (QS.get('desktop') === '1') return false; const coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches; const touch = ('ontouchstart' in window) || navigator.maxTouchPoints > 0; return (coarse && touch) || (touch && Math.min(window.innerWidth, window.innerHeight) < 600); }
let scene, camera, renderer, composer, bloomPass, gradePass, hemi, moon, canvas, lastT = 0, menuT = 0, baseFov = 82, heartT = 0, powerAnim = -1;

class LayerRenderPass extends RenderPass {
  constructor(scene, camera, layer) { super(scene, camera); this.layer = layer; this.clear = false; this.clearDepth = true; }
  render(r, w, rb, dt, m) { const old = this.camera.layers.mask, bg = this.scene.background, fog = this.scene.fog; this.scene.background = null; this.scene.fog = null; this.camera.layers.set(this.layer); super.render(r, w, rb, dt, m); this.camera.layers.mask = old; this.scene.background = bg; this.scene.fog = fog; }
}
const GradeShader = {
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uDamage: { value: 0 }, uFlash: { value: 0 }, uAberr: { value: 0.25 }, uInsta: { value: 0 } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `uniform sampler2D tDiffuse; uniform float uTime, uDamage, uFlash, uAberr, uInsta; varying vec2 vUv;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
    void main(){ vec2 uv = vUv; vec2 c = uv - 0.5; float r = length(c);
      float ab = uAberr * (0.0015 + r*r*0.014) * (1.0 + uDamage*2.0);
      vec3 col; col.r = texture2D(tDiffuse, uv + c*ab).r; col.g = texture2D(tDiffuse, uv).g; col.b = texture2D(tDiffuse, uv - c*ab).b;
      float vig = 1.0 - smoothstep(0.28, 0.78, r); col *= mix(0.72, 1.0, vig);
      float g = (hash(uv * (1.0 + fract(uTime))) - 0.5) * 0.012; col += g;
      float lum = dot(col, vec3(0.3, 0.59, 0.11));
      col = mix(col, vec3(lum) * vec3(1.0, 0.25, 0.2) + vec3(0.12, 0.0, 0.0) * (1.0 - vig), uDamage * 0.85);
      col = mix(col, col * vec3(1.15, 0.9, 0.9) + vec3(0.05, 0.0, 0.0), uInsta * 0.6);
      col += vec3(1.0, 0.9, 0.8) * uFlash;
      gl_FragColor = vec4(col, 1.0); }`,
};

// ---------------------------------------------------------------- power-ups
const PU = {
  defs: { maxammo: { name: 'MAX AMMO', color: '#e5b53a', hex: 0xe5b53a, w: 30 }, doublepts: { name: 'DOUBLE POINTS', color: '#5fe3ff', hex: 0x5fe3ff, w: 26 }, instakill: { name: 'INSTA-KILL', color: '#ff4a4a', hex: 0xff4a4a, w: 26 }, nuke: { name: 'NUKE', color: '#7cff6a', hex: 0x7cff6a, w: 12 }, carpenter: { name: 'CARPENTER', color: '#ffb347', hex: 0xffb347, w: 9 } },
  list: [], dropped: 0, lastRound: 0,
  init(scene) { this.scene = scene; this.geo = new THREE.IcosahedronGeometry(0.22, 0); this.labels = {}; },
  clear() { for (const p of this.list) this.scene.remove(p.g); this.list = []; this.dropped = 0; },
  maybeDrop(x, z) {
    if (G.round !== this.lastRound) { this.lastRound = G.round; this.dropped = 0; }
    if (this.dropped >= 4) return; const chance = 0.028 + (this.dropped === 0 ? 0.012 : 0);
    if (Math.random() < chance) { const type = weighted(Object.keys(this.defs).map((k) => ({ w: this.defs[k].w, k }))).k; this.spawn(type, x, z); this.dropped++; }
  },
  spawn(type, x, z) {
    const D = this.defs[type]; const g = new THREE.Group(); g.position.set(x, 0, z);
    const m = new THREE.Mesh(this.geo, new THREE.MeshStandardMaterial({ color: 0x111111, emissive: D.hex, emissiveIntensity: 1.8, metalness: 0.6, roughness: 0.3 })); m.position.y = 1.0; g.add(m);
    if (!this.labels[type]) this.labels[type] = texLabel(D.name, D.color);
    const lbl = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.labels[type], transparent: true, depthWrite: false })); lbl.scale.set(1.7, 0.53, 1); lbl.position.y = 1.75; g.add(lbl);
    this.scene.add(g); this.list.push({ type, g, m, life: 30, x, z });
  },
  update(dt) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i]; p.life -= dt; p.m.rotation.y += dt * 2; p.m.rotation.x += dt * 0.7; p.m.position.y = 1.0 + Math.sin(G.time * 3) * 0.12; p.m.material.emissiveIntensity = 1.8 + Math.sin(G.time * 5) * 0.6;
      if (p.life < 8) p.g.visible = Math.sin(G.time * (p.life < 3 ? 25 : 10)) > 0;
      if (p.life <= 0) { this.scene.remove(p.g); this.list.splice(i, 1); continue; }
      if (PL.alive && Math.hypot(PL.pos.x - p.x, PL.pos.z - p.z) < 1.35) { this.collect(p.type); this.scene.remove(p.g); this.list.splice(i, 1); }
    }
    if (G.instakill > 0) G.instakill -= dt; if (G.doublepts > 0) G.doublepts -= dt;
    const active = []; if (G.instakill > 0) active.push({ name: 'INSTA-KILL', color: '#ff4a4a', t: G.instakill, max: 30 }); if (G.doublepts > 0) active.push({ name: 'DOUBLE POINTS', color: '#5fe3ff', t: G.doublepts, max: 30 });
    HUD.pups(active);
  },
  collect(type) {
    const D = this.defs[type]; SFX.powerup(type); HUD.msg(D.name, D.color); FX.burst(PL.pos.x, 1.2, PL.pos.z, 30, D.hex, 4, 0.1, 0.7, 0.2, true);
    switch (type) {
      case 'maxammo': WPN.maxAmmo(); PL.nades = 4; HUD.nades(4); break;
      case 'doublepts': G.doublepts = 30; break;
      case 'instakill': G.instakill = 30; break;
      case 'nuke': ZM.killAll('nuke'); PL.addPoints(400); FX.light(PL.pos.x, 2, PL.pos.z, 0xffffff, 4000, 0.7, 40); PL.shakeCam(1.2); G.flash = 1.0; break;
      case 'carpenter': for (const w of MAP.windows) while (w.boards < 6) windowAddBoard(w); PL.addPoints(200); break;
    }
  },
};

// ---------------------------------------------------------------- interactions
const IT = {
  cur: null, fHeld: false, repairT: 0,
  update(dt) {
    if (G.state !== 'playing' || !PL.alive) { HUD.prompt(null); return; }
    let best = null, bd = 1e9; const fwdx = -Math.sin(PL.yaw), fwdz = -Math.cos(PL.yaw);
    for (const it of MAP.interactables) {
      const dx = it.x - PL.pos.x, dz = it.z - PL.pos.z, d = Math.hypot(dx, dz); if (d > it.r) continue;
      const dot = (dx * fwdx + dz * fwdz) / (d || 1); if (d > 0.7 && dot < 0.1) continue;
      if (it.kind === 'door' && it.door.open) continue; if (it.kind === 'window' && it.win.boards >= 6) continue; if (it.kind === 'power' && MAP.powerOn) continue;
      const score = d - dot * 0.6; if (score < bd) { bd = score; best = it; }
    }
    this.cur = best; if (!best) { HUD.prompt(null); this.repairT = 0; return; }
    const kbd = G.mobile ? '<kbd>TAP</kbd>' : '<kbd>F</kbd>', cost = (n) => `<span class="cost${PL.points < n ? ' no' : ''}">${fmt(n)}</span>`;
    switch (best.kind) {
      case 'wall': { const W = WEAPONS[best.weapon], own = WPN.owns(best.weapon); if (own >= 0) { const inv = WPN.slots[own], S = weaponStats(inv); HUD.prompt(inv.reserve >= S.reserve ? `${W.name} <span class="no">— AMMO FULL</span>` : `${kbd}AMMO · ${S.name} ${cost(inv.pap ? W.cost * 2.5 : W.cost / 2)}`); } else HUD.prompt(`${kbd}BUY ${W.name} ${cost(W.cost)}`); break; }
      case 'door': HUD.prompt(`${kbd}${best.door.style === 'gate' ? 'OPEN GATE' : 'CLEAR DEBRIS'} · ${MAP.zones[best.door.to].name} ${cost(best.door.cost)}`); break;
      case 'perk': { const P = PERKS[best.perk]; if (P.power && !MAP.powerOn) HUD.prompt(`${P.name} <span class="no">— NO POWER</span>`); else if (PL.hasPerk(best.perk)) HUD.prompt(`${P.name} <span class="no">— ACTIVE</span>`); else HUD.prompt(`${kbd}BUY ${P.name} · ${P.tag} ${cost(P.cost)}`); break; }
      case 'box': { const b = MAP.box; if (b.state === 'idle') HUD.prompt(`${kbd}MYSTERY BOX ${cost(950)}`); else if (b.state === 'ready') HUD.prompt(`${kbd}TAKE ${WEAPONS[b.weapon].name}`, 1 - b.t / 10); else HUD.prompt(null); break; }
      case 'pap': { const p = MAP.pap; if (!MAP.powerOn) HUD.prompt(`PACK-A-PUNCH <span class="no">— NO POWER</span>`); else if (p.state === 'idle') HUD.prompt(WPN.inv.pap ? `${WPN.stats.name} <span class="no">— ALREADY UPGRADED</span>` : `${kbd}PACK-A-PUNCH · ${WPN.stats.name} ${cost(5000)}`); else if (p.state === 'ready') HUD.prompt(`${kbd}TAKE <span style="color:var(--violet)">${WEAPONS[p.inv.id].pap.name}</span>`); else HUD.prompt(null); break; }
      case 'power': HUD.prompt(`${kbd}ACTIVATE MAIN POWER`); break;
      case 'window': HUD.prompt(`${kbd}HOLD · REPAIR BARRICADE <span class="cost">+10</span>`, this.repairT / 0.7); break;
    }
    if (best.kind === 'window' && this.fHeld) { this.repairT += dt; if (this.repairT >= 0.7) { this.repairT = 0; if (windowAddBoard(best.win)) PL.addPoints(10); } } else this.repairT = 0;
  },
  press() {
    const it = this.cur; if (!it || G.state !== 'playing') return;
    switch (it.kind) {
      case 'wall': {
        const W = WEAPONS[it.weapon], own = WPN.owns(it.weapon);
        if (own >= 0) { const inv = WPN.slots[own], S = weaponStats(inv); if (inv.reserve >= S.reserve) { SFX.deny(); HUD.hint('AMMO FULL'); return; } if (PL.spend(inv.pap ? W.cost * 2.5 : W.cost / 2)) { inv.reserve = S.reserve; SFX.purchase(); if (own === WPN.cur) HUD.ammo(inv.mag, inv.reserve, S.mag); } }
        else if (PL.spend(W.cost)) { WPN.give(it.weapon); SFX.purchase(); }
        break;
      }
      case 'door': if (PL.spend(it.door.cost)) { openDoor(it.door); SFX.purchase(); G.flowT = 0; HUD.msg(MAP.zones[it.door.to].name + ' UNLOCKED', '#e9e4da'); } break;
      case 'perk': {
        const P = PERKS[it.perk]; if (P.power && !MAP.powerOn) { SFX.deny(); HUD.hint('POWER REQUIRED'); return; } if (PL.hasPerk(it.perk)) { SFX.deny(); return; } if (PL.perks.size >= 4) { SFX.deny(); HUD.hint('PERK LIMIT REACHED'); return; }
        if (PL.spend(P.cost)) { PL.perks.add(it.perk); if (it.perk === 'ironhide') { PL.maxHp = 200; PL.hp = 200; HUD.hp(200, 200); } HUD.perks(PL.perks); SFX.perk(); HUD.msg(P.name, P.color); FX.burst(it.x, 1.3, it.z, 24, parseInt(P.color.slice(1), 16), 3, 0.08, 0.6, 0.2, true); }
        break;
      }
      case 'box': { const b = MAP.box; if (b.state === 'idle') { if (PL.spend(950)) startBox(); } else if (b.state === 'ready') takeBox(); break; }
      case 'pap': { const p = MAP.pap; if (!MAP.powerOn) { SFX.deny(); HUD.hint('POWER REQUIRED'); return; } if (p.state === 'idle') { if (WPN.inv.pap) { SFX.deny(); return; } if (PL.spend(5000)) startPap(); } else if (p.state === 'ready') takePap(); break; }
      case 'power': if (!MAP.powerOn) { turnOnPower(); powerAnim = 0; hemi.intensity = 2.1; HUD.msg('POWER RESTORED', '#e9e4da'); } break;
    }
  },
};
// ---- mystery box
function pickBoxWeapon() { const pool = BOX_POOL.filter((w) => WPN.owns(w.id) < 0); return weighted(pool.map((w) => ({ w: w.boxW, id: w.id }))).id; }
function setDisplay(target, id, pap) { if (target.display) target.holder.remove(target.display); target.display = buildGunMesh(WEAPONS[id].kind, pap, id); target.display.scale.setScalar(1.7); target.display.rotation.set(0, Math.PI / 2, 0); target.holder.add(target.display); }
function startBox() { const b = MAP.box; b.state = 'rolling'; b.t = 0; b.tick = 0; b.weapon = pickBoxWeapon(); SFX.boxOpen(); }
function closeBox() { const b = MAP.box; b.state = 'closing'; b.t = 0; if (b.display) { b.holder.remove(b.display); b.display = null; } }
function takeBox() { const b = MAP.box; WPN.give(b.weapon); SFX.purchase(); HUD.msg(WEAPONS[b.weapon].name, '#5fe3ff'); closeBox(); }
function updateBox(dt) {
  const b = MAP.box; if (b.state === 'idle') return; b.t += dt;
  if (b.state === 'rolling') {
    b.lid.rotation.x = -Math.min(1, b.t / 0.6) * 1.9; b.holder.position.y = 1.0 + Math.min(1, b.t / 0.8) * 0.9; b.tick -= dt;
    if (b.tick <= 0 && b.t < 4) { b.tick = 0.1 + b.t * 0.07; setDisplay(b, choice(BOX_POOL).id, false); SFX.boxTick(); b.light.intensity = 180; }
    b.light.intensity = damp(b.light.intensity, 70, 8, dt);
    if (b.t >= 4.3) { b.state = 'ready'; b.t = 0; setDisplay(b, b.weapon, false); SFX.boxDone(); FX.burst(b.x, 2, b.z, 30, 0x5fe3ff, 3, 0.08, 0.6, 0.1, true); }
  } else if (b.state === 'ready') { b.holder.rotation.y += dt * 1.3; b.holder.position.y = 1.9 + Math.sin(G.time * 2) * 0.05; if (b.t >= 10) closeBox(); }
  else if (b.state === 'closing') { b.lid.rotation.x = -Math.max(0, 1 - b.t / 0.5) * 1.9; if (b.t >= 0.6) b.state = 'idle'; }
}
// ---- pack-a-punch
function startPap() { const p = MAP.pap; p.state = 'working'; p.t = 0; p.swapped = false; p.inv = WPN.inv; p.slot = WPN.cur; WPN.holstered = true; WPN.trigger = false; SFX.papStart(); setDisplay(p, p.inv.id, false); p.holder.position.z = 0.7; p.display.visible = true; }
function takePap() {
  const p = MAP.pap; p.state = 'idle'; if (p.display) { p.holder.remove(p.display); p.display = null; }
  p.inv.pap = true; const S = weaponStats(p.inv); p.inv.mag = S.mag; p.inv.reserve = S.reserve; WPN.holstered = false; WPN.cur = p.slot; WPN.equip(); SFX.purchase(); HUD.msg(S.name, '#b06cff');
}
function updatePap(dt) {
  const p = MAP.pap; if (p.state === 'idle') return; p.t += dt;
  if (p.state === 'working') {
    if (p.t < 0.8) { p.holder.position.z = lerp(0.7, -0.3, p.t / 0.8); }
    else if (p.t < 3.2) { if (p.display) p.display.visible = false; if (Math.random() < dt * 8) FX.burst(p.x + rand(-0.6, 0.6), rand(0.6, 1.9), p.z - 0.55, 4, 0xb06cff, 2.5, 0.05, 0.4, 0.3, true); p.light.intensity = 60 + Math.random() * 160; }
    else { if (!p.swapped) { p.swapped = true; setDisplay(p, p.inv.id, true); } p.holder.position.z = lerp(-0.3, 0.75, Math.min(1, (p.t - 3.2) / 0.6)); if (p.t >= 3.9) { p.state = 'ready'; p.t = 0; SFX.papDone(); FX.burst(p.x, 1.4, p.z - 0.9, 50, 0xb06cff, 4, 0.1, 0.8, 0.2, true); } }
  } else if (p.state === 'ready') { p.holder.rotation.y = Math.sin(G.time * 1.5) * 0.35; if (p.t >= 15) takePap(); }
}

// ---------------------------------------------------------------- game flow
function resetWorld() {
  clearInputs(); ARMS.nade = -1; ARMS.nadeLaunched = false;
  for (const d of MAP.doors) { d.open = false; d.anim = 0; d.group.visible = true; d.group.position.y = 0; d.group.rotation.z = 0; NAV.fillRect(d.x1, d.z1, d.x2, d.z2, 0); MAP.zones[d.to].open = false; }
  for (const w of MAP.windows) { w.boards = 6; for (const p of w.planks) { p.visible = true; p.userData.fall = undefined; p.userData.rise = undefined; p.position.set(0, p.userData.home.y, p.userData.home.z); p.rotation.set(0, 0, p.userData.home.rz); } }
  MAP.powerOn = false; MAP.powerSwitch.done = false; MAP.powerSwitch.lever.rotation.x = 0.9; MAP.powerSwitch.lampMat.emissive.setHex(0xff2020); MAP.powerSwitch.lampMat.color.setHex(0x300000); powerAnim = -1; hemi.intensity = 2.1;
  for (const e of MAP.lights) if (e.mode === 'power') { e.warm = 0; e.light.intensity = 0; if (e.tube) e.tube.material.emissiveIntensity = 0; }
  for (const pm of MAP.perkMachines) { pm.warm = 0; pm.panelMat.emissiveIntensity = 0; pm.stripMat.emissiveIntensity = 0; pm.light.intensity = 0; }
  const pap = MAP.pap; pap.warm = 0; pap.glowMat.emissiveIntensity = 0; pap.labelMat.emissiveIntensity = 0; pap.light.intensity = 0; pap.state = 'idle'; if (pap.display) { pap.holder.remove(pap.display); pap.display = null; }
  const b = MAP.box; b.state = 'idle'; b.lid.rotation.x = 0; if (b.display) { b.holder.remove(b.display); b.display = null; }
  ZM.reset(); PU.clear(); for (const g of GRENADES.list) scene.remove(g.m); GRENADES.list = [];
  for (const d of FX.decals) { d.life = 0; d.m.visible = false; }
  G.kills = 0; G.headshots = 0; G.shots = 0; G.hits = 0; G.ptsEarned = 0; G.time = 0; G.instakill = 0; G.doublepts = 0; G.round = 0; G.roundState = 'idle'; G.flash = 0; G.dyingT = 0;
  HUD.kills(0); HUD.pups([]); HUD.prompt(null);
  PL.reset(); WPN.reset();
}
function startGame() {
  resetWorld(); G.state = 'playing'; document.body.classList.remove('menu'); WPN.vm.visible = true;
  $('menu').classList.add('hidden'); $('death').classList.add('hidden'); $('pause').classList.add('hidden'); HUD.show();
  G.roundState = 'intermission'; G.roundTimer = 2.2; HUD.round(1); HUD.el.round.classList.remove('change');
  NAV.computeFlow(PL.pos.x, PL.pos.z);
  const best = Store.get('best', { round: 0, kills: 0, runs: 0 }); best.runs++; Store.set('best', best);
}
function startRound(n) {
  G.round = n; G.roundState = 'active'; ZM.startRound(n); HUD.round(n);
  HUD.banner(`ROUND ${n}`, n === 1 ? 'THEY COME AT NIGHT' : n % 5 === 0 ? 'THE HORDE GROWS' : choice(['HOLD THE LINE', 'NO ONE IS COMING', 'BOARD THE WINDOWS', 'KEEP MOVING', 'WATCH YOUR BACK']));
  SFX.roundStart();
}
function updateRound(dt) {
  if (G.roundState === 'active') { if (ZM.spawned >= ZM.toSpawn && ZM.alive() === 0) { G.roundState = 'intermission'; G.roundTimer = 7; SFX.roundEnd(); } }
  else if (G.roundState === 'intermission') { G.roundTimer -= dt; if (G.roundTimer <= 0) startRound(G.round + 1); }
}
function onPlayerDeath() { clearInputs(); G.state = 'dying'; G.dyingT = 0; WPN.trigger = false; WPN.wantAds = false; HUD.prompt(null); }
function showDeath() {
  G.state = 'dead'; HUD.hide(); $('touch').classList.add('hidden'); PL.touchMove = null; if (document.pointerLockElement) document.exitPointerLock();
  const best = Store.get('best', { round: 0, kills: 0, runs: 0 }); const newBest = G.round > best.round;
  if (newBest) best.round = G.round; if (G.kills > best.kills) best.kills = G.kills; Store.set('best', best);
  $('dRound').textContent = G.round; $('dKills').textContent = G.kills; $('dHead').textContent = G.headshots; $('dAcc').textContent = (G.shots ? Math.round(100 * G.hits / G.shots) : 0) + '%'; $('dPts').textContent = fmt(G.ptsEarned);
  $('newbest').classList.toggle('hidden', !newBest); $('cause').textContent = choice(['THE DEAD TOOK BUNKER 09', 'OVERRUN IN ' + (MAP.zoneAt(PL.pos.x, PL.pos.z) ? MAP.zones[MAP.zoneAt(PL.pos.x, PL.pos.z)].name : 'THE DARK'), 'NO ONE HEARD THE SIGNAL', 'THEY ALWAYS COME BACK']);
  $('death').classList.remove('hidden'); document.body.classList.add('menu'); refreshMenuStats();
}
function toMenu() { clearInputs(); SFX.resume(); G.state = 'menu'; HUD.hide(); $('touch').classList.add('hidden'); PL.touchMove = null; if (document.pointerLockElement) document.exitPointerLock(); $('death').classList.add('hidden'); $('pause').classList.add('hidden'); $('menu').classList.remove('hidden'); document.body.classList.add('menu'); WPN.vm.visible = false; resetWorld(); refreshMenuStats(); }
function pauseGame() { if (G.state !== 'playing') return; clearInputs(); if (SFX.ctx?.state === 'running') SFX.ctx.suspend().catch(() => {}); G.state = 'paused'; $('pause').classList.remove('hidden'); document.body.classList.add('menu'); WPN.trigger = false; WPN.wantAds = false; PL.keys = {}; IT.fHeld = false; PL.touchMove = null; $('touch').classList.add('hidden'); }
function resumeNow() { if (G.state !== 'paused') return; if (G.mobile && innerHeight > innerWidth * 1.05) return; clearInputs(); SFX.resume(); G.state = 'playing'; $('pause').classList.add('hidden'); document.body.classList.remove('menu'); lastT = performance.now(); if (G.mobile) $('touch').classList.remove('hidden'); }
function refreshMenuStats() { const b = Store.get('best', { round: 0, kills: 0, runs: 0 }); $('bestround').textContent = b.round || '—'; $('bestkills').textContent = b.kills || '—'; $('runs').textContent = b.runs || '—'; }

// ---- pointer lock
function enableFallback() { if (G.fallback) return; G.fallback = true; HUD.fallbackTip('MOUSE LOCK UNAVAILABLE IN THIS FRAME · MOVE THE MOUSE OVER THE GAME TO LOOK · ESC PAUSES · OPEN IN A NEW TAB FOR FULL MOUSE CAPTURE'); if (G.state === 'paused') resumeNow(); }
function requestLock(onFail) {
  if (G.fallback) { onFail(); return; }
  let settled = false; const fail = () => { if (!settled) { settled = true; onFail(); } };
  try { const p = canvas.requestPointerLock({ unadjustedMovement: true }); if (p && p.catch) p.catch(() => { try { const q = canvas.requestPointerLock(); if (q && q.catch) q.catch(fail); } catch (e) { fail(); } }); } catch (e) { try { const q = canvas.requestPointerLock(); if (q && q.catch) q.catch(fail); } catch (e2) { fail(); } }
  setTimeout(() => { if (document.pointerLockElement !== canvas) fail(); else settled = true; }, 900);
}
function deploy() {
  if (!['menu', 'dead'].includes(G.state)) return;
  try { SFX.init(); SFX.resume(); } catch (e) { SFX.enabled = false; }
  startGame();
  if (G.mobile) { G.fallback = true; $('touch').classList.remove('hidden'); requestFullscreen(); return; }
  requestLock(() => { enableFallback(); });
}
function resumeGame() {
  SFX.resume();
  if (G.fallback) { resumeNow(); return; }
  requestLock(() => { G.lockFails++; if (G.lockFails >= 2) enableFallback(); else $('btnResume').textContent = 'CLICK AGAIN TO RESUME'; });
}

// ---------------------------------------------------------------- touch controls (mobile)
function bindTouch() {
  const stick = $('stick'), knob = $('stickKnob'), moveZone = $('moveZone'), lookZone = $('lookZone');
  let moveId = null, lookId = null, fireId = null, ox = 0, oy = 0, lx = 0, ly = 0; const R = 56;
  const setStick = (dx, dy) => { const d = Math.hypot(dx, dy); const k = d > R ? R / d : 1; knob.style.transform = `translate(${dx * k}px,${dy * k}px)`;
    const nx = (dx * k) / R, ny = -(dy * k) / R; const m = Math.hypot(nx, ny);
    const DZ = 0.12; let mm = m < DZ ? 0 : (m - DZ) / (1 - DZ); mm *= mm; // dead-zone + quadratic response
    const a = Math.atan2(ny, nx);
    PL.touchMove = mm <= 0 ? null : { x: Math.cos(a) * mm, y: Math.sin(a) * mm, sprint: m >= 0.985 && ny > 0.4 }; };
  const touchLook = (dx, dy) => {
    const k = 2.4 * (WPN.wantAds ? 0.6 : 1); // split sensitivity: slower while ADS
    if (WPN.touchTarget && (WPN.trigger || WPN.ads > 0.4)) { dx *= 0.72; dy *= 0.72; } // aim-assist friction over target
    PL.look(dx * k, dy * k);
  };
  moveZone.addEventListener('pointerdown', (e) => { if (moveId !== null || G.state !== 'playing') return; moveId = e.pointerId; ox = e.clientX; oy = e.clientY; stick.style.left = ox + 'px'; stick.style.top = oy + 'px'; stick.classList.add('on'); setStick(0, 0); try { moveZone.setPointerCapture(e.pointerId); } catch (_) {} e.preventDefault(); });
  moveZone.addEventListener('pointermove', (e) => { if (e.pointerId !== moveId || G.state !== 'playing') return; setStick(e.clientX - ox, e.clientY - oy); e.preventDefault(); });
  const endMove = (e) => { if (e.pointerId !== moveId) return; moveId = null; PL.touchMove = null; stick.classList.remove('on'); };
  moveZone.addEventListener('pointerup', endMove); moveZone.addEventListener('pointercancel', endMove); moveZone.addEventListener('lostpointercapture', endMove);
  lookZone.addEventListener('pointerdown', (e) => { if (lookId !== null || G.state !== 'playing') return; lookId = e.pointerId; lx = e.clientX; ly = e.clientY; try { lookZone.setPointerCapture(e.pointerId); } catch (_) {} e.preventDefault(); });
  lookZone.addEventListener('pointermove', (e) => { if (e.pointerId !== lookId || G.state !== 'playing') return; const dx = e.clientX - lx, dy = e.clientY - ly; lx = e.clientX; ly = e.clientY; touchLook(dx, dy); e.preventDefault(); });
  const endLook = (e) => { if (e.pointerId !== lookId) return; lookId = null; };
  lookZone.addEventListener('pointerup', endLook); lookZone.addEventListener('pointercancel', endLook); lookZone.addEventListener('lostpointercapture', endLook);
  const hold = (id, down, up) => {
    const el = $(id); let active = null;
    el.addEventListener('pointerdown', e => {
      if (G.state !== 'playing' || (active !== null && el.hasPointerCapture?.(active))) return;
      active = e.pointerId; e.preventDefault(); e.stopPropagation(); down(e);
      try { el.setPointerCapture(e.pointerId); } catch (_) {}
    });
    const release = e => { if (e.pointerId !== active) return; active = null; up?.(e); };
    for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) el.addEventListener(name, release);
    el.addEventListener('contextmenu', e => e.preventDefault());
  };
  { const fb = $('tbFire'); let fpx = 0, fpy = 0;
    hold('tbFire', (e) => { if (G.state === 'playing') { WPN.trigger = true; WPN.semiReady = true; fireId = e.pointerId; fpx = e.clientX; fpy = e.clientY; } }, () => { WPN.trigger = false; WPN.semiReady = true; fireId = null; });
    fb.addEventListener('pointermove', (e) => { if (e.pointerId !== fireId || G.state !== 'playing') return; const dx = e.clientX - fpx, dy = e.clientY - fpy; fpx = e.clientX; fpy = e.clientY; touchLook(dx * 0.8, dy * 0.8); e.preventDefault(); }); }
  hold('tbAim', () => { if (G.state !== 'playing') return; WPN.wantAds = !WPN.wantAds; $('tbAim').classList.toggle('on', WPN.wantAds); });
  hold('tbReload', () => { if (G.state === 'playing') WPN.startReload(); });
  hold('tbNade', () => { if (G.state === 'playing') GRENADES.throw(); });
  hold('tbKnife', () => { if (G.state === 'playing') WPN.melee(); });
  hold('tbSwap', () => { if (G.state === 'playing') WPN.swap(1 - WPN.cur); });
  hold('tbPause', () => { if (G.state === 'playing') pauseGame(); });
  hold('tbUse', () => { if (G.state === 'playing') { IT.fHeld = true; IT.press(); } }, () => { IT.fHeld = false; });
  const pr = $('prompt'); pr.addEventListener('pointerdown', (e) => { if (G.state !== 'playing') return; e.preventDefault(); e.stopPropagation(); IT.fHeld = true; IT.press(); try { pr.setPointerCapture(e.pointerId); } catch (_) { /* optional */ } }); const pu = () => { IT.fHeld = false; }; pr.addEventListener('pointerup', pu); pr.addEventListener('pointercancel', pu); pr.addEventListener('lostpointercapture', pu);
  const clearTouch = () => { moveId = null; lookId = null; fireId = null; stick.classList.remove('on'); };
  G.clearTouch = clearTouch;
  document.addEventListener('visibilitychange', () => { if (document.hidden) clearInputs(); });
  window.addEventListener('blur', clearInputs);
  const orient = () => { const portrait = window.innerHeight > window.innerWidth * 1.05; $('rotate').classList.toggle('hidden', !portrait); if (portrait && G.state === 'playing') pauseGame(); };
  window.addEventListener('resize', orient); orient();
  document.addEventListener('touchmove', (e) => { if (e.touches.length > 1) e.preventDefault(); }, { passive: false });
}
function updateAssetsLabel() {
  const ready = MODELS.ready.length > 0;
  const finished = MODELS.progress.done >= MODELS.progress.total;
  const text = ready ? 'BUNKER 09 · READY TO DEPLOY' : finished ? 'LOW-DATA MODE · READY TO DEPLOY' : 'PREPARING THE HORDE…';
  if ($('assets').textContent !== text) $('assets').textContent = text;
  if ($('loadDetail')) $('loadDetail').textContent = ready ? 'Preparing weapons…' : 'Opening Bunker 09…';
}

// ---------------------------------------------------------------- mobile presentation and rendering budget
function clearInputs() {
  PL.keys = {}; PL.touchMove = null;
  WPN.trigger = false; WPN.wantAds = false; WPN.semiReady = true;
  WPN.afFire = false; WPN.afT = 0; WPN.touchTarget = null;
  IT.fHeld = false; G.clearTouch?.();
  $('tbAim')?.classList.remove('on');
}
function requestFullscreen() {
  const root = document.documentElement;
  if (!root.requestFullscreen || document.fullscreenElement) return;
  root.requestFullscreen().then(() => screen.orientation?.lock?.('landscape')).catch(() => {});
}
const Resolution = {
  mode: 'auto', ratio: 1, elapsed: 0, frames: 0, slow: 0, fast: 0,
  set(mode) {
    this.mode = ['auto', 'fast', 'balanced', 'high'].includes(mode) ? mode : 'auto';
    const ceiling = Math.min(devicePixelRatio || 1, this.mode === 'high' ? 1.75 : this.mode === 'fast' ? 0.85 : G.mobile ? 1.25 : 1.5);
    this.ratio = this.mode === 'balanced' ? Math.min(1.15, ceiling) : ceiling;
    this.elapsed = this.frames = this.slow = this.fast = 0;
    this.apply();
  },
  apply() {
    renderer.setPixelRatio(this.ratio); composer.setPixelRatio(this.ratio); onResize();
    document.body.classList.toggle('battery-saver', this.mode === 'fast');
  },
  sample(ms) {
    if (this.mode !== 'auto' || !Number.isFinite(ms) || ms <= 0 || ms > 250) return;
    this.elapsed += ms; this.frames++;
    if (this.elapsed < 2000) return;
    const fps = this.frames * 1000 / this.elapsed;
    this.slow = fps < 48 ? this.slow + 1 : 0;
    this.fast = fps > 58 ? this.fast + 1 : 0;
    const min = Math.min(devicePixelRatio || 1, G.mobile ? 0.7 : 0.85);
    const max = Math.min(devicePixelRatio || 1, G.mobile ? 1.25 : 1.5);
    const next = this.slow >= 2 ? Math.max(min, this.ratio - 0.15) : this.fast >= 4 ? Math.min(max, this.ratio + 0.1) : this.ratio;
    if (next !== this.ratio) { this.ratio = next; this.apply(); this.slow = this.fast = 0; }
    this.elapsed = this.frames = 0;
  },
};
// Lights stay allocated: changing the visible light count would recompile every
// material. Only the strongest nearby sources occupy the fixed world-light pool.
const LightBudget = {
  sources: [], slots: [],
  init() {
    MAP.group.updateMatrixWorld(true);
    MAP.group.traverse(o => {
      if (!o.isPointLight) return;
      this.sources.push({ light: o, pos: o.getWorldPosition(new THREE.Vector3()), score: 0 });
      o.visible = false;
    });
    for (let i = 0; i < (G.mobile ? 8 : 12); i++) {
      const light = new THREE.PointLight(0xffffff, 0, 16, 2);
      scene.add(light); this.slots.push({ light, source: null });
    }
  },
  update(dt) {
    const p = camera.position;
    for (const s of this.sources) s.score = s.light.intensity / (4 + s.pos.distanceToSquared(p));
    const chosen = this.sources.slice().sort((a, b) => b.score - a.score).slice(0, this.slots.length);
    const pending = chosen.filter(s => !this.slots.some(slot => slot.source === s));
    for (const slot of this.slots) {
      if (!chosen.includes(slot.source)) {
        slot.light.intensity = damp(slot.light.intensity, 0, 12, dt);
        if (slot.light.intensity < 0.5) {
          slot.source = pending.shift() || null;
          if (slot.source) slot.light.position.copy(slot.source.pos);
        }
      } else {
        const source = slot.source.light;
        slot.light.color.copy(source.color); slot.light.distance = source.distance;
        slot.light.decay = source.decay;
        slot.light.intensity = damp(slot.light.intensity, source.intensity, 18, dt);
      }
    }
  },
};
let dust;
function buildAtmosphere() {
  // Soft contact occlusion grounds existing furniture without mobile shadow maps.
  const occlusion = makeCanvas(64, 64), x = occlusion.getContext('2d');
  const grad = x.createRadialGradient(32, 32, 5, 32, 32, 32);
  grad.addColorStop(0, 'rgba(0,0,0,.55)'); grad.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = grad; x.fillRect(0, 0, 64, 64);
  const shadowTex = new THREE.CanvasTexture(occlusion);
  const bases = MAP.solids.filter(s => s.y1 < 0.7 && s.x2 - s.x1 < 6 && s.z2 - s.z1 < 7 && s.y2 > 0.7);
  const shadows = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 }), bases.length);
  const dummy = new THREE.Object3D();
  bases.forEach((s, i) => {
    dummy.position.set((s.x1 + s.x2) / 2, 0.014, (s.z1 + s.z2) / 2);
    dummy.rotation.set(-Math.PI / 2, 0, 0); dummy.scale.set((s.x2 - s.x1) * 1.6, (s.z2 - s.z1) * 1.6, 1);
    dummy.updateMatrix(); shadows.setMatrixAt(i, dummy.matrix);
  });
  shadows.instanceMatrix.needsUpdate = true; MAP.group.add(shadows);
  // Faint fixture shafts add depth; inexpensive transparent geometry, no raymarch.
  for (const entry of MAP.lights.filter(e => e.bulb && e.mode === 'steady')) {
    const mat = new THREE.ShaderMaterial({
      uniforms: { color: { value: entry.light.color.clone() } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      vertexShader: 'varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
      fragmentShader: 'uniform vec3 color; varying vec2 vUv; void main(){float fade=sin(vUv.y*3.14159);gl_FragColor=vec4(color,0.018*fade*fade);}',
    });
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 1.0, 3.2, 12, 1, true), mat);
    shaft.position.copy(entry.light.position); shaft.position.y -= 1.5; MAP.group.add(shaft);
  }
  const count = G.mobile ? 90 : 180;
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) { positions[i * 3] = rand(-13, 29); positions[i * 3 + 1] = rand(0.2, 4); positions[i * 3 + 2] = rand(-9, 9); }
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  dust = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xbad7de, size: 0.024, transparent: true, opacity: 0.25, depthWrite: false, sizeAttenuation: true }));
  scene.add(dust);
}
function updateAtmosphere(dt) {
  if (!dust) return;
  dust.visible = Resolution.mode !== 'fast';
  if (!dust.visible || G.reducedMotion) return;
  const positions = dust.geometry.attributes.position;
  for (let i = 0; i < positions.count; i++) {
    let y = positions.getY(i) + dt * (0.016 + (i % 5) * 0.005);
    positions.setY(i, y > 4 ? 0.2 : y);
  }
  positions.needsUpdate = true;
}
let hudRefresh = 0;
function updateCombatHUD(dt) {
  const loading = WPN.reloading && G.state === 'playing';
  $('reloadStatus').classList.toggle('hidden', !loading);
  if (loading) $('reloadFill').style.transform = `scaleX(${clamp(WPN.reloadT / WPN.reloadDur, 0, 1)})`;
  $('tbReload').classList.toggle('on', loading);
  hudRefresh -= dt; if (hudRefresh > 0) return; hudRefresh = 0.12;
  const zone = MAP.zones[MAP.zoneAt(PL.pos.x, PL.pos.z)];
  $('zoneName').textContent = zone?.name || 'BUNKER 09';
  const left = Math.max(0, ZM.toSpawn - ZM.spawned) + ZM.alive();
  const intermission = G.roundState === 'intermission';
  $('waveStatus').textContent = intermission ? (G.round ? `ROUND CLEAR · NEXT IN ${Math.ceil(Math.max(0, G.roundTimer))}s` : 'PREPARE YOUR DEFENSE') : `${left} ${left === 1 ? 'HOSTILE' : 'HOSTILES'} REMAINING`;
  const progress = intermission ? (G.round ? 1 - G.roundTimer / 7 : 0) : (ZM.toSpawn ? 1 - left / ZM.toSpawn : 0);
  $('waveFill').style.transform = `scaleX(${clamp(progress, 0, 1)})`;
  $('mission').classList.toggle('intermission', intermission);
  $('tbNade').disabled = PL.nades <= 0 || ARMS.nade >= 0;
  $('tbSwap').disabled = !WPN.slots[1 - WPN.cur] || WPN.holstered;
  $('tbReload').disabled = !loading && (WPN.inv.reserve <= 0 || WPN.inv.mag >= WPN.stats.mag);
  const firstRun = Store.get('best', {}).runs <= 1;
  $('fieldTip').textContent = firstRun && G.time < 16 ? (G.mobile ? 'LEFT THUMB TO MOVE · HOLD FIRE AND DRAG TO AIM' : 'WASD TO MOVE · AIM FOR THE HEAD · F TO INTERACT') : '';
}
function bindPolishUI() {
  G.reducedMotion = Store.get('reducedMotion', matchMedia('(prefers-reduced-motion: reduce)').matches);
  const syncMotion = () => {
    document.body.classList.toggle('reduced-motion', G.reducedMotion);
    for (const id of ['motion', 'motion2']) { $(id).textContent = G.reducedMotion ? 'ON' : 'OFF'; $(id).classList.toggle('on', G.reducedMotion); $(id).setAttribute('aria-pressed', String(G.reducedMotion)); }
  };
  for (const id of ['motion', 'motion2']) $(id).onclick = () => { G.reducedMotion = !G.reducedMotion; Store.set('reducedMotion', G.reducedMotion); syncMotion(); };
  syncMotion();
  Resolution.set(Store.get('quality', 'auto'));
  for (const id of ['quality', 'quality2']) {
    $(id).value = Resolution.mode;
    $(id).onchange = () => { Resolution.set($(id).value); Store.set('quality', Resolution.mode); $('quality').value = $('quality2').value = Resolution.mode; };
  }
  for (const el of document.querySelectorAll('.tog')) {
    el.setAttribute('aria-pressed', String(el.classList.contains('on')));
    el.addEventListener('click', () => el.setAttribute('aria-pressed', String(el.classList.contains('on'))));
  }
  for (const [id, name] of Object.entries({tbFire:'Fire; drag to aim',tbAim:'Toggle aiming',tbReload:'Reload weapon',tbKnife:'Melee attack',tbNade:'Throw grenade',tbSwap:'Switch weapon',tbPause:'Pause game'})) $(id).setAttribute('aria-label', name);
  $('btnControls').setAttribute('aria-expanded', 'false');
  $('btnControls').addEventListener('click', () => $('btnControls').setAttribute('aria-expanded', String(!$('controls').classList.contains('hidden'))));
  canvas.addEventListener('webglcontextlost', e => {
    e.preventDefault(); pauseGame(); $('loading').classList.remove('hidden');
    $('loading').innerHTML = '<div class="load-panel"><strong>DISPLAY INTERRUPTED</strong><p>Your progress records are saved. Reload to start a new run.</p><button class="btn primary" id="reloadGame">RELOAD GAME</button></div>';
    $('reloadGame').onclick = () => location.reload();
  });
}

// ---------------------------------------------------------------- init
async function init() {
  try { await Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 2500))]); } catch (e) { /* ignore */ }
  buildTextures();
  G.mobile = detectMobile(); if (G.mobile) document.body.classList.add('mobile');
  canvas = $('gl');
  renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, G.mobile ? 1.25 : 1.5)); renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.18;
  scene = new THREE.Scene(); scene.background = new THREE.Color(0x04060a); scene.fog = new THREE.FogExp2(0x05070b, 0.031);
  camera = new THREE.PerspectiveCamera(baseFov, window.innerWidth / window.innerHeight, 0.04, G.mobile ? 70 : 90); scene.add(camera);
  hemi = new THREE.HemisphereLight(0x3a4a60, 0x1a1410, 2.1); scene.add(hemi);
  moon = new THREE.DirectionalLight(0x6f86b8, 0.9); moon.position.set(-8, 20, 6); scene.add(moon);
  GUNS.init(); MODELS.init();
  const characters = MODELS.loadAll(G.mobile);
  const sidearm = GUNS.load('sidearm');
  await Promise.race([Promise.all([characters, sidearm]), new Promise(resolve => setTimeout(resolve, 6000))]);
  buildMap(scene); FX.init(scene); ZM.init(scene); GRENADES.init(scene); PU.init(scene); WPN.init(camera); PL.init(camera); HUD.init();
  buildAtmosphere(); LightBudget.init();
  scene.traverse((o) => { if (o.isLight) o.layers.enable(1); });
  GUNS.loadAll();
  composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(new LayerRenderPass(scene, camera, 1));
  bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.5, 0.4, 1.0); composer.addPass(bloomPass);
  composer.addPass(new OutputPass());
  gradePass = new ShaderPass(GradeShader); composer.addPass(gradePass);
  onResize(); window.addEventListener('resize', onResize);
  bindUI(); bindPolishUI(); bindInput(); if (G.mobile) bindTouch();
  WPN.reset(); WPN.vm.visible = false; refreshMenuStats();
  G.state = 'menu'; $('loading').classList.add('hidden'); $('btnPlay').disabled = false;
  requestAnimationFrame(loop);
}
function onResize() {
  const w = window.innerWidth, h = window.innerHeight; renderer.setSize(w, h); composer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix();
  FX.setScale(h * renderer.getPixelRatio(), camera.fov);
}
function bindUI() {
  $('btnPlay').addEventListener('click', deploy);
  $('btnAgain').addEventListener('click', deploy);
  $('btnMenu').addEventListener('click', toMenu);
  $('btnResume').addEventListener('click', resumeGame);
  $('btnQuit').addEventListener('click', toMenu);
  $('btnControls').addEventListener('click', () => $('controls').classList.toggle('hidden'));
  const sens = Store.get('sens', 1), fov = Store.get('fov', 82), bloom = Store.get('bloom', !G.mobile), audio = Store.get('audio', true);
  PL.sens = sens; baseFov = fov; G.bloom = bloom; SFX.enabled = audio;
  for (const id of ['sens', 'sens2']) { const el = $(id); el.value = sens; el.addEventListener('input', () => { PL.sens = +el.value; Store.set('sens', PL.sens); $(id === 'sens' ? 'sens2' : 'sens').value = el.value; }); }
  for (const id of ['fov', 'fov2']) { const el = $(id); el.value = fov; el.addEventListener('input', () => { baseFov = +el.value; Store.set('fov', baseFov); $(id === 'fov' ? 'fov2' : 'fov').value = el.value; }); }
  const tb = $('togBloom'); tb.classList.toggle('on', bloom); tb.textContent = bloom ? 'ON' : 'OFF'; tb.addEventListener('click', () => { G.bloom = !G.bloom; Store.set('bloom', G.bloom); tb.classList.toggle('on', G.bloom); tb.textContent = G.bloom ? 'ON' : 'OFF'; });
  G.autofire = Store.get('autofire', false);
  const tga = $('togAuto'); tga.classList.toggle('on', G.autofire); tga.textContent = G.autofire ? 'ON' : 'OFF'; tga.addEventListener('click', () => { G.autofire = !G.autofire; Store.set('autofire', G.autofire); tga.classList.toggle('on', G.autofire); tga.textContent = G.autofire ? 'ON' : 'OFF'; });
  const ta = $('togAudio'); ta.classList.toggle('on', audio); ta.textContent = audio ? 'ON' : 'OFF'; ta.addEventListener('click', () => { SFX.init(); SFX.setEnabled(!SFX.enabled); Store.set('audio', SFX.enabled); ta.classList.toggle('on', SFX.enabled); ta.textContent = SFX.enabled ? 'ON' : 'OFF'; });
  if (!('onpointerlockchange' in document)) { $('notice').textContent = 'POINTER LOCK NOT SUPPORTED — MOUSE-OVER LOOK MODE WILL BE USED'; $('notice').classList.remove('hidden'); }
  if (G.mobile) { $('notice').textContent = 'TOUCH CONTROLS ON · LEFT THUMB MOVES · RIGHT THUMB LOOKS · PLAY IN LANDSCAPE'; $('notice').classList.remove('hidden'); if (document.documentElement.requestFullscreen) { $('btnFull').classList.remove('hidden'); $('btnFull').addEventListener('click', () => { document.documentElement.requestFullscreen().catch(() => {}); if (screen.orientation && screen.orientation.lock) screen.orientation.lock('landscape').catch(() => {}); }); } }
}
function bindInput() {
  document.addEventListener('pointerlockchange', () => {
    const locked = document.pointerLockElement === canvas;
    if (locked) { G.lockFails = 0; $('btnResume').textContent = 'RESUME'; if (G.state === 'paused') resumeNow(); }
    else if (G.state === 'playing' && !G.fallback) pauseGame();
  });
  document.addEventListener('pointerlockerror', () => { if (G.state === 'playing') enableFallback(); });
  document.addEventListener('keydown', (e) => {
    if (G.state === 'playing') {
      PL.keys[e.code] = true;
      switch (e.code) {
        case 'KeyR': WPN.startReload(); break;
        case 'KeyF': if (!IT.fHeld) { IT.fHeld = true; IT.press(); } break;
        case 'KeyG': GRENADES.throw(); break;
        case 'KeyV': WPN.melee(); break;
        case 'Digit1': WPN.swap(0); break;
        case 'Digit2': WPN.swap(1); break;
        case 'KeyQ': WPN.swap(1 - WPN.cur); break;
        case 'Escape': if (G.fallback) pauseGame(); break;
      }
      if (e.code === 'Space' || e.code === 'Tab' || e.code.startsWith('Arrow')) e.preventDefault();
    } else if (G.state === 'paused' && e.code === 'Escape' && G.fallback) resumeNow();
  });
  document.addEventListener('keyup', (e) => { PL.keys[e.code] = false; if (e.code === 'KeyF') IT.fHeld = false; });
  canvas.addEventListener('mousedown', (e) => { if (G.state !== 'playing' || G.mobile) return; if (e.button === 0) { WPN.trigger = true; WPN.semiReady = true; } else if (e.button === 2) WPN.wantAds = true; e.preventDefault(); });
  document.addEventListener('mouseup', (e) => { if (e.button === 0) { WPN.trigger = false; WPN.semiReady = true; } else if (e.button === 2) WPN.wantAds = false; });
  document.addEventListener('contextmenu', (e) => e.preventDefault());
  document.addEventListener('mousemove', (e) => { if (G.state !== 'playing' || G.mobile) return; if (document.pointerLockElement === canvas || G.fallback) PL.look(e.movementX || 0, e.movementY || 0); });
  canvas.addEventListener('wheel', (e) => { if (G.state === 'playing') { WPN.swap(1 - WPN.cur); e.preventDefault(); } }, { passive: false });
  document.addEventListener('visibilitychange', () => { if (document.hidden && G.state === 'playing') pauseGame(); });
  window.addEventListener('blur', () => { if (G.state === 'playing') pauseGame(); });
}

// ---------------------------------------------------------------- loop
let lastRenderT = 0;
function loop(t) {
  requestAnimationFrame(loop);
  if (document.hidden) { lastT = t; return; }
  if (['menu', 'dead', 'paused'].includes(G.state) && t - lastRenderT < 1000 / 30) return;
  const frameMs = t - lastRenderT; lastRenderT = t;
  if (G.state === 'playing') Resolution.sample(frameMs);
  tick(t, true);
}
function tick(t, doRender = true) {
  let dt = (t - lastT) / 1000; lastT = t; if (!(dt > 0) || dt > 0.1) dt = 0.016;
  bloomPass.enabled = G.bloom;
  if (G.state === 'menu' || G.state === 'dead' || G.state === 'loading') {
    menuT += G.reducedMotion ? 0 : dt; camera.position.set(-3 + Math.sin(menuT * 0.13) * 3, 1.9 + Math.sin(menuT * 0.21) * 0.1, 4 + Math.cos(menuT * 0.1) * 2); camera.lookAt(2 + Math.sin(menuT * 0.07) * 5, 1.4, -6);
    camera.fov = 70; camera.updateProjectionMatrix(); updateMapLights(dt, menuT); LightBudget.update(dt); updateAtmosphere(dt); FX.update(dt); updateAssetsLabel();
    gradePass.uniforms.uTime.value = menuT; gradePass.uniforms.uDamage.value = 0; gradePass.uniforms.uFlash.value = 0; gradePass.uniforms.uInsta.value = 0;
    if (doRender) composer.render(); return;
  }
  if (G.state === 'paused') { if (doRender) composer.render(); return; }
  G.time += dt;
  PL.update(dt); WPN.update(dt); GRENADES.update(dt);
  if (G.state === 'playing') {
    updateRound(dt);
    G.flowT -= dt; if (G.flowT <= 0) { NAV.computeFlow(PL.pos.x, PL.pos.z); G.flowT = 0.25; }
    if (G.mobile && ZM.maxAlive > 16) ZM.maxAlive = 16;
    ZM.update(dt, G.time); PU.update(dt); IT.update(dt); updateBox(dt); updatePap(dt);
  } else if (G.state === 'dying') { ZM.update(dt, G.time); G.dyingT += dt; if (G.dyingT > 2.6) showDeath(); }
  if (powerAnim >= 0) { powerAnim += dt; MAP.powerSwitch.lever.rotation.x = lerp(0.9, -0.9, Math.min(1, powerAnim / 0.4)); hemi.intensity = lerp(2.1, 2.35, Math.min(1, powerAnim / 3)); if (powerAnim > 3) powerAnim = -1; }
  updateMapLights(dt, G.time); LightBudget.update(dt); updateAtmosphere(dt); FX.update(dt); HUD.update(dt); SFX.update(dt, ZM.alive() > 0);
  // camera fov / ads
  const fov = lerp(baseFov, baseFov * 0.72, WPN.ads) * (PL.sprinting && !G.reducedMotion ? 1.04 : 1); if (Math.abs(camera.fov - fov) > 0.01) { camera.fov = fov; camera.updateProjectionMatrix(); FX.setScale(window.innerHeight * renderer.getPixelRatio(), fov); }
  // grade
  const hpF = PL.hp / PL.maxHp; const dmg = clamp((0.6 - hpF) / 0.6, 0, 1); G.flash = Math.max(0, G.flash - dt * 2.5);
  gradePass.uniforms.uTime.value = G.time; gradePass.uniforms.uDamage.value = damp(gradePass.uniforms.uDamage.value, PL.alive ? dmg * 0.9 : 1, 6, dt); gradePass.uniforms.uFlash.value = G.flash; gradePass.uniforms.uInsta.value = G.instakill > 0 ? 1 : 0;
  if (PL.alive && hpF < 0.5) { heartT -= dt; if (heartT <= 0) { SFX.heartbeat(); heartT = 0.75 + hpF * 0.9; } }
  HUD.crosshair(WPN.heat * 0.7 + (PL.moving ? 0.35 : 0) + WPN.stats.spread * 0.05, WPN.ads);
  if (doRender) composer.render();
}
function step(seconds) { const n = Math.round(seconds / 0.016); lastT = performance.now(); for (let i = 0; i < n; i++) { lastT += 16; tick(lastT, i === n - 1); } }
function probe(n = 1) {
  for (let i = 0; i < n; i++) tick(performance.now() + i * 16);
  const c = renderer.domElement, w = 96, h = 54, cc = document.createElement('canvas'); cc.width = w; cc.height = h; const x = cc.getContext('2d'); x.drawImage(c, 0, 0, w, h);
  const d = x.getImageData(0, 0, w, h).data; let sum = 0, max = 0, bright = 0; for (let i = 0; i < d.length; i += 4) { const l = (d[i] + d[i + 1] + d[i + 2]) / 3; sum += l; if (l > max) max = l; if (l > 40) bright++; }
  return { avg: +(sum / (w * h)).toFixed(2), max, brightFrac: +(bright / (w * h)).toFixed(3), calls: renderer.info.render.calls, tris: renderer.info.render.triangles, programs: renderer.info.programs.length, state: G.state, cam: camera.position.toArray().map((v) => +v.toFixed(2)), dataUrl: cc.toDataURL('image/jpeg', 0.6) };
}
window.__DL = { G, PL, WPN, ZM, MAP, NAV, FX, SFX, IT, PU, GRENADES, MODELS, GUNS, startGame, startRound, deploy, probe, tick, step, get renderer() { return renderer; }, get scene() { return scene; }, get camera() { return camera; }, get composer() { return composer; } };
init().catch(error => {
  console.error('Deadlight could not start:', error);
  $('loading').classList.remove('hidden');
  const graphics = /WebGL|context|graphics/i.test(error.message || '');
  $('loading').innerHTML = `<div class="load-panel"><strong>${graphics ? '3D GRAPHICS UNAVAILABLE' : 'CONNECTION LOST'}</strong><p>${graphics ? 'This browser could not start 3D graphics. Try a browser with hardware acceleration enabled.' : 'The bunker could not load. Check your connection and try again.'}</p><button class="btn primary" id="btnRetry">TRY AGAIN</button></div>`;
  $('btnRetry').onclick = () => location.reload();
});
