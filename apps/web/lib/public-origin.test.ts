import { afterEach, describe, expect, it, vi } from "vitest";

import { appUrl } from "./telegram";
import { publicUrlOrNull, rememberPublicOrigin, rememberedPublicOrigin } from "./public-origin";

const headers = (values: Record<string, string>) => new Headers(values);

describe("the app's public address", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("is remembered from a request through the tunnel, not from internal calls", () => {
    rememberPublicOrigin(headers({ host: "handbags-tournaments-victoria-solid.trycloudflare.com", "x-forwarded-proto": "https" }));
    for (const host of ["app:3000", "localhost:3000", "127.0.0.1:3000", "[::1]:3000"]) rememberPublicOrigin(headers({ host }));
    expect(rememberedPublicOrigin()).toBe("https://handbags-tournaments-victoria-solid.trycloudflare.com");
  });

  it("links under the base path when only the remembered address is known", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "");
    vi.stubEnv("BETTER_AUTH_URL", "http://127.0.0.1:3000");
    vi.stubEnv("NEXT_PUBLIC_BASE_PATH", "/cases");
    rememberPublicOrigin(headers({ "x-forwarded-host": "abc-def.trycloudflare.com", host: "app:3000" }));
    expect(appUrl("/projects/p1/requirements")).toBe("https://abc-def.trycloudflare.com/cases/projects/p1/requirements");
  });

  it("prefers a fixed public address when one is set", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://qa.example.test/cases");
    expect(appUrl("/projects/p1")).toBe("https://qa.example.test/cases/projects/p1");
    expect(publicUrlOrNull("http://localhost:3000")).toBeNull();
  });
});
