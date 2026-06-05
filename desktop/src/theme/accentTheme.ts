export function hexToRgb(hex: string): [number, number, number] {
  const m = hex.replace("#", "").match(/^([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i);
  if (!m) return [123, 98, 163];
  return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
}

export function applyAccent(hex: string): void {
  const [r, g, b] = hexToRgb(hex);
  const root = document.documentElement;
  root.style.setProperty("--accent-hex", hex);
  root.style.setProperty("--accent-rgb", `${r}, ${g}, ${b}`);
  root.style.setProperty("--accent-dim", `rgba(${r}, ${g}, ${b}, 0.18)`);
  root.style.setProperty("--accent-glow", `0 0 12px 2px rgba(${r}, ${g}, ${b}, 0.28)`);
}
