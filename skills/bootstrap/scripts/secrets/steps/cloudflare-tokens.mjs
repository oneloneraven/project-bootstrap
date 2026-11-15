import { WORKER_SCOPE, ZONE_SCOPE, buildPolicies, createVerified, findEarlierItems, oneYearFrom, readOldIds, resolvePermissions, storeEach, withBootstrapToken } from "../cloudflare.mjs";
import { resolveAccountId, resolveZoneId } from "../ids.mjs";
import { readRenderedJson } from "../context.mjs";
import { storeThenSet } from "../order.mjs";
import { ensureWorkers, scriptNames } from "../workers.mjs";

const title = token => `Cloudflare ${token} token`;

const STACK_MODULES = ["cloudflare-opentofu", "cloudflare-identity"];
const stackModule = ctx => STACK_MODULES.find(name => ctx.modules.includes(name)) ?? STACK_MODULES[0];
const readTokens = ctx => readRenderedJson(ctx, ".bootstrap/cloudflare/tokens.json", stackModule(ctx));
const COUNT_WORDS = { 2: "two", 3: "three", 4: "four", 5: "five" };

const secretsFor = (entry, value) => (entry.env ?? [undefined]).map(env => ({ name: entry.secret, ...(env && { env }), value }));

async function run(ctx, deps, options) {
  const { vault, rotate } = options;
  const tokens = readTokens(ctx);
  const previous = await findEarlierItems(deps, vault, tokens.map(entry => title(entry.token)), rotate);
  const accountId = await resolveAccountId(ctx, deps, options);
  const zoneId = tokens.some(entry => entry.zone) ? await resolveZoneId(ctx, deps, options) : undefined;
  const expires = oneYearFrom(deps.now());
  const envs = [...new Set(tokens.flatMap(entry => entry.workers ?? []))];
  const names = scriptNames(ctx, envs);

  await withBootstrapToken(deps, accountId, async client => {
    const olds = (await readOldIds(vault, previous)).map((old, index) => old && { ...old, name: tokens[index].token });
    const tags = envs.length ? await ensureWorkers(client, deps, accountId, [...new Set(Object.values(names))]) : {};
    const tagByEnv = Object.fromEntries(envs.map(env => [env, tags[names[env]]]));
    const specs = [];
    for (const entry of tokens) {
      const groups = await resolvePermissions(client, accountId, entry.permissions);
      if (!entry.zone && groups.some(group => group.scope === ZONE_SCOPE)) throw new Error(`The ${entry.token} token has zone permissions, so its definition needs "zone": true`);
      const hasRole = groups.some(group => group.scope === WORKER_SCOPE);
      if (hasRole && !entry.workers?.length) throw new Error(`The ${entry.token} token has a Workers role, so its definition needs "workers"`);
      if (!hasRole && entry.workers?.length) throw new Error(`The ${entry.token} token lists workers, so it needs an Individual Workers role`);
      const scriptTags = (entry.workers ?? []).map(env => tagByEnv[env]);
      specs.push({ label: entry.token, name: `${ctx.slug} ${entry.token}`, policies: buildPolicies(groups, { accountId, zoneId, scriptTags }) });
    }
    const made = await createVerified(client, deps, accountId, specs);
    await storeEach(client, deps, accountId, made, (token, index) => {
      const entry = tokens[index];
      return storeThenSet(deps, vault, ctx, {
        title: title(entry.token),
        fields: [
          { name: "token", value: token.value, hidden: true },
          { name: "token id", value: token.id, hidden: false },
          { name: "expires", value: expires, hidden: false },
        ],
        note: `The Cloudflare ${entry.token} API token for ${ctx.repo}, set as the GitHub secret ${entry.secret}${entry.env ? ` in ${entry.env.join(" and ")}` : ""}.`,
        secrets: secretsFor(entry, token.value),
        variables: index === 0 ? [{ name: "CLOUDFLARE_ACCOUNT_ID", value: accountId }] : [],
        rotate,
      });
    }, olds);
  });
  deps.log(`The ${COUNT_WORDS[tokens.length] ?? tokens.length} Cloudflare tokens are stored in Pass and set in GitHub.`);
}

export default {
  name: "cloudflare-tokens",
  secrets: ctx => readTokens(ctx).flatMap(entry => (entry.env ?? [undefined]).map(env => ({ name: entry.secret, ...(env && { env }) }))),
  run,
};
