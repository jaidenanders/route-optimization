// ─── Grid Config ──────────────────────────────────────────────────────────────
export const COLS = 200;
export const ROWS = 200;
export const CELL = 12; // base cell size in px at zoom=1

export const ITEM_TYPES = {
  zone:  { label: "Zone",     color: "#64748b" },
  shelf: { label: "Shelving", color: "#60a5fa" },
};

// Wall color
export const WALL_COLOR = "#ff4d6d";

// Temperature/display zones — controls pick pass order and color
// pass: 0=Ambient, 1=Chilled, 2=Frozen, 3=Action Alley
export const TEMP_ZONES = {
  ambient:     { label: "Ambient",      color: "#60a5fa", pass: 0 },
  endcap:      { label: "Endcap",       color: "#fbbf24", pass: 0 },
  regulated:   { label: "Regulated",    color: "#f43f5e", pass: 0 },
  chilled:     { label: "Chilled",      color: "#22d3ee", pass: 1 },
  frozen:      { label: "Frozen",       color: "#a78bfa", pass: 2 },
  action_alley:{ label: "Action Alley", color: "#f97316", pass: 3 },
};

export const ORIENT = { H: "H", V: "V" };

export const genId = () => Math.random().toString(36).slice(2, 9);
