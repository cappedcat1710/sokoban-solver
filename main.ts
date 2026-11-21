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
const LIMIT = 1_000_000;

/** The moves to push every box onto a goal, as few pushes as you can: u, d, l and r a step, an upper letter a push. */
const solve = (text: string): string => {
  const rows = text.split('\n').filter((r) => r.length > 0);
  if (rows.length === 0) return '';
  const w = Math.max(...rows.map((r) => r.length));
  const size = w * rows.length;
  const wall = new Uint8Array(size).fill(1);
  const goal = new Uint8Array(size);
  const goals: number[] = [];
  const startBoxes: number[] = [];
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
      if (ch === '$' || ch === '*') startBoxes.push(i);
      if (ch === '@' || ch === '+') player = i;
    }
  });
  if (player < 0) return '';
  startBoxes.sort((a, b) => a - b);
  if (goals.length === 0) return '';
  // Each box must be pushed at least its grid distance to its nearest goal: the estimate.
  const dist = (b: number): number => {
    let d = Infinity;
    const xb = b % w;
    const yb = Math.floor(b / w);
    for (const g of goals) {
      const dd = Math.abs((g % w) - xb) + Math.abs(Math.floor(g / w) - yb);
      if (dd < d) d = dd;
    }
    return d;
  };
  const est = (bs: number[]): number => {
    let s = 0;
    for (const b of bs) s += dist(b);
    return s;
  };
  const key = (p: number, bs: number[]): string => p + '|' + bs.join(',');
  const sp: number[] = [player];
  const sb: number[][] = [startBoxes];
  const sg: number[] = [0];
  const parent: number[] = [-1];
  const step: string[] = [''];
  const best = new Map<string, number>([[key(player, startBoxes), 0]]);
  const heap: [number, number, number][] = [[est(startBoxes), 0, 0]];
  const less = (a: [number, number, number], b: [number, number, number]): boolean =>
    a[0] < b[0] || (a[0] === b[0] && (a[1] < b[1] || (a[1] === b[1] && a[2] < b[2])));
  const push = (e: [number, number, number]): void => {
    let i = heap.length;
    heap.push(e);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!less(heap[i]!, heap[p]!)) break;
      [heap[i], heap[p]] = [heap[p]!, heap[i]!];
      i = p;
    }
  };
  const pop = (): [number, number, number] => {
    const top = heap[0]!;
    const last = heap.pop()!;
    if (heap.length > 0) {
      heap[0] = last;
      for (let i = 0;;) {
        let c = 2 * i + 1;
        if (c >= heap.length) break;
        if (c + 1 < heap.length && less(heap[c + 1]!, heap[c]!)) c++;
        if (!less(heap[c]!, heap[i]!)) break;
        [heap[i], heap[c]] = [heap[c]!, heap[i]!];
        i = c;
      }
    }
    return top;
  };
  let expanded = 0;
  while (heap.length > 0 && expanded < LIMIT) {
    const [, g, s] = pop();
    if (best.get(key(sp[s]!, sb[s]!)) !== s) continue;
    const bs = sb[s]!;
    let solved = true;
    for (const b of bs) {
      if (!goal[b]) {
        solved = false;
        break;
      }
    }
    if (solved) {
      let m = '';
      for (let t = s; t > 0; t = parent[t]!) m = step[t]! + m;
      return m;
    }
    expanded++;
    const p = sp[s]!;
    for (const [dx, dy, letter] of DIRS) {
      const d = dy * w + dx;
      const q = p + d;
      if (wall[q]) continue;
      let nb = bs;
      let move = letter;
      let ng = g;
      const at = bs.indexOf(q);
      if (at >= 0) {
        if (wall[q + d] || bs.includes(q + d)) continue;
        nb = bs.slice();
        nb[at] = q + d;
        nb.sort((a, b) => a - b);
        move = letter.toUpperCase();
        ng = g + 1;
      }
      const k = key(q, nb);
      const seen = best.get(k);
      if (seen !== undefined && sg[seen]! <= ng) continue;
      const t = sp.length;
      sp.push(q);
      sb.push(nb);
      sg.push(ng);
      parent.push(s);
      step.push(move);
      best.set(k, t);
      push([ng + est(nb), ng, t]);
    }
  }
  return '';
};

for (const id of readdirSync(I).sort()) {
  const moves = solve(readFileSync(join(I, id, 'level.txt'), 'utf8'));
  mkdirSync(join(O, id), { recursive: true });
  writeFileSync(join(O, id, 'solution.txt'), `${moves}\n`);
}
