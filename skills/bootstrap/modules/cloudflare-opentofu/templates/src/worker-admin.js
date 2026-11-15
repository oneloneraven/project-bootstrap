import { adminIdentity } from "./lib/access.js";

export default {
  /**
   * @param {Request} request
   * @param {{ ASSETS: { fetch: (request: Request) => Promise<Response> }, APP_ENV: string, RELEASE_VERSION?: string, ADMIN_HOST?: string, ADMIN_ACCESS_CHECK?: string, ACCESS_TEAM_DOMAIN?: string, ACCESS_AUD?: string, OWNER_EMAIL?: string }} env
   * @returns {Promise<Response>}
   */
  async fetch(request, env) {
    const { hostname, pathname } = new URL(request.url);
    if (pathname === "/api/health") {
      return Response.json(
        { ok: true, environment: env.APP_ENV, version: env.RELEASE_VERSION ?? "unreleased" },
        { headers: { "Cache-Control": "no-store" } },
      );
    }
    if (env.ADMIN_HOST && hostname === env.ADMIN_HOST) {
      const identity = await adminIdentity(request, env);
      if (!identity) return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
      return Response.json({ ok: true, admin: true }, { headers: { "Cache-Control": "no-store" } });
    }
    return env.ASSETS.fetch(request);
  },
};
