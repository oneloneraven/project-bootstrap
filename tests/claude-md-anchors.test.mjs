import { strict as assert } from "node:assert";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { realModulesDir, renderReal } from "./helpers.mjs";

const moduleAnswers = {
  "android-toolchain": { application_id: "org.example.sample" },
  "cloudflare-opentofu": { zone_name: "example.test" },
};
const manifest = name => JSON.parse(readFileSync(join(realModulesDir, name, "manifest.json"), "utf8"));
const indexedModules = readdirSync(realModulesDir).filter(name => name !== "core" && manifest(name).claudeIndexLines?.length);

const renders = {
  ...Object.fromEntries(Object.keys(manifest("core").mergePolicies).map(policy => [`core, merge policy ${policy}`, [[], { merge_policy: policy }]])),
  ...Object.fromEntries(indexedModules.map(name => [name, [[name], moduleAnswers[name]]])),
  "cloudflare-opentofu, every option off": [["cloudflare-opentofu"], { ...moduleAnswers["cloudflare-opentofu"], beta: false, admin: false, turnstile: false, d1: false }],
  "cloudflare-opentofu, every option on": [["cloudflare-opentofu"], { ...moduleAnswers["cloudflare-opentofu"], beta: true, admin: true, admin_subdomain: "admin", turnstile: true, d1: true }],
};

function slugs(markdown) {
  const seen = new Map();
  const result = new Set();
  const add = text => {
    const base = text
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s_-]/gu, "")
      .replace(/\s/g, "-");
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    result.add(count ? `${base}-${count}` : base);
  };
  let fence = null;
  let previous = "";
  for (const line of markdown.split("\n")) {
    const marker = line.match(/^\s*(`{3,}|~{3,})/)?.[1];
    if (fence) {
      if (marker?.[0] === fence[0] && marker.length >= fence.length) fence = null;
    } else if (marker) {
      fence = marker;
    } else if (/^#{1,6}\s/.test(line)) {
      add(line.replace(/^#{1,6}\s+/, "").replace(/\s+#+\s*$/, "").trim());
    } else if (/^\s*(=+|-+)\s*$/.test(line) && previous.trim() && !/^\s*[-*+>#|]/.test(previous)) {
      add(previous.trim());
    }
    previous = fence ? "" : line;
  }
  return result;
}

const isFile = path => {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
};

for (const [name, [modules, answers]] of Object.entries(renders)) {
  test(`every anchor link in the ${name} render's CLAUDE.md resolves to a heading`, () => {
    const dest = renderReal(modules, answers);
    const claude = readFileSync(join(dest, "CLAUDE.md"), "utf8");
    const links = [...claude.matchAll(/\]\(([^)\s#]*)#([^)\s]+)\)/g)].filter(([, path]) => !/^[a-z][a-z0-9+.-]*:/i.test(path));
    assert.ok(links.length, `${name}: CLAUDE.md has no anchor links`);
    const broken = links.flatMap(([, path, anchor]) => {
      const file = path || "CLAUDE.md";
      if (!isFile(join(dest, file))) return [`${path}#${anchor}: ${file} isn't a rendered file`];
      return slugs(readFileSync(join(dest, file), "utf8")).has(anchor) ? [] : [`${path}#${anchor}: no matching heading in ${file}`];
    });
    assert.deepEqual(broken, [], `${name}: broken anchor links in CLAUDE.md`);
  });
}
