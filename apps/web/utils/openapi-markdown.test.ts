import { describe, expect, it } from "vitest";

import { extractDocumentText, pastedDocumentText } from "./document-text";
import {
  apiSpecIdentifier,
  apiSpecSection,
  commonBasePath,
  isConvertedApiSpec,
  openApiToMarkdown,
  parseOpenApi,
} from "./openapi-markdown";

const OPENAPI_3 = `
openapi: 3.0.3
info:
  title: Pet Store
  version: "1.2"
servers:
  - url: https://api.example.com/v1
security:
  - bearerAuth: []
tags:
  - name: Pets
    description: Everything about pets
paths:
  /pets/{petId}:
    parameters:
      - name: petId
        in: path
        required: true
        schema: { type: integer, minimum: 1 }
    get:
      tags: [Pets]
      summary: Get one pet
      operationId: getPet
      responses:
        "200":
          description: The pet
          content:
            application/json:
              schema: { $ref: "#/components/schemas/Pet" }
        "404":
          description: No such pet
  /pets:
    post:
      tags: [Pets]
      summary: Add a pet
      requestBody:
        required: true
        content:
          application/json:
            schema: { $ref: "#/components/schemas/NewPet" }
            example: { name: Rex, status: available }
      responses:
        "201": { description: Created }
        "400": { $ref: "#/components/responses/BadRequest" }
  /health:
    get:
      security: []
      responses:
        "200": { description: OK }
components:
  securitySchemes:
    bearerAuth: { type: http, scheme: bearer, bearerFormat: JWT }
  responses:
    BadRequest:
      description: The body is invalid
  schemas:
    NewPet:
      type: object
      required: [name]
      properties:
        name: { type: string, maxLength: 50 }
        status: { type: string, enum: [available, sold] }
        owner: { $ref: "#/components/schemas/Owner" }
    Pet:
      allOf:
        - $ref: "#/components/schemas/NewPet"
        - type: object
          required: [id]
          properties:
            id: { type: integer, format: int64 }
    Owner:
      type: object
      properties:
        email: { type: string, format: email }
        pets:
          type: array
          items: { $ref: "#/components/schemas/Pet" }
`;

const SWAGGER_2 = JSON.stringify({
  swagger: "2.0",
  info: { title: "Legacy", version: "1" },
  host: "legacy.example.com",
  basePath: "/api",
  schemes: ["https"],
  securityDefinitions: { key: { type: "apiKey", in: "header", name: "X-Api-Key" } },
  security: [{ key: [] }],
  paths: {
    "/users": {
      post: {
        parameters: [
          { name: "body", in: "body", required: true, schema: { $ref: "#/definitions/User" } },
          { name: "dryRun", in: "query", type: "boolean" },
        ],
        responses: { "200": { description: "OK", schema: { $ref: "#/definitions/User" } } },
      },
    },
  },
  definitions: {
    User: { type: "object", required: ["login"], properties: { login: { type: "string" } } },
  },
});

describe("OpenAPI 3", () => {
  const markdown = openApiToMarkdown(parseOpenApi(OPENAPI_3)!);

  it("writes one section per operation, identified by method and path", () => {
    expect(isConvertedApiSpec(markdown)).toBe(true);
    expect(markdown).toContain("# Pet Store — API reference");
    expect(markdown).toContain("- https://api.example.com/v1");
    expect(markdown).toContain("## Pets\n\nEverything about pets");
    expect(markdown.match(/^### /gm)).toHaveLength(3);
    expect(markdown).toContain(
      "### GET /pets/{petId} — Get one pet\nIdentifier: GET /pets/{petId}\nEndpoint: GET /pets/{petId}\nOperation ID: getPet",
    );
    // Nothing shared by every path: no base path.
    expect(markdown).not.toContain("Base path:");
  });

  it("spells out parameters, bodies and responses with $refs and allOf resolved", () => {
    const get = apiSpecSection(markdown, "GET /pets/{petId}")!;
    expect(get).toContain("Authentication: bearerAuth");
    expect(get).toContain("- petId (path, integer, required, min 1)");
    expect(get).toContain("- 200 — The pet");
    // allOf: the NewPet fields and the Pet's own id, all on the Pet.
    expect(get).toContain("  - id (integer, int64, required)");
    expect(get).toContain("  - name (string, required, max length 50)");

    const post = apiSpecSection(markdown, "post /pets")!;
    expect(post).toContain("Request body (application/json, required):");
    expect(post).toContain('- status (string, optional, one of: "available", "sold")');
    expect(post).toContain("  - email (string, email, optional)");
    expect(post).toContain('"name": "Rex"');
    expect(post).toContain("- 400 — The body is invalid");
  });

  it("stops at a schema that contains itself", () => {
    const post = apiSpecSection(markdown, "POST /pets")!;
    // NewPet → owner → pets: array of Pet → owner: Owner again.
    expect(post).toContain("  - pets (array of object Pet, optional)");
    expect(post).toContain("      - (same structure as Owner above)");
    expect(apiSpecSection(markdown, "GET /pets/{petId}")).toContain("      - (same structure as Pet above)");
  });

  it("says when an operation is public and names the scheme", () => {
    expect(apiSpecSection(markdown, "GET /health")).toContain("Authentication: none (public)");
    expect(markdown).toContain("- bearerAuth: HTTP bearer token (JWT) in the Authorization header");
  });
});

describe("Swagger 2", () => {
  const markdown = openApiToMarkdown(parseOpenApi(SWAGGER_2)!);

  it("reads host, body parameters and definitions", () => {
    expect(markdown).toContain("- https://legacy.example.com/api");
    expect(markdown).toContain('- key: API key in the header "X-Api-Key"');
    const post = apiSpecSection(markdown, "POST /users")!;
    expect(post).toContain("Authentication: key");
    expect(post).toContain("- dryRun (query, boolean, optional)");
    expect(post).toContain("Request body (application/json, required):\n- login (string, required)");
    expect(post).toContain("- 200 — OK\n  - login (string, required)");
  });
});

describe("telling specs from other text", () => {
  it("is not fooled by prose or other JSON", () => {
    expect(parseOpenApi("The login page shows a username field.")).toBeNull();
    expect(parseOpenApi('{"name": "not a spec"}')).toBeNull();
  });

  it("refuses a spec with nothing to test", () => {
    expect(() => parseOpenApi("openapi: 3.0.0\ninfo: {title: x}\npaths: {}")).toThrow("no paths");
  });

  it("converts a pasted spec, and keeps prose that only mentions one", () => {
    expect(isConvertedApiSpec(pastedDocumentText(SWAGGER_2))).toBe(true);
    const prose = "Our API follows openapi: 3 conventions [and this: is: not yaml";
    expect(pastedDocumentText(prose)).toBe(prose);
  });

  it("finds nothing in a document that was not a spec", () => {
    expect(apiSpecSection("# PRD\n### GET /pets\nIdentifier: GET /pets", "GET /pets")).toBeNull();
  });
});

describe("uploading a spec file", () => {
  it("converts .yaml and .json specs", async () => {
    const yaml = await extractDocumentText({ buffer: Buffer.from(OPENAPI_3), fileName: "pets.YAML" });
    expect(apiSpecSection(yaml, "GET /health")).not.toBeNull();
    const json = await extractDocumentText({ buffer: Buffer.from(SWAGGER_2), fileName: "legacy.json" });
    expect(apiSpecSection(json, "POST /users")).not.toBeNull();
  });

  it("refuses JSON that is not a spec, and says why", async () => {
    await expect(
      extractDocumentText({ buffer: Buffer.from('{"rows": [1, 2, 3]}'), fileName: "data.json" }),
    ).rejects.toThrow("Swagger / OpenAPI");
  });
});

describe("base paths", () => {
  it("are the leading segments every path shares, never a whole path or a parameter", () => {
    expect(commonBasePath(["/api/v1/auth/token", "/api/v1/customers/{id}"])).toBe("/api/v1");
    expect(commonBasePath(["/api/v1/customers"])).toBe("/api/v1");
    expect(commonBasePath(["/api/v1/customers", "/api/v1"])).toBe("/api");
    expect(commonBasePath(["/{tenant}/orders", "/{tenant}/users"])).toBe("");
    expect(commonBasePath(["/pets", "/health"])).toBe("");
    // One webhook elsewhere does not cancel the base the rest share…
    expect(commonBasePath(["/api/v2/auth/token", "/api/v2/qr", "/api/v2/qr/{id}", "/webhook-url"])).toBe("/api/v2");
    // …but without a majority there is none.
    expect(commonBasePath(["/api/v2/a", "/hooks/b"])).toBe("");
  });

  it("are left out of identifiers, which still find old full-path codes", () => {
    const markdown = openApiToMarkdown(
      parseOpenApi(`openapi: 3.0.0
info: {title: x, version: "1"}
paths:
  /api/v1/auth/token:
    post: {responses: {"200": {description: OK}}}
  /api/v1/customers/{id}:
    delete: {responses: {"204": {description: Gone}}}
`)!,
    );
    expect(markdown).toContain("Base path: /api/v1 — Identifiers of the endpoints under it leave it out");
    expect(markdown).toContain("### POST /auth/token\nIdentifier: POST /auth/token\nEndpoint: POST /api/v1/auth/token");
    expect(apiSpecSection(markdown, "DELETE /customers/{id}")).toContain("- 204 — Gone");
    // A requirement read before base paths were left out.
    expect(apiSpecSection(markdown, "DELETE /api/v1/customers/{id}")).toContain("- 204 — Gone");
  });
});

describe("apiSpecIdentifier", () => {
  const markdown = openApiToMarkdown(
    parseOpenApi(`openapi: 3.0.0
info: {title: x, version: "1"}
paths:
  /api/v2/auth/token: {post: {responses: {"200": {description: OK}}}}
  /api/v2/qr: {get: {responses: {"200": {description: OK}}}}
  /webhook-url: {post: {responses: {"200": {description: OK}}}}
`)!,
  );

  it("snaps however the model spelled a code to the operation's exact Identifier", () => {
    expect(apiSpecIdentifier(markdown, "POST /auth/token")).toBe("POST /auth/token");
    expect(apiSpecIdentifier(markdown, "POST /api/v2/auth/token")).toBe("POST /auth/token");
    expect(apiSpecIdentifier(markdown, "post   `/auth/token`")).toBe("POST /auth/token");
    expect(apiSpecIdentifier(markdown, "POST webhook-url")).toBe("POST /webhook-url");
  });

  it("leaves codes that name no operation alone", () => {
    expect(apiSpecIdentifier(markdown, "FR-01")).toBeNull();
    expect(apiSpecIdentifier("# PRD", "POST /auth/token")).toBeNull();
  });
});
