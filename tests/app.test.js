import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { test } from "node:test";

test("literal app element lookups refer to existing page elements", () => {
  const app = readFileSync(new URL("../js/app.js", import.meta.url), "utf8");
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]));
  const lookups = new Set([...app.matchAll(/\$\("([^"]+)"\)/g)].map((match) => match[1]));

  assert.ok(lookups.size > 0);
  assert.deepEqual([...lookups].filter((id) => !ids.has(id)), []);
});

test("finish-time domains use category percentiles and keep outlying riders visible", () => {
  const app = readFileSync(new URL("../js/app.js", import.meta.url), "utf8");
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

test("rider history offers a speed toggle and shows average speed in its table", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const app = readFileSync(new URL("../js/app.js", import.meta.url), "utf8");
  const css = readFileSync(new URL("../style.css", import.meta.url), "utf8");
  assert.match(html, /name="history-metric" value="time" checked/);
  assert.match(html, /id="history-speed-option" type="radio" name="history-metric" value="speed" disabled/);
  assert.match(html, /<th scope="col">Finish \/ avg speed<\/th>/);
  assert.match(html, /<th scope="col">Time change<\/th>/);
  assert.match(app, /result\.rider\.speed\.toFixed\(1\).*mph/s);
  assert.match(app, /mark\.append\(icon, place\)/);
  assert.match(css, /\.podium-mark\s*\{[^}]*display: inline-flex/s);
  assert.match(css, /\.podium-mark \.trophy\s*\{[^}]*width: 0\.75rem;\s+height: 0\.75rem/s);
});
