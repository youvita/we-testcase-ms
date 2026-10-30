import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { MONACO_VERSION, PLAYWRIGHT_VERSION, scriptGlobals } from "./script-types";

const root = path.resolve(__dirname, "../../../..");
const readJson = (file: string) => JSON.parse(readFileSync(path.join(root, file), "utf8"));

describe("versions", () => {
  it("loads the Playwright types the runner actually runs", () => {
    const runner = readJson("apps/runner/package.json");
    expect(runner.dependencies["@playwright/test"]).toBe(PLAYWRIGHT_VERSION);
  });

  it("loads the editor its types were installed from", () => {
    expect(readJson("node_modules/monaco-editor/package.json").version).toBe(MONACO_VERSION);
  });
});

describe("scriptGlobals", () => {
  it("gives Web scripts a browser and API scripts only request", () => {
    const web = scriptGlobals("WEB", []);
    const api = scriptGlobals("API", []);
    for (const name of ["page", "context", "browser", "request", "expect", "env", "vars"]) {
      expect(web).toContain(`declare const ${name}:`);
    }
    expect(api).toContain("declare const request:");
    expect(api).not.toContain("declare const page:");
  });

  it("lists the environment's variables on vars, once each", () => {
    const globals = scriptGlobals("WEB", [
      { key: "USER_EMAIL", secret: false },
      { key: "USER_PASSWORD", secret: true },
      { key: "USER_EMAIL", secret: false },
    ]);
    expect(globals.match(/readonly USER_EMAIL: string/g)).toHaveLength(1);
    expect(globals).toMatch(/Secret[^\n]*\n\s+readonly USER_PASSWORD: string/);
  });

  it("skips names that are not identifiers, which would break the declarations", () => {
    const globals = scriptGlobals("API", [{ key: "api-key", secret: false }]);
    expect(globals).not.toContain("api-key");
  });
});
