import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ACCOUNT_SCOPE, buildPolicies, cfClient, resolvePermissions } from "./cloudflare.mjs";

const STUB_MODULE = 'export default { fetch() { return new Response("Not found", { status: 404 }); } };\n';
const STUB_COMPATIBILITY_DATE = "2026-10-01";
const HELPER_LIFETIME_MS = 60 * 60 * 1000;

function wranglerConfig(dir) {
  try {
    return JSON.parse(readFileSync(join(dir, "wrangler.jsonc"), "utf8").replace(/^\s*\/\/.*$/gm, ""));
  } catch {
    return {};
  }
}

export function scriptNames(ctx, envs) {
  const config = wranglerConfig(ctx.dir);
  const base = config.name ?? ctx.slug;
  return Object.fromEntries(envs.map(env => [env, config.env?.[env]?.name ?? `${base}-${env}`]));
}

function stubForm() {
  const form = new FormData();
  form.set("metadata", JSON.stringify({ main_module: "worker.js", compatibility_date: STUB_COMPATIBILITY_DATE }));
  form.set("worker.js", new Blob([STUB_MODULE], { type: "application/javascript+module" }), "worker.js");
  return form;
}

async function listTags(client, accountId) {
  const scripts = await client.get(`/accounts/${accountId}/workers/scripts`);
  return Object.fromEntries(scripts.map(script => [script.id, script.tag]));
}

export async function ensureWorkers(bootstrapClient, deps, accountId, names) {
  const [admin] = await resolvePermissions(bootstrapClient, accountId, ["Workers Admin"], [ACCOUNT_SCOPE]);
  const expires = new Date(deps.now().getTime() + HELPER_LIFETIME_MS).toISOString().replace(/\.\d{3}Z$/, "Z");
  const helper = await bootstrapClient.post(`/accounts/${accountId}/tokens`, {
    name: "Workers helper",
    policies: buildPolicies([admin], { accountId }),
    expires_on: expires,
  });
  try {
    const client = cfClient(deps, helper.value);
    let tags = await listTags(client, accountId);
    const missing = names.filter(name => !tags[name]);
    for (const name of names.filter(name => tags[name])) deps.log(`Worker ${name} already exists: leaving it as it is.`);
    for (const name of missing) {
      await client.putForm(`/accounts/${accountId}/workers/scripts/${name}`, stubForm());
      deps.log(`Created the stub Worker ${name}: the first deploy replaces it.`);
    }
    if (missing.length) tags = await listTags(client, accountId);
    const absent = names.filter(name => !tags[name]);
    if (absent.length) throw new Error(`Cloudflare doesn't list the Worker ${absent.join(", ")} after creating it`);
    return Object.fromEntries(names.map(name => [name, tags[name]]));
  } finally {
    try {
      await bootstrapClient.del(`/accounts/${accountId}/tokens/${helper.id}`);
    } catch (error) {
      deps.log(`Couldn't delete the Workers helper token (${error.message}): revoke it in the dashboard.`);
    }
  }
}
