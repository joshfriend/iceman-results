import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { test } from "node:test";

test("finish-time domains use category percentiles and keep outlying riders visible", () => {
  const app = readFileSync(new URL("../src/charts/riderCharts.js", import.meta.url), "utf8");
  const source = app.match(/function domainFor\(minutes, riderMinutes\) \{[\s\S]*?\n\}/)?.[0];
  assert.ok(source);
  const domainFor = runInNewContext(`(${source})`, {
    d3: {
      quantileSorted: (values, percentile) => {
        const index = (values.length - 1) * percentile;
        const lower = Math.floor(index);
        return values[lower] + (values[Math.ceil(index)] - values[lower]) * (index - lower);
      },
    },
  });
  assert.deepEqual(Array.from(domainFor([140, 90, 100, 120], 95)), [90, 150]);
  assert.deepEqual(Array.from(domainFor([270, 90, 150, 240], 95)), [90, 270]);
  assert.deepEqual(Array.from(domainFor([140, 90, 100, 120], 310)), [90, 330]);
  assert.deepEqual(Array.from(domainFor([95], 95)), [90, 120]);
});
