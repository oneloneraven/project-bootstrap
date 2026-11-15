import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { moveLegacyFolder } from "../skills/bootstrap/scripts/legacy-folder.mjs";
import { resolveConfigDir } from "../skills/bootstrap/scripts/secrets/ids.mjs";
import { resolveStateDir } from "../skills/bootstrap/scripts/migrate/state.mjs";

const root = () => mkdtempSync(join(tmpdir(), "legacy-folder-"));
const seed = (dir, text) => {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "f.txt"), text);
};

test("the old folder is moved when only it exists", () => {
  const r = root();
  seed(join(r, "claude-project-bootstrap"), "old");
  assert.equal(moveLegacyFolder(r), join(r, "project-bootstrap"));
  assert.equal(readFileSync(join(r, "project-bootstrap", "f.txt"), "utf8"), "old");
  assert.equal(existsSync(join(r, "claude-project-bootstrap")), false);
});

test("both folders are left alone and the new one is used", () => {
  const r = root();
  seed(join(r, "claude-project-bootstrap"), "old");
  seed(join(r, "project-bootstrap"), "new");
  assert.equal(moveLegacyFolder(r), join(r, "project-bootstrap"));
  assert.equal(readFileSync(join(r, "project-bootstrap", "f.txt"), "utf8"), "new");
  assert.equal(readFileSync(join(r, "claude-project-bootstrap", "f.txt"), "utf8"), "old");
});

test("neither folder existing creates nothing", () => {
  const r = root();
  assert.equal(moveLegacyFolder(r), join(r, "project-bootstrap"));
  assert.deepEqual(readdirSync(r), []);
});

test("the config and state resolvers move the old folder", () => {
  const r = root();
  seed(join(r, "config", "claude-project-bootstrap"), "c");
  seed(join(r, "state", "claude-project-bootstrap", "migrate"), "s");
  const env = { XDG_CONFIG_HOME: join(r, "config"), XDG_STATE_HOME: join(r, "state") };
  assert.equal(resolveConfigDir(env, "/home/u"), join(r, "config", "project-bootstrap"));
  assert.equal(resolveStateDir(env, "/home/u"), join(r, "state", "project-bootstrap", "migrate"));
  assert.equal(readFileSync(join(r, "config", "project-bootstrap", "f.txt"), "utf8"), "c");
  assert.equal(readFileSync(join(r, "state", "project-bootstrap", "migrate", "f.txt"), "utf8"), "s");
});
