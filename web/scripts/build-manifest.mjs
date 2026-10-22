import { readdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, extname, join, resolve } from "node:path";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const defaultDist = resolve(scriptDirectory, "../../dist");
const distDirectory = resolve(process.argv[2] ?? defaultDist);
const assetDirectory = join(distDirectory, "assets");
const allowedExtensions = new Set([
  ".js",
  ".css",
  ".woff",
  ".woff2",
  ".ttf",
  ".otf",
  ".eot",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".svg",
  ".webp",
  ".avif",
  ".ico",
]);

function safeAssetName(name) {
  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name) && !name.includes("..");
}

const html = await readFile(join(distDirectory, "index.html"), "utf8");
const entries = await readdir(assetDirectory, { withFileTypes: true });
const names = entries.map((entry) => {
  if (!entry.isFile() || !safeAssetName(entry.name)) {
    throw new Error("The production assets directory contains an unsupported entry.");
  }
  const extension = extname(entry.name).toLowerCase();
  if (extension === ".map" || !allowedExtensions.has(extension)) {
    throw new Error("The production assets directory contains an unsupported file.");
  }
  return entry.name;
});
names.sort();

if (!names.some((name) => name.startsWith("reaflow-elk-worker-") && name.endsWith(".js"))) {
  throw new Error("The production build is missing its same-origin Reaflow ELK worker.");
}

const routes = { "/": "index.html" };
for (const name of names) routes["/assets/" + name] = "assets/" + name;
for (const match of html.matchAll(/(?:src|href)=["']([^"']+)["']/g)) {
  const reference = match[1];
  if (/^(?:https?:)?\/\//i.test(reference)) {
    throw new Error("The production HTML may not reference external assets.");
  }
  if (reference.startsWith("/assets/") && !Object.hasOwn(routes, reference)) {
    throw new Error("The production HTML references an asset outside the generated manifest.");
  }
}

const manifest = { version: 1, routes };
await writeFile(
  join(distDirectory, "manifest.json"),
  JSON.stringify(manifest, null, 2) + "\n",
  "utf8",
);
