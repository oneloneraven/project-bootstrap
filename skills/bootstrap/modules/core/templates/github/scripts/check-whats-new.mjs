import { fileURLToPath } from "node:url";
import { hasWhatsNewHeading, placeholdersIn, whatsNewFromPrBody } from "./whats-new.mjs";

export function checkWhatsNew({ body, labels = [] }) {
  if (!labels.some(({ name }) => /^release: (major|minor|patch)$/.test(name))) {
    return { ok: true, message: "No release, so no What's new needed." };
  }
  if (!hasWhatsNewHeading(body ?? "")) {
    return {
      ok: false,
      message:
        "This PR makes a release, so its description needs a \"## What's new\" heading: one plain sentence per change a user would notice. Leave it empty only if they won't notice anything. See docs/definition-of-done.md.",
    };
  }
  const [placeholder] = placeholdersIn(whatsNewFromPrBody(body ?? ""));
  if (placeholder) {
    return {
      ok: false,
      message: `Leave "What's new" empty when users won't notice anything; "${placeholder}" would be published as a change.`,
    };
  }
  return { ok: true, message: "What's new heading present." };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { ok, message } = checkWhatsNew(JSON.parse(process.env.PR_JSON ?? "{}"));
  console.log(ok ? message : `::error::${message}`);
  process.exit(ok ? 0 : 1);
}
