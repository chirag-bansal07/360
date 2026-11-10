// Web Mercator helpers for satellite tiles.
export function tileXY(lat: number, lng: number, z: number) {
  const n = Math.pow(2, z), p = (lat * Math.PI) / 180;
  return { x: ((lng + 180) / 360) * n, y: ((1 - Math.log(Math.tan(p) + 1 / Math.cos(p)) / Math.PI) / 2) * n };
}
export function metresPerPixel(lat: number, z: number) {
  return (156543.03392 * Math.cos((lat * Math.PI) / 180)) / Math.pow(2, z);
}
