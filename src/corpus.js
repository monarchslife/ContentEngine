import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const SOP = fs.readFileSync(path.join(root, "docs/SOP.md"), "utf8");
export const SWIPE_FILE = JSON.parse(
  fs.readFileSync(path.join(root, "data/swipe-file.json"), "utf8"),
);
export const MECHANISM_KEYS = Object.keys(SWIPE_FILE.mechanisms);
export const EXAMPLES_BY_ID = new Map(SWIPE_FILE.examples.map((e) => [e.id, e]));
export const LOG_PATH = path.join(root, "logs/decisions.jsonl");
export const PUBLIC_DIR = path.join(root, "public");
