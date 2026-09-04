import * as THREE from 'three';

// Contact phases are shared by the animation player and gameplay events.
export const CONTACT = Object.freeze({attack: 0.48, attack2: 0.48, attack3: 0.51, crawlAttack: 0.5, crawlBash: 0.48, melee: 0.42, grenade: 0.62, reloadOut: 0.18, reloadIn: 0.78, reloadBolt: 0.90});
export const STRIDE = Object.freeze({walk: 1.10, walk2: 1.04, run: 2.18, run2: 1.76, crawl: 0.72});

const axis = new THREE.Vector3(), bend = new THREE.Vector3();
// Analytic two-bone IK. The pole controls the bend plane; the endpoint is
// clamped just inside reach so elbows and knees never invert at extension.
export function solveTwoBone(root, target, pole, upper, lower, joint, end) {
  axis.copy(target).sub(root);
  const distance = axis.length();
  if (distance < 1e-8) axis.set(0, 0, -1); else axis.divideScalar(distance);
  const d = THREE.MathUtils.clamp(distance, Math.abs(upper - lower) + 1e-5, upper + lower - 1e-5);
  bend.copy(pole).sub(root).addScaledVector(axis, -bend.dot(axis));
  if (bend.lengthSq() < 1e-8) {
    bend.set(Math.abs(axis.y) < 0.9 ? 0 : 1, Math.abs(axis.y) < 0.9 ? 1 : 0, 0);
    bend.addScaledVector(axis, -bend.dot(axis));
  }
  bend.normalize();
  const along = (upper * upper - lower * lower + d * d) / (2 * d);
  joint.copy(root).addScaledVector(axis, along).addScaledVector(bend, Math.sqrt(Math.max(0, upper * upper - along * along)));
  end.copy(root).addScaledVector(axis, d);
  return distance <= upper + lower;
}

// Shape-preserving cubic interpolation. Shared tangents carry velocity through
// intermediate keys; extrema and repeated poses retain intentional pauses.
export function sampleMotion(keys, phase) {
  if (phase <= keys[0][0]) return {...keys[0][1]};
  if (phase >= keys.at(-1)[0]) return {...keys.at(-1)[1]};
  let i = 0; while (keys[i + 1][0] < phase) i++;
  const [ta, a] = keys[i], [tb, b] = keys[i + 1], h = tb - ta;
  const u = (phase - ta) / h, u2 = u * u, u3 = u2 * u;
  const tangent = (j, k) => {
    if (j === 0 || j === keys.length - 1) return 0;
    const hp = keys[j][0] - keys[j - 1][0], hn = keys[j + 1][0] - keys[j][0];
    const p = (keys[j][1][k] - keys[j - 1][1][k]) / hp, n = (keys[j + 1][1][k] - keys[j][1][k]) / hn;
    if (p * n <= 0) return 0;
    const w1 = 2 * hn + hp, w2 = hn + 2 * hp;
    return (w1 + w2) / (w1 / p + w2 / n);
  };
  const out = {};
  for (const k in a) out[k] = (2 * u3 - 3 * u2 + 1) * a[k] + (u3 - 2 * u2 + u) * h * tangent(i, k) + (-2 * u3 + 3 * u2) * b[k] + (u3 - u2) * h * tangent(i + 1, k);
  return out;
}

// Reload may be interrupted; swap, knife, and grenade are exclusive hand actions.
export function canStartWeaponAction(action,s) {
  if(s.holstered||s.swapping||s.meleeT>=0||s.grenadeT>=0)return false;
  return action!=='reload'||!s.reloading;
}
