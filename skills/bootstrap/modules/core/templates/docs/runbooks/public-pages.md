# Public ethics and privacy pages

{{name}} publishes an ethics page and a privacy page. Both start from a shared
base, so every product says the same things in the same words wherever the
principles are shared, and only the parts that differ are written per product.

## How the pages are built

The base copies are in `docs/public/`: `ethics.md` and `privacy.md`. They're
source copies for the product's website or in-app help, not pages in their
own right. Don't edit them by hand, or the next render overwrites the change.

Each page has two kinds of part:

- **Shared sections** sit between `<!-- shared:name -->` and
  `<!-- /shared:name -->`. They stay word for word the same in every product.
  The product's name is already filled in. Never edit one in the published
  page. If the wording is wrong, change it in the plugin's template and let
  every product pick it up.
- **Slots** sit between `<!-- slot:name -->` and `<!-- /slot:name -->` and
  start with **SLOT**. They're the product's own words: why it's free, any
  further tool exceptions, additional considerations, what the app keeps,
  what the platform collects, what feedback collects, how to use your rights.
  Replace each one with real content, or delete an optional one. The check
  ignores slots.

The shared wording names no suppliers and no tools, and never says "no
analytics". The privacy page's platform slot is where the product says whether
and how it counts visits. It follows the [privacy rules](../privacy.md), and
the app and feedback slots must match the
[record of processing](../data-protection.md).

## Publishing the pages

1. Copy `docs/public/ethics.md` and `docs/public/privacy.md` into the site's
   own source, in whatever layout it uses (front matter, wrapper elements and
   navigation can go around the content). Keep the shared section markers.
2. Fill in every slot, then delete the slot markers and their **SLOT**
   instructions. The order of sections can change and extra sections can be
   added outside the shared sections.
3. Set the published paths in `.github/public-pages.json`: each key is a base
   copy and its value is the page in the site that carries the shared
   sections, or `null` while it's unpublished.

   ```json
   {
     "pages": {
       "docs/public/ethics.md": "site/ethics/index.md",
       "docs/public/privacy.md": "site/privacy/index.md"
     }
   }
   ```

4. Run `node .github/scripts/check-public-pages.mjs`. CI runs it on every pull
   request and on `main` (the Check public pages workflow).

The check compares each shared section in the published page with the same
section in the base copy, ignoring spacing and line breaks. It fails, naming
the file and the section, when a section differs or is missing. Keep the
shared sections as Markdown between the markers, so the text can match.

## When the shared base changes

A change to the shared wording reaches a product when it re-renders the core
module, which rewrites `docs/public/`. After that:

1. Run `node .github/scripts/check-public-pages.mjs`. It names every shared
   section that no longer matches.
2. Copy each named section from the base copy into the published page, between
   the same markers. Leave the slots alone.
3. Run the check again, and read `git diff docs/public` to see what changed,
   because new sections or slots also need adding to the published page.
4. Raise the change as a normal PR. If a slot needs new content, write it.

## Adopting the shared pages in an existing project

1. Re-render the core module into the project. It adds `docs/public/`, the
   check script, `.github/public-pages.json` and the workflow.
2. Compare the project's current ethics and privacy pages with the base.
   Keep what's true of the product as slot content, and replace the rest with
   the shared sections, wording included. If the product names a supplier or
   describes how it counts visits in the old copy, move that into the matching
   slot rather than dropping it.
3. Add the shared section markers around the shared sections in the published
   pages, then follow "Publishing the pages" from step 3.
4. Check the privacy page against the record of processing: every kind of
   data it lists must be on the page, and the page must list nothing the
   record doesn't.
