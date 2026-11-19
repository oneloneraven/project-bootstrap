import { strict as assert } from "node:assert";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { renderReal } from "./helpers.mjs";

const cf = { zone_name: "example.test" };

const renders = {
  "core, merge policy claude": [[], { merge_policy: "claude" }],
  "core, merge policy claude-except-release": [[], { merge_policy: "claude-except-release" }],
  "core, merge policy maintainer": [[], { merge_policy: "maintainer" }],
  "js-toolchain": [["js-toolchain"]],
  "python-toolchain": [["python-toolchain"]],
  "android-toolchain": [["android-toolchain"], { application_id: "org.example.sample" }],
  "web-app": [["web-app"]],
  "cloudflare-identity": [["cloudflare-identity"]],
  "cloudflare-opentofu, every option off": [["cloudflare-opentofu"], { ...cf, beta: false, admin: false, turnstile: false, d1: false }],
  "cloudflare-opentofu, every option on": [["cloudflare-opentofu"], { ...cf, beta: true, admin: true, admin_subdomain: "admin", turnstile: true, d1: true }],
};

function slugs(markdown) {
  const seen = new Map();
  const result = new Set();
  let fenced = false;
  for (const line of markdown.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
    const heading = !fenced && line.match(/^#{1,6}\s+(.+?)\s*#*\s*$/);
    if (!heading) continue;
    const base = heading[1]
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s_-]/gu, "")
      .replace(/\s/g, "-");
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    result.add(count ? `${base}-${count}` : base);
  }
  return result;
}

for (const [name, [modules, answers]] of Object.entries(renders)) {
  test(`every anchor link in the ${name} render's CLAUDE.md resolves to a heading`, () => {
    const dest = renderReal(modules, answers);
    const claude = readFileSync(join(dest, "CLAUDE.md"), "utf8");
    const links = [...claude.matchAll(/\]\(([^)\s#]*)#([^)\s]+)\)/g)];
    assert.ok(links.length, `${name}: CLAUDE.md has no anchor links`);
    const broken = links.flatMap(([, path, anchor]) => {
      const file = path || "CLAUDE.md";
      if (!existsSync(join(dest, file))) return [`${path}#${anchor}: ${file} isn't rendered`];
      return slugs(readFileSync(join(dest, file), "utf8")).has(anchor) ? [] : [`${path}#${anchor}: no matching heading in ${file}`];
    });
    assert.deepEqual(broken, [], `${name}: broken anchor links in CLAUDE.md`);
  });
}
