import { createHash } from "node:crypto";

export const API = "https://api.cloudflare.com/client/v4";
export const ACCOUNT_SCOPE = "com.cloudflare.api.account";
export const ZONE_SCOPE = "com.cloudflare.api.account.zone";
export const R2_BUCKET_SCOPE = "com.cloudflare.edge.r2.bucket";
export const WORKER_SCOPE = "com.cloudflare.edge.worker.script";

export function cfClient(deps, token) {
  async function request(method, path, body, { form } = {}) {
    const response = await deps.fetch(`${API}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(!form && { "Content-Type": "application/json" }) },
      ...(body !== undefined && { body: form ? body : JSON.stringify(body) }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.success === false) {
      const messages = (payload.errors ?? []).map(error => error.message).join("; ") || "no error message";
      throw new Error(`Cloudflare ${method} ${path} failed (HTTP ${response.status}): ${messages}`);
    }
    return payload.result;
  }
  return {
    get: path => request("GET", path),
    post: (path, body) => request("POST", path, body),
    putForm: (path, form) => request("PUT", path, form, { form: true }),
    del: path => request("DELETE", path),
  };
}

export async function withBootstrapToken(deps, accountId, fn) {
  const token = (await deps.prompt("Paste the bootstrap token (the long value from the Copy button, not the token ID): ", { hidden: true })).trim();
  if (!token) throw new Error("No bootstrap token pasted");
  if (isHexId(token.toLowerCase())) throw new Error("That looks like a token ID, not the token: paste the long value from the Copy button");
  const client = cfClient(deps, token);
  const self = await client.get(`/accounts/${accountId}/tokens/verify`).catch(error => {
    throw new Error(`${error.message}: the bootstrap token didn't verify. If it exists, revoke it in the dashboard.`);
  });
  try {
    return await fn(client);
  } finally {
    try {
      await client.del(`/accounts/${accountId}/tokens/${self.id}`);
      deps.log("The bootstrap token is deleted.");
    } catch (error) {
      deps.log(`Couldn't delete the bootstrap token (${error.message}): revoke it in the dashboard.`);
    }
  }
}

export async function resolvePermissions(client, accountId, names, scopes = [ZONE_SCOPE, ACCOUNT_SCOPE, WORKER_SCOPE]) {
  const groups = await client.get(`/accounts/${accountId}/tokens/permission_groups`);
  return names.map(name => {
    const matches = groups.filter(group => group.name === name && scopes.some(scope => group.scopes.includes(scope)));
    if (matches.length !== 1) throw new Error(`Permission "${name}" matched ${matches.length} permission groups in the allowed scopes; expected 1`);
    return { id: matches[0].id, scope: scopes.find(scope => matches[0].scopes.includes(scope)) };
  });
}

export function buildPolicies(groups, { accountId, zoneId, scriptTags }) {
  const account = `${ACCOUNT_SCOPE}.${accountId}`;
  const workerGroups = groups.filter(group => group.scope === WORKER_SCOPE).map(group => ({ id: group.id }));
  if (workerGroups.length && !scriptTags?.length) throw new Error("A Worker permission needs at least one Worker tag");
  const policies = [
    { scope: ACCOUNT_SCOPE, resource: account },
    { scope: ZONE_SCOPE, resource: `${ZONE_SCOPE}.${zoneId}` },
  ]
    .map(({ scope, resource }) => ({ resource, ids: groups.filter(group => group.scope === scope).map(group => ({ id: group.id })) }))
    .filter(({ ids }) => ids.length)
    .map(({ resource, ids }) => ({ effect: "allow", resources: { [resource]: "*" }, permission_groups: ids }));
  if (workerGroups.length) {
    policies.push({
      effect: "allow",
      resources: { [account]: Object.fromEntries(scriptTags.map(tag => [scriptResource(tag), "*"])) },
      permission_groups: workerGroups,
    });
  }
  return policies;
}

function sortKeys(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  return Object.fromEntries(Object.entries(value).sort(([a], [b]) => (a < b ? -1 : 1)).map(([key, item]) => [key, sortKeys(item)]));
}

function summarise(policies) {
  return policies
    .map(policy => JSON.stringify([sortKeys(policy.resources), policy.permission_groups.map(group => group.id).sort(), policy.effect ?? "allow"]))
    .sort();
}

export function policiesMatch(requested, actual) {
  return JSON.stringify(summarise(requested)) === JSON.stringify(summarise(actual ?? []));
}

export function scriptResource(tag) {
  return `${WORKER_SCOPE}.${tag}`;
}

export function bucketResource(accountId, bucket) {
  return `${R2_BUCKET_SCOPE}.${accountId}_default_${bucket}`;
}

export function s3Credentials({ id, value }) {
  return { accessKeyId: id, secretAccessKey: createHash("sha256").update(value).digest("hex") };
}

export function oneYearFrom(now) {
  const expiry = new Date(now);
  expiry.setUTCFullYear(expiry.getUTCFullYear() + 1);
  return expiry.toISOString().replace(/\.\d{3}Z$/, "Z");
}

export const HEX_ID = /^[0-9a-f]{32}$/;

export const isHexId = value => HEX_ID.test(value);

export async function askId(deps, question) {
  const id = (await deps.prompt(question)).trim();
  if (!HEX_ID.test(id)) throw new Error(`${question.replace(/ \(.*$/, "")} must be 32 hexadecimal characters`);
  return id;
}

export async function findEarlierItems(deps, vault, titles, rotate) {
  const previous = {};
  for (const title of titles) {
    previous[title] = await vault.find(title);
    if (previous[title] && !rotate) {
      throw new Error(`An earlier run left ${title} in Pass but didn't finish setting the secrets: re-run with --rotate to replace it`);
    }
    if (!previous[title] && rotate) deps.log(`No earlier ${title} in Pass: creating one`);
  }
  return previous;
}

async function revoke(client, deps, accountId, id) {
  await client.del(`/accounts/${accountId}/tokens/${id}`).catch(() => deps.log(`Couldn't delete token ${id}: revoke it in the dashboard.`));
}

export async function createVerified(client, deps, accountId, specs) {
  const made = [];
  try {
    for (const { label, name, policies } of specs) {
      const token = await client.post(`/accounts/${accountId}/tokens`, { name, policies, expires_on: oneYearFrom(deps.now()) });
      made.push({ id: token.id, value: token.value });
      const actual = await client.get(`/accounts/${accountId}/tokens/${token.id}`);
      if (!policiesMatch(policies, actual.policies)) {
        throw new Error(`The ${label} token's policies did not match what was requested: nothing was stored`);
      }
    }
  } catch (error) {
    for (const { id } of made) await revoke(client, deps, accountId, id);
    throw error;
  }
  return made;
}

export async function storeEach(client, deps, accountId, made, store, olds = []) {
  const oldMap = list => Object.fromEntries(list.filter(Boolean).map(({ name, id }) => [name, id]));
  let current = 0;
  try {
    for (const [index, token] of made.entries()) {
      current = index;
      await store(token, index);
    }
  } catch (error) {
    for (const { id } of made.slice(error.stored ? current + 1 : current)) await revoke(client, deps, accountId, id);
    await revokeOld(client, deps, accountId, oldMap(olds.slice(0, current)));
    throw error;
  }
  await revokeOld(client, deps, accountId, oldMap(olds));
}

export async function revokeOld(client, deps, accountId, oldIds) {
  for (const [name, id] of Object.entries(oldIds)) {
    try {
      await client.del(`/accounts/${accountId}/tokens/${id}`);
      deps.log(`Revoked the old ${name} token.`);
    } catch (error) {
      deps.log(`Couldn't revoke the old ${name} token (${error.message}): revoke it in the dashboard.`);
    }
  }
}

export async function readOldIds(vault, previous) {
  const olds = [];
  for (const [name, itemId] of Object.entries(previous)) {
    olds.push(itemId ? { name, id: await vault.field(itemId, "token id") } : undefined);
  }
  return olds;
}
