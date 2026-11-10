import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

test("literal app element lookups refer to existing page elements", () => {
  const app = readFileSync(new URL("../js/app.js", import.meta.url), "utf8");
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]));
  const lookups = new Set([...app.matchAll(/\$\("([^"]+)"\)/g)].map((match) => match[1]));

  assert.ok(lookups.size > 0);
  assert.deepEqual([...lookups].filter((id) => !ids.has(id)), []);
});
