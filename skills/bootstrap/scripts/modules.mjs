import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

function loadManifest(name, modulesDir) {
  const path = join(modulesDir, name, "manifest.json");
  if (!existsSync(path)) throw new Error(`Unknown module: ${name}`);
  return JSON.parse(readFileSync(path, "utf8"));
}

export function resolveModules(selected, modulesDir) {
  const ordered = [];
  const visiting = [];
  const requiredByOf = new Map();
  const visit = (name, requiredBy) => {
    if (ordered.some(m => m.name === name)) return;
    if (visiting.includes(name)) throw new Error(`Dependency cycle: ${[...visiting.slice(visiting.indexOf(name)), name].join(" -> ")}`);
    let manifest;
    try {
      manifest = loadManifest(name, modulesDir);
    } catch (error) {
      if (requiredBy) throw new Error(`Missing dependency: ${requiredBy} requires ${name}`);
      throw error;
    }
    requiredByOf.set(name, requiredBy);
    visiting.push(name);
    for (const dep of manifest.dependsOn ?? []) visit(dep, name);
    visiting.pop();
    ordered.push(manifest);
  };
  visit("core");
  for (const name of selected) visit(name);
  rejectConflicts(ordered, requiredByOf);
  return ordered;
}

function rejectConflicts(ordered, requiredByOf) {
  const present = name => {
    const via = requiredByOf.get(name);
    return via ? `${name} (required by ${via})` : name;
  };
  for (const module of ordered) {
    for (const other of module.conflictsWith ?? []) {
      if (ordered.some(m => m.name === other)) {
        throw new Error(`Conflicting modules: ${present(module.name)} conflicts with ${present(other)}`);
      }
    }
  }
}

export function maxSlugLength(modules) {
  return Math.min(63, ...modules.map(m => m.maxSlugLength ?? 63));
}

export function mergePolicies(modules) {
  return modules.find(m => m.mergePolicies)?.mergePolicies ?? {};
}
