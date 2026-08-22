import {
  mkdir,
  readFile,
  writeFile
} from "node:fs/promises";
import { dirname } from "node:path";
import { dshHomePath } from "@deepseek-ai/dsh-home-paths";
import { withFileLock } from "@deepseek-ai/dsh-atomic-write";
import { sanitizeFilterInput } from "./filter.js";
const DEFAULT_PERSIST_FILE = "model-health.json";
async function loadPersistence(opts = {}) {
  const filename = resolveFilename(opts);
  try {
    const raw = await readFile(filename, "utf8");
    const parsed = JSON.parse(raw);
    return {
      rounds: Array.isArray(parsed.rounds) ? parsed.rounds : [],
      ...isFilter(parsed.filter) ? { filter: sanitizeFilterInput(parsed.filter) } : {},
      ...typeof parsed.writtenAt === "string" ? { writtenAt: parsed.writtenAt } : {}
    };
  } catch (error) {
    if (isMissing(error)) return { rounds: [] };
    throw error;
  }
}
async function savePersistence(snapshot, opts = {}) {
  const filename = resolveFilename(opts);
  const payload = JSON.stringify({
    ...snapshot,
    writtenAt: (/* @__PURE__ */ new Date()).toISOString()
  }, null, 2);
  await withFileLock(filename, async () => {
    await mkdir(dirname(filename), { recursive: true });
    await writeFile(filename, payload);
  });
}
function resolveFilename(opts) {
  return opts.filename ?? dshHomePath(DEFAULT_PERSIST_FILE);
}
function isFilter(value) {
  return typeof value === "object" && value !== null;
}
function isMissing(error) {
  return typeof error === "object" && error !== null && error.code === "ENOENT";
}
export {
  DEFAULT_PERSIST_FILE,
  loadPersistence,
  savePersistence
};
