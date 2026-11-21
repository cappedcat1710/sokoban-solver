import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const I = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const O = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

const DIRS: [number, number, string][] = [
  [0, -1, 'u'],
  [0, 1, 'd'],
  [-1, 0, 'l'],
  [1, 0, 'r'],
];
const DEADLINE = Date.now() + 50_000;
const MAX_EXPANSIONS = 1_500_000;
const WEIGHT = 2;

const grow32 = (a: Int32Array, cap: number): Int32Array => {
  const b = new Int32Array(cap);
  b.set(a);
  return b;
};
const grow16 = (a: Uint16Array, cap: number): Uint16Array => {
  const b = new Uint16Array(cap);
  b.set(a);
  return b;
};
const grow8 = (a: Uint8Array, cap: number): Uint8Array => {
  const b = new Uint8Array(cap);
  b.set(a);
  return b;
};

/** The moves to push every box onto a goal, as few pushes as you can: u, d, l and r a step, an upper letter a push. */
const solve = (text: string, deadline: number): string => {
  const rows = text.split('\n').filter((r) => r.length > 0);
  if (rows.length === 0) return '';
  const w = Math.max(...rows.map((r) => r.length));
  const size = w * rows.length;
  const wall = new Uint8Array(size).fill(1);
  const goal = new Uint8Array(size);
  const goals: number[] = [];
  const boxes: number[] = [];
  let player = -1;
  rows.forEach((row, y) => {
    for (let x = 0; x < w; x++) {
      const ch = row[x] ?? '#';
      const i = y * w + x;
      if (ch === '#') continue;
      wall[i] = 0;
      if (ch === '.' || ch === '*' || ch === '+') {
        goal[i] = 1;
        goals.push(i);
      }
      if (ch === '$' || ch === '*') boxes.push(i);
      if (ch === '@' || ch === '+') player = i;
    }
  });
  if (player < 0 || goals.length === 0) return '';
  boxes.sort((a, b) => a - b);
  const B = boxes.length;
  if (B === 0) return '';

  // exact distance to the nearest goal over free cells
  const gd = new Int16Array(size).fill(32767);
  {
    const q = new Int32Array(size);
    let head = 0;
    let tail = 0;
    for (const g of goals) {
      gd[g] = 0;
      q[tail++] = g;
    }
    while (head < tail) {
      const c = q[head++]!;
      const d = gd[c]! + 1;
      for (const [dx, dy] of DIRS) {
        const q2 = c + dy * w + dx;
        if (q2 >= 0 && q2 < size && !wall[q2] && gd[q2]! > d) {
          gd[q2] = d;
          q[tail++] = q2;
        }
      }
    }
  }
  const est = (bs: number[]): number => {
    let s = 0;
    for (const b of bs) {
      if (gd[b] === 32767) return 1e9;
      s += gd[b]!;
    }
    return s;
  };

  const occ = new Uint8Array(size);
  const comp = new Uint8Array(size);
  const comp2 = new Uint8Array(size);
  const bfsQ = new Int32Array(size);
  const prev = new Int32Array(size);
  const mv = new Uint8Array(size);
  const walk = (from: number, to: number, bs: number[]): string => {
    if (from === to) return '';
    for (const b of bs) occ[b] = 1;
    prev.fill(-2);
    let head = 0;
    let tail = 0;
    prev[from] = -1;
    bfsQ[tail++] = from;
    while (head < tail) {
      const c = bfsQ[head++]!;
      if (c === to) break;
      for (let di = 0; di < 4; di++) {
        const [dx, dy] = DIRS[di]!;
        const n2 = c + dy * w + dx;
        if (n2 >= 0 && n2 < size && !wall[n2] && !occ[n2] && prev[n2] === -2) {
          prev[n2] = c;
          mv[n2] = di;
          bfsQ[tail++] = n2;
        }
      }
    }
    for (const b of bs) occ[b] = 0;
    if (prev[to] === -2) return '';
    let out = '';
    for (let c = to; c !== from; c = prev[c]!) out = DIRS[mv[c]!]![2] + out;
    return out;
  };

  let cap = 1 << 12;
  let nRegion = new Int32Array(cap);
  let nParent = new Int32Array(cap);
  let nG = new Int32Array(cap);
  let nFrom = new Uint16Array(cap);
  let nDir = new Uint8Array(cap);
  let nBoxes = new Uint16Array(cap * B);
  let n = 0;
  const addNode = (region: number, parent: number, g: number, from: number, dir: number, bs: number[]): number => {
    if (n === cap) {
      cap <<= 1;
      nRegion = grow32(nRegion, cap);
      nParent = grow32(nParent, cap);
      nG = grow32(nG, cap);
      nFrom = grow16(nFrom, cap);
      nDir = grow8(nDir, cap);
      nBoxes = grow16(nBoxes, cap * B);
    }
    const i = n++;
    nRegion[i] = region;
    nParent[i] = parent;
    nG[i] = g;
    nFrom[i] = from;
    nDir[i] = dir;
    for (let k = 0; k < B; k++) nBoxes[i * B + k] = bs[k]!;
    return i;
  };

  // open-addressed state table: (region, boxes) -> node
  const HSIZE = 1 << 22;
  const slots = new Int32Array(HSIZE).fill(-1);
  const hash = (region: number, bs: number[]): number => {
    let h = Math.imul(region + 1, 2654435761) >>> 0;
    for (const b of bs) h = Math.imul(h ^ (b + 0x9e37), 16777619) >>> 0;
    return h;
  };
  const sameState = (node: number, region: number, bs: number[]): boolean => {
    if (nRegion[node] !== region) return false;
    const off = node * B;
    for (let k = 0; k < B; k++) if (nBoxes[off + k] !== bs[k]) return false;
    return true;
  };
  const lookup = (region: number, bs: number[]): number => {
    let s = hash(region, bs) & (HSIZE - 1);
    for (;;) {
      const node = slots[s]!;
      if (node === -1) return -1;
      if (sameState(node, region, bs)) return node;
      s = (s + 1) & (HSIZE - 1);
    }
  };
  const insert = (region: number, bs: number[], node: number): void => {
    let s = hash(region, bs) & (HSIZE - 1);
    for (;;) {
      if (slots[s] === -1 || sameState(slots[s]!, region, bs)) {
        slots[s] = node;
        return;
      }
      s = (s + 1) & (HSIZE - 1);
    }
  };

  let hCap = 1 << 12;
  let hLen = 0;
  let hF = new Int32Array(hCap);
  let hG = new Int32Array(hCap);
  let hI = new Int32Array(hCap);
  const hPush = (f: number, g: number, i: number): void => {
    if (hLen === hCap) {
      hCap <<= 1;
      hF = grow32(hF, hCap);
      hG = grow32(hG, hCap);
      hI = grow32(hI, hCap);
    }
    let k = hLen++;
    for (;;) {
      if (k === 0) {
        hF[0] = f;
        hG[0] = g;
        hI[0] = i;
        break;
      }
      const p = (k - 1) >> 1;
      if (hF[p]! < f || (hF[p] === f && hG[p]! <= g)) {
        hF[k] = f;
        hG[k] = g;
        hI[k] = i;
        break;
      }
      hF[k] = hF[p]!;
      hG[k] = hG[p]!;
      hI[k] = hI[p]!;
      k = p;
    }
  };
  const hPop = (): number => {
    const top = hI[0]!;
    hLen--;
    if (hLen > 0) {
      const f = hF[hLen]!;
      const g = hG[hLen]!;
      const i = hI[hLen]!;
      let k = 0;
      for (;;) {
        let c = 2 * k + 1;
        if (c >= hLen) break;
        if (c + 1 < hLen && (hF[c + 1]! < hF[c]! || (hF[c + 1] === hF[c] && hG[c + 1]! < hG[c]!))) c++;
        if (hF[c]! > f || (hF[c] === f && hG[c]! >= g)) break;
        hF[k] = hF[c]!;
        hG[k] = hG[c]!;
        hI[k] = hI[c]!;
        k = c;
      }
      hF[k] = f;
      hG[k] = g;
      hI[k] = i;
    }
    return top;
  };

  const regionOf = (start: number, bs: number[]): number => {
    for (const b of bs) occ[b] = 1;
    comp2.fill(0);
    comp2[start] = 1;
    let head = 0;
    let tail = 0;
    bfsQ[tail++] = start;
    let rep = start;
    while (head < tail) {
      const c = bfsQ[head++]!;
      if (c < rep) rep = c;
      for (let di = 0; di < 4; di++) {
        const [dx, dy] = DIRS[di]!;
        const n2 = c + dy * w + dx;
        if (n2 >= 0 && n2 < size && !wall[n2] && !occ[n2] && !comp2[n2]) {
          comp2[n2] = 1;
          bfsQ[tail++] = n2;
        }
      }
    }
    for (const b of bs) occ[b] = 0;
    return rep;
  };

  const root = addNode(regionOf(player, boxes), -1, 0, 0, 0, boxes);
  insert(nRegion[root]!, boxes, root);
  hPush(WEIGHT * est(boxes), 0, root);
  let expanded = 0;
  while (hLen > 0 && expanded < MAX_EXPANSIONS && Date.now() < deadline) {
    const s = hPop();
    const bs = new Array<number>(B);
    for (let k = 0; k < B; k++) bs[k] = nBoxes[s * B + k]!;
    const g = nG[s]!;
    const region = nRegion[s]!;
    if (lookup(region, bs) !== s) continue;
    let solved = true;
    for (let k = 0; k < B; k++) {
      if (!goal[bs[k]!]) {
        solved = false;
        break;
      }
    }
    if (solved) {
      const path: [number, number][] = [];
      for (let t = s; t > 0; t = nParent[t]!) path.push([nFrom[t]!, nDir[t]!]);
      path.reverse();
      let out = '';
      let pos = player;
      let cur = boxes.slice();
      for (const [b, d] of path) {
        const [dx, dy, letter] = DIRS[d]!;
        const pf = b - (dy * w + dx);
        out += walk(pos, pf, cur) + letter.toUpperCase();
        cur = cur.map((x) => (x === b ? b + (dy * w + dx) : x));
        pos = b;
      }
      return out;
    }
    expanded++;
    for (const b of bs) occ[b] = 1;
    comp.fill(0);
    comp[region] = 1;
    let head = 0;
    let tail = 0;
    bfsQ[tail++] = region;
    while (head < tail) {
      const c = bfsQ[head++]!;
      for (let di = 0; di < 4; di++) {
        const [dx, dy] = DIRS[di]!;
        const n2 = c + dy * w + dx;
        if (n2 >= 0 && n2 < size && !wall[n2] && !occ[n2] && !comp[n2]) {
          comp[n2] = 1;
          bfsQ[tail++] = n2;
        }
      }
    }
    for (let k = 0; k < B; k++) {
      const b = bs[k]!;
      for (let di = 0; di < 4; di++) {
        const [dx, dy, letter] = DIRS[di]!;
        const pf = b - (dy * w + dx);
        const pt = b + (dy * w + dx);
        if (wall[pf] || wall[pt] || !comp[pf] || occ[pf] || occ[pt]) continue;
        if (gd[pt] === 32767) continue;
        if (!goal[pt] && (wall[pt - w] || wall[pt + w]) && (wall[pt - 1] || wall[pt + 1])) continue;
        const nb = bs.slice();
        nb[k] = pt;
        nb.sort((a, b2) => a - b2);
        occ[b] = 0;
        occ[pt] = 1;
        const nrep = regionOf(b, nb);
        for (const x of bs) occ[x] = 1;
        occ[pt] = 0;
        const ng = g + 1;
        const cur = lookup(nrep, nb);
        if (cur !== -1 && nG[cur]! <= ng) continue;
        const t = addNode(nrep, s, ng, b, di, nb);
        insert(nrep, nb, t);
        hPush(ng + WEIGHT * est(nb), ng, t);
      }
    }
    for (const b of bs) occ[b] = 0;
  }
  return '';
};

const ids = readdirSync(I).sort();
for (let li = 0; li < ids.length; li++) {
  const id = ids[li]!;
  const now = Date.now();
  const slice = Math.max(500, Math.floor((DEADLINE - now) / (ids.length - li)));
  const moves = solve(readFileSync(join(I, id, 'level.txt'), 'utf8'), Math.min(DEADLINE, now + slice));
  mkdirSync(join(O, id), { recursive: true });
  writeFileSync(join(O, id, 'solution.txt'), `${moves}\n`);
}
