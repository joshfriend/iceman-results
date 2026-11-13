import { copyFile, mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const index = JSON.parse(await readFile("data/index.json", "utf8"));
const paths = new Set(["index.json"]);
for (const event of Object.values(index.events)) {
  for (const year of event.years) {
    paths.add(year.path);
    if (year.splits) paths.add(year.splits);
  }
}
for (const path of paths) {
  const destination = join("dist", "data", path);
  await mkdir(dirname(destination), { recursive: true });
  await copyFile(join("data", path), destination);
}
await copyFile("CNAME", "dist/CNAME");
await copyFile(".nojekyll", "dist/.nojekyll");
