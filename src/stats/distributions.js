export function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function populationSd(values) {
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return Math.sqrt(values.reduce((a, v) => a + (v - mean) ** 2, 0) / values.length);
}

export function percentile(sorted, p) {
  const pos = (sorted.length - 1) * p;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

export function distributionStats(times) {
  const sorted = [...times].sort((a, b) => a - b);
  const q1 = percentile(sorted, 0.25);
  const q3 = percentile(sorted, 0.75);
  const iqr = q3 - q1;
  const lowerFence = q1 - 1.5 * iqr;
  const upperFence = q3 + 1.5 * iqr;
  return {
    times,
    n: times.length,
    median: median(times),
    q1, q3, lowerFence, upperFence,
    whiskerMin: sorted.find((t) => t >= lowerFence),
    whiskerMax: sorted.findLast((t) => t <= upperFence),
    min: sorted[0],
    max: sorted[sorted.length - 1],
  };
}

// Gaussian KDE with Silverman's robust bandwidth so one very slow result can't flatten the curve.
export function kde(values, xs, minBandwidth = 3) {
  const n = values.length;
  const sorted = [...values].sort((a, b) => a - b);
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const sd = n > 1 ? Math.sqrt(values.reduce((a, v) => a + (v - mean) ** 2, 0) / (n - 1)) : 0;
  const iqr = (percentile(sorted, 0.75) - percentile(sorted, 0.25)) / 1.34;
  const scale = iqr > 0 ? Math.min(sd, iqr) : sd;
  const bandwidth = Math.max(minBandwidth, 0.9 * scale * n ** -0.2);
  const norm = 1 / (n * bandwidth * Math.sqrt(2 * Math.PI));
  return xs.map((x) => {
    let sum = 0;
    for (const v of values) {
      const z = (x - v) / bandwidth;
      sum += Math.exp(-0.5 * z * z);
    }
    return sum * norm;
  });
}
