import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pluginRoot, pluginVersion } from "../plugin-version.mjs";
import { loadState } from "../state.mjs";

export function readRenderedJson(ctx, relativePath, module) {
  const file = join(ctx.dir, relativePath);
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    const { pluginVersion: recorded, modules } = loadState(ctx.dir);
    const selected = [...new Set([...modules, "core", module])].join(",");
    const rendering = recorded ? `plugin ${recorded}` : "an older plugin";
    const command = `node ${join(pluginRoot, "skills", "bootstrap", "scripts", "render.mjs")} --modules ${selected} --answers ${join(ctx.dir, ".bootstrap", "answers.json")} --dest ${ctx.dir} --bootstrap-only`;
    throw new Error(`Can't read ${file}: this project's .bootstrap/ was rendered by ${rendering} and the current plugin is ${pluginVersion()}. Run \`${command}\` to write the missing files.`);
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`Can't parse ${file}: ${error.message}`);
  }
}

export function loadContext(dir) {
  const { answers, ids } = loadState(dir);
  const missing = ["owner", "slug", "name"].filter(key => !answers?.[key]);
  if (missing.length) {
    throw new Error(`No bootstrap answers for ${missing.join(", ")} in ${dir}/.bootstrap/state.json: run this against a bootstrapped project directory`);
  }
  const { owner, slug, name, zone_name: zoneName } = answers;
  return {
    dir,
    owner,
    slug,
    name,
    repo: `${owner}/${slug}`,
    ...(zoneName && { zoneName }),
    skippedEnvs: (ids.skipped_envs ?? "").split(",").map(env => env.trim()).filter(Boolean),
    answers,
  };
}

export function resolveEnv(ctx, env) {
  return env && !ctx.skippedEnvs.includes(env) ? env : null;
}
