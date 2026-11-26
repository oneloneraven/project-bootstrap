import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, existsSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadState, saveRun } from "../skills/bootstrap/scripts/state.mjs";
import { pluginVersion } from "../skills/bootstrap/scripts/plugin-version.mjs";
import { formatJson, maxSlugLength, resolveModules, validateAnswers, render } from "../skills/bootstrap/scripts/render.mjs";

const modulesDir = fileURLToPath(new URL("./fixtures/modules", import.meta.url));
const tmp = () => mkdtempSync(join(tmpdir(), "render-"));

test("resolveModules orders core first and pulls dependencies", () => {
  const names = resolveModules(["b"], modulesDir).map(m => m.name);
  assert.deepEqual(names, ["core", "a", "b"]);
});

test("resolveModules throws on missing dependency", () => {
  assert.throws(() => resolveModules(["c"], modulesDir), { message: "Missing dependency: c requires nope" });
});

test("resolveModules throws on an unknown module", () => {
  assert.throws(() => resolveModules(["zzz"], modulesDir), { message: "Unknown module: zzz" });
});

test("resolveModules rejects two selected modules that conflict", () => {
  assert.throws(() => resolveModules(["a", "rival"], modulesDir), {
    message: "Conflicting modules: rival conflicts with a",
  });
  assert.throws(() => resolveModules(["rival", "a"], modulesDir), {
    message: "Conflicting modules: rival conflicts with a",
  });
});

test("resolveModules rejects a conflict that only arises through dependsOn", () => {
  assert.throws(() => resolveModules(["b", "needs-rival"], modulesDir), {
    message: "Conflicting modules: rival (required by needs-rival) conflicts with a (required by b)",
  });
});

test("resolveModules accepts a conflicting module on its own", () => {
  assert.deepEqual(resolveModules(["rival"], modulesDir).map(m => m.name), ["core", "rival"]);
});

test("validateAnswers slugs a display name", () => {
  const { slug, answers } = validateAnswers({ name: "My Cool App!" });
  assert.equal(slug, "my-cool-app");
  assert.equal(answers.slug, "my-cool-app");
});

test("validateAnswers rejects a name not starting with a letter", () => {
  assert.throws(() => validateAnswers({ name: "123" }), { message: "Project name must start with a letter" });
});

test("validateAnswers rejects an empty name", () => {
  assert.throws(() => validateAnswers({ name: "  " }), { message: "Project name is required" });
});

test("validateAnswers truncates slugs to 63 characters without a trailing hyphen", () => {
  const { slug } = validateAnswers({ name: `${"a".repeat(62)} b` });
  assert.ok(slug.length <= 63);
  assert.ok(!slug.endsWith("-"));
});

test("render substitutes placeholders and derived keys", () => {
  const dest = tmp();
  const modules = resolveModules([], modulesDir);
  const { answers } = validateAnswers({ name: "Demo App", beta: true });
  const written = render({ modules, answers, modulesDir, destDir: dest });
  assert.deepEqual(written.sort(), ["CLAUDE.md", "docs/beta.md"]);
  const claude = readFileSync(join(dest, "CLAUDE.md"), "utf8");
  assert.match(claude, /^# Demo App/);
  assert.match(claude, /Slug: demo-app/);
  assert.match(claude, /- Core line/);
  assert.match(claude, /Checks: \[\{"context":"check-label"\}\]/);
});

test("render honours !when", () => {
  const dest = tmp();
  const { answers } = validateAnswers({ name: "Demo", beta: false });
  const written = render({ modules: resolveModules([], modulesDir), answers, modulesDir, destDir: dest });
  assert.deepEqual(written.sort(), ["CLAUDE.md", "docs/no-beta.md"]);
});

test("render unions required checks across modules without duplicates", () => {
  const modules = resolveModules(["a"], modulesDir);
  modules[1] = { ...modules[1], files: [] };
  const { answers } = validateAnswers({ name: "Demo" });
  const dest = tmp();
  render({ modules, answers, modulesDir, destDir: dest });
  assert.match(readFileSync(join(dest, "CLAUDE.md"), "utf8"), /Checks: \[\{"context":"check-label"\},\{"context":"lint"\}\]/);
});

test("render throws on unresolved placeholder and writes nothing", () => {
  const dest = tmp();
  const { answers } = validateAnswers({ name: "Demo" });
  assert.throws(
    () => render({ modules: resolveModules(["a"], modulesDir), answers, modulesDir, destDir: dest }),
    { message: "Unresolved placeholder {{missing_key}} in a.txt" },
  );
  assert.deepEqual(readdirSync(dest), []);
});

test("render rejects a destination that escapes the target", () => {
  const dest = tmp();
  const modules = resolveModules(["b"], modulesDir).map(m => (m.name === "a" ? { ...m, files: [] } : m));
  const { answers } = validateAnswers({ name: "Demo" });
  assert.throws(() => render({ modules, answers, modulesDir, destDir: dest }), {
    message: "Path escapes destination: ../escape.txt",
  });
  assert.ok(!existsSync(join(dest, "..", "escape.txt")));
});

test("render dryRun writes nothing but reports paths", () => {
  const dest = tmp();
  const { answers } = validateAnswers({ name: "Demo" });
  const written = render({ modules: resolveModules([], modulesDir), answers, modulesDir, destDir: dest, dryRun: true });
  assert.ok(written.includes("CLAUDE.md"));
  assert.deepEqual(readdirSync(dest), []);
});

test("render leaves GitHub Actions expressions untouched", () => {
  const dest = tmp();
  const { answers } = validateAnswers({ name: "Demo" });
  render({ modules: resolveModules(["d"], modulesDir), answers, modulesDir, destDir: dest });
  assert.equal(
    readFileSync(join(dest, ".github/workflows/wf.yml"), "utf8"),
    "name: Demo\nref: ${{ github.sha }}\nctx: ${{ steps }}\n",
  );
});

test("render splits files by stage, defaulting to initial", () => {
  const { answers } = validateAnswers({ name: "Demo" });
  const modules = resolveModules(["e"], modulesDir);
  const initial = render({ modules, answers, modulesDir, destDir: tmp(), dryRun: true, stage: "initial" });
  const app = render({ modules, answers, modulesDir, destDir: tmp(), dryRun: true, stage: "app" });
  assert.ok(initial.includes("infra.txt") && !initial.includes("src/app.txt"));
  assert.deepEqual(app, ["src/app.txt"]);
});

test("render without a stage renders everything", () => {
  const { answers } = validateAnswers({ name: "Demo" });
  const all = render({ modules: resolveModules(["e"], modulesDir), answers, modulesDir, destDir: tmp(), dryRun: true });
  assert.ok(all.includes("infra.txt") && all.includes("src/app.txt"));
});

test("render derives standards fragments, screening table and repo URL", () => {
  const dest = tmp();
  const { answers } = validateAnswers({ name: "Demo", owner: "someone" });
  render({ modules: resolveModules(["f"], modulesDir), answers, modulesDir, destDir: dest });
  const out = readFileSync(join(dest, "out.md"), "utf8");
  assert.match(out, /### F standards\n\n- Rule F/);
  assert.match(out, /\| Dependency or vendor \| Used for \| Maintainer \| On a list\? \| Decision \|\n\|---\|---\|---\|---\|---\|\n\| toolf \| Testing \| Org F \| No \| Allowed \|/);
  assert.match(out, /Last checked: 2026-01-02/);
  assert.match(out, /Repo: https:\/\/github\.com\/someone\/demo/);
});

test("render merges release paths across modules", () => {
  const dest = tmp();
  const { answers } = validateAnswers({ name: "Demo" });
  render({ modules: resolveModules(["g"], modulesDir), answers, modulesDir, destDir: dest });
  assert.deepEqual(JSON.parse(readFileSync(join(dest, "paths.json"), "utf8")), {
    noneAllowed: ["docs/", "e2e/"],
    noneForbidden: ["infra/"],
  });
});

test("a module's overrides replace another module's file", () => {
  const dest = tmp();
  const { answers } = validateAnswers({ name: "Demo" });
  const written = render({ modules: resolveModules(["h"], modulesDir), answers, modulesDir, destDir: dest });
  assert.equal(written.filter(p => p === "CLAUDE.md").length, 1);
  assert.equal(readFileSync(join(dest, "CLAUDE.md"), "utf8"), "overridden Demo\n");
});

test("two modules writing the same path without an override is an error", () => {
  const modules = resolveModules(["h"], modulesDir).map(m => (m.name === "h" ? { ...m, overrides: [] } : m));
  const { answers } = validateAnswers({ name: "Demo" });
  assert.throws(() => render({ modules, answers, modulesDir, destDir: tmp() }), {
    message: "CLAUDE.md is written by both core and h; declare it in h's overrides",
  });
});

test("resolveModules fails on a dependency cycle", () => {
  assert.throws(() => resolveModules(["cyc1"], modulesDir), { message: "Dependency cycle: cyc1 -> cyc2 -> cyc1" });
});

test("render rejects a file and a directory at the same path", () => {
  const dest = tmp();
  const { answers } = validateAnswers({ name: "Demo" });
  assert.throws(() => render({ modules: resolveModules(["clash"], modulesDir), answers, modulesDir, destDir: dest }), {
    message: "a is both a file and a directory",
  });
  assert.deepEqual(readdirSync(dest), []);
});

test("render rejects an empty destination path", () => {
  const modules = [{ name: "core", files: [{ from: "templates/CLAUDE.md", to: "." }] }];
  const { answers } = validateAnswers({ name: "Demo" });
  assert.throws(() => render({ modules, answers, modulesDir, destDir: tmp() }), { message: "Path escapes destination: ." });
});

test("render accepts a file whose name starts with two dots", () => {
  const { answers } = validateAnswers({ name: "Demo" });
  const written = render({ modules: resolveModules(["dots"], modulesDir), answers, modulesDir, destDir: tmp(), dryRun: true });
  assert.ok(written.includes("..foo"));
});

test("validateAnswers enforces the tightest module slug limit", () => {
  assert.throws(() => validateAnswers({ name: "a-very-long-project-name" }, { maxSlugLength: 10 }), {
    message: "Project name gives the slug a-very-long-project-name (24 characters); the selected modules allow at most 10",
  });
});

test("maxSlugLength takes the minimum over modules", () => {
  assert.equal(maxSlugLength(resolveModules(["slim"], modulesDir)), 10);
  assert.equal(maxSlugLength(resolveModules([], modulesDir)), 63);
});

test("validateAnswers derives private, licensor and escaped name keys", () => {
  const { answers } = validateAnswers({ name: `Sam's "App" <1>`, visibility: "private" });
  assert.equal(answers.private, true);
  assert.equal(answers.owner_org, false);
  assert.equal(validateAnswers({ name: "A", visibility: "public", owner_type: "Organization" }).answers.owner_org, true);
  assert.equal(answers.licensor, "One Lone Raven (https://github.com/oneloneraven)");
  assert.equal(answers.name_js, JSON.stringify(`Sam's "App" <1>`));
  assert.equal(answers.greeting_js, JSON.stringify(`Hello from Sam's "App" <1>`));
  assert.equal(answers.name_html, "Sam&#39;s &quot;App&quot; &lt;1&gt;");
});

test("validateAnswers derives Kotlin and Android string forms of the name", () => {
  const { answers } = validateAnswers({ name: `@Sam's "App" $x <1> & \\f` });
  assert.equal(answers.name_kotlin, String.raw`"@Sam's \"App\" \$x <1> & \\f"`);
  assert.equal(answers.greeting_kotlin, String.raw`"Hello from @Sam's \"App\" \$x <1> & \\f"`);
  assert.equal(answers.name_android, String.raw`\@Sam\'s \"App\" $x &lt;1&gt; &amp; \\f`);
  assert.equal(validateAnswers({ name: "A\fB" }).answers.name_kotlin, String.raw`"A\u000CB"`);
});

test("validateAnswers derives the application id path only when there's an id", () => {
  assert.equal(validateAnswers({ name: "A", application_id: "org.example.app" }).answers.application_id_path, "org/example/app");
  assert.equal(validateAnswers({ name: "A" }).answers.application_id_path, undefined);
});

test("validateAnswers keeps a supplied licensor", () => {
  assert.equal(validateAnswers({ name: "Demo", licensor: "Someone Else" }).answers.licensor, "Someone Else");
});


test("a merge file deep-merges JSON into the earlier module's file", () => {
  const dest = tmp();
  const { answers } = validateAnswers({ name: "Demo" });
  render({ modules: resolveModules(["pkgext"], modulesDir), answers, modulesDir, destDir: dest });
  assert.deepEqual(JSON.parse(readFileSync(join(dest, "package.json"), "utf8")), {
    name: "demo",
    scripts: { test: "vitest run", build: "vite build" },
    devDependencies: { vitest: "^5.0.0", vite: "^8.0.0" },
  });
});

test("a merge file with nothing to merge into is an error", () => {
  const { answers } = validateAnswers({ name: "Demo" });
  assert.throws(() => render({ modules: resolveModules(["orphan"], modulesDir), answers, modulesDir, destDir: tmp() }), {
    message: "orphan merges into package.json, but no earlier module writes it",
  });
});

test("allow_builds_yaml lists every module's build decisions with reasons", () => {
  const dest = tmp();
  const { answers } = validateAnswers({ name: "Demo" });
  render({ modules: resolveModules(["ws"], modulesDir), answers, modulesDir, destDir: dest });
  assert.equal(
    readFileSync(join(dest, "ws.yaml"), "utf8"),
    "allowBuilds:\n  # Bundler binary.\n  \"esbuild\": true\n  # Downloaded at runtime instead.\n  \"geckodriver\": false\n",
  );
});

test("required checks can depend on an answer", () => {
  const modules = resolveModules(["condcheck"], modulesDir);
  const contexts = visibility => {
    const dest = tmp();
    const { answers } = validateAnswers({ name: "Demo", visibility });
    render({ modules, answers, modulesDir, destDir: dest });
    return readFileSync(join(dest, "CLAUDE.md"), "utf8").match(/Checks: (.*)/)[1];
  };
  assert.equal(contexts("public"), '[{"context":"check-label"},{"context":"always"},{"context":"public-only"}]');
  assert.equal(contexts("private"), '[{"context":"check-label"},{"context":"always"}]');
});

test("an override can't silently drop an earlier merge", () => {
  const dir = mkdtempSync(join(tmpdir(), "mods-"));
  const write = (path, text) => {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  };
  write("core/manifest.json", JSON.stringify({ name: "core", files: [{ from: "t/p.json", to: "p.json" }] }));
  write("core/t/p.json", '{"a":[1]}');
  write("m/manifest.json", JSON.stringify({ name: "m", files: [{ from: "t/p.json", to: "p.json", merge: true }] }));
  write("m/t/p.json", '{"a":{"b":1},"c":2}');
  write("o/manifest.json", JSON.stringify({ name: "o", dependsOn: ["m"], overrides: ["p.json"], files: [{ from: "t/p.json", to: "p.json" }] }));
  write("o/t/p.json", "{}");
  const { answers } = validateAnswers({ name: "Demo" });
  const dest = tmp();
  render({ modules: resolveModules(["m"], dir), answers, modulesDir: dir, destDir: dest });
  assert.deepEqual(JSON.parse(readFileSync(join(dest, "p.json"), "utf8")), { a: { b: 1 }, c: 2 });
  assert.throws(() => render({ modules: resolveModules(["o"], dir), answers, modulesDir: dir, destDir: tmp() }), {
    message: "o overrides p.json, which m merges into; merge instead",
  });
});

test("allow_builds_yaml quotes package names and keeps reasons on one line", () => {
  const dir = mkdtempSync(join(tmpdir(), "mods-"));
  mkdirSync(join(dir, "core", "t"), { recursive: true });
  writeFileSync(join(dir, "core", "t", "w.yaml"), "{{allow_builds_yaml}}\n");
  writeFileSync(
    join(dir, "core", "manifest.json"),
    JSON.stringify({ name: "core", files: [{ from: "t/w.yaml", to: "w.yaml" }], allowBuilds: { "@scope/pkg": { allow: true, reason: "Two\nlines." } } }),
  );
  const dest = tmp();
  const { answers } = validateAnswers({ name: "Demo" });
  render({ modules: resolveModules([], dir), answers, modulesDir: dir, destDir: dest });
  assert.equal(readFileSync(join(dest, "w.yaml"), "utf8"), '  # Two lines.\n  "@scope/pkg": true\n');
});

test("formatJson keeps short scalar arrays on one line and expands objects and long arrays", () => {
  const long = Array.from({ length: 12 }, (_, i) => `path/number-${i}/`);
  const out = formatJson({ short: ["a", "b"], empty: [], nested: { n: 1 }, long, items: [{ x: 1 }] });
  assert.equal(
    out,
    `{\n  "short": ["a", "b"],\n  "empty": [],\n  "nested": {\n    "n": 1\n  },\n  "long": [\n${long.map(p => `    "${p}"`).join(",\n")}\n  ],\n  "items": [\n    {\n      "x": 1\n    }\n  ]\n}`,
  );
});

const answersFile = (dir, extra = {}) => {
  const path = join(dir, "answers.json");
  const base = JSON.parse(readFileSync(new URL("./fixtures/answers-core.json", import.meta.url), "utf8"));
  writeFileSync(path, JSON.stringify({ ...base, zone_name: "example.test", beta: false, ...extra }));
  return path;
};

function vaultModule(to) {
  const dir = tmp();
  mkdirSync(join(dir, "v", "templates"), { recursive: true });
  writeFileSync(join(dir, "v", "templates", "doc.md"), "{{name}} private doc\n");
  return { modulesDir: dir, modules: [{ name: "v", files: [{ from: "templates/doc.md", to, vault: true }] }] };
}

test("render stages a vault file under .bootstrap/vault, never in the project itself", () => {
  const dest = tmp();
  const { modules, modulesDir } = vaultModule("runbooks/doc.md");
  const { answers } = validateAnswers({ name: "Demo" });
  assert.deepEqual(render({ modules, answers, modulesDir, destDir: dest }), [".bootstrap/vault/runbooks/doc.md"]);
  assert.equal(readFileSync(join(dest, ".bootstrap/vault/runbooks/doc.md"), "utf8"), "Demo private doc\n");
  assert.deepEqual(readdirSync(dest), [".bootstrap"]);
});

test("render rejects a vault file that escapes the staging folder", () => {
  const dest = tmp();
  const { modules, modulesDir } = vaultModule("../state.json");
  const { answers } = validateAnswers({ name: "Demo" });
  assert.throws(() => render({ modules, answers, modulesDir, destDir: dest }), { message: "Path escapes destination: ../state.json" });
  assert.deepEqual(readdirSync(dest), []);
});

test("bootstrapOnly writes only the .bootstrap files and leaves the project's own files alone", () => {
  const project = tmp();
  writeFileSync(join(project, "CLAUDE.md"), "mine\n");
  mkdirSync(join(project, "infra"));
  writeFileSync(join(project, "infra", "main.tf"), "mine\n");
  mkdirSync(join(project, ".bootstrap", "vault", "infra"), { recursive: true });
  writeFileSync(join(project, ".bootstrap", "vault", "infra", "README.md"), "staged\n");
  const real = fileURLToPath(new URL("../skills/bootstrap/modules", import.meta.url));
  const { answers } = validateAnswers({ ...JSON.parse(readFileSync(new URL("./fixtures/answers-core.json", import.meta.url), "utf8")), zone_name: "example.test", beta: false });
  const written = render({ modules: resolveModules(["cloudflare-opentofu"], real), answers, modulesDir: real, destDir: project, bootstrapOnly: true });
  assert.ok(written.includes(".bootstrap/cloudflare/tokens.json"));
  assert.ok(written.every(path => path.startsWith(".bootstrap/")), written.join(", "));
  assert.ok(!written.some(path => path.startsWith(".bootstrap/vault/")), written.join(", "));
  assert.equal(readFileSync(join(project, ".bootstrap", "vault", "infra", "README.md"), "utf8"), "staged\n");
  assert.equal(readFileSync(join(project, "CLAUDE.md"), "utf8"), "mine\n");
  assert.equal(readFileSync(join(project, "infra", "main.tf"), "utf8"), "mine\n");
  assert.deepEqual(readdirSync(project).sort(), [".bootstrap", "CLAUDE.md", "infra"]);
  assert.deepEqual(readdirSync(join(project, "infra")), ["main.tf"]);
});

test("render.mjs --bootstrap-only writes the token definitions and records the plugin version and modules", () => {
  const scratch = tmp();
  const project = tmp();
  writeFileSync(join(project, "README.md"), "mine\n");
  saveRun(project, { answers: { name: "Sample Project" }, modules: ["core"] }, "0123456789ab");
  const script = fileURLToPath(new URL("../skills/bootstrap/scripts/render.mjs", import.meta.url));
  const result = spawnSync("node", [script, "--modules", "cloudflare-opentofu", "--answers", answersFile(scratch), "--dest", project, "--bootstrap-only"], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.ok(existsSync(join(project, ".bootstrap", "cloudflare", "tokens.json")));
  assert.equal(readFileSync(join(project, "README.md"), "utf8"), "mine\n");
  assert.ok(!existsSync(join(project, "package.json")));
  const state = loadState(project);
  assert.equal(state.pluginVersion, pluginVersion());
  assert.notEqual(state.pluginVersion, "0123456789ab");
  assert.deepEqual(state.modules, ["core", "cloudflare-opentofu"]);
  assert.equal(state.answers.zone_name, "example.test");
});

test("a screening row missing a required field fails the render and names the field", () => {
  const dir = tmp();
  mkdirSync(join(dir, "core"));
  const row = { dependency: "x", usedFor: "Testing", maintainer: "Org", listed: "N", decision: "Allowed", screenedOn: "2026-01-01" };
  const { answers } = validateAnswers({ name: "Demo" });
  for (const field of ["usedFor", "decision", "screenedOn"]) {
    const { [field]: _omitted, ...incomplete } = row;
    writeFileSync(join(dir, "core", "manifest.json"), JSON.stringify({ name: "core", files: [], screening: [incomplete] }));
    assert.throws(() => render({ modules: resolveModules([], dir), answers, modulesDir: dir, destDir: tmp() }), new RegExp(`core's screening row "x" needs ${field}`));
  }
  writeFileSync(join(dir, "core", "manifest.json"), JSON.stringify({ name: "core", files: [], screening: [{ ...row, screenedOn: "13/11/2026" }] }));
  assert.throws(() => render({ modules: resolveModules([], dir), answers, modulesDir: dir, destDir: tmp() }), /needs screenedOn as YYYY-MM-DD/);
});

function fragmentModules(layout) {
  const dir = tmp();
  for (const [name, { manifest, files = {} }] of Object.entries(layout)) {
    mkdirSync(join(dir, name, "templates"), { recursive: true });
    writeFileSync(join(dir, name, "manifest.json"), JSON.stringify({ name, ...manifest }));
    for (const [file, text] of Object.entries(files)) writeFileSync(join(dir, name, "templates", file), text);
  }
  return dir;
}

const renderModules = (dir, selected, answers, dest) => render({ modules: resolveModules(selected, dir), answers, modulesDir: dir, destDir: dest });

const renderFragments = (dir, selected) => {
  const { answers } = validateAnswers({ name: "Demo" });
  const dest = tmp();
  render({ modules: resolveModules(selected, dir), answers, modulesDir: dir, destDir: dest });
  return dest;
};

test("a fragment from a dependency is substituted with the host's values inside a dependent's template", () => {
  const dir = fragmentModules({
    core: { manifest: { files: [] } },
    base: { manifest: { fragments: { greeting: "templates/greeting.md" }, files: [] }, files: { "greeting.md": "Hello {{slug}} from ${{ github.actor }}.\n" } },
    stack: { manifest: { dependsOn: ["base"], files: [{ from: "templates/doc.md", to: "doc.md" }] }, files: { "doc.md": "Top\n{{fragment_greeting}}Bottom {{slug}}\n" } },
  });
  const dest = renderFragments(dir, ["stack"]);
  assert.equal(readFileSync(join(dest, "doc.md"), "utf8"), "Top\nHello demo from ${{ github.actor }}.\nBottom demo\n");
});

test("an unknown fragment fails the render and names the fragment and the file", () => {
  const dir = fragmentModules({
    core: { manifest: { files: [] } },
    stack: { manifest: { files: [{ from: "templates/doc.md", to: "doc.md" }] }, files: { "doc.md": "{{fragment_missing}}\n" } },
  });
  assert.throws(() => renderFragments(dir, ["stack"]), /Unknown fragment "missing" in doc\.md/);
});

test("two modules declaring the same fragment fail the render and name both", () => {
  const dir = fragmentModules({
    core: { manifest: { files: [] } },
    a: { manifest: { fragments: { shared: "templates/x.md" }, files: [] }, files: { "x.md": "A\n" } },
    b: { manifest: { dependsOn: ["a"], fragments: { shared: "templates/x.md" }, files: [] }, files: { "x.md": "B\n" } },
  });
  assert.throws(() => renderFragments(dir, ["b"]), /Fragment "shared" is declared by both a and b/);
});

test("a fragment that a template uses and that has an unresolved placeholder fails the render naming the fragment", () => {
  const dir = fragmentModules({
    core: { manifest: { files: [] } },
    base: { manifest: { fragments: { bad: "templates/bad.md" }, files: [] }, files: { "bad.md": "{{nope}}\n" } },
    stack: { manifest: { dependsOn: ["base"], files: [{ from: "templates/doc.md", to: "doc.md" }] }, files: { "doc.md": "{{fragment_bad}}\n" } },
  });
  assert.throws(() => renderFragments(dir, ["stack"]), /Unresolved placeholder \{\{nope\}\} in fragment bad/);
});

test("a fragment no template uses isn't rendered, so its unknown placeholder doesn't fail the render", () => {
  const dir = fragmentModules({
    core: { manifest: { files: [] } },
    base: { manifest: { fragments: { unused: "templates/unused.md" }, files: [] }, files: { "unused.md": "{{zone_name}}\n" } },
    stack: { manifest: { dependsOn: ["base"], files: [{ from: "templates/doc.md", to: "doc.md" }] }, files: { "doc.md": "plain\n" } },
  });
  assert.equal(readFileSync(join(renderFragments(dir, ["stack"]), "doc.md"), "utf8"), "plain\n");
});

test("a conditional fragment is empty when its answer is false and the text when it is true", () => {
  const dir = fragmentModules({
    core: { manifest: { files: [] } },
    stack: {
      manifest: { fragments: { extra: { path: "templates/extra.md", when: "beta" } }, files: [{ from: "templates/doc.md", to: "doc.md" }] },
      files: { "extra.md": ", extra {{slug}}", "doc.md": "base{{fragment_extra}}\n" },
    },
  });
  const render = beta => {
    const { answers } = validateAnswers({ name: "Demo", beta });
    const dest = tmp();
    renderModules(dir, ["stack"], answers, dest);
    return readFileSync(join(dest, "doc.md"), "utf8");
  };
  assert.equal(render(true), "base, extra demo\n");
  assert.equal(render(false), "base\n");
});

function conditionalFiles(when, answers) {
  const dir = fragmentModules({
    core: { manifest: { files: [{ from: "templates/doc.md", to: "doc.md", when }] }, files: { "doc.md": "x\n" } },
  });
  const { answers: validated } = validateAnswers({ name: "Demo", ...answers });
  return render({ modules: resolveModules([], dir), answers: validated, modulesDir: dir, destDir: tmp(), dryRun: true });
}

test("a file whose when is an array is rendered when any element is true", () => {
  assert.deepEqual(conditionalFiles(["beta", "admin"], { beta: true }), ["doc.md"]);
  assert.deepEqual(conditionalFiles(["beta", "admin"], { admin: true }), ["doc.md"]);
  assert.deepEqual(conditionalFiles(["beta", "admin"], { beta: true, admin: true }), ["doc.md"]);
  assert.deepEqual(conditionalFiles(["beta", "admin"], {}), []);
});

test("an element of a when array may be negated", () => {
  assert.deepEqual(conditionalFiles(["beta", "!admin"], { admin: true }), []);
  assert.deepEqual(conditionalFiles(["beta", "!admin"], { admin: false }), ["doc.md"]);
  assert.deepEqual(conditionalFiles(["beta", "!admin"], { beta: true, admin: true }), ["doc.md"]);
});

test("an empty when array renders nothing and a one-element array behaves like the string", () => {
  assert.deepEqual(conditionalFiles([], {}), []);
  assert.deepEqual(conditionalFiles(["beta"], { beta: true }), ["doc.md"]);
  assert.deepEqual(conditionalFiles(["beta"], {}), []);
});

test("a conditional fragment with a when array is the text when any element is true and empty otherwise", () => {
  const dir = fragmentModules({
    core: { manifest: { files: [] } },
    stack: {
      manifest: { fragments: { extra: { path: "templates/extra.md", when: ["beta", "admin"] } }, files: [{ from: "templates/doc.md", to: "doc.md" }] },
      files: { "extra.md": ", extra", "doc.md": "base{{fragment_extra}}\n" },
    },
  });
  const render = answers => {
    const { answers: validated } = validateAnswers({ name: "Demo", ...answers });
    const dest = tmp();
    renderModules(dir, ["stack"], validated, dest);
    return readFileSync(join(dest, "doc.md"), "utf8");
  };
  assert.equal(render({ beta: true }), "base, extra\n");
  assert.equal(render({ admin: true }), "base, extra\n");
  assert.equal(render({}), "base\n");
});

test("a required check with a when array is included when any element is true", () => {
  const dir = fragmentModules({
    core: { manifest: { files: [], requiredChecks: [{ context: "either", when: ["beta", "admin"] }] }, files: {} },
  });
  const checks = answers => {
    const modules = resolveModules([], dir).map(m => ({ ...m, files: [{ from: "templates/doc.md", to: "doc.md" }] }));
    writeFileSync(join(dir, "core", "templates", "doc.md"), "{{required_checks_json}}\n");
    const { answers: validated } = validateAnswers({ name: "Demo", ...answers });
    const dest = tmp();
    render({ modules, answers: validated, modulesDir: dir, destDir: dest });
    return readFileSync(join(dest, "doc.md"), "utf8").trim();
  };
  assert.equal(checks({ admin: true }), '[{"context":"either"}]');
  assert.equal(checks({}), "[]");
});

test("a fragment can place another fragment, which is substituted with the same values", () => {
  const dir = fragmentModules({
    core: { manifest: { files: [] } },
    stack: {
      manifest: {
        fragments: { outer: "templates/outer.md", inner: { path: "templates/inner.md", when: "beta" } },
        files: [{ from: "templates/doc.md", to: "doc.md" }],
      },
      files: { "outer.md": "outer {{slug}}[{{fragment_inner}}]", "inner.md": "inner {{slug}}", "doc.md": "{{fragment_outer}}\n" },
    },
  });
  const render = beta => {
    const { answers } = validateAnswers({ name: "Demo", beta });
    const dest = tmp();
    renderModules(dir, ["stack"], answers, dest);
    return readFileSync(join(dest, "doc.md"), "utf8");
  };
  assert.equal(render(true), "outer demo[inner demo]\n");
  assert.equal(render(false), "outer demo[]\n");
});

test("fragments that place each other fail the render and name the cycle", () => {
  const dir = fragmentModules({
    core: { manifest: { files: [] } },
    stack: {
      manifest: { fragments: { one: "templates/one.md", two: "templates/two.md" }, files: [{ from: "templates/doc.md", to: "doc.md" }] },
      files: { "one.md": "{{fragment_two}}", "two.md": "{{fragment_one}}", "doc.md": "{{fragment_one}}\n" },
    },
  });
  assert.throws(() => renderFragments(dir, ["stack"]), /Fragment cycle: one -> two -> one/);
});
