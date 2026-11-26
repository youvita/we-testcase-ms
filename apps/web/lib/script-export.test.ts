import { describe, expect, it } from "vitest";

import { projectFiles, singleSpecFile, type ExportCase } from "./script-export";

const webCase: ExportCase = {
  tcId: "TC-CUSTOMER-02",
  title: "Create a customer",
  platform: "WEB",
  moduleName: "Customers",
  subModule: null,
  code: 'await page.goto("/customers");\nawait capture("Customer found");',
};

describe("exported scripts that call capture", () => {
  it("get capture from the fixtures in a project", () => {
    const files = projectFiles("WeBill365", [webCase], null);
    const spec = files["tests/Customers/TC-CUSTOMER-02.spec.ts"]!;

    expect(files["tests/fixtures.ts"]).toContain("export const captureWith");
    expect(spec).toContain("import { test, expect, vars, env, captureWith } from");
    expect(spec).toContain("const capture = captureWith(page);");
  });

  it("get it in a single file too", () => {
    const file = singleSpecFile(webCase, null);

    expect(file).toContain("export const captureWith");
    expect(file).toContain("const capture = captureWith(page);");
  });

  it("do nothing in an API test, which has no page", () => {
    const file = singleSpecFile({ ...webCase, platform: "API", code: 'await capture("Token issued");' }, null);

    expect(file).toContain("const capture = async (_label: string) => {};");
    expect(file).not.toContain("captureWith(page)");
  });

  it("leave scripts that do not call it as they were", () => {
    const spec = projectFiles("WeBill365", [{ ...webCase, code: 'await page.goto("/");' }], null)[
      "tests/Customers/TC-CUSTOMER-02.spec.ts"
    ]!;

    expect(spec).toContain("import { test, expect, vars, env } from");
    expect(spec).not.toContain("const capture");
  });
});

describe("exported Admin-site scripts", () => {
  it("open their pages on ADMIN_BASE_URL", () => {
    const files = projectFiles("WeBill365", [{ ...webCase, site: "ADMIN" }], null);
    const spec = files["tests/Customers/TC-CUSTOMER-02.spec.ts"]!;

    expect(spec).toMatch(/^test\.use\(\{ site: "admin" \}\);$/m);
    expect(files["tests/fixtures.ts"]).toContain("process.env.ADMIN_BASE_URL");
    expect(files[".env.example"]).toContain("ADMIN_BASE_URL=");
  });

  it("leave Web-site scripts on WEB_BASE_URL", () => {
    expect(singleSpecFile(webCase, null)).not.toMatch(/^test\.use\(/m);
  });
});
