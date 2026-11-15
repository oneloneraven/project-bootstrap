import { expect, test } from "vitest";
import worker from "../src/worker.js";

const env = { APP_ENV: "test", RELEASE_VERSION: "v1.2.3", ASSETS: { fetch: async () => new Response("asset") } };
const admin = { ...env, APP_ENV: "e2e", ADMIN_ACCESS_CHECK: "off", ADMIN_HOST: "admin.example.test" };

test("health reports the environment and release", async () => {
  const response = await worker.fetch(new Request("https://example.test/api/health"), env);
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(await response.json()).toEqual({ ok: true, environment: "test", version: "v1.2.3" });
});

test("everything else is served from static assets", async () => {
  const response = await worker.fetch(new Request("https://example.test/"), env);
  expect(await response.text()).toBe("asset");
});

test("the admin host answers 404 to anyone the owner check refuses", async () => {
  const refused = { ...admin, APP_ENV: "production", ACCESS_TEAM_DOMAIN: "", ACCESS_AUD: "" };
  const response = await worker.fetch(new Request("https://admin.example.test/"), refused);
  expect(response.status).toBe(404);
  expect(response.headers.get("Cache-Control")).toBe("no-store");
});

test("the admin host answers a request the owner check accepts", async () => {
  const response = await worker.fetch(new Request("https://admin.example.test/"), admin);
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ ok: true, admin: true });
});

test("without an admin host configured, no request is treated as admin", async () => {
  const response = await worker.fetch(new Request("https://admin.example.test/"), {
    ...env,
    ADMIN_ACCESS_CHECK: "off",
  });
  expect(await response.text()).toBe("asset");
});
