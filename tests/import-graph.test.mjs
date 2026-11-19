import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../skills/bootstrap/scripts", import.meta.url));
const SPECIFIER = /\bimport\s*\(\s*["'](\.[^"']*)["']\s*\)|\b(?:import|export)\b[^"'`;]*?\bfrom\s*["'](\.[^"']*)["']|^\s*import\s*["'](\.[^"']*)["']/gm;

function scripts(dir) {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return scripts(path);
    return name.endsWith(".mjs") ? [path] : [];
  });
}

function graph() {
  const edges = new Map();
  for (const file of scripts(root)) {
    const targets = [];
    for (const match of readFileSync(file, "utf8").matchAll(SPECIFIER)) {
      const specifier = match[1] ?? match[2] ?? match[3];
      const target = resolve(dirname(file), specifier);
      assert.ok(existsSync(target), `${relative(root, file)} imports ${specifier}, which does not exist`);
      targets.push(target);
    }
    edges.set(file, targets);
  }
  return edges;
}

function findCycle(edges) {
  const done = new Set();
  const path = [];
  const visit = node => {
    if (path.includes(node)) return [...path.slice(path.indexOf(node)), node];
    if (done.has(node)) return null;
    path.push(node);
    for (const next of edges.get(node) ?? []) {
      const cycle = visit(next);
      if (cycle) return cycle;
    }
    path.pop();
    done.add(node);
    return null;
  };
  for (const node of edges.keys()) {
    const cycle = visit(node);
    if (cycle) return cycle;
  }
  return null;
}

test("the scripts' import graph has no cycle", () => {
  const cycle = findCycle(graph());
  assert.equal(cycle, null, `Import cycle: ${cycle?.map(file => relative(root, file)).join(" -> ")}`);
});

test("the cycle finder reports a cycle when there is one", () => {
  const edges = new Map([["a", ["b"]], ["b", ["c"]], ["c", ["a"]]]);
  assert.deepEqual(findCycle(edges), ["a", "b", "c", "a"]);
});
