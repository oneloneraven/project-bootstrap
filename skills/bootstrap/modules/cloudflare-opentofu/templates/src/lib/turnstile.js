const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const TIMEOUT_MS = 5000;

/**
 * Fails closed: a missing token, secret or sitekey, an outage and any answer but success all refuse.
 * @param {string | null | undefined} token
 * @param {string | null | undefined} ip
 * @param {{ TURNSTILE_SECRET_KEY?: string, TURNSTILE_SITEKEY?: string }} env
 * @returns {Promise<boolean>}
 */
export async function verifyTurnstile(token, ip, env) {
  if (!token || !env.TURNSTILE_SECRET_KEY || !env.TURNSTILE_SITEKEY) return false;
  try {
    const response = await fetch(SITEVERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret: env.TURNSTILE_SECRET_KEY, response: token, remoteip: ip ?? undefined }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) return false;
    const result = /** @type {{ success?: unknown }} */ (await response.json());
    return result.success === true;
  } catch {
    return false;
  }
}
