// Sun position. Scene axes: x = east, y = up, z = south.
const R = Math.PI / 180;
export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
export const MID_DAY = [17, 47, 75, 105, 135, 162, 198, 228, 258, 288, 318, 344]; // typical day of each month

export function dayOfYear(month: number, day: number) {
  let n = day;
  for (let i = 0; i < month; i++) n += MONTH_DAYS[i];
  return n;
}
export const declination = (n: number) => 23.45 * R * Math.sin((2 * Math.PI * (284 + n)) / 365);

export function equationOfTime(n: number) { // minutes
  const B = (2 * Math.PI * (n - 81)) / 364;
  return 9.87 * Math.sin(2 * B) - 7.53 * Math.cos(B) - 1.5 * Math.sin(B);
}
export function clockToSolar(clockHour: number, n: number, lng: number, utcOffset: number) {
  return clockHour + (lng - 15 * utcOffset) / 15 + equationOfTime(n) / 60;
}
export function guessUtcOffset(lat: number, lng: number) {
  if (lat > 6 && lat < 37.5 && lng > 68 && lng < 97.5) return 5.5; // India
  return Math.round(lng / 15);
}

// Unit vector pointing at the sun, in scene axes. y <= 0 means the sun is below the horizon.
export function sunVector(lat: number, n: number, solarHour: number): [number, number, number] {
  const d = declination(n), p = lat * R, w = (solarHour - 12) * 15 * R;
  const up = Math.sin(p) * Math.sin(d) + Math.cos(p) * Math.cos(d) * Math.cos(w);
  const east = -Math.cos(d) * Math.sin(w);
  const north = Math.sin(d) * Math.cos(p) - Math.cos(d) * Math.sin(p) * Math.cos(w);
  return [east, up, -north];
}
export function sunsetHourAngle(lat: number, n: number) {
  const x = -Math.tan(lat * R) * Math.tan(declination(n));
  return Math.acos(Math.max(-1, Math.min(1, x)));
}
