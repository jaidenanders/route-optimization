import { CELL, COLS, ROWS, ITEM_TYPES, TEMP_ZONES, WALL_COLOR } from "./constants.js";

export function drawCanvas(
  canvas, items, walls, drawTool, previewRect, selectedId,
  zoom, wallPreview, bgImageEl, bgImage, bgOpacity,
  routePath, showRoute, START, END
) {
  const CZ = CELL * zoom;
  canvas.width  = Math.round(COLS * CZ);
  canvas.height = Math.round(ROWS * CZ);
  const ctx = canvas.getContext("2d");

  // Background
  ctx.fillStyle = "#070b12";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Trace image
  if (bgImageEl && bgImage) {
    ctx.globalAlpha = bgOpacity ?? 0.35;
    ctx.drawImage(bgImageEl, bgImage.x*CZ, bgImage.y*CZ, bgImage.w*CZ, bgImage.h*CZ);
    ctx.globalAlpha = 1;
  }

  // Grid lines
  if (zoom >= 0.4) {
    ctx.strokeStyle = "rgba(255,255,255,0.04)";
    ctx.lineWidth = 0.5;
    for (let r=0;r<=ROWS;r++){ctx.beginPath();ctx.moveTo(0,r*CZ);ctx.lineTo(COLS*CZ,r*CZ);ctx.stroke();}
    for (let c=0;c<=COLS;c++){ctx.beginPath();ctx.moveTo(c*CZ,0);ctx.lineTo(c*CZ,ROWS*CZ);ctx.stroke();}
  }

  // Zone rectangles
  items.filter(it=>it.type==="zone").forEach(zone=>{
    const x=zone.c*CZ, y=zone.r*CZ, w=zone.w*CZ, h=zone.h*CZ;
    ctx.fillStyle=zone.color+"22"; ctx.fillRect(x,y,w,h);
    ctx.strokeStyle=zone.color+"88"; ctx.lineWidth=1.5;
    ctx.setLineDash([6,4]); ctx.strokeRect(x+1,y+1,w-2,h-2); ctx.setLineDash([]);
    ctx.fillStyle=zone.color+"dd";
    ctx.font=`700 ${Math.max(10,11*zoom)}px monospace`;
    ctx.textAlign="left"; ctx.textBaseline="top";
    ctx.fillText(zone.label||zone.dept||"?",x+4,y+3);
    const wfSize=Math.min(w,h)*0.28;
    if (wfSize>8) {
      ctx.save();
      ctx.font=`900 ${wfSize}px monospace`; ctx.fillStyle=zone.color+"15";
      ctx.textAlign="center"; ctx.textBaseline="middle";
      ctx.fillText(zone.label||zone.dept||"?",x+w/2,y+h/2); ctx.restore();
    }
  });

  // Shelves
  items.filter(it=>it.type!=="zone").forEach(item=>{
    const isSel=item.id===selectedId;
    const col=(item.tempZone&&TEMP_ZONES[item.tempZone]?.color)||ITEM_TYPES[item.type]?.color||"#60a5fa";
    const x=item.c*CZ, y=item.r*CZ, w=item.w*CZ, h=item.h*CZ;
    const isExcluded=item.excluded;

    ctx.fillStyle=isSel?col+"55":isExcluded?col+"0a":col+"18"; ctx.fillRect(x,y,w,h);
    ctx.strokeStyle=isSel?col:isExcluded?col+"33":col+"99";
    ctx.lineWidth=isSel?Math.max(2,2*zoom):Math.max(1,1.5*zoom);
    if (isExcluded) ctx.setLineDash([3,3]);
    ctx.strokeRect(x+0.5,y+0.5,w-1,h-1); ctx.setLineDash([]);

    if (isExcluded) {
      ctx.strokeStyle="#f87171"+"44"; ctx.lineWidth=1;
      ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x+w,y+h);ctx.stroke();
      ctx.beginPath();ctx.moveTo(x+w,y);ctx.lineTo(x,y+h);ctx.stroke();
    }

    if (item.sections>1) {
      ctx.strokeStyle=col+"44"; ctx.lineWidth=0.5;
      const isV=item.h>item.w;
      for (let s=1;s<item.sections;s++) {
        const t=s/item.sections;
        ctx.beginPath();
        if (isV){const sy=y+t*h;ctx.moveTo(x,sy);ctx.lineTo(x+w,sy);}
        else{const sx=x+t*w;ctx.moveTo(sx,y);ctx.lineTo(sx,y+h);}
        ctx.stroke();
      }
    }

    const name=`${item.dept||""}${item.num||""}`;
    const namePx=Math.max(10,Math.min(h*0.45,w*0.15,24));
    const secPx=Math.max(8,Math.min(h*0.3,w*0.1,16));
    ctx.textAlign="center"; ctx.textBaseline="middle";
    const cx2=x+w/2, cy2=y+h/2;
    if (w>8&&h>8) {
      ctx.fillStyle=col; ctx.font=`700 ${namePx}px monospace`;
      const offset=(item.sections>0&&h>namePx+secPx+4)?-(secPx*0.6):0;
      ctx.fillText(name,cx2,cy2+offset);
      if (item.sections>0&&h>namePx+secPx+4) {
        ctx.font=`400 ${secPx}px monospace`; ctx.fillStyle=col+"99";
        ctx.fillText(`§${item.sections}`,cx2,cy2+namePx*0.6);
      }
    }

    // Linked aisle connector
    if (item.linkedId) {
      const partner=items.find(it=>it.id===item.linkedId);
      if (partner&&item.id<item.linkedId) {
        const px2=partner.c*CZ, py2=partner.r*CZ, pw=partner.w*CZ, ph=partner.h*CZ;
        const mx1=x+w/2, my1=y+h/2, mx2=px2+pw/2, my2=py2+ph/2;
        ctx.save();
        ctx.strokeStyle=col+"99"; ctx.lineWidth=Math.max(1.5,2*zoom);
        ctx.setLineDash([3*zoom,2*zoom]);
        ctx.beginPath();ctx.moveTo(mx1,my1);ctx.lineTo(mx2,my2);ctx.stroke();
        ctx.setLineDash([]);
        const lmx=(mx1+mx2)/2, lmy=(my1+my2)/2, cr=Math.max(5,6*zoom);
        ctx.fillStyle="#070b12"; ctx.beginPath();ctx.arc(lmx,lmy,cr,0,Math.PI*2);ctx.fill();
        ctx.strokeStyle=col; ctx.lineWidth=Math.max(1.2,1.5*zoom);
        ctx.beginPath();ctx.arc(lmx,lmy,cr,0,Math.PI*2);ctx.stroke();
        const lw=cr*0.55, lh=cr*0.3;
        ctx.strokeStyle=col; ctx.lineWidth=Math.max(0.8,1*zoom);
        ctx.beginPath();ctx.ellipse(lmx-lw*0.4,lmy,lw,lh,Math.PI/4,0,Math.PI*2);ctx.stroke();
        ctx.beginPath();ctx.ellipse(lmx+lw*0.4,lmy,lw,lh,Math.PI/4,0,Math.PI*2);ctx.stroke();
        ctx.restore();
      }
    }
  });

  // Pick-node dots
  items.filter(it=>it.type==="shelf"&&(it.sections||0)>0&&!it.excluded).forEach(item=>{
    const isV=item.h>item.w, isQ=item.h===item.w;
    const col=(item.tempZone&&TEMP_ZONES[item.tempZone]?.color)||"#60a5fa";
    const dotR=Math.max(2,Math.min(3.5,CZ*0.22));
    ctx.save(); ctx.fillStyle=col+"cc"; ctx.strokeStyle="#070b12"; ctx.lineWidth=Math.max(0.5,0.8*zoom);

    const dot=(x,y)=>{ctx.beginPath();ctx.arc(x,y,dotR,0,Math.PI*2);ctx.fill();ctx.stroke();};

    // Endcap: single node at centre of pick edge
    if (item.tempZone==="endcap") {
      const edge=item.pickSide||(isV?"right":"bottom");
      const midR=(item.r+item.h/2)*CZ, midC=(item.c+item.w/2)*CZ;
      if      (edge==="left")   dot((item.c-0.25)*CZ,       midR);
      else if (edge==="right")  dot((item.c+item.w+0.25)*CZ, midR);
      else if (edge==="top")    dot(midC, (item.r-0.25)*CZ);
      else                      dot(midC, (item.r+item.h+0.25)*CZ);
      ctx.restore(); return;
    }

    // Action Alley: 2 nodes (L+R or T+B) or 4 nodes (all sides)
    if (item.tempZone==="action_alley") {
      const fourNodes=item.aaNodes==="4";
      const aaSide=item.pickSide||(isV?"lr":"tb");
      const midR=(item.r+item.h/2)*CZ, midC=(item.c+item.w/2)*CZ;
      if (fourNodes||aaSide==="lr") {
        dot((item.c-0.25)*CZ,       midR);
        dot((item.c+item.w+0.25)*CZ, midR);
      }
      if (fourNodes||aaSide==="tb") {
        dot(midC, (item.r-0.25)*CZ);
        dot(midC, (item.r+item.h+0.25)*CZ);
      }
      ctx.restore(); return;
    }

    // Normal shelves
    const N=item.sections;
    const edge=item.pickSide||(isV?"right":"bottom");
    for (let s=1;s<=N;s++) {
      let dotX,dotY;
      if (isQ) {
        if      (edge==="top")    {dotX=(item.c+(s-0.5)*item.w/N)*CZ; dotY=(item.r-0.25)*CZ;}
        else if (edge==="bottom") {dotX=(item.c+(s-0.5)*item.w/N)*CZ; dotY=(item.r+item.h+0.25)*CZ;}
        else if (edge==="left")   {dotX=(item.c-0.25)*CZ; dotY=(item.r+(s-0.5)*item.h/N)*CZ;}
        else                      {dotX=(item.c+item.w+0.25)*CZ; dotY=(item.r+(s-0.5)*item.h/N)*CZ;}
      } else if (isV) {
        dotY=(item.r+(s-0.5)*item.h/N)*CZ;
        dotX=edge==="left"?(item.c-0.25)*CZ:(item.c+item.w+0.25)*CZ;
      } else {
        dotX=(item.c+(s-0.5)*item.w/N)*CZ;
        dotY=edge==="top"?(item.r-0.25)*CZ:(item.r+item.h+0.25)*CZ;
      }
      dot(dotX,dotY);
    }
    ctx.restore();
  });

  // Preview rect
  if (previewRect&&previewRect.w>0&&previewRect.h>0) {
    const col=(drawTool.tempZone&&TEMP_ZONES[drawTool.tempZone]?.color)||ITEM_TYPES[drawTool.type]?.color||"#818cf8";
    const x=previewRect.c*CZ, y=previewRect.r*CZ, w=previewRect.w*CZ, h=previewRect.h*CZ;
    ctx.fillStyle=col+"30"; ctx.fillRect(x,y,w,h);
    ctx.strokeStyle=col; ctx.lineWidth=1.5;
    ctx.setLineDash([4,3]); ctx.strokeRect(x,y,w,h); ctx.setLineDash([]);
    ctx.fillStyle=col; ctx.font=`700 ${Math.max(10,11*zoom)}px monospace`;
    ctx.textAlign="center"; ctx.textBaseline="middle";
    ctx.fillText(`${previewRect.w}×${previewRect.h}`,x+w/2,y+h/2);
  }

  // Walls
  function drawWall(seg, isPreview, isSel) {
    const x1=seg.c1*CZ, y1=seg.r1*CZ, x2=seg.c2*CZ, y2=seg.r2*CZ;
    ctx.beginPath(); ctx.moveTo(x1,y1); ctx.lineTo(x2,y2);
    ctx.lineWidth=isSel?Math.max(3,3.5*zoom):Math.max(2,2.5*zoom);
    ctx.lineCap="round"; ctx.strokeStyle=isPreview?WALL_COLOR+"99":WALL_COLOR;
    ctx.shadowColor=WALL_COLOR; ctx.shadowBlur=isSel?12*zoom:isPreview?6*zoom:8*zoom;
    if (isPreview) ctx.setLineDash([4*zoom,3*zoom]);
    ctx.stroke(); ctx.setLineDash([]); ctx.shadowBlur=0;
  }
  walls.forEach(w=>drawWall(w,false,w.id===selectedId));
  if (wallPreview) drawWall(wallPreview,true,false);

  // Route path
  if (showRoute && routePath && routePath.length > 1) {
    ctx.save();
    ctx.lineCap="round"; ctx.lineJoin="round";
    ctx.strokeStyle="#ffffff"; ctx.lineWidth=Math.max(2,3*zoom);
    ctx.globalAlpha=0.12; ctx.shadowColor="#ffffff"; ctx.shadowBlur=8*zoom;
    ctx.beginPath();
    ctx.moveTo(routePath[0].c*CZ+CZ/2, routePath[0].r*CZ+CZ/2);
    for (let i=1;i<routePath.length;i++) ctx.lineTo(routePath[i].c*CZ+CZ/2, routePath[i].r*CZ+CZ/2);
    ctx.stroke();
    ctx.shadowBlur=0; ctx.lineWidth=Math.max(1,1.5*zoom); ctx.globalAlpha=0.9;
    ctx.beginPath();
    ctx.moveTo(routePath[0].c*CZ+CZ/2, routePath[0].r*CZ+CZ/2);
    for (let i=1;i<routePath.length;i++) ctx.lineTo(routePath[i].c*CZ+CZ/2, routePath[i].r*CZ+CZ/2);
    ctx.stroke();
    ctx.restore();
  }

  // S / E markers
  if (START && END) {
    const mR=Math.max(8,CZ*0.7), font=Math.max(7,mR*0.65);
    [[START,"#052e16","#22c55e","S"],[END,"#4c0519","#f43f5e","E"]].forEach(([pt,bg,stroke,lbl])=>{
      const mx=pt.c*CZ+CZ/2, my=pt.r*CZ+CZ/2;
      ctx.fillStyle=bg; ctx.strokeStyle=stroke; ctx.lineWidth=Math.max(2,2*zoom);
      ctx.beginPath(); ctx.arc(mx,my,mR,0,Math.PI*2); ctx.fill(); ctx.stroke();
      ctx.fillStyle=stroke; ctx.font=`700 ${font}px monospace`;
      ctx.textAlign="center"; ctx.textBaseline="middle";
      ctx.fillText(lbl,mx,my);
    });
  }
}
