// Glass theme — adaptive text colors based on wallpaper dominant hue.
// Glass tokens (--glass-*) are fixed rgba white in CSS; only text/accent adapts.

export function hexToRgb(hex: string): [number, number, number] {
  const m = hex.replace("#", "").match(/^([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i);
  if (!m) return [107, 92, 78];
  return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
}

export function luminance(r: number, g: number, b: number): number {
  const lin = (v: number) => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

export function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, Math.round(l * 100)];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === rn)      h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6;
  else if (max === gn) h = ((bn - rn) / d + 2) / 6;
  else                 h = ((rn - gn) / d + 4) / 6;
  return [Math.round(h * 360), Math.round(s * 100), Math.round(l * 100)];
}

export function hslToHex(h: number, s: number, l: number): string {
  const sn = s / 100, ln = l / 100;
  const a = sn * Math.min(ln, 1 - ln);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const c = ln - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * c).toString(16).padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

function clamp(v: number, mn: number, mx: number): number {
  return Math.max(mn, Math.min(mx, v));
}

export function getAdaptiveTextColors(tintHex: string): {
  primary: string; secondary: string; muted: string; accent: string;
} {
  const [r, g, b] = hexToRgb(tintHex);
  const lum = luminance(r, g, b);
  const [h, s, l] = rgbToHsl(r, g, b);

  if (lum > 0.18) {
    // Light wallpaper → darken the hue for readable text
    const da = 25 + Math.round(lum * 35);
    const primary = hslToHex(h, clamp(s + 12, 0, 100), clamp(l - da,        6,  100));
    return {
      primary,
      secondary: hslToHex(h, clamp(s + 6,  0, 100), clamp(l - da * 0.82, 14, 100)),
      muted:     hslToHex(h, clamp(s,       0, 100), clamp(l - da * 0.62, 22, 100)),
      accent:    primary,
    };
  } else {
    // Dark wallpaper → lighten the hue
    const la = 30 + Math.round((1 - lum) * 30);
    const primary = hslToHex(h, clamp(s - 15, 0, 100), clamp(l + la,        8, 92));
    return {
      primary,
      secondary: hslToHex(h, clamp(s - 20, 0, 100), clamp(l + la * 0.85, 8, 88)),
      muted:     hslToHex(h, clamp(s - 25, 0, 100), clamp(l + la * 0.65, 8, 78)),
      accent:    primary,
    };
  }
}

// Median cut on a pixel bucket — returns the most vivid representative color.
function medianCutDominant(pixels: [number, number, number][], depth: number): [number, number, number] {
  if (depth === 0 || pixels.length <= 1) {
    const n = pixels.length || 1;
    return [
      Math.round(pixels.reduce((s, p) => s + p[0], 0) / n),
      Math.round(pixels.reduce((s, p) => s + p[1], 0) / n),
      Math.round(pixels.reduce((s, p) => s + p[2], 0) / n),
    ];
  }
  let rMin = 255, rMax = 0, gMin = 255, gMax = 0, bMin = 255, bMax = 0;
  for (const [r, g, b] of pixels) {
    if (r < rMin) rMin = r; if (r > rMax) rMax = r;
    if (g < gMin) gMin = g; if (g > gMax) gMax = g;
    if (b < bMin) bMin = b; if (b > bMax) bMax = b;
  }
  const ch = (rMax - rMin >= gMax - gMin && rMax - rMin >= bMax - bMin) ? 0
           : (gMax - gMin >= bMax - bMin) ? 1 : 2;
  const sorted = [...pixels].sort((a, b2) => a[ch] - b2[ch]);
  const mid = Math.floor(sorted.length / 2);
  const left  = medianCutDominant(sorted.slice(0, mid), depth - 1);
  const right = medianCutDominant(sorted.slice(mid),    depth - 1);
  const vivid = (p: [number, number, number]) => Math.max(...p) - Math.min(...p);
  return vivid(left) >= vivid(right) ? left : right;
}

// Extract dominant color from a data URI via Canvas (JS-side, no Rust needed).
export function extractDominantFromDataUri(dataUri: string): Promise<string> {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = 80; canvas.height = 80;
      const ctx = canvas.getContext("2d");
      if (!ctx) { resolve("#6b5c4e"); return; }
      ctx.drawImage(img, 0, 0, 80, 80);
      const data = ctx.getImageData(0, 0, 80, 80).data;
      const pixels: [number, number, number][] = [];
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i], g = data[i + 1], b = data[i + 2];
        const lum = luminance(r, g, b);
        if (lum > 0.05 && lum < 0.92) pixels.push([r, g, b]);
      }
      if (pixels.length === 0) { resolve("#6b5c4e"); return; }
      const [r, g, b] = medianCutDominant(pixels, 3);
      resolve(`#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`);
    };
    img.onerror = () => resolve("#6b5c4e");
    img.src = dataUri;
  });
}

export function applyGlassTheme(tintHex: string, isDark: boolean): void {
  const colors = getAdaptiveTextColors(tintHex);
  const root = document.documentElement;
  root.style.setProperty("--text-primary",   colors.primary);
  root.style.setProperty("--text-secondary", colors.secondary);
  root.style.setProperty("--text-muted",     colors.muted);
  root.style.setProperty("--text-accent",    colors.accent);
  root.style.setProperty("--accent",         colors.accent);
  root.style.setProperty("--accent-dim",     tintHex + "2e");
  root.style.setProperty("--accent-glow",    `0 0 14px 2px ${tintHex}30`);

  console.log("Glass theme applied:", tintHex, "isDark:", isDark, "primary:", colors.primary);
}
