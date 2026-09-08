import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve("supabase");
const failures = [];

async function files(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const output = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) output.push(...await files(full));
    else if (entry.isFile() && entry.name.endsWith(".sql")) output.push(full);
  }
  return output;
}

function withoutComments(sql) {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--.*$/gm, " ");
}

for (const file of await files(root)) {
  const raw = await readFile(file, "utf8");
  const sql = withoutComments(raw);
  const relative = path.relative(process.cwd(), file);

  if (/\bsecurity\s+definer\b/i.test(sql)) {
    failures.push(`${relative}: SECURITY DEFINER is forbidden; use service_role grants + SECURITY INVOKER.`);
  }

  if (/\bgrant\b[\s\S]*?\bto\s+(?:anon|authenticated)\b/i.test(sql)) {
    failures.push(`${relative}: direct GRANT to anon/authenticated is forbidden for LVL Mail internal persistence.`);
  }
}

if (failures.length) {
  console.error("SQL security gate failed:\n" + failures.map((failure) => `- ${failure}`).join("\n"));
  process.exit(1);
}

console.log("SQL security gate passed: no elevated definer functions or public Data API grants.");
