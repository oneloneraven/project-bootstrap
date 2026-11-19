import { afterEach, describe, expect, it, vi } from "vitest";
import { verifyTurnstile } from "../../src/lib/turnstile.js";

const ENV = { TURNSTILE_SECRET_KEY: "test-secret-value", TURNSTILE_SITEKEY: "sitekey", APP_ENV: "production", RELEASE_VERSION: "v1.2.3" };
const TOKEN = "test-token-value";
const IP = "203.0.113.9";
const EVENT = { event: "turnstile.unavailable", environment: "production", release: "v1.2.3" };

function spyOnConsole() {
  return {
    warn: vi.spyOn(console, "warn").mockImplementation(() => {}),
    others: [
      vi.spyOn(console, "log").mockImplementation(() => {}),
      vi.spyOn(console, "error").mockImplementation(() => {}),
      vi.spyOn(console, "info").mockImplementation(() => {}),
    ],
  };
}

/** @param {() => Promise<Response>} respond */
function stubFetch(respond) {
  const stub = vi.fn(respond);
  vi.stubGlobal("fetch", stub);
  return stub;
}

describe("verifyTurnstile", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("accepts a token Cloudflare confirms, posting the secret, token and address as JSON", async () => {
    const stub = stubFetch(async () => Response.json({ success: true }));
    expect(await verifyTurnstile("token", "203.0.113.9", ENV)).toBe(true);
    const [url, init] = stub.mock.calls[0];
    expect(url).toBe("https://challenges.cloudflare.com/turnstile/v0/siteverify");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({ secret: ENV.TURNSTILE_SECRET_KEY, response: "token", remoteip: "203.0.113.9" });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("gives the request a five second timeout", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout");
    stubFetch(async () => Response.json({ success: true }));
    await verifyTurnstile("token", "203.0.113.9", ENV);
    expect(timeout).toHaveBeenCalledWith(5000);
  });

  it("refuses a missing token without calling Cloudflare", async () => {
    const stub = stubFetch(async () => Response.json({ success: true }));
    expect(await verifyTurnstile("", "203.0.113.9", ENV)).toBe(false);
    expect(await verifyTurnstile(null, "203.0.113.9", ENV)).toBe(false);
    expect(await verifyTurnstile(undefined, "203.0.113.9", ENV)).toBe(false);
    expect(stub).not.toHaveBeenCalled();
  });

  it("refuses a missing secret or sitekey without calling Cloudflare", async () => {
    const stub = stubFetch(async () => Response.json({ success: true }));
    expect(await verifyTurnstile("token", "203.0.113.9", {})).toBe(false);
    expect(await verifyTurnstile("token", "203.0.113.9", { ...ENV, TURNSTILE_SECRET_KEY: "" })).toBe(false);
    expect(await verifyTurnstile("token", "203.0.113.9", { ...ENV, TURNSTILE_SITEKEY: "" })).toBe(false);
    expect(await verifyTurnstile("token", "203.0.113.9", { TURNSTILE_SECRET_KEY: "secret" })).toBe(false);
    expect(stub).not.toHaveBeenCalled();
  });

  it("refuses a non-OK response", async () => {
    spyOnConsole();
    stubFetch(async () => Response.json({ success: true }, { status: 503 }));
    expect(await verifyTurnstile("token", "203.0.113.9", ENV)).toBe(false);
  });

  it("refuses when the request fails or times out", async () => {
    spyOnConsole();
    stubFetch(async () => {
      throw new TypeError("network");
    });
    expect(await verifyTurnstile("token", "203.0.113.9", ENV)).toBe(false);
    stubFetch(async () => {
      throw new DOMException("timed out", "TimeoutError");
    });
    expect(await verifyTurnstile("token", "203.0.113.9", ENV)).toBe(false);
  });

  it("refuses a response that is not JSON", async () => {
    spyOnConsole();
    stubFetch(async () => new Response("not json"));
    expect(await verifyTurnstile("token", "203.0.113.9", ENV)).toBe(false);
  });

  it.each([{ success: false }, {}, { success: "true" }, { success: 1 }, { success: null }, null, []])(
    "refuses %j",
    async body => {
      stubFetch(async () => Response.json(body));
      expect(await verifyTurnstile("token", "203.0.113.9", ENV)).toBe(false);
    },
  );

  describe("logging", () => {
    /** @param {ReturnType<typeof spyOnConsole>} spies */
    function warnings(spies) {
      return spies.warn.mock.calls;
    }

    it("logs one warning with the status for a non-OK response", async () => {
      const spies = spyOnConsole();
      stubFetch(async () => Response.json({ success: true }, { status: 503 }));
      expect(await verifyTurnstile(TOKEN, IP, ENV)).toBe(false);
      expect(warnings(spies)).toEqual([[JSON.stringify({ ...EVENT, status: 503 })]]);
    });

    it("logs one warning with the error name for a network error", async () => {
      const spies = spyOnConsole();
      stubFetch(async () => {
        throw new TypeError("network");
      });
      expect(await verifyTurnstile(TOKEN, IP, ENV)).toBe(false);
      expect(warnings(spies)).toEqual([[JSON.stringify({ ...EVENT, errorName: "TypeError" })]]);
    });

    it("logs one warning with the error name for a timeout", async () => {
      const spies = spyOnConsole();
      stubFetch(async () => {
        throw new DOMException("timed out", "TimeoutError");
      });
      expect(await verifyTurnstile(TOKEN, IP, ENV)).toBe(false);
      expect(warnings(spies)).toEqual([[JSON.stringify({ ...EVENT, errorName: "TimeoutError" })]]);
    });

    it("logs one warning for a 200 whose body is not JSON", async () => {
      const spies = spyOnConsole();
      stubFetch(async () => new Response("not json"));
      expect(await verifyTurnstile(TOKEN, IP, ENV)).toBe(false);
      expect(warnings(spies)).toEqual([[JSON.stringify({ ...EVENT, errorName: "SyntaxError" })]]);
    });

    it("logs nothing for a successful challenge", async () => {
      const spies = spyOnConsole();
      stubFetch(async () => Response.json({ success: true }));
      expect(await verifyTurnstile(TOKEN, IP, ENV)).toBe(true);
      expect(spies.warn).not.toHaveBeenCalled();
      for (const spy of spies.others) expect(spy).not.toHaveBeenCalled();
    });

    it("logs nothing for a failed challenge", async () => {
      const spies = spyOnConsole();
      stubFetch(async () => Response.json({ success: false, "error-codes": ["invalid-input-response"] }));
      expect(await verifyTurnstile(TOKEN, IP, ENV)).toBe(false);
      stubFetch(async () => Response.json({ success: "true" }));
      expect(await verifyTurnstile(TOKEN, IP, ENV)).toBe(false);
      expect(spies.warn).not.toHaveBeenCalled();
      for (const spy of spies.others) expect(spy).not.toHaveBeenCalled();
    });

    it("logs nothing for a missing token, secret or sitekey", async () => {
      const spies = spyOnConsole();
      stubFetch(async () => Response.json({ success: true }));
      expect(await verifyTurnstile("", IP, ENV)).toBe(false);
      expect(await verifyTurnstile(TOKEN, IP, {})).toBe(false);
      expect(await verifyTurnstile(TOKEN, IP, { ...ENV, TURNSTILE_SITEKEY: "" })).toBe(false);
      expect(spies.warn).not.toHaveBeenCalled();
      for (const spy of spies.others) expect(spy).not.toHaveBeenCalled();
    });

    it("never logs the secret, the token or the address, whatever the outcome", async () => {
      const spies = spyOnConsole();
      const outcomes = [
        async () => Response.json({ success: true }),
        async () => Response.json({ success: false }),
        async () => Response.json({}, { status: 500 }),
        async () => {
          throw new TypeError(`failed for ${TOKEN} ${IP} ${ENV.TURNSTILE_SECRET_KEY}`);
        },
        async () => {
          throw new DOMException(`${TOKEN} ${IP}`, "TimeoutError");
        },
        async () => new Response(`${TOKEN} ${ENV.TURNSTILE_SECRET_KEY}`),
      ];
      for (const outcome of outcomes) {
        stubFetch(outcome);
        await verifyTurnstile(TOKEN, IP, ENV);
      }
      const logged = [spies.warn, ...spies.others].flatMap(spy => spy.mock.calls.flat().map(String));
      expect(spies.warn).toHaveBeenCalledTimes(4);
      for (const secret of [ENV.TURNSTILE_SECRET_KEY, TOKEN, IP]) {
        for (const line of logged) expect(line).not.toContain(secret);
      }
      for (const spy of spies.others) expect(spy).not.toHaveBeenCalled();
    });
  });
});
