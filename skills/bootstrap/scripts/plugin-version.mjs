import { execFileSync } from "node:child_process";
import { basename } from "node:path";
import { fileURLToPath } from "node:url";

export const pluginRoot = fileURLToPath(new URL("../../../", import.meta.url)).replace(/\/$/, "");

const gitHead = root => execFileSync("git", ["-C", root, "rev-parse", "--short=12", "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });

export function pluginVersion({ root = pluginRoot, git = gitHead } = {}) {
  if (/^[0-9a-f]{12}$/.test(basename(root))) return basename(root);
  try {
    return git(root).trim() || "unknown";
  } catch {
    return "unknown";
  }
}
