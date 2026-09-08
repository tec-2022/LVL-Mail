import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import process from "node:process";

const root = process.cwd();
const manifestPath = join(root, "supabase", "migration-manifest.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));

if (!Array.isArray(manifest.files) || manifest.files.length === 0) {
  throw new Error("Migration manifest must contain a non-empty files array");
}

const duplicates = manifest.files.filter((value, index, values) => values.indexOf(value) !== index);
if (duplicates.length) throw new Error(`Duplicate migration manifest entries: ${[...new Set(duplicates)].join(", ")}`);

for (const file of manifest.files) {
  if (typeof file !== "string" || !file.startsWith("supabase/") || !file.endsWith(".sql")) {
    throw new Error(`Invalid migration entry: ${String(file)}`);
  }
  const fileStat = await stat(join(root, file)).catch(() => null);
  if (!fileStat?.isFile()) throw new Error(`Migration manifest references missing file: ${file}`);
}

async function collectSql(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const absolute = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules") continue;
      files.push(...await collectSql(absolute));
    } else if (entry.isFile() && entry.name.endsWith(".sql")) {
      files.push(relative(root, absolute).replaceAll("\\", "/"));
    }
  }
  return files;
}

const discovered = (await collectSql(join(root, "supabase"))).sort();
const listed = [...manifest.files].sort();
const missingFromManifest = discovered.filter((file) => !listed.includes(file));
const staleEntries = listed.filter((file) => !discovered.includes(file));

if (missingFromManifest.length || staleEntries.length) {
  const messages = [];
  if (missingFromManifest.length) messages.push(`SQL not ordered in manifest: ${missingFromManifest.join(", ")}`);
  if (staleEntries.length) messages.push(`Manifest entries without SQL file: ${staleEntries.join(", ")}`);
  throw new Error(messages.join("\n"));
}

if (manifest.files.at(-1) !== "supabase/retention.sql") {
  throw new Error("Retention must be the last schema extension in the bootstrap order");
}

console.log(`Migration manifest passed: ${manifest.files.length} SQL files have an explicit bootstrap order.`);
