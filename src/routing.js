import { COLS, ROWS, ORIENT } from "./constants.js";

// ── Entrance calculation ──────────────────────────────────────────────────────
export function calcEntrance(c, r, w, h, orient) {
  if (orient === ORIENT.V) return { entrC: c + Math.floor(w/2), entrR: r + h };
  return { entrC: c + w, entrR: r + Math.floor(h/2) };
}

// ── Blocked cells from shelf footprints ──────────────────────────────────────
export function buildBlocked(items) {
  const blocked = new Set();
  items.filter(it => it.type === "shelf").forEach(it => {
    for (let r = it.r; r < it.r + it.h; r++)
      for (let c = it.c; c < it.c + it.w; c++)
        blocked.add(r * COLS + c);
  });
  return blocked;
}

// ── Wall-edge forbidden transitions ──────────────────────────────────────────
export function buildWallEdges(walls) {
  const wallEdges = new Set();
  const key = (c, r) => r * COLS + c;
  for (const w of walls) {
    if (w.r1 === w.r2) {
      const rowAbove = w.r1 - 1, rowBelow = w.r1;
      for (let c = w.c1; c < w.c2; c++) {
        if (rowAbove >= 0 && rowBelow < ROWS) {
          wallEdges.add(`${key(c,rowAbove)}:${key(c,rowBelow)}`);
          wallEdges.add(`${key(c,rowBelow)}:${key(c,rowAbove)}`);
        }
      }
    } else {
      const colLeft = w.c1 - 1, colRight = w.c1;
      for (let r = w.r1; r < w.r2; r++) {
        if (colLeft >= 0 && colRight < COLS) {
          wallEdges.add(`${key(colLeft,r)}:${key(colRight,r)}`);
          wallEdges.add(`${key(colRight,r)}:${key(colLeft,r)}`);
        }
      }
    }
  }
  return wallEdges;
}

// ── A* pathfinder ─────────────────────────────────────────────────────────────
export function astar(blocked, wallEdges, sc, sr, ec, er) {
  const cellKey = (c, r) => r * COLS + c;
  const h = (c, r) => Math.abs(c - ec) + Math.abs(r - er);
  const sk = cellKey(sc, sr), ek = cellKey(ec, er);
  if (sk === ek) return [{ c: sc, r: sr }];

  const open = new Map([[sk, { c: sc, r: sr, g: 0, f: h(sc, sr) }]]);
  const closed = new Set();
  const from = new Map();

  while (open.size) {
    let cur = null, loF = Infinity;
    for (const [, n] of open) if (n.f < loF) { loF = n.f; cur = n; }
    const ck = cellKey(cur.c, cur.r);
    if (ck === ek) {
      const path = []; let k = ck;
      while (from.has(k)) { path.unshift(k); k = from.get(k); }
      path.unshift(sk);
      return path.map(k => ({ c: k % COLS, r: Math.floor(k / COLS) }));
    }
    open.delete(ck); closed.add(ck);
    for (const [dc, dr] of [[-1,0],[1,0],[0,-1],[0,1]]) {
      const nc = cur.c + dc, nr = cur.r + dr;
      if (nc < 0 || nc >= COLS || nr < 0 || nr >= ROWS) continue;
      const nk = cellKey(nc, nr);
      if (closed.has(nk) || blocked.has(nk)) continue;
      if (wallEdges?.has(`${ck}:${nk}`)) continue;
      const g = cur.g + 1;
      if (!open.has(nk) || open.get(nk).g > g)
        open.set(nk, { c: nc, r: nr, g, f: g + h(nc, nr) }), from.set(nk, ck);
    }
  }
  return [{ c: sc, r: sr }, { c: ec, r: er }];
}
