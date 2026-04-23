import { TEMP_ZONES } from "./constants.js";
import { astar } from "./routing.js";

// ── Build pick nodes ──────────────────────────────────────────────────────────
export function buildAllNodes(items) {
  const nodes = [];
  for (const shelf of items.filter(it => it.type==="shelf" && (it.sections||0)>0 && !it.excluded)) {
    const isV=shelf.h>shelf.w, isQ=shelf.h===shelf.w;

    if (shelf.tempZone==="endcap") {
      const edge=shelf.pickSide||(isV?"right":"bottom");
      let c,r;
      if (isV)      { r=Math.round(shelf.r+shelf.h/2); c=edge==="left"?shelf.c-1:shelf.c+shelf.w; }
      else if (!isQ){ c=Math.round(shelf.c+shelf.w/2); r=edge==="top"?shelf.r-1:shelf.r+shelf.h; }
      else {
        if      (edge==="left")  {c=shelf.c-1;       r=Math.round(shelf.r+shelf.h/2);}
        else if (edge==="right") {c=shelf.c+shelf.w; r=Math.round(shelf.r+shelf.h/2);}
        else if (edge==="top")   {c=Math.round(shelf.c+shelf.w/2); r=shelf.r-1;}
        else                     {c=Math.round(shelf.c+shelf.w/2); r=shelf.r+shelf.h;}
      }
      nodes.push(_nd(shelf,1,Math.max(0,c),Math.max(0,r)));
      continue;
    }

    if (shelf.tempZone==="action_alley") {
      const fourNodes = shelf.aaNodes==="4";
      const midR=Math.round(shelf.r+shelf.h/2);
      const midC=Math.round(shelf.c+shelf.w/2);
      const aaSide=shelf.pickSide||(isV?"lr":"tb");
      const doLR = fourNodes || aaSide==="lr";
      const doTB = fourNodes || aaSide==="tb";
      let s=1;
      if (doLR) {
        nodes.push(_nd(shelf,s++,shelf.c-1,       midR,"L"));
        nodes.push(_nd(shelf,s++,shelf.c+shelf.w,  midR,"R"));
      }
      if (doTB) {
        nodes.push(_nd(shelf,s++,midC,shelf.r-1,       "T"));
        nodes.push(_nd(shelf,s++,midC,shelf.r+shelf.h, "B"));
      }
      continue;
    }

    const N=shelf.sections;
    const edge=shelf.pickSide||(isV?"right":"bottom");
    for (let s=1;s<=N;s++) {
      let c,r;
      if (isQ) {
        if      (edge==="top")    { c=Math.round(shelf.c+(s-.5)*shelf.w/N); r=shelf.r-1; }
        else if (edge==="bottom") { c=Math.round(shelf.c+(s-.5)*shelf.w/N); r=shelf.r+shelf.h; }
        else if (edge==="left")   { r=Math.round(shelf.r+(s-.5)*shelf.h/N); c=shelf.c-1; }
        else                      { r=Math.round(shelf.r+(s-.5)*shelf.h/N); c=shelf.c+shelf.w; }
      } else if (isV) {
        r=Math.round(shelf.r+(s-.5)*shelf.h/N); c=edge==="left"?shelf.c-1:shelf.c+shelf.w;
      } else {
        c=Math.round(shelf.c+(s-.5)*shelf.w/N); r=edge==="top"?shelf.r-1:shelf.r+shelf.h;
      }
      nodes.push(_nd(shelf,s,Math.max(0,c),Math.max(0,r)));
    }
  }
  return nodes;
}
function _nd(shelf,s,c,r,suf) {
  return { c, r, shelfId:shelf.id, section:s, tempZone:shelf.tempZone||"ambient",
    code:suf?`${shelf.dept||""}${shelf.num||""}-${suf}`:`${shelf.dept||""}${shelf.num||""}-${s}` };
}

// ── Unreachable detection ─────────────────────────────────────────────────────
// A* returns [start, end] as a 2-cell fallback when no real path exists.
// A legitimate 2-cell path only occurs when start and end are directly adjacent
// (Manhattan distance = 1). If the two points are further apart but the path is
// only 2 cells, it must be the fallback teleport — i.e. truly unreachable.
function isPathFallback(path, sc, sr, ec, er) {
  if (path.length !== 2) return false;
  if (sc === ec && sr === er) return false;
  const adjacent = Math.abs(sc - ec) + Math.abs(sr - er) === 1;
  return !adjacent;
}

// ── Lazy cached distance ──────────────────────────────────────────────────────
function makeDistCache(blocked, wallEdges) {
  // Keyed directionally (c1,r1 → c2,r2) so reverse paths don't collide.
  const cache = new Map();
  function distResult(c1,r1,c2,r2) {
    if (c1===c2&&r1===r2) return { dist: 0, unreachable: false, path: [{c:c1,r:r1}] };
    const key = `${c1},${r1}|${c2},${r2}`;
    if (cache.has(key)) return cache.get(key);
    const p = astar(blocked,wallEdges,c1,r1,c2,r2);
    const unreachable = isPathFallback(p, c1, r1, c2, r2);
    const d = unreachable ? Infinity : p.length - 1;
    const result = { dist: d, unreachable, path: p };
    cache.set(key, result); return result;
  }
  function dist(c1,r1,c2,r2) {
    const r = distResult(c1,r1,c2,r2);
    return r.unreachable ? 99999 : r.dist;
  }
  function path(c1,r1,c2,r2) {
    return distResult(c1,r1,c2,r2).path;
  }
  function man(c1,r1,c2,r2) { return Math.abs(c1-c2)+Math.abs(r1-r2); }
  return { dist, path, man };
}

// ── Nearest-neighbour (endpoint-aware) ───────────────────────────────────────
function nnTour(nodes, startC, startR, endC, endR, dc) {
  const N=nodes.length, visited=new Uint8Array(N), tour=[];
  let curC=startC, curR=startR;
  for (let step=0;step<N;step++) {
    const progress=step/N;
    const alpha=Math.max(0, 0.8*(1-progress*1.4));
    const cands=[];
    for (let i=0;i<N;i++) { if (!visited[i]) cands.push({i,man:dc.man(curC,curR,nodes[i].c,nodes[i].r)}); }
    cands.sort((a,b)=>a.man-b.man);
    let best=-1, bestScore=Infinity;
    for (const {i,man} of cands) {
      if (man>=bestScore) break;
      const d=dc.dist(curC,curR,nodes[i].c,nodes[i].r);
      const score=d+alpha*dc.man(nodes[i].c,nodes[i].r,endC,endR);
      if (score<bestScore) { bestScore=score; best=i; }
    }
    if (best===-1) { for (let i=0;i<N;i++) if (!visited[i]){best=i;break;} }
    visited[best]=1; tour.push(best); curC=nodes[best].c; curR=nodes[best].r;
  }
  return tour;
}

// ── 2-opt ─────────────────────────────────────────────────────────────────────
function twoOpt(tour, nodes, startC, startR, endC, endR, dc) {
  const N=tour.length; if (N<4) return tour;
  const t=tour.slice(); let improved=true, passes=0;
  while (improved && passes++<12) {
    improved=false;
    for (let i=0;i<N-1;i++) {
      const ni=nodes[t[i]], ni1=nodes[t[i+1]];
      const dii1=dc.dist(ni.c,ni.r,ni1.c,ni1.r);
      for (let j=i+2;j<N;j++) {
        if (i===0&&j===N-1) continue;
        const nj=nodes[t[j]], nj1=j+1<N?nodes[t[j+1]]:null;
        const manGain=dc.man(ni.c,ni.r,ni1.c,ni1.r)+(nj1?dc.man(nj.c,nj.r,nj1.c,nj1.r):0)
                     -dc.man(ni.c,ni.r,nj.c,nj.r)-(nj1?dc.man(ni1.c,ni1.r,nj1.c,nj1.r):0);
        if (manGain<=0) continue;
        // Use cached A* distances for end connection (not Manhattan approximation)
        const cur=dii1+(nj1?dc.dist(nj.c,nj.r,nj1.c,nj1.r):dc.dist(nj.c,nj.r,endC,endR));
        const nw=dc.dist(ni.c,ni.r,nj.c,nj.r)+(nj1?dc.dist(ni1.c,ni1.r,nj1.c,nj1.r):dc.dist(ni1.c,ni1.r,endC,endR));
        if (nw<cur-0.5) {
          let lo=i+1,hi=j; while(lo<hi){const tmp=t[lo];t[lo]=t[hi];t[hi]=tmp;lo++;hi--;} improved=true;
        }
      }
    }
  }
  return t;
}

// ── Or-opt (relocate segments of 1–3) ────────────────────────────────────────
function orOpt(tour, nodes, startC, startR, endC, endR, dc) {
  const N=tour.length; if (N<4) return tour;
  const t=tour.slice();
  function D(ia,ib) {
    const a=ia<0?{c:startC,r:startR}:nodes[t[ia]];
    const b=ib<0?{c:startC,r:startR}:nodes[t[ib]];
    return dc.dist(a.c,a.r,b.c,b.r);
  }
  let improved=true, passes=0;
  while (improved&&passes++<10) {
    improved=false;
    for (let segLen=1;segLen<=3&&!improved;segLen++) {
      for (let i=0;i<=N-segLen&&!improved;i++) {
        const last=i+segLen-1, after=last+1; if (after>=N) continue;
        const removeSave=D(i-1,i)+D(last,after)-D(i-1,after);
        for (let j=0;j<N-1&&!improved;j++) {
          if (j>=i-1&&j<=last) continue;
          // gain = (remove savings) + (broken edge) - (two new insertion edges)
          const gain=removeSave+D(j,j+1)-D(j,i)-D(last,j+1);
          const gainRev=removeSave+D(j,j+1)-D(j,last)-D(i,j+1);
          if (gain>0.5||gainRev>0.5) {
            const seg=t.splice(i,segLen);
            if (gainRev>gain) seg.reverse();
            t.splice((j<i?j:j-segLen)+1,0,...seg);
            improved=true;
          }
        }
      }
    }
  }
  return t;
}

// ── 3-opt ─────────────────────────────────────────────────────────────────────
function threeOpt(tour, nodes, startC, startR, endC, endR, dc) {
  const N=tour.length; if (N<6) return tour;
  const t=tour.slice();
  function nd(idx) { return idx<0?{c:startC,r:startR}:nodes[t[idx]]; }
  function D(a,b) { const na=nd(a),nb=nd(b); return dc.dist(na.c,na.r,nb.c,nb.r); }
  function M(a,b) { const na=nd(a),nb=nd(b); return dc.man(na.c,na.r,nb.c,nb.r); }
  let improved=true, passes=0;
  while (improved&&passes++<4) {
    improved=false;
    for (let i=0;i<N-2&&!improved;i++) {
      for (let j=i+1;j<N-1&&!improved;j++) {
        for (let k=j+1;k<N&&!improved;k++) {
          const d0=D(i,i+1)+D(j,j+1)+D(k,k<N-1?k+1:-1);
          const kn=k+1<N?k+1:-1;
          const d4=D(i,j+1)+D(k,i+1)+D(j,kn);
          if (d4<d0-0.5) {
            const s1=t.slice(i+1,j+1).reverse(), s2=t.slice(j+1,k+1), s3=t.slice(k+1);
            t.splice(0,N,...t.slice(0,i+1),...s2,...s1,...s3);
            improved=true;
          }
        }
      }
    }
  }
  return t;
}

// ── Within-shelf monotonic reordering ────────────────────────────────────────
// Enforces sequential section order within consecutive same-shelf runs.
// After global optimization, sections of the same shelf may be scrambled by
// moves that look globally beneficial but create local backtracking. This pass
// sorts each run by section number and picks the better traversal direction.
function fixShelfSequences(tour, nodes, startC, startR, endC, endR, dc) {
  if (tour.length < 2) return tour;
  const t = tour.slice();
  let i = 0;
  while (i < t.length) {
    const node = nodes[t[i]];
    if (!node.shelfId || node.tempZone === "action_alley") { i++; continue; }
    const shelfId = node.shelfId;
    let j = i + 1;
    while (j < t.length && nodes[t[j]].shelfId === shelfId) j++;
    const runLen = j - i;
    if (runLen > 1) {
      const run = t.slice(i, j).sort((a, b) => nodes[a].section - nodes[b].section);
      const rev = run.slice().reverse();
      const pre = i > 0 ? nodes[t[i - 1]] : { c: startC, r: startR };
      const nxt = j < t.length ? nodes[t[j]] : { c: endC, r: endR };
      const fwd = dc.dist(pre.c, pre.r, nodes[run[0]].c, nodes[run[0]].r)
                + dc.dist(nodes[run[runLen-1]].c, nodes[run[runLen-1]].r, nxt.c, nxt.r);
      const rvd = dc.dist(pre.c, pre.r, nodes[rev[0]].c, nodes[rev[0]].r)
                + dc.dist(nodes[rev[runLen-1]].c, nodes[rev[runLen-1]].r, nxt.c, nxt.r);
      const best = fwd <= rvd ? run : rev;
      for (let k = 0; k < runLen; k++) t[i + k] = best[k];
    }
    i = j;
  }
  return t;
}

// ── Main entry point ──────────────────────────────────────────────────────────
export function buildNearestNodePath(items, walls, startPt, endPt, blocked, wallEdges, onProgress) {
  const allNodes=buildAllNodes(items);
  if (!allNodes.length) return { path:[], sectionSeq:[], aisleOrder:[], cost:0, unreachable:[] };

  const getPass=tz=>TEMP_ZONES[tz]?.pass??0;
  const totalNodes=allNodes.length;
  const dc=makeDistCache(blocked,wallEdges);

  const finalTourNodes=[], sectionSeq=[], seenShelves=new Map();
  let curC=startPt.c, curR=startPt.r, totalCost=0, doneCount=0;

  for (let pass=0;pass<=3;pass++) {
    const passNodes=allNodes.filter(n=>getPass(n.tempZone)===pass);
    if (!passNodes.length) continue;
    const N=passNodes.length;
    const prog=d=>{ if (onProgress) onProgress(Math.min(doneCount+d,totalNodes-1),totalNodes); };

    // Deterministic pipeline: NN → 2-opt → Or-opt → 3-opt → Or-opt → 2-opt
    let tour=nnTour(passNodes,curC,curR,endPt.c,endPt.r,dc);      prog(Math.floor(N*0.15));
    tour=twoOpt(tour,passNodes,curC,curR,endPt.c,endPt.r,dc);     prog(Math.floor(N*0.35));
    tour=orOpt(tour,passNodes,curC,curR,endPt.c,endPt.r,dc);      prog(Math.floor(N*0.55));
    tour=threeOpt(tour,passNodes,curC,curR,endPt.c,endPt.r,dc);   prog(Math.floor(N*0.75));
    tour=orOpt(tour,passNodes,curC,curR,endPt.c,endPt.r,dc);      prog(Math.floor(N*0.88));
    tour=twoOpt(tour,passNodes,curC,curR,endPt.c,endPt.r,dc);     prog(Math.floor(N*0.97));
    tour=fixShelfSequences(tour,passNodes,curC,curR,endPt.c,endPt.r,dc);

    for (const idx of tour) {
      const node=passNodes[idx], shelf=items.find(it=>it.id===node.shelfId);
      finalTourNodes.push(node);
      sectionSeq.push({code:node.code,aisle:shelf,section:node.section,tempZone:node.tempZone});
      if (shelf&&!seenShelves.has(shelf.id)) seenShelves.set(shelf.id,shelf);
      doneCount++;
    }
    if (tour.length>0) { const last=passNodes[tour[tour.length-1]]; curC=last.c; curR=last.r; }
  }

  if (onProgress) onProgress(Math.floor(totalNodes*0.99),totalNodes);

  // ── Build full path & detect unreachable nodes ────────────────────────────
  let walkC=startPt.c, walkR=startPt.r;
  const fullPath=[];
  const unreachableCodes=[];
  // segBoundaries[i] = index in fullPath where the i-th pick-node segment ends.
  // segBoundaries[0] = 0 (start), then one entry per pick-node, then the end.
  const segBoundaries=[0];

  for (const node of finalTourNodes) {
    const seg=dc.path(walkC,walkR,node.c,node.r);
    if (isPathFallback(seg, walkC, walkR, node.c, node.r)) {
      unreachableCodes.push(node.code);
    }
    if (fullPath.length===0) fullPath.push(...seg); else fullPath.push(...seg.slice(1));
    segBoundaries.push(fullPath.length-1);
    totalCost += isPathFallback(seg, walkC, walkR, node.c, node.r) ? 0 : seg.length-1;
    walkC=node.c; walkR=node.r;
  }
  const endSeg=astar(blocked,wallEdges,walkC,walkR,endPt.c,endPt.r);
  if (fullPath.length===0) fullPath.push(...endSeg); else fullPath.push(...endSeg.slice(1));
  segBoundaries.push(fullPath.length-1);
  totalCost+=endSeg.length-1;
  if (onProgress) onProgress(totalNodes,totalNodes);

  return {
    path: fullPath,
    segBoundaries,
    pickNodeCoords: finalTourNodes.map(n=>({c:n.c,r:n.r,code:n.code})),
    sectionSeq,
    aisleOrder: [...seenShelves.values()],
    cost: totalCost,
    unreachable: unreachableCodes,
  };
}
