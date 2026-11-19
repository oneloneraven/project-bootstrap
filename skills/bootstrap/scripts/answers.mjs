const PYTHON_KEYWORDS = new Set(
  "False None True and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield".split(" "),
);

function pythonPackage(slug) {
  const identifier = slug.replace(/-/g, "_");
  return PYTHON_KEYWORDS.has(identifier) ? `${identifier}_` : identifier;
}

const DEFAULT_LICENSOR = "One Lone Raven (https://github.com/oneloneraven)";

function escapeHtml(text) {
  return text.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

function kotlinString(text) {
  return JSON.stringify(text).replace(/\\.|\$/g, m => ({ $: "\\$", "\\f": "\\u000C" })[m] ?? m);
}

function androidString(text) {
  const escaped = text.replace(/[\\'"]/g, c => `\\${c}`).replace(/^[@?]/, c => `\\${c}`);
  return escaped.replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);
}

export function validateAnswers(input, { maxSlugLength: limit = 63 } = {}) {
  const name = String(input.name ?? "").trim();
  if (!name) throw new Error("Project name is required");
  const full = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!/^[a-z]/.test(full)) throw new Error("Project name must start with a letter");
  if (full.length > limit && limit < 63) {
    throw new Error(
      `Project name gives the slug ${full} (${full.length} characters); the selected modules allow at most ${limit}`,
    );
  }
  const slug = full.slice(0, 63).replace(/-+$/, "");
  const answers = {
    licensor: DEFAULT_LICENSOR,
    ...input,
    name,
    slug,
    private: input.visibility === "private",
    owner_org: input.owner_type === "Organization",
    name_js: JSON.stringify(name),
    name_html: escapeHtml(name),
    greeting_js: JSON.stringify(`Hello from ${name}`),
    description_toml: JSON.stringify(String(input.description ?? "")),
    python_package: pythonPackage(slug),
    name_kotlin: kotlinString(name),
    greeting_kotlin: kotlinString(`Hello from ${name}`),
    name_android: androidString(name),
    ...(typeof input.application_id === "string" && { application_id_path: input.application_id.replace(/\./g, "/") }),
  };
  return { answers, slug };
}
