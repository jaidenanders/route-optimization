# Store Optimizer (Store Map Builder)

A React + Vite app for **drawing a store layout** (aisles/shelves, zones, walls) and **generating an optimized pick path** from a start point to an end point.

The optimizer runs in a **Web Worker** and uses grid-based routing (A\*) plus tour-improvement heuristics (nearest-neighbour, 2-opt, Or-opt, 3-opt, simulated annealing). Maps can be saved/loaded as JSON and exported as TXT/CSV pick lists.

### Features

- **Interactive map builder**: draw shelves, zones, and walls on a 200×200 grid
- **Start/End markers**: drag “S” and “E” markers to define the route endpoints
- **Route optimization**: computes an efficient walk path that visits every pick node
- **Temperature passes**: picks are grouped by zone pass order (Ambient → Chilled → Frozen → Action Alley)
- **Save/Load**: export/import a `store-map.json` file; also persists to `localStorage`
- **Export pick path**: download `pick-path.txt` or `pick-path.csv`
- **Trace image**: overlay a floor-plan image with adjustable opacity for drawing alignment

### Controls (quick reference)

- **Draw / Select / Erase**: use the mode buttons in the header
- **Place items**: click + drag on the map in **Draw** mode
- **Pan**: hold **Space** and drag, or **right-click** drag (middle mouse also works)
- **Zoom**: mouse wheel (or header zoom buttons)
- **Move Start/End**: drag the **S**/**E** markers

### Getting started

#### Prerequisites

- **Node.js** (recommended: current LTS)
- npm (comes with Node)

#### Install

```bash
npm install
```

#### Run (dev)

```bash
npm run dev
```

Then open the URL shown in your terminal (Vite typically uses `http://localhost:5173`).

#### Build / preview

```bash
npm run build
npm run preview
```

### Testing

This repo uses **Jest** for unit tests (see `src/pathBuilder.test.js`).

```bash
npm test
```

### Project structure

- `src/App.jsx`: main UI (map builder, controls, exports)
- `src/drawCanvas.js`: canvas renderer (grid, items, walls, route overlay)
- `src/optimizer.worker.js`: background route optimization worker
- `src/pathBuilder.js`: pick-node generation + optimizer pipeline
- `src/routing.js`: A\* pathfinding + blocked cells + wall edge constraints
- `src/constants.js`: grid size, item types, temperature zones

### Data model (map JSON)

The saved `store-map.json` contains:

- **`items`**: shelves + zones (position, size, dept/num/label, sections, temp zone, etc.)
- **`walls`**: wall segments that the route cannot cross
- **`START` / `END`**: route endpoints
- **`bgImage`** (optional): trace-image data URL + placement/scale

### Notes / troubleshooting

- **Performance**: very large numbers of sections increase optimization time (each section becomes a pick node).
- **Walls**: the route will not cross walls; if you see odd detours, check for accidental wall segments.
- **Reset state**: the app persists maps in `localStorage`. Use the in-app **Clear** button (or clear site data) to reset.
