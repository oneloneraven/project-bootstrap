import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const SECTION = /<!--\s*shared:([a-z0-9-]+)\s*-->([\s\S]*?)<!--\s*\/shared:\1\s*-->/g;

const squash = text => text.replace(/\s+/g, " ").trim();

export const BASE_PAGES = { "docs/public/ethics.md": null, "docs/public/privacy.md": null };
const CONFIG = ".github/public-pages.json";

export function sharedSections(text) {
  return new Map([...text.matchAll(SECTION)].map(([, name, body]) => [name, squash(body)]));
}

export function checkPublicPages({ pages }, read) {
  const problems = [];
  for (const [base, published] of Object.entries(pages)) {
    if (!published) continue;
    const baseText = read(base);
    if (baseText === undefined) {
      problems.push({ file: base, section: null, reason: "the base copy doesn't exist" });
      continue;
    }
    const expected = sharedSections(baseText);
    const publishedText = read(published);
    if (publishedText === undefined) {
      problems.push({ file: published, section: null, reason: "the published page doesn't exist" });
      continue;
    }
    const actual = sharedSections(publishedText);
    const names = [...publishedText.matchAll(SECTION)].map(([, name]) => name);
    for (const name of new Set(names.filter((name, index) => names.indexOf(name) !== index))) {
      problems.push({ file: published, section: name, reason: "the shared section appears more than once" });
    }
    for (const name of actual.keys()) {
      if (!expected.has(name))
        problems.push({ file: published, section: name, reason: `the shared section isn't in ${base} any more` });
    }
    for (const [name, body] of expected) {
      if (!actual.has(name)) problems.push({ file: published, section: name, reason: "the shared section is missing" });
      else if (actual.get(name) !== body)
        problems.push({ file: published, section: name, reason: `the shared section differs from ${base}` });
    }
  }
  return { ok: problems.length === 0, problems };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const pages = existsSync(CONFIG) ? JSON.parse(readFileSync(CONFIG, "utf8")).pages : {};
  const config = { pages: { ...BASE_PAGES, ...pages } };
  const read = path => (existsSync(path) ? readFileSync(path, "utf8") : undefined);
  const { ok, problems } = checkPublicPages(config, read);
  for (const [base, published] of Object.entries(config.pages)) {
    if (!published) console.log(`${base} isn't published yet: set its path in ${CONFIG} once it is.`);
  }
  if (!ok) {
    for (const { file, section, reason } of problems) {
      console.log(
        `::error file=${file}::${section ? `Shared section "${section}": ` : ""}${reason}. Update it from the base (the public pages runbook, in the vault).`,
      );
    }
    process.exit(1);
  }
  console.log("Every shared section in the published pages matches its base copy.");
}
