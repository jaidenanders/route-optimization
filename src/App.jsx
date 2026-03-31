import { useState, useRef, useLayoutEffect, useEffect, useCallback, useMemo } from "react";
import { COLS, ROWS, CELL, ITEM_TYPES, TEMP_ZONES, ORIENT, genId } from "./constants.js";
import { calcEntrance } from "./routing.js";
import { drawCanvas } from "./drawCanvas.js";

export default function StoreMapBuilder() {
  const canvasRef       = useRef(null);
  const mapContainerRef = useRef(null);
  const loadFileRef     = useRef(null);
  const bgFileRef       = useRef(null);

  // ── Core map state ──────────────────────────────────────────────────────────
  const [items,     setItems]     = useState([]);
  const [walls,     setWalls]     = useState([]);
  const [bgImage,   setBgImage]   = useState(null);
  const [bgOpacity, setBgOpacity] = useState(0.35);
  const [bgImageEl, setBgImageEl] = useState(null);

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

  // ── Routing state ───────────────────────────────────────────────────────────
  const [START,        setSTART]        = useState({ c: 10, r: 10 });
  const [END,          setEND]          = useState({ c: 10, r: 12 });
  const [routePath,    setRoutePath]    = useState(null);
  const [sectionSeq,   setSectionSeq]   = useState([]);
  const [aisleOrder,   setAisleOrder]   = useState([]);
  const [pickNodes,    setPickNodes]    = useState([]); // {c,r,tempZone} for each visited node
  const [simStats,     setSimStats]     = useState(null);
  const [showRoute,    setShowRoute]    = useState(false);
  const [optimizing,   setOptimizing]   = useState(false);
  const [optProgress,  setOptProgress]  = useState({ done: 0, total: 0 });
  const workerRef = useRef(null);
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
    if (items.length > 0 || walls.length > 0)
      localStorage.setItem("storeMap", JSON.stringify({ items, walls, bgImage, START, END }));
  }, [items, walls, bgImage, START, END]);

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

  // ── Space = pan mode ────────────────────────────────────────────────────────
  useEffect(() => {
    const dn = (e) => { if (e.code==="Space"&&e.target===document.body){ e.preventDefault(); spaceHeldRef.current=true; } };
    const up = (e) => { if (e.code==="Space"){ spaceHeldRef.current=false; isPanningRef.current=false; } };
    window.addEventListener("keydown", dn);
    window.addEventListener("keyup",   up);
    return () => { window.removeEventListener("keydown", dn); window.removeEventListener("keyup", up); };
  }, []);

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

  useLayoutEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    drawCanvas(canvas, items, walls, drawTool, previewRect, selectedId,
      zoom, wallPreview, bgImageEl, bgImage, bgOpacity,
      routePath, showRoute, START, END, pickNodes);
  }, [items, walls, drawTool, previewRect, selectedId, zoom,
      wallPreview, bgImageEl, bgImage, bgOpacity, routePath, showRoute, START, END, pickNodes]);

  // ── Coordinate helpers ──────────────────────────────────────────────────────
  const getCell = useCallback((e) => {
    const el = mapContainerRef.current; if (!el) return { c:0, r:0 };
    const rect = el.getBoundingClientRect(), CZ = CELL * zoom;
    return {
      c: Math.max(0, Math.min(COLS-1, Math.floor(((e.clientX - rect.left) - pan.x) / CZ))),
      r: Math.max(0, Math.min(ROWS-1, Math.floor(((e.clientY - rect.top)  - pan.y) / CZ))),
    };
  }, [zoom, pan]);

  const getEdge = useCallback((e) => {
    const el = mapContainerRef.current; if (!el) return { c:0, r:0 };
    const rect = el.getBoundingClientRect(), CZ = CELL * zoom;
    return {
      c: Math.max(0, Math.min(COLS, Math.round(((e.clientX - rect.left) - pan.x) / CZ))),
      r: Math.max(0, Math.min(ROWS, Math.round(((e.clientY - rect.top)  - pan.y) / CZ))),
    };
  }, [zoom, pan]);

  const snapWall = (e1, e2) => {
    const dc = Math.abs(e2.c-e1.c), dr = Math.abs(e2.r-e1.r);
    if (dc >= dr) { const [c1,c2]=e1.c<=e2.c?[e1.c,e2.c]:[e2.c,e1.c]; return {r1:e1.r,c1,r2:e1.r,c2}; }
    const [r1,r2]=e1.r<=e2.r?[e1.r,e2.r]:[e2.r,e1.r]; return {r1,c1:e1.c,r2,c2:e1.c};
  };
  const normRect = (c1,r1,c2,r2) => ({ c:Math.min(c1,c2), r:Math.min(r1,r2), w:Math.abs(c2-c1)+1, h:Math.abs(r2-r1)+1 });
  const hitTest  = useCallback((c,r) => [...items].reverse().find(it => c>=it.c&&c<it.c+it.w&&r>=it.r&&r<it.r+it.h), [items]);

  // ── Mouse handlers ──────────────────────────────────────────────────────────
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
      setSelectedId(h?.id||null); if (h) setPanelTab("edit");
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
      if (hitWall) { setWalls(p=>p.filter(w=>w.id!==hitWall.id)); setSelectedId(null); }
      else { const h=hitTest(cell.c,cell.r); if(h){setItems(p=>p.filter(it=>it.id!==h.id));setSelectedId(null);} }
    }
  }, [mode, drawTool, getCell, getEdge, hitTest, walls, zoom, linkPickMode, selectedId, pan, START, END]);

  const onMouseMove = useCallback((e) => {
    if (isPanningRef.current) {
      const {mx,my,px,py} = panStartRef.current;
      setPan({ x: px+(e.clientX-mx), y: py+(e.clientY-my) }); return;
    }
    if (draggingMarker==="start") { setSTART(getCell(e)); return; }
    if (draggingMarker==="end")   { setEND(getCell(e));   return; }
    if (!drawing||!dragStart) return;
    drawTool.type==="wall"
      ? setWallPreview(snapWall(dragStart, getEdge(e)))
      : setPreviewRect(normRect(dragStart.c,dragStart.r,getCell(e).c,getCell(e).r));
  }, [drawing, dragStart, draggingMarker, drawTool, getCell, getEdge]);

  const onMouseUp = useCallback((e) => {
    if (isPanningRef.current) { isPanningRef.current=false; return; }
    if (draggingMarker) { setDraggingMarker(null); return; }
    if (!drawing||!dragStart) return;
    setDrawing(false);
    if (drawTool.type==="wall") {
      const seg=snapWall(dragStart,getEdge(e));
      if (seg.r1!==seg.r2||seg.c1!==seg.c2) { const nw={id:genId(),...seg}; setWalls(p=>[...p,nw]); setSelectedId(nw.id); }
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
    setItems(prev => isZone ? [newItem,...prev] : [...prev,newItem]);
    if (!isZone) setDrawTool(t=>({...t,num:(parseInt(t.num)||0)+1}));
    setSelectedId(newItem.id); setPanelTab("edit");
  }, [drawing, dragStart, drawTool, getCell, getEdge, items]);

  const onMouseLeave = useCallback(() => {
    isPanningRef.current=false;
    setDrawing(false); setPreviewRect(null); setWallPreview(null); setDraggingMarker(null);
  }, []);

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
    setOptimizing(true); setOptProgress({done:0,total:0}); setPanelTab("route");
    setPickNodes([]);
    const worker = new Worker(new URL("./optimizer.worker.js", import.meta.url), {type:"module"});
    workerRef.current = worker;
    worker.onmessage = ({data}) => {
      if (data.type==="progress") {
        setOptProgress({done:data.done,total:data.total});
      } else if (data.type==="done") {
        setRoutePath(data.path); setSectionSeq(data.sectionSeq); setAisleOrder(data.aisleOrder);
        setPickNodes(data.pickNodeCoords||[]);
        setSimStats({cost:data.cost,sections:data.sectionSeq.length,aisles:data.aisleOrder.length});
        setShowRoute(true); setOptimizing(false); workerRef.current=null;
      }
    };
    worker.onerror = () => { setOptimizing(false); workerRef.current=null; };
    worker.postMessage({items, walls, startPt:START, endPt:END});
  }, [items, walls, START, END]);
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

  // Reusable style factories
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

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div style={{height:"100vh",background:DARK,color:CREAM,fontFamily:SANS,
      display:"flex",flexDirection:"column",overflow:"hidden"}}>

      {/* ══ HEADER ══ */}
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

        {/* Divider */}
        <div style={{width:1,height:28,background:BORDER,flexShrink:0,margin:"0 0.25rem"}}/>

        {/* Mode pills */}
        {["draw","select","erase"].map(m=>(
          <button key={m} onClick={()=>setMode(m)} style={{
            padding:"0.3rem 0.75rem", borderRadius:100, cursor:"pointer",
            fontFamily:MONO, fontSize:"0.72rem", fontWeight:500,
            letterSpacing:"0.08em", textTransform:"uppercase", transition:"all 0.2s",
            background: mode===m ? modeCol[m]+"22" : "transparent",
            border: `1px solid ${mode===m ? modeCol[m] : BORDER}`,
            color: mode===m ? modeCol[m] : MUTED,
          }}>
            {m==="draw"?"✏ Draw":m==="select"?"↖ Select":"⌫ Erase"}
          </button>
        ))}

        {/* Zoom cluster */}
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

        {/* Right-side actions */}
        <div style={{marginLeft:"auto",display:"flex",gap:"0.4rem",alignItems:"center"}}>
          <span style={{fontFamily:MONO,fontSize:"0.65rem",color:MUTED,marginRight:4}}>
            {items.filter(it=>it.type!=="zone").length} items
          </span>

          {/* Path toggle */}
          <button onClick={()=>setShowRoute(r=>!r)} style={{
            padding:"0.3rem 0.75rem",borderRadius:100,cursor:"pointer",
            fontFamily:MONO,fontSize:"0.72rem",fontWeight:500,letterSpacing:"0.06em",transition:"all 0.2s",
            background: showRoute ? GOLD+"22":"transparent",
            border: `1px solid ${showRoute ? GOLD : BORDER}`,
            color: showRoute ? GOLD : MUTED,
          }}>{showRoute?"● Path":"○ Path"}</button>

          {/* Optimize */}
          <button onClick={runRoute} disabled={optimizing} style={{
            padding:"0.35rem 1rem",borderRadius:6,cursor:optimizing?"not-allowed":"pointer",
            fontFamily:SANS,fontSize:"0.82rem",fontWeight:700,letterSpacing:"0.03em",transition:"all 0.2s",
            background: optimizing ? "transparent" : GOLD,
            border: `1px solid ${optimizing ? BORDER : GOLD}`,
            color: optimizing ? MUTED : DARK,
          }}>{optimizing?"⏳ Running…":"▶ Optimize"}</button>

          <div style={{width:1,height:20,background:BORDER}}/>

          {/* Ghost buttons */}
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
          <button onClick={()=>{if(window.confirm("Clear everything?")){setItems([]);setWalls([]);setSelectedId(null);}}}
            style={{padding:"0.3rem 0.75rem",borderRadius:6,cursor:"pointer",
              fontFamily:MONO,fontSize:"0.7rem",fontWeight:500,transition:"all 0.2s",
              background:"transparent",border:`1px solid ${"#f43f5e44"}`,color:"#f43f5e88"}}>Clear</button>
        </div>
      </header>

      {/* ══ BODY ══ */}
      <div style={{flex:1,display:"flex",overflow:"hidden"}}>

        {/* ══ SIDE PANEL ══ */}
        <aside style={{
          width:244,flexShrink:0,
          background:"#160C08",
          borderRight:`1px solid ${BORDER}`,
          display:"flex",flexDirection:"column",overflow:"hidden",
        }}>
          {/* Tabs */}
          <div style={{display:"flex",borderBottom:`1px solid ${BORDER}`,flexShrink:0}}>
            {[["draw","Draw"],["edit","Edit"],["route","Route"]].map(([id,label])=>(
              <button key={id} onClick={()=>setPanelTab(id)} style={tab(panelTab===id)}>{label}</button>
            ))}
          </div>

          {/* Scrollable content */}
          <div style={{flex:1,overflowY:"auto",padding:"1rem 0.875rem",
            scrollbarWidth:"thin",scrollbarColor:`${GOLD_DIM} transparent`}}>

            {/* ─── DRAW TAB ─── */}
            {panelTab==="draw"&&(
              <div style={{display:"flex",flexDirection:"column",gap:"0.9rem"}}>

                {/* Item type */}
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
                    {/* Temperature zone */}
                    <div>
                      {lbl("Temperature Zone")}
                      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"0.3rem"}}>
                        {Object.entries(TEMP_ZONES).map(([k,z])=>(
                          <button key={k} onClick={()=>setDrawTool(t=>({...t,tempZone:k,color:z.color}))}
                            style={chip(drawTool.tempZone===k,z.color)}>{z.label}</button>
                        ))}
                      </div>
                    </div>

                    {/* Action Alley controls */}
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

                    {/* Pick side (non-action-alley) */}
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

                  {/* Dept / Label */}
                  <div>
                    {fieldLabel(drawTool.type==="zone"?"Zone Label":"Dept Letter")}
                    <input value={drawTool.dept}
                      onChange={e=>setDrawTool(t=>({...t,dept:e.target.value.toUpperCase()}))}
                      maxLength={4} style={inp()} />
                  </div>

                  {/* Number */}
                  {drawTool.type!=="zone"&&(
                    <div>
                      {fieldLabel("Number")}
                      <input type="number" min={1} value={drawTool.num}
                        onChange={e=>setDrawTool(t=>({...t,num:parseInt(e.target.value)||1}))} style={inp()} />
                    </div>
                  )}

                  {/* Sections */}
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

                  {/* Color */}
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

                {/* Tip box */}
                <div style={{background:"rgba(255,255,255,0.02)",border:`1px solid ${BORDER}`,borderRadius:8,
                  padding:"0.6rem 0.75rem",fontFamily:MONO,fontSize:"0.7rem",color:MUTED,lineHeight:1.7}}>
                  <span style={{color:GOLD}}>Tip — </span>Drag to place · Scroll to zoom · Right-click or Space to pan
                </div>

                {/* Trace image */}
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

                {/* Placed counts */}
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
                  {/* Title */}
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

                  {/* Dept */}
                  <div>
                    {fieldLabel("Dept / Label")}
                    <input value={selectedItem.dept||""}
                      onChange={e=>updateItem("dept",e.target.value.toUpperCase())} style={inp()} />
                  </div>

                  {/* Number */}
                  {selectedItem.type!=="zone"&&(
                    <div>
                      {fieldLabel("Number")}
                      <input type="number" value={selectedItem.num||""}
                        onChange={e=>updateItem("num",parseInt(e.target.value)||1)} style={inp()} />
                    </div>
                  )}

                  {/* Sections */}
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

                  {/* Zone type */}
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

                  {/* Action alley node config */}
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

                  {/* Pick side */}
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

                  {/* Position */}
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

                  {/* Link aisle */}
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

                  {/* Color */}
                  <div>
                    {fieldLabel("Color")}
                    <input type="color" value={selectedItem.color||GOLD}
                      onChange={e=>updateItem("color",e.target.value)}
                      style={{width:32,height:24,border:`1px solid ${BORDER}`,borderRadius:4,cursor:"pointer",background:"none",padding:2}} />
                  </div>

                  {/* Exclude */}
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

                  <div style={{height:1,background:BORDER}}/>

                  {/* Delete */}
                  <button onClick={()=>{
                    const pid=selectedItem?.linkedId;
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
                {!simStats
                  ? <div style={{color:MUTED,fontFamily:MONO,fontSize:"0.8rem",
                      lineHeight:1.7,marginTop:"0.5rem"}}>
                      Place shelves, set <span style={{color:GOLD}}>S</span>/<span style={{color:"#f43f5e"}}>E</span> markers, then hit <strong style={{color:CREAM}}>Optimize</strong>.
                    </div>
                  : <>
                  {/* Stats */}
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

                  {/* Search */}
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

                  {/* Aisle order */}
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
                            <span style={{fontFamily:MONO,fontSize:"0.62rem",color:MUTED}}>§{shelf.sections}</span>
                          </div>
                        );
                      });
                    })()}
                  </div>

                  {/* Section sequence */}
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
                        els.push(
                          <div key={s.code+"_"+i} data-secidx={i}
                            style={{display:"flex",alignItems:"center",gap:"0.3rem",
                              padding:"0.15rem 0.5rem",borderRadius:4,marginBottom:1,
                              background:isTarget?GOLD+"22":isSame?(tz.color+"18"):"transparent",
                              borderLeft:`2px solid ${isTarget?GOLD:isSame?(tz.color+"66"):"transparent"}`}}>
                            <span style={{fontFamily:MONO,fontSize:"0.6rem",color:MUTED,width:20,textAlign:"right"}}>{i+1}</span>
                            <span style={{fontFamily:MONO,fontSize:"0.72rem",flex:1,
                              color:isTarget?GOLD:tz.color,fontWeight:isTarget?700:400}}>{s.code}</span>
                          </div>
                        );
                      });
                      return els;
                    })()}
                  </div>

                  {/* Export */}
                  <div style={{display:"flex",gap:"0.4rem"}}>
                    <button onClick={()=>{
                      const lines=["PICK PATH — "+new Date().toLocaleString(),"","AISLE ORDER:",""];
                      aisleOrder.forEach((s,i)=>lines.push(String(i+1).padStart(3)+" . "+s.dept+s.num+"  §"+s.sections));
                      lines.push("","SECTION SEQUENCE:","");
                      sectionSeq.forEach((s,i)=>{const tz=TEMP_ZONES[s.tempZone]||TEMP_ZONES.ambient;lines.push(String(i+1).padStart(5)+". "+s.code.padEnd(14)+" ["+tz.label+"]");});
                      const a=document.createElement("a");a.href=URL.createObjectURL(new Blob([lines.join("\n")],{type:"text/plain"}));a.download="pick-path.txt";a.click();
                    }} style={{flex:1,padding:"0.45rem",borderRadius:6,cursor:"pointer",background:"transparent",
                      border:`1px solid ${GOLD}44`,color:GOLD,fontFamily:MONO,fontSize:"0.72rem",letterSpacing:"0.04em"}}>⬇ TXT</button>
                    <button onClick={()=>{
                      const rows=[["Step","Code","Shelf","Section","Zone"]];
                      sectionSeq.forEach((s,i)=>{const tz=TEMP_ZONES[s.tempZone]||TEMP_ZONES.ambient;rows.push([i+1,s.code,(s.aisle?.dept||"")+(s.aisle?.num||""),s.section,tz.label]);});
                      const a=document.createElement("a");a.href=URL.createObjectURL(new Blob([rows.map(r=>r.join(",")).join("\n")],{type:"text/csv"}));a.download="pick-path.csv";a.click();
                    }} style={{flex:1,padding:"0.45rem",borderRadius:6,cursor:"pointer",background:"transparent",
                      border:`1px solid #4ade8044`,color:"#4ade80",fontFamily:MONO,fontSize:"0.72rem",letterSpacing:"0.04em"}}>⬇ CSV</button>
                  </div>
                  </>
                }
              </div>
            )}

          </div>
        </aside>

        {/* ══ CANVAS ══ */}
        <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>

          {/* Link mode banner */}
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

          {/* Map canvas */}
          <div ref={mapContainerRef}
            style={{flex:1,overflow:"hidden",background:"#0D0805",position:"relative",
              cursor:isPanningRef.current?"grabbing":linkPickMode?"cell":mode==="draw"?"crosshair":mode==="erase"?"not-allowed":"default"}}
            onMouseDown={onMouseDown} onMouseMove={onMouseMove} onMouseUp={onMouseUp}
            onMouseLeave={onMouseLeave} onContextMenu={e=>e.preventDefault()}>

            <div style={{position:"absolute",transform:`translate(${pan.x}px,${pan.y}px)`,transformOrigin:"0 0",pointerEvents:"none"}}>
              <canvas ref={canvasRef} style={{display:"block"}} />
            </div>

            {/* Optimization overlay */}
            {optimizing&&(
              <div style={{position:"absolute",inset:0,zIndex:10,
                background:"rgba(13,8,5,0.88)",backdropFilter:"blur(8px)",
                display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:"1rem"}}>

                <div style={{fontFamily:SERIF,fontSize:"1.6rem",fontWeight:900,color:CREAM,letterSpacing:"-0.02em"}}>
                  Optimizing Route
                </div>
                <div style={{fontFamily:MONO,fontSize:"0.65rem",color:GOLD_DIM,letterSpacing:"0.2em",textTransform:"uppercase"}}>
                  NN → 2-opt → Or-opt → 3-opt → Annealing
                </div>

                {optProgress.total>0
                  ? <>
                    <div style={{width:280,height:3,background:`rgba(212,175,55,0.15)`,borderRadius:2,overflow:"hidden"}}>
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

                <button onClick={()=>{workerRef.current?.terminate();workerRef.current=null;setOptimizing(false);}}
                  style={{marginTop:"0.5rem",padding:"0.45rem 1.25rem",borderRadius:6,cursor:"pointer",
                    background:"transparent",border:`1px solid #f43f5e44`,
                    color:"#f43f5e",fontFamily:MONO,fontSize:"0.75rem",letterSpacing:"0.04em"}}>
                  ✕ Cancel
                </button>
              </div>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}
