export const TEAM_COLORS: Record<string, string> = {
  "McLaren": "#F47600",
  "Red Bull": "#3671C6",
  "Red Bull Racing": "#3671C6",
  "Mercedes": "#27F4D2",
  "Ferrari": "#ED1131",
  "Ferrari (Scuderia)": "#ED1131",
  "Scuderia Ferrari": "#ED1131",
  "Williams": "#1868DB",
  "Sauber": "#01C00E",
  "Revolut Audi F1 Team": "#01C00E",
  "RB F1 Team": "#6C98FF",
  "Visa Cash App RB": "#6C98FF",
  "Visa Cash App Racing Bulls": "#6C98FF",
  "Racing Bulls": "#6C98FF",
  "Haas F1 Team": "#9C9FA2",
  "TGR Haas F1 Team": "#9C9FA2",
  "Alpine F1 Team": "#FF87BC",
  "BWT Alpine F1 Team": "#FF87BC",
  "Aston Martin": "#229971",
  "Aston Martin Aramco Honda": "#229971",
  "Cadillac Formula 1 Team": "#9AA0FF",
};

// Returns a slight variant of the base team color for multiple drivers on the same team
export function colorVariant(hex: string, variantIndex: number): string {
  // simple lighten/darken by mixing with white/black
  const mix = (hexColor: string, amount: number) => {
    const c = hexColor.replace('#','');
    const r = parseInt(c.substring(0,2), 16);
    const g = parseInt(c.substring(2,4), 16);
    const b = parseInt(c.substring(4,6), 16);
    const m = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
    const rr = m(r + (255 - r) * amount);
    const gg = m(g + (255 - g) * amount);
    const bb = m(b + (255 - b) * amount);
    return `#${rr.toString(16).padStart(2,'0')}${gg.toString(16).padStart(2,'0')}${bb.toString(16).padStart(2,'0')}`.toUpperCase();
  };
  // 0 -> base, 1 -> +10% white, 2 -> +20% white, 3 -> +5% black
  if (variantIndex <= 0) return hex.toUpperCase();
  if (variantIndex === 1) return mix(hex, 0.1);
  if (variantIndex === 2) return mix(hex, 0.2);
  return mix(hex, -0.05);
}
