import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { checkPublicPages, sharedSections } from "../skills/bootstrap/modules/core/templates/github/scripts/check-public-pages.mjs";
import { renderReal } from "./helpers.mjs";

const dest = renderReal([]);
const read = path => readFileSync(join(dest, path), "utf8");
const pages = { "docs/public/ethics.md": "site/ethics.md", "docs/public/privacy.md": "site/privacy.md" };
const copies = () => ({ "site/ethics.md": read("docs/public/ethics.md"), "site/privacy.md": read("docs/public/privacy.md") });
const check = (published, config = { pages }) =>
  checkPublicPages(config, path => (path.startsWith("docs/") ? read(path) : published[path]));

const ethicsSections = ["intro", "building-with-ai", "who-we-buy-from", "democratisation", "closing"];
const privacySections = ["intro", "app", "website", "feedback", "rights", "changes"];
const ethicsSlots = ["product-sections", "tools-used", "why-free"];
const privacySlots = ["app", "website", "feedback", "rights"];

test("the ethics page renders every shared section and slot with markers", () => {
  const text = read("docs/public/ethics.md");
  assert.deepEqual([...sharedSections(text).keys()], ethicsSections);
  for (const slot of ethicsSlots) assert.match(text, new RegExp(`<!-- slot:${slot} -->[\\s\\S]*<!-- /slot:${slot} -->`));
});

test("the privacy page renders every shared section and slot with markers", () => {
  const text = read("docs/public/privacy.md");
  assert.deepEqual([...sharedSections(text).keys()], privacySections);
  for (const slot of privacySlots) assert.match(text, new RegExp(`<!-- slot:${slot} -->[\\s\\S]*<!-- /slot:${slot} -->`));
});

test("the privacy page has the same headings in order", () => {
  const headings = read("docs/public/privacy.md").match(/^#{1,2} .+$/gm);
  assert.deepEqual(headings, ["# Privacy", "## What the app keeps", "## What the website collects", "## Feedback", "## Your rights", "## Changes"]);
});

test("the shared sections have no en or em dashes and name no suppliers", () => {
  for (const page of ["ethics", "privacy"]) {
    for (const [name, body] of sharedSections(read(`docs/public/${page}.md`))) {
      assert.doesNotMatch(body, /[–—]/, `${page} ${name}`);
      assert.doesNotMatch(body, /cloudflare|github|microsoft|google|claude|anthropic|discord|better stack/i, `${page} ${name}`);
    }
  }
});

test("the shared privacy wording rules out tracking without saying no analytics", () => {
  const text = [...sharedSections(read("docs/public/privacy.md")).values()].join(" ");
  assert.match(text, /cookies that track you/);
  assert.match(text, /don't show ads/);
  assert.match(text, /profiles/);
  assert.match(text, /across other sites/);
  assert.doesNotMatch(text, /analytics/i);
});

test("the pages carry the project name and no placeholder survives", () => {
  for (const page of ["ethics", "privacy"]) {
    const text = read(`docs/public/${page}.md`);
    assert.match(text, /sample-project|Sample Project/i);
    assert.doesNotMatch(text, /(?<!\$)\{\{/);
  }
});

test("the check passes on matching copies", () => {
  assert.deepEqual(check(copies()), { ok: true, problems: [] });
});

test("the check passes when spacing and wrapping differ", () => {
  const published = copies();
  published["site/ethics.md"] = `---\ntitle: Ethics\n---\n<div>\n${read("docs/public/ethics.md").replace(/\. /g, ".\n  ")}\n</div>`;
  assert.equal(check(published).ok, true);
});

test("the check names the file and section when a shared section was edited", () => {
  const published = copies();
  published["site/ethics.md"] = published["site/ethics.md"].replace("It wouldn't exist otherwise.", "It would exist anyway.");
  const { ok, problems } = check(published);
  assert.equal(ok, false);
  assert.deepEqual(problems.map(({ file, section }) => [file, section]), [["site/ethics.md", "building-with-ai"]]);
});

test("the check names the section when a shared section is missing", () => {
  const published = copies();
  published["site/privacy.md"] = published["site/privacy.md"].replace(/<!-- shared:rights -->[\s\S]*<!-- \/shared:rights -->/, "");
  const { ok, problems } = check(published);
  assert.equal(ok, false);
  assert.deepEqual(problems.map(({ file, section }) => [file, section]), [["site/privacy.md", "rights"]]);
});

test("the check fails when a published page doesn't exist", () => {
  const { ok, problems } = check({ "site/ethics.md": copies()["site/ethics.md"] });
  assert.equal(ok, false);
  assert.deepEqual(problems.map(({ file, section }) => [file, section]), [["site/privacy.md", null]]);
});

test("the check ignores edits to slots", () => {
  const published = copies();
  published["site/ethics.md"] = published["site/ethics.md"].replace(/<!-- slot:why-free -->[\s\S]*<!-- \/slot:why-free -->/, "Why? Because everyone should be able to use it.");
  published["site/privacy.md"] = published["site/privacy.md"].replace(/<!-- slot:website -->[\s\S]*<!-- \/slot:website -->/, "We count visits without cookies.");
  assert.equal(check(published).ok, true);
});

test("a page with no published path is skipped", () => {
  assert.equal(check({}, { pages: { "docs/public/ethics.md": null, "docs/public/privacy.md": null } }).ok, true);
});

test("core ships the script, its config, the workflow and the runbook", () => {
  assert.deepEqual(JSON.parse(read(".github/public-pages.json")), { pages: { "docs/public/ethics.md": null, "docs/public/privacy.md": null } });
  assert.match(read(".github/workflows/check-public-pages.yml"), /run: node \.github\/scripts\/check-public-pages\.mjs/);
  assert.match(read("CLAUDE.md"), /^- Publish the ethics and privacy pages .*\[public pages\]\(docs\/runbooks\/public-pages\.md\)\.$/m);
  assert.match(read("docs/runbooks/public-pages.md"), /## Adopting the shared pages in an existing project/);
});

test("the script exits non-zero and annotates the file and section", () => {
  const work = renderReal([]);
  mkdirSync(join(work, "site"));
  for (const page of ["ethics", "privacy"]) writeFileSync(join(work, `site/${page}.md`), readFileSync(join(work, `docs/public/${page}.md`), "utf8"));
  writeFileSync(join(work, ".github/public-pages.json"), JSON.stringify({ pages: { "docs/public/ethics.md": "site/ethics.md", "docs/public/privacy.md": "site/privacy.md" } }));
  const script = fileURLToPath(new URL("../skills/bootstrap/modules/core/templates/github/scripts/check-public-pages.mjs", import.meta.url));
  assert.match(execFileSync("node", [script], { cwd: work, encoding: "utf8" }), /matches its base copy/);
  writeFileSync(join(work, "site/ethics.md"), readFileSync(join(work, "site/ethics.md"), "utf8").replace("Thanks for reading", "Cheers for reading"));
  const result = spawnSync("node", [script], { cwd: work, encoding: "utf8" });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /::error file=site\/ethics\.md::Shared section "closing"/);
});
