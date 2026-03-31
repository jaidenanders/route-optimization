import { buildNearestNodePath } from "./pathBuilder.js";
import { buildBlocked, buildWallEdges } from "./routing.js";

self.onmessage = ({ data: { items, walls, startPt, endPt } }) => {
  const blocked   = buildBlocked(items);
  const wallEdges = buildWallEdges(walls);
  const result    = buildNearestNodePath(
    items, walls, startPt, endPt, blocked, wallEdges,
    (done, total) => self.postMessage({ type: "progress", done, total })
  );
  self.postMessage({ type: "done", ...result });
};
