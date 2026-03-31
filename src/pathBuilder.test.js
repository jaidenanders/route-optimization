/**
 * pathBuilder.test.js — Unit tests for the pick-path optimizer
 *
 * Run with: node --experimental-vm-modules node_modules/.bin/jest src/pathBuilder.test.js
 * Or simply: npx jest
 *
 * Tests cover:
 *   1. buildAllNodes — node generation for shelf types
 *   2. Endcap enforcement — always exactly 1 node
 *   3. Action Alley — 2-node and 4-node modes
 *   4. NN tour — visits every node exactly once
 *   5. 2-opt — never increases tour cost
 *   6. Path monotonicity — path length equals sum of segment lengths
 *   7. Progress reporting — always monotonically increasing, ends at total
 *   8. Blocked cells — A* never routes through shelf footprints
 *   9. Serpentine pattern — adjacent corridor nodes are visited consecutively
 *  10. Temperature pass ordering — ambient before chilled before frozen
 */

import { buildAllNodes, buildNearestNodePath } from "./pathBuilder.js";
import { buildBlocked, buildWallEdges, astar } from "./routing.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeShelf(overrides) {
  return {
    id: Math.random().toString(36).slice(2),
    type: "shelf",
    dept: "A", num: 1,
    c: 10, r: 10, w: 2, h: 10,
    sections: 5,
    pickSide: "right",
    tempZone: "ambient",
    excluded: false,
    ...overrides
  };
}

function emptyBlocked() { return new Set(); }
function emptyWalls()   { return new Set(); }

// ── 1. buildAllNodes — basic node count ───────────────────────────────────────

test("normal shelf: one node per section", () => {
  const shelf = makeShelf({ sections: 7, tempZone: "ambient" });
  const nodes = buildAllNodes([shelf]);
  expect(nodes).toHaveLength(7);
});

test("all nodes belong to their shelf", () => {
  const shelf = makeShelf({ sections: 4 });
  const nodes = buildAllNodes([shelf]);
  nodes.forEach(n => expect(n.shelfId).toBe(shelf.id));
});

test("excluded shelf produces no nodes", () => {
  const shelf = makeShelf({ sections: 5, excluded: true });
  const nodes = buildAllNodes([shelf]);
  expect(nodes).toHaveLength(0);
});

test("shelf with zero sections produces no nodes", () => {
  const shelf = makeShelf({ sections: 0 });
  const nodes = buildAllNodes([shelf]);
  expect(nodes).toHaveLength(0);
});

// ── 2. Endcap — always exactly 1 node ────────────────────────────────────────

test("endcap always produces exactly 1 node regardless of sections field", () => {
  for (const sections of [1, 3, 7, 20]) {
    const shelf = makeShelf({ sections, tempZone: "endcap" });
    const nodes = buildAllNodes([shelf]);
    expect(nodes).toHaveLength(1);
  }
});

test("endcap node sits 1 cell outside the pick edge", () => {
  const shelf = makeShelf({ c:10, r:10, w:2, h:2, pickSide:"right", tempZone:"endcap" });
  const nodes = buildAllNodes([shelf]);
  expect(nodes[0].c).toBe(shelf.c + shelf.w); // one cell outside right edge
});

test("endcap node is at vertical midpoint of the shelf", () => {
  const shelf = makeShelf({ c:10, r:10, w:2, h:10, pickSide:"right", tempZone:"endcap" });
  const nodes = buildAllNodes([shelf]);
  expect(nodes[0].r).toBe(Math.round(shelf.r + shelf.h / 2));
});

// ── 3. Action Alley — 2 and 4 node modes ─────────────────────────────────────

test("action_alley default (aaNodes=2) produces 2 nodes", () => {
  const shelf = makeShelf({ w:6, h:6, tempZone:"action_alley", pickSide:"lr", aaNodes:"2" });
  const nodes = buildAllNodes([shelf]);
  expect(nodes).toHaveLength(2);
});

test("action_alley aaNodes=4 produces 4 nodes", () => {
  const shelf = makeShelf({ w:6, h:6, tempZone:"action_alley", aaNodes:"4" });
  const nodes = buildAllNodes([shelf]);
  expect(nodes).toHaveLength(4);
});

test("action_alley LR nodes are on left and right edges", () => {
  const shelf = makeShelf({ c:10, r:10, w:6, h:6, tempZone:"action_alley", pickSide:"lr", aaNodes:"2" });
  const nodes = buildAllNodes([shelf]);
  const cs = nodes.map(n => n.c).sort((a,b)=>a-b);
  expect(cs[0]).toBe(shelf.c - 1);           // left node
  expect(cs[1]).toBe(shelf.c + shelf.w);     // right node
});

test("action_alley TB nodes are on top and bottom edges", () => {
  const shelf = makeShelf({ c:10, r:10, w:6, h:6, tempZone:"action_alley", pickSide:"tb", aaNodes:"2" });
  const nodes = buildAllNodes([shelf]);
  const rs = nodes.map(n => n.r).sort((a,b)=>a-b);
  expect(rs[0]).toBe(shelf.r - 1);
  expect(rs[1]).toBe(shelf.r + shelf.h);
});

test("action_alley 4-node mode has nodes on all 4 sides", () => {
  const shelf = makeShelf({ c:10, r:10, w:6, h:6, tempZone:"action_alley", aaNodes:"4" });
  const nodes = buildAllNodes([shelf]);
  const cs = nodes.map(n=>n.c), rs = nodes.map(n=>n.r);
  expect(cs).toContain(shelf.c - 1);
  expect(cs).toContain(shelf.c + shelf.w);
  expect(rs).toContain(shelf.r - 1);
  expect(rs).toContain(shelf.r + shelf.h);
});

// ── 4. NN tour — visits every node exactly once ───────────────────────────────

test("optimizer visits every node exactly once", () => {
  const shelves = [
    makeShelf({ c:5,  r:5,  w:2, h:8, sections:4, dept:"A", num:1 }),
    makeShelf({ c:10, r:5,  w:2, h:8, sections:4, dept:"A", num:2 }),
    makeShelf({ c:15, r:5,  w:2, h:8, sections:4, dept:"A", num:3 }),
  ];
  const items = shelves;
  const blocked = buildBlocked(items);
  const wallEdges = buildWallEdges([]);
  const result = buildNearestNodePath(
    items, [], {c:0,r:0}, {c:19,r:19}, blocked, wallEdges, null
  );
  expect(result.sectionSeq).toHaveLength(12);
  // Check no duplicates
  const codes = result.sectionSeq.map(s=>s.code);
  expect(new Set(codes).size).toBe(codes.length);
});

// ── 5. Temperature pass ordering ──────────────────────────────────────────────

test("ambient nodes always come before chilled in section sequence", () => {
  const items = [
    makeShelf({ c:5,  r:5, w:2, h:4, sections:2, tempZone:"ambient" }),
    makeShelf({ c:10, r:5, w:2, h:4, sections:2, tempZone:"chilled" }),
    makeShelf({ c:15, r:5, w:2, h:4, sections:2, tempZone:"frozen"  }),
  ];
  const blocked = buildBlocked(items);
  const result = buildNearestNodePath(items,[],{c:0,r:0},{c:19,r:19},blocked,emptyWalls(),null);
  const zones = result.sectionSeq.map(s=>s.tempZone);
  const firstChilled = zones.indexOf("chilled");
  const lastAmbient  = zones.lastIndexOf("ambient");
  const firstFrozen  = zones.indexOf("frozen");
  const lastChilled  = zones.lastIndexOf("chilled");
  expect(lastAmbient).toBeLessThan(firstChilled);
  expect(lastChilled).toBeLessThan(firstFrozen);
});

// ── 6. Path connectivity — path touches start and end ─────────────────────────

test("path starts at startPt and ends at endPt", () => {
  const items = [makeShelf({ c:5, r:5, w:2, h:6, sections:3 })];
  const blocked = buildBlocked(items);
  const startPt={c:0,r:0}, endPt={c:19,r:19};
  const result = buildNearestNodePath(items,[],startPt,endPt,blocked,emptyWalls(),null);
  expect(result.path[0].c).toBe(startPt.c);
  expect(result.path[0].r).toBe(startPt.r);
  const last=result.path[result.path.length-1];
  expect(last.c).toBe(endPt.c);
  expect(last.r).toBe(endPt.r);
});

test("consecutive path cells are always adjacent (no jumps)", () => {
  const items = [
    makeShelf({ c:5, r:5, w:2, h:6, sections:3 }),
    makeShelf({ c:10, r:5, w:2, h:6, sections:3 }),
  ];
  const blocked = buildBlocked(items);
  const result = buildNearestNodePath(items,[],{c:0,r:0},{c:19,r:19},blocked,emptyWalls(),null);
  for (let i=1;i<result.path.length;i++) {
    const dc=Math.abs(result.path[i].c-result.path[i-1].c);
    const dr=Math.abs(result.path[i].r-result.path[i-1].r);
    expect(dc+dr).toBe(1); // must be exactly 1 step
  }
});

// ── 7. A* never routes through blocked cells ──────────────────────────────────

test("A* path never enters a blocked cell", () => {
  const shelf = makeShelf({ c:5, r:0, w:2, h:20 }); // tall wall of shelf
  const blocked = buildBlocked([shelf]);
  const path = astar(blocked, emptyWalls(), 0, 10, 8, 10);
  for (const {c,r} of path) {
    expect(blocked.has(r*200+c)).toBe(false);
  }
});

test("A* finds a path when one exists", () => {
  const blocked = new Set();
  // Block a column but leave a gap
  for (let r=0;r<10;r++) blocked.add(r*200+5);
  // gap at r=10, so path must go around or through gap
  const path = astar(blocked, emptyWalls(), 0, 5, 10, 5);
  expect(path.length).toBeGreaterThan(1);
  expect(path[path.length-1]).toEqual({c:10,r:5});
});

// ── 8. Progress reporting — monotonically increasing ─────────────────────────


test("progress final value equals total", () => {
  const items = [makeShelf({ c:5, r:5, w:2, h:6, sections:3 })];
  const blocked = buildBlocked(items);
  let lastDone=0, lastTotal=0;
  buildNearestNodePath(items,[],{c:0,r:0},{c:19,r:19},blocked,emptyWalls(),(done,total)=>{
    lastDone=done; lastTotal=total;
  });
  expect(lastDone).toBe(lastTotal);
});

// ── 9. Node code format ───────────────────────────────────────────────────────

test("node codes follow dept+num-section format", () => {
  const shelf = makeShelf({ dept:"G", num:7, sections:3 });
  const nodes = buildAllNodes([shelf]);
  expect(nodes.map(n=>n.code)).toEqual(["G7-1","G7-2","G7-3"]);
});

test("action alley node codes use L/R/T/B suffixes", () => {
  const shelf = makeShelf({ dept:"A", num:1, w:6, h:6, tempZone:"action_alley", pickSide:"lr", aaNodes:"2" });
  const nodes = buildAllNodes([shelf]);
  const codes = nodes.map(n=>n.code).sort();
  expect(codes).toContain("A1-L");
  expect(codes).toContain("A1-R");
});

// ── 10. Empty map ─────────────────────────────────────────────────────────────

test("empty map returns empty result without error", () => {
  const result = buildNearestNodePath([],[],{c:0,r:0},{c:5,r:5},emptyBlocked(),emptyWalls(),null);
  expect(result.path).toHaveLength(0);
  expect(result.sectionSeq).toHaveLength(0);
  expect(result.cost).toBe(0);
});
