// Write third-party notices for every production npm package in package-lock.json that is installed.
//
//   node scripts/third-party-notices.mjs > THIRD_PARTY_NOTICES.txt
//
// Production means not marked "dev" in the lockfile: these packages run on the server or are bundled
// into the JavaScript sent to browsers. Each entry gives the package, version, declared licence and the
// full text of every licence or notice file it ships.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const HINTS = ["license", "licence", "copying", "notice"];

/** Vendored code in this repository that no package manager tracks. */
const VENDORED = `shadcn/ui components (src/components/ui)
Licence: MIT
Source: https://github.com/shadcn-ui/ui
Generated into this repository by the shadcn CLI and adapted.

MIT License

Copyright (c) 2023 shadcn

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
`;

const lock = JSON.parse(readFileSync("package-lock.json", "utf8"));
const seen = new Map();
for (const [path, info] of Object.entries(lock.packages)) {
  if (!path.startsWith("node_modules/") || info.dev || info.link) continue;
  if (!existsSync(path)) continue; // optional platform binaries for other systems
  const name = info.name ?? path.slice(path.lastIndexOf("node_modules/") + "node_modules/".length);
  const key = `${name}@${info.version}`;
  if (!seen.has(key)) seen.set(key, { name, version: info.version, path, license: info.license });
}

const out = [];
out.push("THIRD-PARTY SOFTWARE NOTICES: SensorTrace web application\n");
out.push("Generated from the installed production npm packages when the image was built.\n");
out.push(`${seen.size} packages, plus vendored code listed first.\n\n`);
out.push("=".repeat(78) + "\n" + VENDORED + "\n");
for (const key of [...seen.keys()].sort()) {
  const p = seen.get(key);
  let manifest = {};
  try {
    manifest = JSON.parse(readFileSync(join(p.path, "package.json"), "utf8"));
  } catch {}
  const licence = p.license ?? manifest.license ?? "See licence text";
  const repo = typeof manifest.repository === "string" ? manifest.repository : manifest.repository?.url;
  out.push("=".repeat(78) + "\n");
  out.push(`${p.name} ${p.version}\nLicence: ${typeof licence === "string" ? licence : JSON.stringify(licence)}\n`);
  if (repo) out.push(`Source: ${repo}\n`);
  const files = readdirSync(p.path)
    .filter((f) => HINTS.some((h) => f.toLowerCase().startsWith(h)))
    .sort();
  if (files.length === 0) out.push("(The package ships no separate licence file; the declared licence above applies.)\n");
  for (const f of files) {
    try {
      out.push(`\n--- ${f} ---\n${readFileSync(join(p.path, f), "utf8").trim()}\n`);
    } catch {}
  }
  out.push("\n");
}
process.stdout.write(out.join(""));
