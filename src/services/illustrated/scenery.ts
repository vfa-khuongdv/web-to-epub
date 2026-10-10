import { Place, TimeOfDay } from "./types";

// Flat backgrounds drawn in code, so a scene needs no image model: a sky for the time of
// day and a landscape for the place. Colours are mixed toward dusk/night tones.
const mix = (a: string, b: string, t: number): string => {
  const pa = a.match(/\w\w/g)!.map((h) => parseInt(h, 16));
  const pb = b.match(/\w\w/g)!.map((h) => parseInt(h, 16));
  return "#" + pa.map((v, i) => Math.round(v + (pb[i] - v) * t).toString(16).padStart(2, "0")).join("");
};

const shade = (color: string, time: TimeOfDay): string =>
  time === "night" ? mix(color, "10163a", 0.6) : time === "dusk" ? mix(color, "7a3a3a", 0.35) : color;

export const FLOOR_Y = 830;

function sky(time: TimeOfDay, uid: string, window?: { x: number; y: number; w: number; h: number }): string {
  const colors = {
    day: ["6fc3ee", "fde9b8"],
    dusk: ["3a2a6e", "ff8a4c"],
    night: ["070b26", "1d2358"],
  }[time];
  const rect = window ?? { x: 0, y: 0, w: 1920, h: 1080 };
  const sun =
    time === "night"
      ? `<circle cx="${rect.x + rect.w * 0.7}" cy="${rect.y + rect.h * 0.28}" r="${Math.min(70, rect.h / 4)}" fill="#f4f1d8"/>`
      : `<circle cx="${rect.x + rect.w * 0.7}" cy="${rect.y + rect.h * (time === "day" ? 0.26 : 0.65)}" r="${Math.min(100, rect.h / 4)}" fill="${time === "day" ? "#fff3b0" : "#ff6a2a"}"/>`;
  const stars =
    time === "night" && !window
      ? Array.from({ length: 60 }, (_, i) => `<circle cx="${(i * 397) % 1920}" cy="${(i * 211) % 620}" r="${1.5 + ((i * 7) % 3)}" fill="#fff" opacity="${0.5 + ((i * 13) % 5) / 10}"/>`).join("")
      : "";
  return (
    `<defs><linearGradient id="sky-${uid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#${colors[0]}"/><stop offset="1" stop-color="#${colors[1]}"/></linearGradient></defs>` +
    `<rect x="${rect.x}" y="${rect.y}" width="${rect.w}" height="${rect.h}" fill="url(#sky-${uid})"/>${sun}${stars}`
  );
}

const trees = (color: string, trunk: string, xs: number[], base: number, size: number): string =>
  xs.map((x) => `<rect x="${x - 10}" y="${base - size * 0.5}" width="20" height="${size * 0.5}" fill="${trunk}"/><circle cx="${x}" cy="${base - size * 0.7}" r="${size * 0.45}" fill="${color}"/>`).join("");

const pines = (color: string, xs: number[], base: number, size: number): string =>
  xs.map((x) => `<path d="M${x - size * 0.4} ${base} L${x} ${base - size} L${x + size * 0.4} ${base}z" fill="${color}"/>`).join("");

export function scenery(place: Place, time: TimeOfDay, uid: string): string {
  const c = (hex: string) => shade(hex, time);
  switch (place) {
    case "desert":
      return (
        sky(time, uid) +
        `<path d="M0 760 q300 -90 640 -20 t700 -10 t580 -30 v380 h-1920z" fill="${c("#e0aa4f")}"/>` +
        `<path d="M0 860 q420 -70 900 0 t1020 -20 v240 h-1920z" fill="${c("#f1c36a")}"/>`
      );
    case "forest":
      return (
        sky(time, uid) +
        pines(c("#2f6a3a"), [120, 360, 620, 900, 1180, 1460, 1720, 1860], 800, 420) +
        pines(c("#3f8a4a"), [240, 500, 760, 1040, 1320, 1600], 860, 360) +
        `<rect y="840" width="1920" height="240" fill="${c("#4f7a3a")}"/>`
      );
    case "city": {
      const heights = [380, 520, 300, 620, 440, 340, 560, 400, 480, 320];
      const buildings = heights
        .map((h, i) => {
          const x = i * 200;
          const windows = Array.from({ length: Math.floor(h / 70) }, (_, row) => `<rect x="${x + 40}" y="${800 - h + 30 + row * 70}" width="30" height="36" fill="${time === "night" ? "#ffd36a" : c("#cfe3f5")}"/><rect x="${x + 110}" y="${800 - h + 30 + row * 70}" width="30" height="36" fill="${time === "night" ? "#ffd36a" : c("#cfe3f5")}"/>`).join("");
          return `<rect x="${x}" y="${800 - h}" width="190" height="${h + 100}" fill="${c(i % 2 ? "#6f7f99" : "#8794ad")}"/>${windows}`;
        })
        .join("");
      return sky(time, uid) + buildings + `<rect y="880" width="1920" height="200" fill="${c("#5a5f6e")}"/>`;
    }
    case "sea":
      return (
        sky(time, uid) +
        `<rect y="640" width="1920" height="300" fill="${c("#2f7fc2")}"/>` +
        `<path d="M0 700 q120 -20 240 0 t240 0 t240 0 t240 0 t240 0 t240 0 t240 0 t240 0" stroke="${c("#8ec5ee")}" stroke-width="6" fill="none"/>` +
        `<rect y="860" width="1920" height="220" fill="${c("#f0d9a0")}"/>`
      );
    case "snow":
      return (
        sky(time, uid) +
        `<path d="M0 760 q400 -140 860 -10 t1060 -20 v350 h-1920z" fill="${c("#e8eef7")}"/>` +
        pines(c("#2f5a4a"), [180, 420, 1500, 1740], 800, 340) +
        `<rect y="860" width="1920" height="220" fill="${c("#f7faff")}"/>`
      );
    case "indoor":
      return (
        `<rect width="1920" height="1080" fill="${c("#d9b98a")}"/>` +
        `<rect y="780" width="1920" height="300" fill="${c("#8a5a32")}"/>` +
        `<rect x="1290" y="170" width="440" height="400" rx="12" fill="${c("#5a3a1e")}"/>` +
        sky(time, uid + "w", { x: 1310, y: 190, w: 400, h: 360 }) +
        `<path d="M1510 190 V550 M1310 370 H1710" stroke="${c("#5a3a1e")}" stroke-width="12"/>` +
        `<rect x="260" y="220" width="300" height="220" rx="8" fill="${c("#b9845a")}" stroke="${c("#5a3a1e")}" stroke-width="10"/>` +
        `<circle cx="410" cy="330" r="60" fill="${c("#e9c98a")}"/>`
      );
    case "field":
    default:
      return (
        sky(time, uid) +
        `<path d="M0 780 q420 -140 900 -10 t1020 -10 v320 h-1920z" fill="${c("#6fb36f")}"/>` +
        trees(c("#3f8a4a"), c("#6b4a2a"), [260, 1560, 1720], 800, 300) +
        `<rect y="860" width="1920" height="220" fill="${c("#5aa86a")}"/>`
      );
  }
}
