// Small numeric helpers that copy Python/NumPy behaviour where the notebooks depend on it.

// Python's round(): halves go to the even neighbour
export function roundHalfEven(x: number) {
  const r = Math.round(x);
  return Math.abs(x % 1) === 0.5 && r % 2 !== 0 ? r - 1 : r;
}

// Python's f"{x:.4g}"
export function fmtG(x: number, digits = 4) {
  return String(Number(x.toPrecision(digits)));
}

// Python's f"{x:g}"
export const fmtShort = (x: number) => fmtG(x, 6);

// np.interp: linear between points, clamped to the end values outside them; xp must be increasing
export function interp(x: number, xp: number[], fp: number[]) {
  const n = xp.length;
  if (x <= xp[0]) return fp[0];
  if (x >= xp[n - 1]) return fp[n - 1];
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (xp[mid] <= x) lo = mid;
    else hi = mid;
  }
  return fp[lo] + ((fp[hi] - fp[lo]) * (x - xp[lo])) / (xp[hi] - xp[lo]);
}

export function mean(xs: number[]) {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

// np.polyfit(x, y, 1) -> [slope, intercept]
export function linfit(x: number[], y: number[]): [number, number] {
  const mx = mean(x);
  const my = mean(y);
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < x.length; i++) {
    sxy += (x[i] - mx) * (y[i] - my);
    sxx += (x[i] - mx) ** 2;
  }
  const slope = sxy / sxx;
  return [slope, my - slope * mx];
}
