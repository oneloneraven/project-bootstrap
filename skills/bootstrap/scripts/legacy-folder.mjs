import { existsSync, renameSync } from "node:fs";
import { join } from "node:path";

export const FOLDER = "project-bootstrap";
const LEGACY_FOLDER = "claude-project-bootstrap";

export function moveLegacyFolder(root) {
  const current = join(root, FOLDER);
  const legacy = join(root, LEGACY_FOLDER);
  if (!existsSync(current) && existsSync(legacy)) renameSync(legacy, current);
  return current;
}
