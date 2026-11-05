import { describe, expect, it } from "vitest";

import { extractDocumentText } from "./document-text";
import { apiSpecSection, isConvertedApiSpec, openApiToMarkdown, parseOpenApi } from "./openapi-markdown";
import { parsePostmanCollection, postmanToMarkdown } from "./postman-markdown";

const bearer = { type: "bearer", bearer: [{ key: "token", value: "{{access_token}}", type: "string" }] };

const COLLECTION = {
  info: {
    _postman_id: "1",
    name: "Shop",
    schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
  },
  auth: bearer,
  variable: [{ key: "access_token", value: "eyJhbGciOiJIUzI1NiJ9.real.token" }],
  item: [
    {
      name: "Auth",
      item: [
        {
          name: "Get token",
          request: {
            auth: { type: "noauth" },
            method: "POST",
            url: { raw: "{{base_url}}/auth/token", host: ["{{base_url}}"], path: ["auth", "token"] },
            body: {
              mode: "raw",
              raw: '{"client_id": "abc123", "client_secret": "s3cr3t", "scope": "{{scope}}"}',
              options: { raw: { language: "json" } },
            },
          },
          event: [
            {
              listen: "test",
              script: {
                exec: [
                  'console.log("debugging", pm.response.text());',
                  'pm.test("Status code is 200", () => pm.response.to.have.status(200));',
                  'pm.collectionVariables.set("access_token", pm.response.json().access_token);',
                ],
              },
            },
          ],
        },
      ],
    },
    {
      name: "Customers",
      item: [
        {
          name: "Create customer",
          request: {
            method: "POST",
            header: [
              { key: "Content-Type", value: "application/json" },
              { key: "X-Api-Key", value: "live-key-123" },
            ],
            url: "{{base_url}}/customers",
            description: "## Create\n\nMakes a customer.\n\n### Fields\n\n```sh\n# not a heading\n```",
            body: { mode: "raw", raw: '{"name": "{{full_name}}", "age": {{age}}, "address": {"city": "PP"}}' },
          },
          event: [
            {
              listen: "test",
              script: {
                exec: [
                  "pm.expect(pm.response.code).to.be.oneOf([200, 201]);",
                  "pm.response.to.be.json;",
                  'pm.environment.set("account_no", pm.response.json().data.account_no);',
                ],
              },
            },
          ],
        },
        {
          name: "Create customer — missing name",
          request: { method: "POST", url: "{{base_url}}/customers", body: { mode: "raw", raw: "{}" } },
        },
        {
          name: "Delete customer",
          request: {
            method: "DELETE",
            url: {
              raw: "{{base_url}}/customers/:account_no?force=true",
              path: ["customers", ":account_no"],
              variable: [{ key: "account_no", value: "{{account_no}}", description: "Customer account" }],
              query: [{ key: "force", value: "true" }, { key: "debug", value: "1", disabled: true }],
            },
          },
        },
      ],
    },
  ],
};

const markdown = postmanToMarkdown(parsePostmanCollection(JSON.stringify(COLLECTION))!);

describe("Postman collections", () => {
  it("writes one section per endpoint, grouped by folder, paths the OpenAPI way", () => {
    expect(isConvertedApiSpec(markdown)).toBe(true);
    expect(markdown).toContain("# Shop — API reference");
    expect(markdown.match(/^### /gm)).toHaveLength(3);
    expect(markdown).toContain("## Customers");
    const remove = apiSpecSection(markdown, "DELETE /customers/{account_no}")!;
    expect(remove).toContain("- account_no (path) — Customer account Example: {{account_no}}");
    expect(remove).toContain("- force (query) Example: true");
    expect(remove).not.toContain("debug");
    expect(remove).toContain("Authentication: bearer token in the Authorization header ({{access_token}})");
  });

  it("puts requests to the same endpoint in one section", () => {
    const create = apiSpecSection(markdown, "POST /customers")!;
    expect(create).toContain("Requests in the collection: Create customer; Create customer — missing name");
    expect(create).toContain("#### 2. Create customer — missing name");
  });

  it("reads bodies with bare {{variables}}, and what the tests check and save", () => {
    const create = apiSpecSection(markdown, "POST /customers")!;
    expect(create).toContain('- name (from a variable) e.g. "{{full_name}}"');
    expect(create).toContain("- address (object)\n  - city (string)");
    expect(create).toContain("- status code is one of 200, 201");
    expect(create).toContain("- the response is JSON");
    expect(create).toContain("Saves from the response for later requests: {{account_no}}");
    expect(create).not.toContain("console.log");

    const token = apiSpecSection(markdown, "POST /auth/token")!;
    expect(token).toContain("Authentication: none");
    expect(token).toContain("- Status code is 200");
    expect(token).toContain("{{access_token}}");
  });

  it("never copies variable values or literal credentials", () => {
    expect(markdown).not.toContain("eyJhbGciOiJIUzI1NiJ9");
    expect(markdown).not.toContain("s3cr3t");
    expect(markdown).not.toContain("abc123");
    expect(markdown).not.toContain("live-key-123");
    expect(markdown).toContain("- X-Api-Key: <hidden>");
    // A variable reference is not a secret, and says what to set.
    expect(markdown).toContain('"scope": "{{scope}}"');
    expect(markdown).toContain("{{access_token}}, {{account_no}}, {{age}}, {{base_url}}, {{full_name}}, {{scope}}");
  });

  it("keeps a description's own headings from splitting its endpoint", () => {
    const create = apiSpecSection(markdown, "POST /customers")!;
    expect(create).toContain("**Create**\n\nMakes a customer.\n\n**Fields**");
    expect(create).toContain("# not a heading");
  });

  it("does the same for OpenAPI descriptions", () => {
    const spec = parseOpenApi(
      'openapi: 3.0.0\ninfo: {title: x, version: "1"}\npaths:\n  /a:\n    get:\n      description: "### Notes\\nSee below."\n      responses: {"200": {description: OK}}\n',
    )!;
    const converted = openApiToMarkdown(spec);
    expect(converted.match(/^### /gm)).toHaveLength(1);
    expect(apiSpecSection(converted, "GET /a")).toContain("**Notes**\nSee below.");
  });

  it("is picked up from an uploaded .json file", async () => {
    const text = await extractDocumentText({
      buffer: Buffer.from(JSON.stringify(COLLECTION)),
      fileName: "Shop.postman_collection.json",
    });
    expect(apiSpecSection(text, "POST /customers")).not.toBeNull();
  });

  it("asks for v2.1 when given the old format, and ignores other JSON", () => {
    expect(() =>
      parsePostmanCollection(JSON.stringify({ id: "x", name: "Old", requests: [], info: { _postman_id: "1" } })),
    ).toThrow("Collection v2.1");
    expect(parsePostmanCollection('{"rows": [1]}')).toBeNull();
  });
});

describe("Postman base paths", () => {
  it("leave the shared prefix out of identifiers", () => {
    const request = (method: string, path: string) => ({
      name: `${method} ${path}`,
      request: { method, url: `{{base_url}}${path}` },
    });
    const converted = postmanToMarkdown(
      parsePostmanCollection(
        JSON.stringify({
          info: { _postman_id: "2", name: "WB", schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json" },
          item: [
            request("POST", "/api/wbi/client/v1/auth/token"),
            request("PATCH", "/api/wbi/client/v1/customers/:account_no"),
          ],
        }),
      )!,
    );
    expect(converted).toContain("Base path: /api/wbi/client/v1");
    expect(converted).toContain("Identifier: POST /auth/token\nEndpoint: POST /api/wbi/client/v1/auth/token");
    expect(apiSpecSection(converted, "PATCH /customers/{account_no}")).not.toBeNull();
  });
});
