import { useState, useRef, useLayoutEffect, useEffect, useCallback, useMemo } from "react";
import { COLS, ROWS, CELL, ITEM_TYPES, TEMP_ZONES, ORIENT, genId } from "./constants.js";
import { calcEntrance } from "./routing.js";
import { drawCanvas, drawOverlayCanvas } from "./drawCanvas.js";

// ── Constants ─────────────────────────────────────────────────────────────────
const MAX_UNDO = 40;
const WORKER_TIMEOUT_MS = 60_000; // 60 s hard limit

// ── Responsive breakpoint hook ────────────────────────────────────────────────
function useIsMobile(breakpoint = 768) {
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < breakpoint);
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${breakpoint - 1}px)`);
    const handler = (e) => setIsMobile(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [breakpoint]);
  return isMobile;
}

// ── Tiny helpers ──────────────────────────────────────────────────────────────
function safeLocalStorageSet(key, value) {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch (e) {
    if (e instanceof DOMException && (
      e.code === 22 || e.code === 1014 ||
      e.name === "QuotaExceededError" ||
      e.name === "NS_ERROR_DOM_QUOTA_REACHED"
    )) {
      return false;
    }
    return false;
  }
}

export default function StoreMapBuilder() {
  const canvasRef         = useRef(null);  // static layer
  const overlayCanvasRef  = useRef(null);  // dynamic / preview layer
  const mapContainerRef   = useRef(null);
  const loadFileRef       = useRef(null);
  const bgFileRef         = useRef(null);

  // ── Responsive layout ───────────────────────────────────────────────────────
  const isMobile = useIsMobile();
  const [sheetOpen, setSheetOpen] = useState(false); // mobile bottom sheet

  // ── Core map state ──────────────────────────────────────────────────────────
  const [items,     setItems]     = useState([]);
  const [walls,     setWalls]     = useState([]);
  const [bgImage,   setBgImage]   = useState(null);
  const [bgOpacity, setBgOpacity] = useState(0.35);
  const [bgImageEl, setBgImageEl] = useState(null);

  // ── Undo stack ──────────────────────────────────────────────────────────────
  const undoStack = useRef([]);   // [{items, walls}]
  const redoStack = useRef([]);

  const pushUndo = useCallback((prevItems, prevWalls) => {
    undoStack.current.push({ items: prevItems, walls: prevWalls });
    if (undoStack.current.length > MAX_UNDO) undoStack.current.shift();
    redoStack.current = [];
  }, []);

  const undo = useCallback(() => {
    if (!undoStack.current.length) return;
    const snap = undoStack.current.pop();
    redoStack.current.push({ items, walls });
    setItems(snap.items);
    setWalls(snap.walls);
    setSelectedId(null);
  }, [items, walls]);

  const redo = useCallback(() => {
    if (!redoStack.current.length) return;
    const snap = redoStack.current.pop();
    undoStack.current.push({ items, walls });
    setItems(snap.items);
    setWalls(snap.walls);
    setSelectedId(null);
  }, [items, walls]);

  // ── UI state ────────────────────────────────────────────────────────────────
  const [selectedId,  setSelectedId]  = useState(null);
  const [mode,        setMode]        = useState("draw");
  const [drawTool,    setDrawTool]    = useState({
    type:"shelf", dept:"A", num:1, sections:20,
    orient:ORIENT.H, color:"#60a5fa", tempZone:"ambient", pickSide:"bottom"
  });
  const [drawing,     setDrawing]     = useState(false);
  const [dragStart,   setDragStart]   = useState(null);
  const [previewRect, setPreviewRect] = useState(null);
  const [wallPreview, setWallPreview] = useState(null);
  const [panelTab,    setPanelTab]    = useState("draw");
  const [zoom,        setZoom]        = useState(1);
  const [pan,         setPan]         = useState({ x: 0, y: 0 });
  const isPanningRef  = useRef(false);
  const panStartRef   = useRef({ mx: 0, my: 0, px: 0, py: 0 });
  const spaceHeldRef  = useRef(false);
  const [linkPickMode,    setLinkPickMode]    = useState(false);
  const [draggingMarker,  setDraggingMarker]  = useState(null);

  // ── Item drag (select mode) ─────────────────────────────────────────────────
  // draggingItem: { id, offsetC, offsetR } — grab offset within the item
  // dragItemPreview: { c, r, w, h, color, type } — ghost position while dragging
  const draggingItemRef   = useRef(null);
  const [dragItemPreview, setDragItemPreview] = useState(null);
  // Track mousedown cell to distinguish click vs drag
  const mouseDownCellRef  = useRef(null);

  // ── Toast notifications ─────────────────────────────────────────────────────
  const [toasts, setToasts] = useState([]); // [{id, msg, type}]
  const showToast = useCallback((msg, type = "warn", duration = 5000) => {
    const id = genId();
    setToasts(t => [...t, { id, msg, type }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), duration);
  }, []);

  // ── Routing state ───────────────────────────────────────────────────────────
  const [START,        setSTART]        = useState({ c: 10, r: 10 });
  const [END,          setEND]          = useState({ c: 10, r: 12 });
  const [routePath,    setRoutePath]    = useState(null);
  const [sectionSeq,   setSectionSeq]   = useState([]);
  const [aisleOrder,   setAisleOrder]   = useState([]);
  const [pickNodes,    setPickNodes]    = useState([]);
  const [simStats,     setSimStats]     = useState(null);
  const [showRoute,    setShowRoute]    = useState(false);
  const [optimizing,   setOptimizing]   = useState(false);
  const [optProgress,  setOptProgress]  = useState({ done: 0, total: 0 });
  const [unreachable,  setUnreachable]  = useState([]);   // codes of unreachable nodes
  const workerRef      = useRef(null);
  const workerTimerRef = useRef(null);
  const [routeSearch,        setRouteSearch]        = useState("");
  const [highlightedAisleId, setHighlightedAisleId] = useState(null);
  const [highlightedSecIdx,  setHighlightedSecIdx]  = useState(null);
  const aisleListRef   = useRef(null);
  const sectionListRef = useRef(null);

  // ── Persist / restore ───────────────────────────────────────────────────────
  useEffect(() => {
    try {
      const d = JSON.parse(localStorage.getItem("storeMap") || "{}");
      if (d.items)   setItems(d.items);
      if (d.walls)   setWalls(d.walls);
      if (d.bgImage) setBgImage(d.bgImage);
      if (d.START)   setSTART(d.START);
      if (d.END)     setEND(d.END);
    } catch (_) {}
  }, []);

  useEffect(() => {
    // Always persist — even empty state — so a clear doesn't leave stale data
    // Strip bgImage dataUrl from localStorage to avoid quota blowout;
    // the user will need to re-upload on refresh (image is kept in React state).
    const payload = JSON.stringify({ items, walls, bgImage: null, START, END });
    const ok = safeLocalStorageSet("storeMap", payload);
    if (!ok) {
      showToast("⚠️ Storage quota exceeded — map not saved to browser storage. Use Save (💾) to download a file.", "error", 8000);
    }
  }, [items, walls, START, END]); // intentionally omit bgImage from persistence

  useEffect(() => {
    if (!bgImage?.dataUrl) { setBgImageEl(null); return; }
    const img = new Image();
    img.onload = () => setBgImageEl(img);
    img.src = bgImage.dataUrl;
  }, [bgImage?.dataUrl]);

  // ── Zoom (scroll wheel) ─────────────────────────────────────────────────────
  const handleWheel = useCallback((e) => {
    e.preventDefault();
    const el = mapContainerRef.current; if (!el) return;
    const rect = el.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
    setZoom(z => {
      const newZ = parseFloat(Math.min(8, Math.max(0.1, z * factor)).toFixed(3));
      setPan(p => ({ x: mx - (mx - p.x) * (newZ / z), y: my - (my - p.y) * (newZ / z) }));
      return newZ;
    });
  }, []);

  useEffect(() => {
    const el = mapContainerRef.current; if (!el) return;
    el.addEventListener("wheel", handleWheel, { passive: false });
    return () => el.removeEventListener("wheel", handleWheel);
  }, [handleWheel]);

  // ── Touch support ───────────────────────────────────────────────────────────
  const lastTouchRef    = useRef(null);   // single-touch pan
  const pinchStartRef   = useRef(null);   // {dist, zoom, panX, panY, midX, midY}

  const getTouchDist = (t1, t2) =>
    Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);

  const handleTouchStart = useCallback((e) => {
    if (e.touches.length === 1) {
      lastTouchRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      pinchStartRef.current = null;
    } else if (e.touches.length === 2) {
      const [t1, t2] = [e.touches[0], e.touches[1]];
      pinchStartRef.current = {
        dist: getTouchDist(t1, t2),
        zoom,
        panX: pan.x,
        panY: pan.y,
        midX: (t1.clientX + t2.clientX) / 2,
        midY: (t1.clientY + t2.clientY) / 2,
      };
      lastTouchRef.current = null;
    }
  }, [zoom, pan]);

  const handleTouchMove = useCallback((e) => {
    e.preventDefault();
    if (e.touches.length === 2 && pinchStartRef.current) {
      const [t1, t2] = [e.touches[0], e.touches[1]];
      const newDist = getTouchDist(t1, t2);
      const { dist, zoom: startZoom, panX, panY, midX, midY } = pinchStartRef.current;
      const scale = newDist / dist;
      const newZ  = parseFloat(Math.min(8, Math.max(0.1, startZoom * scale)).toFixed(3));
      setPan({
        x: midX - (midX - panX) * (newZ / startZoom),
        y: midY - (midY - panY) * (newZ / startZoom),
      });
      setZoom(newZ);
    } else if (e.touches.length === 1 && lastTouchRef.current) {
      const dx = e.touches[0].clientX - lastTouchRef.current.x;
      const dy = e.touches[0].clientY - lastTouchRef.current.y;
      lastTouchRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      setPan(p => ({ x: p.x + dx, y: p.y + dy }));
    }
  }, []);

  const handleTouchEnd = useCallback(() => {
    lastTouchRef.current  = null;
    pinchStartRef.current = null;
  }, []);

  useEffect(() => {
    const el = mapContainerRef.current; if (!el) return;
    el.addEventListener("touchstart",  handleTouchStart, { passive: false });
    el.addEventListener("touchmove",   handleTouchMove,  { passive: false });
    el.addEventListener("touchend",    handleTouchEnd,   { passive: true  });
    return () => {
      el.removeEventListener("touchstart",  handleTouchStart);
      el.removeEventListener("touchmove",   handleTouchMove);
      el.removeEventListener("touchend",    handleTouchEnd);
    };
  }, [handleTouchStart, handleTouchMove, handleTouchEnd]);

  // ── Space = pan mode ────────────────────────────────────────────────────────
  useEffect(() => {
    const dn = (e) => {
      // Keyboard shortcuts — only when not typing in an input/textarea
      if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;

      if (e.code === "Space") { e.preventDefault(); spaceHeldRef.current = true; return; }

      // Mode shortcuts
      if (e.key === "d" || e.key === "D") { setMode("draw");   return; }
      if (e.key === "s" || e.key === "S") { setMode("select"); return; }
      if (e.key === "e" || e.key === "E") { setMode("erase");  return; }

      // Undo / Redo
      if ((e.ctrlKey || e.metaKey) && e.key === "z") { e.preventDefault(); undo(); return; }
      if ((e.ctrlKey || e.metaKey) && (e.key === "y" || (e.shiftKey && e.key === "z"))) {
        e.preventDefault(); redo(); return;
      }
    };
    const up = (e) => {
      if (e.code === "Space") { spaceHeldRef.current = false; isPanningRef.current = false; }
    };
    window.addEventListener("keydown", dn);
    window.addEventListener("keyup",   up);
    return () => { window.removeEventListener("keydown", dn); window.removeEventListener("keyup", up); };
  }, [undo, redo]);

  // Scroll highlighted aisle/section into view
  useEffect(() => {
    if (!highlightedAisleId || !aisleListRef.current) return;
    aisleListRef.current.querySelector(`[data-aisleid="${highlightedAisleId}"]`)?.scrollIntoView({ block:"nearest" });
  }, [highlightedAisleId]);
  useEffect(() => {
    if (highlightedSecIdx == null || !sectionListRef.current) return;
    sectionListRef.current.querySelector(`[data-secidx="${highlightedSecIdx}"]`)?.scrollIntoView({ block:"nearest" });
  }, [highlightedSecIdx]);

  const selectedItem = useMemo(() => items.find(it => it.id === selectedId) || null, [items, selectedId]);

  // ── Dual-canvas rendering ───────────────────────────────────────────────────
  // Static layer: items, walls, route, S/E markers — only redraws when those change
  useLayoutEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    drawCanvas(canvas, items, walls, zoom, bgImageEl, bgImage, bgOpacity,
      routePath, showRoute, START, END, pickNodes, selectedId);
  }, [items, walls, zoom, bgImageEl, bgImage, bgOpacity,
      routePath, showRoute, START, END, pickNodes, selectedId]);

  // Overlay layer: preview rect, wall preview, item drag ghost
  useLayoutEffect(() => {
    const canvas = overlayCanvasRef.current; if (!canvas) return;
    drawOverlayCanvas(canvas, drawTool, previewRect, wallPreview, zoom, dragItemPreview);
  }, [drawTool, previewRect, wallPreview, zoom, dragItemPreview]);

  // ── Coordinate helpers ──────────────────────────────────────────────────────
  const getCell = useCallback((e) => {
    const el = mapContainerRef.current; if (!el) return { c:0, r:0 };
    const rect = el.getBoundingClientRect(), CZ = CELL * zoom;
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    return {
      c: Math.max(0, Math.min(COLS-1, Math.floor(((clientX - rect.left) - pan.x) / CZ))),
      r: Math.max(0, Math.min(ROWS-1, Math.floor(((clientY - rect.top)  - pan.y) / CZ))),
    };
  }, [zoom, pan]);

  const getEdge = useCallback((e) => {
    const el = mapContainerRef.current; if (!el) return { c:0, r:0 };
    const rect = el.getBoundingClientRect(), CZ = CELL * zoom;
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    return {
      c: Math.max(0, Math.min(COLS, Math.round(((clientX - rect.left) - pan.x) / CZ))),
      r: Math.max(0, Math.min(ROWS, Math.round(((clientY - rect.top)  - pan.y) / CZ))),
    };
  }, [zoom, pan]);

  const snapWall = (e1, e2) => {
    const dc = Math.abs(e2.c-e1.c), dr = Math.abs(e2.r-e1.r);
    if (dc >= dr) { const [c1,c2]=e1.c<=e2.c?[e1.c,e2.c]:[e2.c,e1.c]; return {r1:e1.r,c1,r2:e1.r,c2}; }
    const [r1,r2]=e1.r<=e2.r?[e1.r,e2.r]:[e2.r,e1.r]; return {r1,c1:e1.c,r2,c2:e1.c};
  };
  const normRect = (c1,r1,c2,r2) => ({ c:Math.min(c1,c2), r:Math.min(r1,r2), w:Math.abs(c2-c1)+1, h:Math.abs(r2-r1)+1 });
  const hitTest  = useCallback((c,r) => [...items].reverse().find(it => c>=it.c&&c<it.c+it.w&&r>=it.r&&r<it.r+it.h), [items]);

  // ── Mouse / pointer handlers ────────────────────────────────────────────────
  const onMouseDown = useCallback((e) => {
    if (e.button===1 || e.button===2 || (e.button===0 && spaceHeldRef.current)) {
      e.preventDefault();
      isPanningRef.current = true;
      panStartRef.current = { mx: e.clientX, my: e.clientY, px: pan.x, py: pan.y };
      return;
    }
    const cell = getCell(e);
    if (Math.abs(cell.c-START.c)<=1 && Math.abs(cell.r-START.r)<=1) { setDraggingMarker("start"); return; }
    if (Math.abs(cell.c-END.c)<=1   && Math.abs(cell.r-END.r)<=1)   { setDraggingMarker("end");   return; }
    if (mode==="draw" && drawTool.type==="wall") {
      const edge=getEdge(e); setDrawing(true); setDragStart(edge);
      setWallPreview({r1:edge.r,c1:edge.c,r2:edge.r,c2:edge.c});
    } else if (mode==="draw") {
      setDrawing(true); setDragStart(cell); setPreviewRect({...cell,w:1,h:1});
    } else if (mode==="select") {
      const h = hitTest(cell.c, cell.r);
      if (linkPickMode && h && h.type==="shelf" && h.id!==selectedId) {
        const src = selectedId;
        setItems(prev => prev.map(it => {
          if (it.id===src)   return {...it, linkedId: h.id};
          if (it.id===h.id)  return {...it, linkedId: src};
          return it;
        }));
        setLinkPickMode(false); setSelectedId(h.id); return;
      }
      if (linkPickMode) { setLinkPickMode(false); return; }
      // Record mousedown cell for click-vs-drag discrimination
      mouseDownCellRef.current = cell;
      if (h) {
        // Arm item drag — offset is where inside the item the user grabbed
        draggingItemRef.current = { id: h.id, offsetC: cell.c - h.c, offsetR: cell.r - h.r };
        setSelectedId(h.id); setPanelTab("edit");
      } else {
        draggingItemRef.current = null;
        setSelectedId(null);
      }
    } else if (mode==="erase") {
      const CZ=CELL*zoom, el=mapContainerRef.current, r2=el.getBoundingClientRect();
      const px=e.clientX-r2.left-pan.x, py=e.clientY-r2.top-pan.y;
      let hitWall=null, minDist=8*zoom;
      for (const w of walls) {
        const x1=w.c1*CZ,y1=w.r1*CZ,x2=w.c2*CZ,y2=w.r2*CZ,dx=x2-x1,dy=y2-y1,lsq=dx*dx+dy*dy;
        if (!lsq) continue;
        const t=Math.max(0,Math.min(1,((px-x1)*dx+(py-y1)*dy)/lsq));
        const dist=Math.hypot(px-(x1+t*dx),py-(y1+t*dy));
        if (dist<minDist) { minDist=dist; hitWall=w; }
      }
      if (hitWall) {
        pushUndo(items, walls);
        setWalls(p=>p.filter(w=>w.id!==hitWall.id)); setSelectedId(null);
      } else {
        const h=hitTest(cell.c,cell.r);
        if(h){
          pushUndo(items, walls);
          setItems(p=>p.filter(it=>it.id!==h.id));setSelectedId(null);
        }
      }
    }
  }, [mode, drawTool, getCell, getEdge, hitTest, walls, zoom, linkPickMode,
      selectedId, pan, START, END, items, pushUndo]);

  const onMouseMove = useCallback((e) => {
    if (isPanningRef.current) {
      const {mx,my,px,py} = panStartRef.current;
      setPan({ x: px+(e.clientX-mx), y: py+(e.clientY-my) }); return;
    }
    if (draggingMarker==="start") { setSTART(getCell(e)); return; }
    if (draggingMarker==="end")   { setEND(getCell(e));   return; }

    // Item drag in select mode
    if (mode==="select" && draggingItemRef.current) {
      const cell = getCell(e);
      const md = mouseDownCellRef.current;
      // Only start showing ghost after moving at least 1 cell (prevents flicker on click)
      if (md && Math.abs(cell.c - md.c) + Math.abs(cell.r - md.r) < 1) return;
      const { id, offsetC, offsetR } = draggingItemRef.current;
      const item = items.find(it => it.id === id);
      if (!item) return;
      const newC = Math.max(0, Math.min(COLS - item.w, cell.c - offsetC));
      const newR = Math.max(0, Math.min(ROWS - item.h, cell.r - offsetR));
      setDragItemPreview({ c: newC, r: newR, w: item.w, h: item.h, color: item.color, type: item.type });
      return;
    }

    if (!drawing||!dragStart) return;
    drawTool.type==="wall"
      ? setWallPreview(snapWall(dragStart, getEdge(e)))
      : setPreviewRect(normRect(dragStart.c,dragStart.r,getCell(e).c,getCell(e).r));
  }, [drawing, dragStart, draggingMarker, drawTool, getCell, getEdge, mode, items]);

  // ── Pick side helpers ───────────────────────────────────────────────────────
  const validPickSides  = (isV, isQ) => isQ?["top","bottom","left","right"]:isV?["left","right"]:["top","bottom"];
  const defaultPickSide = (isV, isQ) => isQ?"right":isV?"right":"bottom";
  const oppositeSide    = { left:"right", right:"left", top:"bottom", bottom:"top" };

  const resolvePickSide = useCallback((shelf, side, allItems) => {
    const others = allItems.filter(it => it.type==="shelf" && it.id!==shelf.id);
    const collides = (c,r) => others.some(o=>c>=o.c&&c<o.c+o.w&&r>=o.r&&r<o.r+o.h);
    const N=Math.max(1,shelf.sections||1), isV=shelf.h>shelf.w;
    const check = (s) => {
      for (let sec=1;sec<=N;sec++) {
        const nc=isV?(s==="left"?shelf.c-1:shelf.c+shelf.w):Math.round(shelf.c+(sec-0.5)*shelf.w/N);
        const nr=isV?Math.round(shelf.r+(sec-0.5)*shelf.h/N):(s==="top"?shelf.r-1:shelf.r+shelf.h);
        if (collides(nc,nr)) return false;
      }
      return true;
    };
    if (check(side)) return side;
    const alt=oppositeSide[side];
    if (alt&&check(alt)) return alt;
    return side;
  }, []);

  const onMouseUp = useCallback((e) => {
    if (isPanningRef.current) { isPanningRef.current=false; return; }
    if (draggingMarker) { setDraggingMarker(null); return; }

    // Commit item drag
    if (mode==="select" && draggingItemRef.current) {
      if (dragItemPreview) {
        const { id } = draggingItemRef.current;
        pushUndo(items, walls);
        setItems(prev => prev.map(it => {
          if (it.id !== id) return it;
          const moved = { ...it, c: dragItemPreview.c, r: dragItemPreview.r };
          if (it.type !== "zone") Object.assign(moved, calcEntrance(moved.c, moved.r, moved.w, moved.h, moved.orient));
          if (it.type === "shelf") {
            const isV = moved.h > moved.w, isQ = moved.h === moved.w;
            const valid = validPickSides(isV, isQ);
            const side = valid.includes(moved.pickSide) ? moved.pickSide : defaultPickSide(isV, isQ);
            moved.pickSide = resolvePickSide(moved, side, prev);
          }
          return moved;
        }));
        setDragItemPreview(null);
      }
      draggingItemRef.current = null;
      mouseDownCellRef.current = null;
      return;
    }

    if (!drawing||!dragStart) return;
    setDrawing(false);
    if (drawTool.type==="wall") {
      const seg=snapWall(dragStart,getEdge(e));
      if (seg.r1!==seg.r2||seg.c1!==seg.c2) {
        pushUndo(items, walls);
        const nw={id:genId(),...seg}; setWalls(p=>[...p,nw]); setSelectedId(nw.id);
      }
      setWallPreview(null); return;
    }
    const cell=getCell(e), rect=normRect(dragStart.c,dragStart.r,cell.c,cell.r);
    setPreviewRect(null);
    const isZone = drawTool.type==="zone";
    const ent    = isZone ? {} : calcEntrance(rect.c,rect.r,rect.w,rect.h,drawTool.orient);
    let pickSide = drawTool.pickSide || "bottom";
    if (!isZone && drawTool.type==="shelf") {
      const isV=rect.h>rect.w, isQ=rect.h===rect.w;
      const valid = validPickSides(isV,isQ);
      pickSide = valid.includes(pickSide) ? pickSide : defaultPickSide(isV,isQ);
      pickSide = resolvePickSide({...rect,type:"shelf",id:"_draft_",sections:drawTool.sections||1}, pickSide, items);
    }
    const newItem = {
      id:genId(), type:drawTool.type, dept:drawTool.dept, num:drawTool.num,
      label:isZone?drawTool.dept:`${drawTool.dept}${drawTool.num}`,
      sections:isZone?0:drawTool.tempZone==="endcap"?1:drawTool.sections,
      orient:drawTool.orient, color:drawTool.color,
      tempZone:drawTool.type==="shelf"?(drawTool.tempZone||"ambient"):undefined,
      pickSide:drawTool.type==="shelf"?pickSide:undefined,
      aaNodes:drawTool.type==="shelf"&&drawTool.tempZone==="action_alley"?(drawTool.aaNodes||"2"):undefined,
      ...rect, ...ent
    };
    pushUndo(items, walls);
    setItems(prev => isZone ? [newItem,...prev] : [...prev,newItem]);
    if (!isZone) setDrawTool(t=>({...t,num:(parseInt(t.num)||0)+1}));
    setSelectedId(newItem.id); setPanelTab("edit");
  }, [drawing, dragStart, drawTool, getCell, getEdge, items, walls, pushUndo,
      mode, dragItemPreview, draggingMarker, resolvePickSide]);

  const onMouseLeave = useCallback(() => {
    isPanningRef.current=false;
    setDrawing(false); setPreviewRect(null); setWallPreview(null); setDraggingMarker(null);
    draggingItemRef.current = null;
    mouseDownCellRef.current = null;
    setDragItemPreview(null);
  }, []);

  const recheckCollisions = useCallback(() => {
    setItems(prev => {
      const shelves=prev.filter(it=>it.type==="shelf");
      return prev.map(it => {
        if (it.type!=="shelf") return it;
        const isV=it.h>it.w, isQ=it.h===it.w;
        const valid=validPickSides(isV,isQ);
        const side=valid.includes(it.pickSide)?it.pickSide:defaultPickSide(isV,isQ);
        const resolved=resolvePickSide(it,side,shelves);
        return resolved===it.pickSide?it:{...it,pickSide:resolved};
      });
    });
  }, [resolvePickSide]);

  const updateItem = (key, val) => {
    setItems(prev => prev.map(it => {
      if (it.id!==selectedId) return it;
      let u={...it,[key]:val};
      if (["orient","c","r","w","h"].includes(key)) u={...u,...calcEntrance(u.c,u.r,u.w,u.h,u.orient)};
      if (["w","h","c","r"].includes(key)&&u.type==="shelf") {
        const isV=u.h>u.w, isQ=u.h===u.w;
        const valid=validPickSides(isV,isQ);
        const side=valid.includes(u.pickSide)?u.pickSide:defaultPickSide(isV,isQ);
        u.pickSide=resolvePickSide(u,side,prev);
      }
      return u;
    }));
  };



  // ── Optimize route ──────────────────────────────────────────────────────────
  const runRoute = useCallback(() => {
    if (!items.filter(it=>it.type==="shelf"&&!it.excluded&&(it.sections||0)>0).length) return;
    if (workerRef.current) { workerRef.current.terminate(); workerRef.current=null; }
    if (workerTimerRef.current) { clearTimeout(workerTimerRef.current); workerTimerRef.current=null; }

    setOptimizing(true); setOptProgress({done:0,total:0}); setPanelTab("route");
    setPickNodes([]); setUnreachable([]);

    const worker = new Worker(new URL("./optimizer.worker.js", import.meta.url), {type:"module"});
    workerRef.current = worker;

    // Hard timeout — kill worker if it hangs
    workerTimerRef.current = setTimeout(() => {
      if (workerRef.current) {
        workerRef.current.terminate();
        workerRef.current = null;
      }
      setOptimizing(false);
      showToast("⏱ Optimization timed out — the map may have unreachable areas. Try re-checking collisions or removing walls.", "error", 8000);
    }, WORKER_TIMEOUT_MS);

    worker.onmessage = ({data}) => {
      if (data.type==="progress") {
        setOptProgress({done:data.done,total:data.total});
      } else if (data.type==="done") {
        clearTimeout(workerTimerRef.current);
        workerTimerRef.current = null;
        setRoutePath(data.path);
        setSectionSeq(data.sectionSeq);
        setAisleOrder(data.aisleOrder);
        setPickNodes(data.pickNodeCoords||[]);
        setSimStats({cost:data.cost,sections:data.sectionSeq.length,aisles:data.aisleOrder.length});
        setShowRoute(true);
        setOptimizing(false);
        workerRef.current=null;

        // Unreachable node detection
        const unreachableCodes = data.unreachable || [];
        setUnreachable(unreachableCodes);
        if (unreachableCodes.length > 0) {
          showToast(
            `⚠️ ${unreachableCodes.length} node${unreachableCodes.length>1?"s":""} unreachable: ${unreachableCodes.slice(0,5).join(", ")}${unreachableCodes.length>5?" …":""}. Check for walls blocking aisles or shelves placed in corners.`,
            "warn", 9000
          );
        }
      }
    };
    worker.onerror = (err) => {
      clearTimeout(workerTimerRef.current);
      workerTimerRef.current = null;
      setOptimizing(false);
      workerRef.current=null;
      showToast("❌ Optimizer crashed — check the browser console for details.", "error", 7000);
    };
    worker.postMessage({items, walls, startPt:START, endPt:END});
  }, [items, walls, START, END, showToast]);

  // Cleanup worker on unmount
  useEffect(() => () => {
    workerRef.current?.terminate();
    clearTimeout(workerTimerRef.current);
  }, []);

  const saveMap = () => {
    const data=JSON.stringify({items,walls,bgImage,START,END});
    localStorage.setItem("storeMap",data);
    const a=document.createElement("a");
    a.href=URL.createObjectURL(new Blob([data],{type:"application/json"}));
    a.download="store-map.json"; a.click();
  };
  const loadMap = (e) => {
    const file=e.target.files?.[0]; if(!file) return;
    const reader=new FileReader();
    reader.onload=ev=>{
      try {
        const d=JSON.parse(ev.target.result);
        pushUndo(items, walls);
        if(d.items)   setItems(d.items);
        if(d.walls)   setWalls(d.walls);
        if(d.bgImage) setBgImage(d.bgImage);
        if(d.START)   setSTART(d.START);
        if(d.END)     setEND(d.END);
        setRoutePath(null); setSectionSeq([]); setAisleOrder([]); setSimStats(null); setSelectedId(null);
      } catch { alert("Invalid map file"); }
    };
    reader.readAsText(file); e.target.value="";
  };
  const loadBgImage = (e) => {
    const file=e.target.files?.[0]; if(!file) return;
    const reader=new FileReader();
    reader.onload=ev=>setBgImage({dataUrl:ev.target.result,x:0,y:0,w:COLS,h:ROWS});
    reader.readAsDataURL(file); e.target.value="";
  };

  // ── Grouped item counts for DRAW panel ─────────────────────────────────────
  const groupedItems = useMemo(() => {
    const g={};
    items.filter(it=>it.type!=="zone").forEach(it=>{
      const k=`${it.type}:${it.dept||it.type}`;
      if(!g[k]) g[k]={type:it.type,dept:it.dept,items:[]};
      g[k].items.push(it);
    });
    return Object.values(g);
  }, [items]);

  // ── Portfolio design tokens ─────────────────────────────────────────────────
  const GOLD       = "#F1C500";
  const GOLD_DIM   = "#8B7220";
  const DARK       = "#1A0F0A";
  const DARK_MID   = "#2C1810";
  const CREAM      = "#FDF6E3";
  const MUTED      = "#8B7355";
  const BORDER     = "rgba(212,175,55,0.2)";
  const CARD_BG    = "rgba(255,255,255,0.03)";

  const SERIF  = "'Playfair Display', serif";
  const SANS   = "'DM Sans', sans-serif";
  const MONO   = "'DM Mono', monospace";

  const inp = (x={}) => ({
    background:"rgba(255,255,255,0.04)", border:`1px solid ${BORDER}`,
    color:CREAM, padding:"6px 10px", borderRadius:6, fontSize:12,
    outline:"none", fontFamily:MONO, width:"100%", boxSizing:"border-box",
    transition:"all 0.2s", ...x
  });

  const tab = (active) => ({
    flex:1, background:"transparent", border:"none",
    borderBottom:`2px solid ${active ? GOLD : "transparent"}`,
    color: active ? GOLD : MUTED,
    padding:"9px 4px", cursor:"pointer", fontSize:10, fontWeight:700,
    fontFamily:MONO, letterSpacing:"0.08em", textTransform:"uppercase",
    transition:"all 0.2s"
  });

  const chip = (active, col=GOLD) => ({
    padding:"3px 10px", borderRadius:100, fontSize:11, fontWeight:500,
    fontFamily:MONO, border:`1px solid ${active ? col : BORDER}`,
    background: active ? col+"22" : "transparent",
    color: active ? col : MUTED, cursor:"pointer", transition:"all 0.2s",
    letterSpacing:"0.03em"
  });

  const btnGold = (extra={}) => ({
    background:GOLD, color:DARK, border:"none", borderRadius:6,
    padding:"6px 14px", fontFamily:SANS, fontWeight:700, fontSize:11,
    cursor:"pointer", letterSpacing:"0.03em", transition:"all 0.2s", ...extra
  });

  const btnGhost = (extra={}) => ({
    background:"transparent", color:CREAM, border:`1px solid ${BORDER}`,
    borderRadius:6, padding:"5px 12px", fontFamily:MONO, fontWeight:500,
    fontSize:10, cursor:"pointer", letterSpacing:"0.05em", transition:"all 0.2s", ...extra
  });

  const modeCol = { draw: GOLD, select:"#60a5fa", erase:"#f43f5e" };

  // ── Render helpers ────────────────────────────────────────────────────────
  const lbl = (txt) => (
    <div style={{fontFamily:MONO,fontSize:"0.75rem",color:GOLD,letterSpacing:"0.2em",
      textTransform:"uppercase",marginBottom:"0.75rem",display:"flex",alignItems:"center",gap:"0.75rem"}}>
      <span style={{display:"block",width:30,height:1,background:GOLD,flexShrink:0}}/>
      {txt}
    </div>
  );

  const fieldLabel = (txt, right=null) => (
    <label style={{display:"flex",justifyContent:"space-between",fontFamily:MONO,fontSize:"0.7rem",
      color:GOLD_DIM,letterSpacing:"0.15em",textTransform:"uppercase",marginBottom:"0.4rem"}}>
      <span>{txt}</span>{right&&<span style={{color:GOLD}}>{right}</span>}
    </label>
  );

  const infoBox = (txt, col=GOLD) => (
    <div style={{background:col+"11",border:`1px solid ${col}33`,borderRadius:8,
      padding:"8px 12px",fontSize:"0.78rem",color:col,lineHeight:1.7,fontFamily:MONO}}>{txt}</div>
  );

  const fitView = () => {
    const el=mapContainerRef.current;
    if(!el||!items.length){setZoom(1);setPan({x:0,y:0});return;}
    const all=items.filter(it=>it.type!=="zone");
    if(!all.length){setZoom(1);setPan({x:0,y:0});return;}
    const minC=Math.min(...all.map(it=>it.c))-2, minR=Math.min(...all.map(it=>it.r))-2;
    const maxC=Math.max(...all.map(it=>it.c+it.w))+2, maxR=Math.max(...all.map(it=>it.r+it.h))+2;
    const cw=el.clientWidth, ch=el.clientHeight;
    const fitZ=parseFloat((Math.min(8,Math.max(0.1,Math.min(cw/((maxC-minC)*CELL),ch/((maxR-minR)*CELL))))*0.9).toFixed(3));
    setZoom(fitZ);
    setPan({x:(cw-(maxC-minC)*CELL*fitZ)/2-minC*CELL*fitZ,y:(ch-(maxR-minR)*CELL*fitZ)/2-minR*CELL*fitZ});
  };

  // ── Panel content (shared between desktop aside and mobile bottom sheet) ────
  const renderPanelContent = () => (
    <>
              <div style={{display:"flex",flexDirection:"column",gap:"0.9rem"}}>
                <div>
                  {lbl("Item Type")}
                  <div style={{display:"flex",flexWrap:"wrap",gap:"0.3rem"}}>
                    {Object.entries(ITEM_TYPES).map(([type,info])=>(
                      <button key={type} onClick={()=>setDrawTool(t=>({...t,type,color:info.color}))}
                        style={{flex:1,...chip(drawTool.type===type,info.color)}}>{info.label}</button>
                    ))}
                    <button onClick={()=>setDrawTool(t=>({...t,type:"wall",color:"#f43f5e"}))}
                      style={{flex:1,...chip(drawTool.type==="wall","#f43f5e")}}>Wall</button>
                  </div>
                </div>

                {drawTool.type==="wall"
                  ? infoBox("Click + drag to place a wall. The optimizer never crosses walls.","#f43f5e")
                  : <>
                  {drawTool.type==="shelf"&&<>
                    <div>
                      {lbl("Temperature Zone")}
                      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"0.3rem"}}>
                        {Object.entries(TEMP_ZONES).map(([k,z])=>(
                          <button key={k} onClick={()=>setDrawTool(t=>({...t,tempZone:k,color:z.color}))}
                            style={chip(drawTool.tempZone===k,z.color)}>{z.label}</button>
                        ))}
                      </div>
                    </div>

                    {drawTool.tempZone==="action_alley"&&(
                      <div style={{display:"flex",flexDirection:"column",gap:"0.5rem"}}>
                        <div>
                          {lbl("Nodes")}
                          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"0.3rem"}}>
                            {[["2","2 Nodes"],["4","4 Nodes"]].map(([v,l])=>(
                              <button key={v} onClick={()=>setDrawTool(t=>({...t,aaNodes:v}))}
                                style={chip((drawTool.aaNodes||"2")===v,"#f97316")}>{l}</button>
                            ))}
                          </div>
                        </div>
                        {(drawTool.aaNodes||"2")==="2"&&(
                          <div>
                            {lbl("Pick Sides")}
                            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"0.3rem"}}>
                              {[["lr","◀ L+R ▶"],["tb","▲ T+B ▼"]].map(([v,l])=>(
                                <button key={v} onClick={()=>setDrawTool(t=>({...t,pickSide:v}))}
                                  style={{...chip((drawTool.pickSide||"lr")===v,"#f97316"),fontSize:"0.7rem"}}>{l}</button>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {drawTool.tempZone==="endcap"&&infoBox("🔖 Endcap — always 1 pick node at centre of edge.",GOLD)}

                    {drawTool.tempZone!=="action_alley"&&drawTool.tempZone!=="endcap"&&(
                      <div>
                        {lbl("Pick Side")}
                        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"0.3rem"}}>
                          {(drawTool.orient===ORIENT.V
                            ?[["left","◀ Left"],["right","▶ Right"]]
                            :[["top","▲ Top"],["bottom","▼ Bottom"]]
                          ).map(([side,l])=>(
                            <button key={side} onClick={()=>setDrawTool(t=>({...t,pickSide:side}))}
                              style={chip(drawTool.pickSide===side)}>{l}</button>
                          ))}
                        </div>
                      </div>
                    )}
                  </>}

                  <div>
                    {fieldLabel(drawTool.type==="zone"?"Zone Label":"Dept Letter")}
                    <input value={drawTool.dept}
                      onChange={e=>setDrawTool(t=>({...t,dept:e.target.value.toUpperCase()}))}
                      maxLength={4} style={inp()} />
                  </div>

                  {drawTool.type!=="zone"&&(
                    <div>
                      {fieldLabel("Number")}
                      <input type="number" min={1} value={drawTool.num}
                        onChange={e=>setDrawTool(t=>({...t,num:parseInt(e.target.value)||1}))} style={inp()} />
                    </div>
                  )}

                  {drawTool.type!=="zone"&&drawTool.tempZone!=="endcap"&&drawTool.tempZone!=="action_alley"&&(
                    <div>
                      {fieldLabel("Sections",drawTool.sections)}
                      <div style={{display:"flex",gap:"0.4rem",alignItems:"center"}}>
                        <input type="range" min={1} max={60} value={Math.min(drawTool.sections,60)}
                          onChange={e=>setDrawTool(t=>({...t,sections:parseInt(e.target.value)}))}
                          style={{flex:1,accentColor:GOLD}} />
                        <input type="number" min={1} max={999} value={drawTool.sections}
                          onChange={e=>setDrawTool(t=>({...t,sections:parseInt(e.target.value)||1}))}
                          style={inp({width:48,padding:"3px 6px"})} />
                      </div>
                    </div>
                  )}

                  <div>
                    {fieldLabel("Color")}
                    <div style={{display:"flex",gap:"0.35rem",alignItems:"center",flexWrap:"wrap"}}>
                      <input type="color" value={drawTool.color}
                        onChange={e=>setDrawTool(t=>({...t,color:e.target.value}))}
                        style={{width:26,height:24,border:`1px solid ${BORDER}`,borderRadius:4,cursor:"pointer",background:"none",padding:1}} />
                      {[GOLD,"#c084fc","#fb923c","#4ade80","#f87171","#67e8f9","#60a5fa","#e2e8f0"].map(c=>(
                        <div key={c} onClick={()=>setDrawTool(t=>({...t,color:c}))}
                          style={{width:14,height:14,borderRadius:3,background:c,cursor:"pointer",flexShrink:0,
                            outline:drawTool.color===c?`2px solid ${CREAM}`:"none",outlineOffset:1,transition:"all 0.15s"}} />
                      ))}
                    </div>
                  </div>
                  </>
                }

                <div style={{background:"rgba(255,255,255,0.02)",border:`1px solid ${BORDER}`,borderRadius:8,
                  padding:"0.6rem 0.75rem",fontFamily:MONO,fontSize:"0.7rem",color:MUTED,lineHeight:1.7}}>
                  <span style={{color:GOLD}}>Keys — </span>
                  <span style={{color:CREAM}}>D</span> Draw · <span style={{color:CREAM}}>S</span> Select · <span style={{color:CREAM}}>E</span> Erase<br/>
                  Drag to place · Scroll/Pinch zoom · Space to pan
                </div>

                <div style={{borderTop:`1px solid ${BORDER}`,paddingTop:"0.9rem"}}>
                  {lbl("🗺 Trace Image")}
                  {!bgImage
                    ? <button onClick={()=>bgFileRef.current?.click()} style={{
                        width:"100%",padding:"0.6rem",borderRadius:8,cursor:"pointer",
                        background:"transparent",border:`1px dashed ${BORDER}`,
                        color:MUTED,fontFamily:MONO,fontSize:"0.75rem",
                      }}>+ Upload floor plan</button>
                    : <div style={{display:"flex",flexDirection:"column",gap:"0.5rem"}}>
                        <div style={{display:"flex",gap:"0.35rem",alignItems:"center"}}>
                          <div style={{flex:1,background:"rgba(255,255,255,0.03)",border:`1px solid ${GOLD}44`,
                            borderRadius:6,padding:"3px 8px",fontSize:"0.75rem",fontFamily:MONO,color:GOLD}}>Image loaded ✓</div>
                          <button onClick={()=>setBgImage(null)} style={{
                            padding:"3px 8px",borderRadius:5,cursor:"pointer",background:"transparent",
                            border:`1px solid #f43f5e44`,color:"#f43f5e",fontFamily:MONO,fontSize:"0.75rem"}}>✕</button>
                        </div>
                        <div style={{background:"#1a0f0a",border:`1px solid ${GOLD}22`,borderRadius:6,
                          padding:"5px 8px",fontFamily:MONO,fontSize:"0.68rem",color:GOLD_DIM,lineHeight:1.5}}>
                          ⚠ Image not saved to browser storage — re-upload after refresh.
                        </div>
                        <div>
                          {fieldLabel("Opacity",`${Math.round(bgOpacity*100)}%`)}
                          <input type="range" min={5} max={90} step={5}
                            value={Math.round(bgOpacity*100)}
                            onChange={e=>setBgOpacity(parseInt(e.target.value)/100)}
                            style={{width:"100%",accentColor:GOLD}} />
                        </div>
                        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"0.4rem"}}>
                          {[["X","x",0,COLS],["Y","y",0,ROWS],["W","w",1,COLS*2],["H","h",1,ROWS*2]].map(([l,k,mn,mx2])=>(
                            <div key={k}>
                              <label style={{fontFamily:MONO,fontSize:"0.62rem",color:GOLD_DIM,display:"block",marginBottom:2,textTransform:"uppercase"}}>{l}</label>
                              <input type="number" min={mn} max={mx2} value={bgImage[k]}
                                onChange={e=>setBgImage(b=>({...b,[k]:parseInt(e.target.value)||0}))}
                                style={inp({padding:"3px 6px",fontSize:"0.75rem"})} />
                            </div>
                          ))}
                        </div>
                        <button onClick={()=>bgFileRef.current?.click()} style={{
                          padding:"0.4rem",borderRadius:6,cursor:"pointer",background:"transparent",
                          border:`1px dashed ${BORDER}`,color:MUTED,fontFamily:MONO,fontSize:"0.7rem"}}>Replace image</button>
                      </div>
                  }
                  <input ref={bgFileRef} type="file" accept="image/*" onChange={loadBgImage} style={{display:"none"}} />
                </div>

                {groupedItems.length>0&&(
                  <div style={{borderTop:`1px solid ${BORDER}`,paddingTop:"0.9rem"}}>
                    {lbl("Placed")}
                    {groupedItems.map(g=>{
                      const info=ITEM_TYPES[g.type];
                      return(
                        <div key={`${g.type}:${g.dept}`}
                          style={{display:"flex",alignItems:"center",gap:"0.4rem",marginBottom:"0.35rem"}}>
                          <div style={{width:7,height:7,borderRadius:2,background:info?.color||GOLD,flexShrink:0}}/>
                          <span style={{fontFamily:MONO,fontSize:"0.72rem",color:info?.color||GOLD,fontWeight:700,width:22}}>{g.dept}</span>
                          <span style={{fontFamily:MONO,fontSize:"0.65rem",color:MUTED,flex:1}}>{info?.label}</span>
                          <span style={{fontFamily:MONO,fontSize:"0.72rem",color:info?.color||GOLD,fontWeight:700}}>{g.items.length}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* ─── EDIT TAB ─── */}
            {panelTab==="edit"&&(
              <div style={{display:"flex",flexDirection:"column",gap:"0.9rem"}}>
                {!selectedItem
                  ? <div style={{color:MUTED,fontFamily:MONO,fontSize:"0.82rem",
                      marginTop:"2rem",textAlign:"center",lineHeight:1.7}}>
                      Select an item<br/>to edit its properties
                    </div>
                  : <>
                  <div>
                    <div style={{fontFamily:SERIF,fontSize:"1.15rem",fontWeight:700,color:CREAM,
                      letterSpacing:"-0.01em",marginBottom:2}}>
                      {selectedItem.label||selectedItem.dept||"Item"}
                    </div>
                    <div style={{fontFamily:MONO,fontSize:"0.65rem",color:GOLD_DIM,letterSpacing:"0.1em",textTransform:"uppercase"}}>
                      {selectedItem.type}{selectedItem.tempZone?` · ${selectedItem.tempZone}`:""}
                    </div>
                  </div>

                  <div style={{height:1,background:BORDER}}/>

                  {/* Drag hint */}
                  <div style={{background:"rgba(255,255,255,0.02)",border:`1px solid ${BORDER}`,borderRadius:6,
                    padding:"6px 10px",fontFamily:MONO,fontSize:"0.68rem",color:MUTED,lineHeight:1.6}}>
                    <span style={{color:GOLD}}>Tip — </span>Hold & drag to reposition this item
                  </div>

                  <div style={{height:1,background:BORDER}}/>

                  <div>
                    {fieldLabel("Dept / Label")}
                    <input value={selectedItem.dept||""}
                      onChange={e=>updateItem("dept",e.target.value.toUpperCase())} style={inp()} />
                  </div>

                  {selectedItem.type!=="zone"&&(
                    <div>
                      {fieldLabel("Number")}
                      <input type="number" value={selectedItem.num||""}
                        onChange={e=>updateItem("num",parseInt(e.target.value)||1)} style={inp()} />
                    </div>
                  )}

                  {selectedItem.type!=="zone"&&selectedItem.tempZone!=="endcap"&&selectedItem.tempZone!=="action_alley"&&(
                    <div>
                      {fieldLabel("Sections",selectedItem.sections)}
                      <div style={{display:"flex",gap:"0.4rem",alignItems:"center"}}>
                        <input type="range" min={1} max={60} value={Math.min(selectedItem.sections,60)}
                          onChange={e=>updateItem("sections",parseInt(e.target.value))}
                          style={{flex:1,accentColor:GOLD}} />
                        <input type="number" min={1} max={999} value={selectedItem.sections}
                          onChange={e=>updateItem("sections",parseInt(e.target.value)||1)}
                          style={inp({width:48,padding:"3px 6px"})} />
                      </div>
                    </div>
                  )}

                  {selectedItem.type==="shelf"&&selectedItem.tempZone==="endcap"&&
                    infoBox("🔖 Endcap — always exactly 1 pick node at the centre of the pick edge.",GOLD)}

                  {selectedItem.type==="shelf"&&(
                    <div>
                      {lbl("Temperature Zone")}
                      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"0.3rem"}}>
                        {Object.entries(TEMP_ZONES).map(([k,z])=>(
                          <button key={k} onClick={()=>{updateItem("tempZone",k);updateItem("color",z.color);}}
                            style={chip((selectedItem.tempZone||"ambient")===k,z.color)}>{z.label}</button>
                        ))}
                      </div>
                    </div>
                  )}

                  {selectedItem.type==="shelf"&&selectedItem.tempZone==="action_alley"&&(
                    <div style={{display:"flex",flexDirection:"column",gap:"0.5rem"}}>
                      <div>
                        {lbl("Nodes")}
                        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"0.3rem"}}>
                          {[["2","2 Nodes"],["4","4 Nodes"]].map(([v,l])=>(
                            <button key={v} onClick={()=>updateItem("aaNodes",v)}
                              style={chip((selectedItem.aaNodes||"2")===v,"#f97316")}>{l}</button>
                          ))}
                        </div>
                      </div>
                      {(selectedItem.aaNodes||"2")==="2"&&(
                        <div>
                          {lbl("Pick Sides")}
                          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"0.3rem"}}>
                            {[["lr","◀ L+R ▶"],["tb","▲ T+B ▼"]].map(([v,l])=>(
                              <button key={v} onClick={()=>updateItem("pickSide",v)}
                                style={{...chip((selectedItem.pickSide||"lr")===v,"#f97316"),fontSize:"0.7rem"}}>{l}</button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {selectedItem.type==="shelf"&&selectedItem.tempZone!=="action_alley"&&(()=>{
                    const isV=selectedItem.h>selectedItem.w, isQ=selectedItem.h===selectedItem.w;
                    const sides=isQ
                      ?[["top","▲ Top"],["bottom","▼ Bottom"],["left","◀ Left"],["right","▶ Right"]]
                      :isV?[["left","◀ Left"],["right","▶ Right"]]:[["top","▲ Top"],["bottom","▼ Bottom"]];
                    const cur=selectedItem.pickSide||defaultPickSide(isV,isQ);
                    return(
                      <div>
                        {lbl("Pick Side")}
                        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"0.3rem"}}>
                          {sides.map(([side,l])=>(
                            <button key={side} onClick={()=>updateItem("pickSide",side)}
                              style={chip(cur===side)}>{l}</button>
                          ))}
                        </div>
                      </div>
                    );
                  })()}

                  <div>
                    {lbl("Position & Size")}
                    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"0.4rem"}}>
                      {[["Col","c"],["Row","r"],["Width","w"],["Height","h"]].map(([l,k])=>(
                        <div key={k}>
                          <label style={{fontFamily:MONO,fontSize:"0.62rem",color:GOLD_DIM,
                            display:"block",marginBottom:2,textTransform:"uppercase"}}>{l}</label>
                          <input type="number" min={0} value={selectedItem[k]||0}
                            onChange={e=>updateItem(k,parseInt(e.target.value)||0)}
                            style={inp({padding:"3px 6px",fontSize:"0.78rem"})} />
                        </div>
                      ))}
                    </div>
                  </div>

                  {selectedItem.type==="shelf"&&selectedItem.tempZone!=="action_alley"&&(
                    <div>
                      {lbl("Link Aisle")}
                      {selectedItem.linkedId
                        ? <div style={{display:"flex",gap:"0.35rem",alignItems:"center"}}>
                            <div style={{flex:1,background:"rgba(255,255,255,0.03)",
                              border:`1px solid ${GOLD}44`,borderRadius:6,
                              padding:"4px 8px",fontFamily:MONO,fontSize:"0.75rem",color:GOLD}}>Linked ✓</div>
                            <button onClick={()=>{const pid=selectedItem.linkedId;
                              setItems(p=>p.map(it=>it.id===selectedId||it.id===pid?{...it,linkedId:undefined}:it));}}
                              style={{padding:"4px 8px",borderRadius:5,cursor:"pointer",background:"transparent",
                                border:`1px solid #f43f5e44`,color:"#f43f5e",fontFamily:MONO,fontSize:"0.75rem"}}>✕</button>
                          </div>
                        : <button onClick={()=>{setMode("select");setLinkPickMode(true);}}
                            style={{width:"100%",padding:"0.45rem 0.75rem",borderRadius:6,cursor:"pointer",
                              background:"transparent",border:`1px solid ${GOLD}44`,
                              color:GOLD,fontFamily:MONO,fontSize:"0.75rem",letterSpacing:"0.03em"}}>
                            ⛓ Link to another aisle
                          </button>
                      }
                    </div>
                  )}

                  <div>
                    {fieldLabel("Color")}
                    <input type="color" value={selectedItem.color||GOLD}
                      onChange={e=>updateItem("color",e.target.value)}
                      style={{width:32,height:24,border:`1px solid ${BORDER}`,borderRadius:4,cursor:"pointer",background:"none",padding:2}} />
                  </div>

                  {selectedItem.type==="shelf"&&(
                    <div style={{display:"flex",alignItems:"center",gap:"0.5rem"}}>
                      <label style={{fontFamily:MONO,fontSize:"0.7rem",color:MUTED,
                        letterSpacing:"0.1em",textTransform:"uppercase",flex:1,cursor:"pointer"}}>
                        Exclude from route
                      </label>
                      <input type="checkbox" checked={!!selectedItem.excluded}
                        onChange={e=>updateItem("excluded",e.target.checked)}
                        style={{accentColor:"#f43f5e",width:14,height:14,cursor:"pointer"}} />
                    </div>
                  )}

                  {/* Unreachable warning for this item */}
                  {unreachable.length > 0 && selectedItem.type === "shelf" && (() => {
                    const label = `${selectedItem.dept||""}${selectedItem.num||""}`;
                    const badCodes = unreachable.filter(c => c.startsWith(label+"-"));
                    if (!badCodes.length) return null;
                    return infoBox(`⚠️ ${badCodes.length} node${badCodes.length>1?"s":""} from this shelf were unreachable during last optimization. Check for walls or shelves blocking its pick side.`, "#f97316");
                  })()}

                  <div style={{height:1,background:BORDER}}/>

                  <button onClick={()=>{
                    const pid=selectedItem?.linkedId;
                    pushUndo(items, walls);
                    setItems(p=>p.filter(it=>it.id!==selectedId).map(it=>it.id===pid?{...it,linkedId:undefined}:it));
                    setSelectedId(null);
                  }} style={{
                    width:"100%",padding:"0.5rem",borderRadius:6,cursor:"pointer",
                    background:"transparent",border:`1px solid #f43f5e44`,
                    color:"#f43f5e",fontFamily:MONO,fontSize:"0.78rem",letterSpacing:"0.04em",
                  }}>🗑 Delete Item</button>
                  </>
                }
              </div>
            )}

            {/* ─── ROUTE TAB ─── */}
            {panelTab==="route"&&(
              <div style={{display:"flex",flexDirection:"column",gap:"0.9rem"}}>
                {lbl("Pick Path")}

                {/* Unreachable summary */}
                {unreachable.length > 0 && (
                  <div style={{background:"#f9731611",border:"1px solid #f9731644",borderRadius:8,
                    padding:"8px 12px",fontSize:"0.75rem",color:"#f97316",fontFamily:MONO,lineHeight:1.7}}>
                    <div style={{fontWeight:700,marginBottom:4}}>⚠ {unreachable.length} Unreachable Node{unreachable.length>1?"s":""}</div>
                    <div style={{color:"#f9731699",marginBottom:6}}>{unreachable.slice(0,8).join(", ")}{unreachable.length>8?" …":""}</div>
                    <div style={{color:MUTED,fontSize:"0.7rem"}}>Possible causes: walls blocking pick sides, shelves touching edges, or enclosed areas.</div>
                  </div>
                )}

                {!simStats
                  ? <div style={{color:MUTED,fontFamily:MONO,fontSize:"0.8rem",
                      lineHeight:1.7,marginTop:"0.5rem"}}>
                      Place shelves, set <span style={{color:GOLD}}>S</span>/<span style={{color:"#f43f5e"}}>E</span> markers, then hit <strong style={{color:CREAM}}>Optimize</strong>.
                    </div>
                  : <>
                  <div style={{background:"rgba(255,255,255,0.03)",border:`1px solid ${BORDER}`,
                    borderRadius:10,padding:"0.75rem 1rem"}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-end"}}>
                      {[["Aisles",simStats.aisles],["Sections",simStats.sections],["Cells",simStats.cost.toLocaleString()]].map(([l,v])=>(
                        <div key={l} style={{textAlign:"center"}}>
                          <div style={{fontFamily:SERIF,fontSize:"1.4rem",color:GOLD,fontWeight:700,lineHeight:1}}>{v}</div>
                          <div style={{fontFamily:MONO,fontSize:"0.6rem",color:MUTED,textTransform:"uppercase",letterSpacing:"0.12em",marginTop:3}}>{l}</div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div style={{position:"relative"}}>
                    <input value={routeSearch}
                      onChange={e=>{setRouteSearch(e.target.value);setHighlightedAisleId(null);setHighlightedSecIdx(null);}}
                      placeholder="Search aisle… (e.g. G2)"
                      style={{...inp({padding:"0.4rem 0.75rem",fontSize:"0.78rem"}),paddingRight:24}} />
                    {routeSearch&&(
                      <button onClick={()=>{setRouteSearch("");setHighlightedAisleId(null);setHighlightedSecIdx(null);}}
                        style={{position:"absolute",right:6,top:"50%",transform:"translateY(-50%)",
                          background:"none",border:"none",color:MUTED,cursor:"pointer",fontSize:"0.9rem",padding:0}}>✕</button>
                    )}
                  </div>

                  {lbl("Aisle Order")}
                  <div ref={aisleListRef}
                    style={{borderTop:`1px solid ${BORDER}`,paddingTop:"0.35rem",maxHeight:150,overflowY:"auto"}}>
                    {(()=>{
                      const q=routeSearch.trim().toLowerCase();
                      const filtered=aisleOrder.map((shelf,i)=>({shelf,i})).filter(({shelf})=>
                        !q||`${shelf.dept||""}${shelf.num||""}`.toLowerCase().includes(q));
                      if(q&&!filtered.length) return(
                        <div style={{fontFamily:MONO,fontSize:"0.72rem",color:MUTED,padding:"4px 6px"}}>No matches</div>);
                      return filtered.map(({shelf,i})=>{
                        const col=(shelf.tempZone&&TEMP_ZONES[shelf.tempZone]?.color)||GOLD;
                        const active=highlightedAisleId===shelf.id;
                        const hasUnreachable = unreachable.some(c => c.startsWith(`${shelf.dept||""}${shelf.num||""}-`));
                        return(
                          <div key={shelf.id} data-aisleid={shelf.id}
                            onClick={()=>{
                              setHighlightedAisleId(shelf.id);
                              const idx=sectionSeq.findIndex(s=>s.aisle?.id===shelf.id);
                              setHighlightedSecIdx(idx>=0?idx:null);
                            }}
                            style={{display:"flex",alignItems:"center",gap:"0.4rem",
                              padding:"0.3rem 0.5rem",borderRadius:6,marginBottom:2,cursor:"pointer",
                              background:active?col+"1a":"transparent",
                              borderLeft:`2px solid ${active?col:"transparent"}`,transition:"all 0.15s"}}>
                            <span style={{fontFamily:MONO,fontSize:"0.6rem",color:MUTED,width:16,textAlign:"right"}}>{i+1}</span>
                            <span style={{fontFamily:MONO,fontSize:"0.78rem",fontWeight:700,color:active?col:CREAM,flex:1}}>{shelf.dept}{shelf.num}</span>
                            {hasUnreachable && <span title="Has unreachable nodes" style={{color:"#f97316",fontSize:"0.7rem"}}>⚠</span>}
                            <span style={{fontFamily:MONO,fontSize:"0.62rem",color:MUTED}}>§{shelf.sections}</span>
                          </div>
                        );
                      });
                    })()}
                  </div>

                  {lbl("Section Sequence")}
                  <div ref={sectionListRef}
                    style={{borderTop:`1px solid ${BORDER}`,paddingTop:"0.35rem",maxHeight:260,overflowY:"auto"}}>
                    {(()=>{
                      const els=[]; let lastTz=null;
                      sectionSeq.forEach((s,i)=>{
                        const tz=TEMP_ZONES[s.tempZone]||TEMP_ZONES.ambient;
                        if(s.tempZone!==lastTz){
                          lastTz=s.tempZone;
                          const icons={chilled:"❄",frozen:"🧊",action_alley:"📣"};
                          els.push(<div key={"hdr"+i} style={{fontFamily:MONO,fontSize:"0.65rem",fontWeight:700,
                            color:tz.color,letterSpacing:"0.12em",textTransform:"uppercase",
                            marginTop:i>0?"0.6rem":0,marginBottom:"0.2rem",paddingLeft:2}}>
                            {icons[s.tempZone]||"🌡"} {tz.label}</div>);
                        }
                        const isTarget=highlightedSecIdx===i;
                        const isSame=highlightedAisleId&&s.aisle?.id===highlightedAisleId;
                        const isUnreachable = unreachable.includes(s.code);
                        els.push(
                          <div key={s.code+"_"+i} data-secidx={i}
                            style={{display:"flex",alignItems:"center",gap:"0.3rem",
                              padding:"0.15rem 0.5rem",borderRadius:4,marginBottom:1,
                              background:isTarget?GOLD+"22":isSame?(tz.color+"18"):"transparent",
                              borderLeft:`2px solid ${isTarget?GOLD:isSame?(tz.color+"66"):"transparent"}`}}>
                            <span style={{fontFamily:MONO,fontSize:"0.6rem",color:MUTED,width:20,textAlign:"right"}}>{i+1}</span>
                            <span style={{fontFamily:MONO,fontSize:"0.72rem",flex:1,
                              color:isUnreachable?"#f97316":isTarget?GOLD:tz.color,fontWeight:isTarget||isUnreachable?700:400}}>
                              {s.code}{isUnreachable?" ⚠":""}
                            </span>
                          </div>
                        );
                      });
                      return els;
                    })()}
                  </div>

                  <div style={{display:"flex",gap:"0.4rem"}}>
                    <button onClick={()=>{
                      const lines=["PICK PATH — "+new Date().toLocaleString(),"","AISLE ORDER:",""];
                      aisleOrder.forEach((s,i)=>lines.push(String(i+1).padStart(3)+" . "+s.dept+s.num+"  §"+s.sections));
                      lines.push("","SECTION SEQUENCE:","");
                      sectionSeq.forEach((s,i)=>{const tz=TEMP_ZONES[s.tempZone]||TEMP_ZONES.ambient;lines.push(String(i+1).padStart(5)+". "+s.code.padEnd(14)+" ["+tz.label+"]");});
                      if(unreachable.length){lines.push("","UNREACHABLE NODES:","");unreachable.forEach(c=>lines.push("  ! "+c));}
                      const a=document.createElement("a");a.href=URL.createObjectURL(new Blob([lines.join("\n")],{type:"text/plain"}));a.download="pick-path.txt";a.click();
                    }} style={{flex:1,padding:"0.45rem",borderRadius:6,cursor:"pointer",background:"transparent",
                      border:`1px solid ${GOLD}44`,color:GOLD,fontFamily:MONO,fontSize:"0.72rem",letterSpacing:"0.04em"}}>⬇ TXT</button>
                    <button onClick={()=>{
                      const rows=[["Step","Code","Shelf","Section","Zone","Unreachable"]];
                      sectionSeq.forEach((s,i)=>{const tz=TEMP_ZONES[s.tempZone]||TEMP_ZONES.ambient;rows.push([i+1,s.code,(s.aisle?.dept||"")+(s.aisle?.num||""),s.section,tz.label,unreachable.includes(s.code)?"YES":""]);});
                      const a=document.createElement("a");a.href=URL.createObjectURL(new Blob([rows.map(r=>r.join(",")).join("\n")],{type:"text/csv"}));a.download="pick-path.csv";a.click();
                    }} style={{flex:1,padding:"0.45rem",borderRadius:6,cursor:"pointer",background:"transparent",
                      border:`1px solid #4ade8044`,color:"#4ade80",fontFamily:MONO,fontSize:"0.72rem",letterSpacing:"0.04em"}}>⬇ CSV</button>
                  </div>
                  </>
                }
              </div>
            )}

          </div>
    </>
  );

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div style={{height:"100vh",background:DARK,color:CREAM,fontFamily:SANS,
      display:"flex",flexDirection:"column",overflow:"hidden"}}>

      {/* ══ TOAST NOTIFICATIONS ══ */}
      <div style={{position:"fixed",top:60,right:16,zIndex:9999,
        display:"flex",flexDirection:"column",gap:8,maxWidth: isMobile ? "calc(100vw - 32px)" : 400,pointerEvents:"none"}}>
        {toasts.map(t => (
          <div key={t.id} style={{
            padding:"10px 14px", borderRadius:8, fontFamily:MONO, fontSize:"0.78rem",
            lineHeight:1.6, pointerEvents:"auto",
            background: t.type==="error" ? "#1a0a0a" : "#1a1400",
            border: `1px solid ${t.type==="error" ? "#f43f5e88" : "#F1C50088"}`,
            color: t.type==="error" ? "#f87171" : GOLD,
            boxShadow:"0 4px 24px rgba(0,0,0,0.5)",
            animation:"slideIn 0.2s ease",
          }}>
            {t.msg}
          </div>
        ))}
      </div>
      <style>{`
        @keyframes slideIn{from{opacity:0;transform:translateX(20px)}to{opacity:1;transform:none}}
        @keyframes sheetUp{from{transform:translateY(100%)}to{transform:translateY(0)}}
        * { -webkit-tap-highlight-color: transparent; }
      `}</style>

      {/* ══ HEADER — DESKTOP ══ */}
      {!isMobile && (
        <header style={{
          position:"relative",zIndex:100,flexShrink:0,
          background:"rgba(26,15,10,0.92)",backdropFilter:"blur(16px)",
          borderBottom:`1px solid ${BORDER}`,
          padding:"0.6rem 1.25rem",
          display:"flex",alignItems:"center",gap:"0.6rem"
        }}>
          {/* Logo */}
          <div style={{marginRight:"0.75rem",flexShrink:0}}>
            <div style={{fontFamily:SERIF,fontSize:"1.1rem",fontWeight:900,color:GOLD,letterSpacing:"-0.02em",lineHeight:1.1}}>
              Store Map Builder
            </div>
            <div style={{fontFamily:MONO,fontSize:"0.6rem",color:GOLD_DIM,letterSpacing:"0.2em",textTransform:"uppercase"}}>
              Aisles · Routing · Optimization
            </div>
          </div>

          <div style={{width:1,height:28,background:BORDER,flexShrink:0,margin:"0 0.25rem"}}/>

          {[["draw","✏ Draw","D"],["select","↖ Select","S"],["erase","⌫ Erase","E"]].map(([m,label,key])=>(
            <button key={m} onClick={()=>setMode(m)} title={`${label} (${key})`} style={{
              padding:"0.3rem 0.75rem", borderRadius:100, cursor:"pointer",
              fontFamily:MONO, fontSize:"0.72rem", fontWeight:500,
              letterSpacing:"0.08em", textTransform:"uppercase", transition:"all 0.2s",
              background: mode===m ? modeCol[m]+"22" : "transparent",
              border: `1px solid ${mode===m ? modeCol[m] : BORDER}`,
              color: mode===m ? modeCol[m] : MUTED,
            }}>
              {label}
              <span style={{marginLeft:5,fontSize:"0.6rem",opacity:0.5,fontWeight:400}}>[{key}]</span>
            </button>
          ))}

          <div style={{display:"flex",alignItems:"center",gap:2,
            background:"rgba(255,255,255,0.03)",border:`1px solid ${BORDER}`,
            borderRadius:8,padding:"2px 6px",marginLeft:"0.25rem"}}>
            <button onClick={()=>setZoom(z=>parseFloat(Math.max(0.1,z/1.25).toFixed(3)))}
              style={{background:"none",border:"none",color:GOLD,cursor:"pointer",fontSize:"1.1rem",fontWeight:700,lineHeight:1,padding:"0 4px"}}>−</button>
            <span style={{fontFamily:MONO,fontSize:"0.7rem",color:GOLD,minWidth:36,textAlign:"center"}}>{Math.round(zoom*100)}%</span>
            <button onClick={()=>setZoom(z=>parseFloat(Math.min(8,z*1.25).toFixed(3)))}
              style={{background:"none",border:"none",color:GOLD,cursor:"pointer",fontSize:"1.1rem",fontWeight:700,lineHeight:1,padding:"0 4px"}}>+</button>
            <div style={{width:1,height:14,background:BORDER,margin:"0 3px"}}/>
            <button onClick={()=>{setZoom(1);setPan({x:0,y:0});}}
              style={{background:"none",border:"none",color:MUTED,cursor:"pointer",fontFamily:MONO,fontSize:"0.65rem",padding:"0 3px"}}>1:1</button>
            <button onClick={fitView}
              style={{background:"none",border:"none",color:MUTED,cursor:"pointer",fontFamily:MONO,fontSize:"0.65rem",padding:"0 3px"}}>FIT</button>
          </div>

          <div style={{display:"flex",gap:2}}>
            {[["↩","Undo (Ctrl+Z)",undo,undoStack.current.length===0],
              ["↪","Redo (Ctrl+Y)",redo,redoStack.current.length===0]].map(([icon,title,fn,disabled])=>(
              <button key={icon} onClick={fn} title={title} disabled={disabled} style={{
                padding:"0.3rem 0.6rem",borderRadius:6,cursor:disabled?"not-allowed":"pointer",
                background:"transparent",border:`1px solid ${BORDER}`,
                color:disabled?MUTED:CREAM,fontFamily:MONO,fontSize:"0.85rem",opacity:disabled?0.4:1,transition:"all 0.2s"
              }}>{icon}</button>
            ))}
          </div>

          <div style={{marginLeft:"auto",display:"flex",gap:"0.4rem",alignItems:"center"}}>
            <span style={{fontFamily:MONO,fontSize:"0.65rem",color:MUTED,marginRight:4}}>
              {items.filter(it=>it.type!=="zone").length} items
            </span>
            <button onClick={()=>setShowRoute(r=>!r)} style={{
              padding:"0.3rem 0.75rem",borderRadius:100,cursor:"pointer",
              fontFamily:MONO,fontSize:"0.72rem",fontWeight:500,letterSpacing:"0.06em",transition:"all 0.2s",
              background: showRoute ? GOLD+"22":"transparent",
              border: `1px solid ${showRoute ? GOLD : BORDER}`,
              color: showRoute ? GOLD : MUTED,
            }}>{showRoute?"● Path":"○ Path"}</button>
            <button onClick={runRoute} disabled={optimizing} style={{
              padding:"0.35rem 1rem",borderRadius:6,cursor:optimizing?"not-allowed":"pointer",
              fontFamily:SANS,fontSize:"0.82rem",fontWeight:700,letterSpacing:"0.03em",transition:"all 0.2s",
              background: optimizing ? "transparent" : GOLD,
              border: `1px solid ${optimizing ? BORDER : GOLD}`,
              color: optimizing ? MUTED : DARK,
            }}>{optimizing?"⏳ Running…":"▶ Optimize"}</button>
            <div style={{width:1,height:20,background:BORDER}}/>
            {[
              ["⟳ Collide", recheckCollisions, GOLD, "Re-check pick-node collisions"],
              ["💾 Save",    saveMap,            CREAM, ""],
            ].map(([label,fn,col,title])=>(
              <button key={label} onClick={fn} title={title} style={{
                padding:"0.3rem 0.75rem",borderRadius:6,cursor:"pointer",
                fontFamily:MONO,fontSize:"0.7rem",fontWeight:500,letterSpacing:"0.04em",transition:"all 0.2s",
                background:"transparent",border:`1px solid ${BORDER}`,color:col,
              }}>{label}</button>
            ))}
            <button onClick={()=>loadFileRef.current?.click()} style={{
              padding:"0.3rem 0.75rem",borderRadius:6,cursor:"pointer",
              fontFamily:MONO,fontSize:"0.7rem",fontWeight:500,letterSpacing:"0.04em",transition:"all 0.2s",
              background:"transparent",border:`1px solid ${BORDER}`,color:CREAM,
            }}>📂 Load</button>
            <input ref={loadFileRef} type="file" accept=".json" onChange={loadMap} style={{display:"none"}} />
            <button onClick={()=>{if(window.confirm("Clear everything?")){
              pushUndo(items,walls);
              setItems([]);setWalls([]);setSelectedId(null);}}}
              style={{padding:"0.3rem 0.75rem",borderRadius:6,cursor:"pointer",
                background:"transparent",border:`1px solid ${"#f43f5e44"}`,color:"#f43f5e88"}}>Clear</button>
          </div>
        </header>
      )}

      {/* ══ HEADER — MOBILE ══ */}
      {isMobile && (
        <header style={{
          zIndex:100,flexShrink:0,
          background:"rgba(26,15,10,0.97)",
          borderBottom:`1px solid ${BORDER}`,
          padding:"0.5rem 0.75rem",
          display:"flex",alignItems:"center",gap:"0.5rem",
        }}>
          {/* Logo (compact) */}
          <div style={{fontFamily:SERIF,fontSize:"0.95rem",fontWeight:900,color:GOLD,letterSpacing:"-0.02em",flexShrink:0}}>
            SMB
          </div>

          <div style={{width:1,height:22,background:BORDER,flexShrink:0}}/>

          {/* Mode pills — icons only */}
          {[["draw","✏","D"],["select","↖","S"],["erase","⌫","E"]].map(([m,icon])=>(
            <button key={m} onClick={()=>setMode(m)} style={{
              width:36,height:36,borderRadius:8,cursor:"pointer",
              display:"flex",alignItems:"center",justifyContent:"center",
              fontSize:"1rem",flexShrink:0,transition:"all 0.15s",
              background: mode===m ? modeCol[m]+"22" : "transparent",
              border: `1px solid ${mode===m ? modeCol[m] : BORDER}`,
              color: mode===m ? modeCol[m] : MUTED,
            }}>{icon}</button>
          ))}

          <div style={{width:1,height:22,background:BORDER,flexShrink:0}}/>

          {/* Zoom − + */}
          <button onClick={()=>setZoom(z=>parseFloat(Math.max(0.1,z/1.25).toFixed(3)))}
            style={{width:32,height:32,borderRadius:6,background:"none",border:`1px solid ${BORDER}`,
              color:GOLD,cursor:"pointer",fontSize:"1.2rem",fontWeight:700,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>−</button>
          <span style={{fontFamily:MONO,fontSize:"0.65rem",color:GOLD,minWidth:30,textAlign:"center",flexShrink:0}}>{Math.round(zoom*100)}%</span>
          <button onClick={()=>setZoom(z=>parseFloat(Math.min(8,z*1.25).toFixed(3)))}
            style={{width:32,height:32,borderRadius:6,background:"none",border:`1px solid ${BORDER}`,
              color:GOLD,cursor:"pointer",fontSize:"1.2rem",fontWeight:700,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>+</button>
          <button onClick={fitView}
            style={{width:32,height:32,borderRadius:6,background:"none",border:`1px solid ${BORDER}`,
              color:MUTED,cursor:"pointer",fontFamily:MONO,fontSize:"0.6rem",flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center"}}>FIT</button>

          {/* Spacer */}
          <div style={{flex:1}}/>

          {/* Optimize */}
          <button onClick={runRoute} disabled={optimizing} style={{
            padding:"0.35rem 0.6rem",borderRadius:6,cursor:optimizing?"not-allowed":"pointer",
            fontFamily:SANS,fontSize:"0.75rem",fontWeight:700,flexShrink:0,
            background: optimizing ? "transparent" : GOLD,
            border: `1px solid ${optimizing ? BORDER : GOLD}`,
            color: optimizing ? MUTED : DARK,
          }}>{optimizing?"⏳":"▶"}</button>

          {/* Save */}
          <button onClick={saveMap} style={{
            width:36,height:36,borderRadius:6,cursor:"pointer",flexShrink:0,
            background:"transparent",border:`1px solid ${BORDER}`,color:CREAM,
            display:"flex",alignItems:"center",justifyContent:"center",fontSize:"1rem",
          }}>💾</button>

          {/* Panel toggle */}
          <button onClick={()=>setSheetOpen(o=>!o)} style={{
            width:36,height:36,borderRadius:8,cursor:"pointer",flexShrink:0,
            background: sheetOpen ? GOLD+"22" : "transparent",
            border: `1px solid ${sheetOpen ? GOLD : BORDER}`,
            color: sheetOpen ? GOLD : MUTED,
            display:"flex",alignItems:"center",justifyContent:"center",fontSize:"1rem",
          }}>☰</button>
        </header>
      )}

      {/* ══ BODY ══ */}
      <div style={{flex:1,display:"flex",overflow:"hidden",position:"relative",
        flexDirection: isMobile ? "column" : "row"}}>

        {/* ══ SIDE PANEL — DESKTOP ══ */}
        {!isMobile && (
          <aside style={{
            width:244,flexShrink:0,
            background:"#160C08",
            borderRight:`1px solid ${BORDER}`,
            display:"flex",flexDirection:"column",overflow:"hidden",
          }}>
            {/* Panel tabs */}
            <div style={{display:"flex",borderBottom:`1px solid ${BORDER}`,flexShrink:0}}>
              {[["draw","Draw"],["edit","Edit"],["route","Route"]].map(([id,label])=>(
                <button key={id} onClick={()=>setPanelTab(id)} style={tab(panelTab===id)}>{label}</button>
              ))}
            </div>
            <div style={{flex:1,overflowY:"auto",padding:"1rem 0.875rem",
              scrollbarWidth:"thin",scrollbarColor:`${GOLD_DIM} transparent`}}>
              {renderPanelContent()}
            </div>
          </aside>
        )}

        {/* ══ CANVAS AREA ══ */}
        <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden",minWidth:0}}>

          {linkPickMode&&(
            <div style={{flexShrink:0,background:"#2C1810",borderBottom:`1px solid ${GOLD}44`,
              padding:"0.4rem 1rem",display:"flex",alignItems:"center",gap:"0.5rem",
              fontFamily:MONO,fontSize:"0.75rem",color:GOLD,fontWeight:600}}>
              ⛓ Link Mode — click a shelf to link with&nbsp;
              <span style={{color:CREAM}}>{selectedItem?.dept}{selectedItem?.num}</span>
              <button onClick={()=>setLinkPickMode(false)}
                style={{marginLeft:"auto",padding:"2px 10px",borderRadius:4,cursor:"pointer",
                  background:"transparent",border:`1px solid ${GOLD}44`,color:GOLD,
                  fontFamily:MONO,fontSize:"0.7rem"}}>✕ Cancel</button>
            </div>
          )}

          {/* Stacked canvas container */}
          <div ref={mapContainerRef}
            style={{flex:1,overflow:"hidden",background:"#0D0805",position:"relative",
              cursor: dragItemPreview ? "grabbing"
                : isPanningRef.current ? "grabbing"
                : linkPickMode ? "cell"
                : mode==="draw" ? "crosshair"
                : mode==="erase" ? "not-allowed"
                : "default",
              touchAction:"none"}}
            onMouseDown={onMouseDown} onMouseMove={onMouseMove} onMouseUp={onMouseUp}
            onMouseLeave={onMouseLeave} onContextMenu={e=>e.preventDefault()}>

            <div style={{position:"absolute",transform:`translate(${pan.x}px,${pan.y}px)`,transformOrigin:"0 0",pointerEvents:"none"}}>
              <canvas ref={canvasRef} style={{display:"block"}} />
            </div>
            <div style={{position:"absolute",transform:`translate(${pan.x}px,${pan.y}px)`,transformOrigin:"0 0",pointerEvents:"none"}}>
              <canvas ref={overlayCanvasRef} style={{display:"block"}} />
            </div>

            {/* Optimization overlay */}
            {optimizing&&(
              <div style={{position:"absolute",inset:0,zIndex:10,
                background:"rgba(13,8,5,0.88)",backdropFilter:"blur(8px)",
                display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:"1rem",
                padding:"1rem"}}>
                <div style={{fontFamily:SERIF,fontSize: isMobile ? "1.2rem" : "1.6rem",fontWeight:900,color:CREAM,letterSpacing:"-0.02em",textAlign:"center"}}>
                  Optimizing Route
                </div>
                <div style={{fontFamily:MONO,fontSize:"0.65rem",color:GOLD_DIM,letterSpacing:"0.15em",textTransform:"uppercase",textAlign:"center"}}>
                  NN → 2-opt → Or-opt → 3-opt → Or-opt → 2-opt
                </div>
                {optProgress.total>0
                  ? <>
                    <div style={{width: isMobile ? "80%" : 280,height:3,background:`rgba(212,175,55,0.15)`,borderRadius:2,overflow:"hidden"}}>
                      <div style={{height:"100%",borderRadius:2,transition:"width 0.15s ease",
                        background:`linear-gradient(90deg,${GOLD_DIM},${GOLD})`,
                        width:`${Math.round(optProgress.done/optProgress.total*100)}%`}} />
                    </div>
                    <div style={{fontFamily:MONO,fontSize:"0.72rem",color:MUTED}}>
                      {Math.round(optProgress.done/optProgress.total*100)}%
                      &nbsp;·&nbsp;{optProgress.done} / {optProgress.total} sections
                    </div>
                  </>
                  : <div style={{fontFamily:MONO,fontSize:"0.72rem",color:MUTED}}>Building node graph…</div>
                }
                <button onClick={()=>{
                  workerRef.current?.terminate(); workerRef.current=null;
                  clearTimeout(workerTimerRef.current); workerTimerRef.current=null;
                  setOptimizing(false);
                }} style={{marginTop:"0.5rem",padding:"0.45rem 1.25rem",borderRadius:6,cursor:"pointer",
                  background:"transparent",border:`1px solid #f43f5e44`,
                  color:"#f43f5e",fontFamily:MONO,fontSize:"0.75rem",letterSpacing:"0.04em"}}>
                  ✕ Cancel
                </button>
              </div>
            )}
          </div>
        </div>

        {/* ══ BOTTOM SHEET — MOBILE ══ */}
        {isMobile && (
          <>
            {/* Scrim */}
            {sheetOpen && (
              <div onClick={()=>setSheetOpen(false)}
                style={{position:"absolute",inset:0,zIndex:199,background:"rgba(0,0,0,0.5)"}} />
            )}
            <div style={{
              position:"absolute",bottom:0,left:0,right:0,
              zIndex:200,
              background:"#160C08",
              borderTop:`1px solid ${BORDER}`,
              borderRadius:"16px 16px 0 0",
              maxHeight: sheetOpen ? "72vh" : 0,
              overflow:"hidden",
              transition:"max-height 0.3s cubic-bezier(0.4,0,0.2,1)",
              display:"flex",flexDirection:"column",
            }}>
              {/* Drag handle */}
              <div style={{display:"flex",flexDirection:"column",alignItems:"center",padding:"10px 0 4px",flexShrink:0,cursor:"pointer"}}
                onClick={()=>setSheetOpen(o=>!o)}>
                <div style={{width:36,height:4,borderRadius:2,background:BORDER}}/>
              </div>

              {/* Tabs */}
              <div style={{display:"flex",borderBottom:`1px solid ${BORDER}`,flexShrink:0}}>
                {[["draw","Draw"],["edit","Edit"],["route","Route"]].map(([id,label])=>(
                  <button key={id} onClick={()=>setPanelTab(id)} style={tab(panelTab===id)}>{label}</button>
                ))}
              </div>

              {/* Panel content — scrollable */}
              <div style={{flex:1,overflowY:"auto",padding:"0.875rem",
                scrollbarWidth:"thin",scrollbarColor:`${GOLD_DIM} transparent`,
                WebkitOverflowScrolling:"touch"}}>
                {renderPanelContent()}
              </div>
            </div>
          </>
        )}

      </div>
    </div>
  );
