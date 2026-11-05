import { load } from "js-yaml";

/**
 * Swagger 2 / OpenAPI 3 specs, as a requirements document.
 *
 * Done in code, not by the AI: every operation becomes its own `###`
 * section with the method and path as its identifier, its parameters, request
 * body and responses spelled out field by field — `$ref`s resolved, required
 * fields and enums kept. Reading requirements then gets one requirement per
 * operation with the real endpoint in it, and a script writer can be handed
 * the one section its case is about (`openApiSection`).
 */

type Node = Record<string, unknown>;

const METHODS = ["get", "put", "post", "delete", "options", "head", "patch", "trace"] as const;

/**
 * First line of every converted spec — OpenAPI here, Postman collections in
 * postman-markdown.ts — and how a document is known to be one.
 */
export const API_SPEC_MARKER = "<!-- converted from an API spec -->";
/** How deep nested objects are spelled out before they are only named. */
const MAX_DEPTH = 5;
const MAX_EXAMPLE_CHARS = 1_200;

const isNode = (value: unknown): value is Node =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const node = (value: unknown): Node => (isNode(value) ? value : {});
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const text = (value: unknown): string =>
  typeof value === "string" ? value.trim() : typeof value === "number" || typeof value === "boolean" ? String(value) : "";

/**
 * The spec in a file's or a paste's text, or null when it is not one.
 * Throws only for text that says it is a spec but cannot be read.
 */
export function parseOpenApi(source: string): Node | null {
  const trimmed = source.trim();
  // Near the top, in YAML (`openapi: 3.0.0`) or JSON, minified or not.
  const looksLikeSpec = /["']?\b(openapi|swagger)["']?\s*:\s*["']?\d/.test(trimmed.slice(0, 4_000));
  if (!looksLikeSpec) return null;
  let parsed: unknown;
  try {
    // YAML is a superset of JSON, so one parser reads both.
    parsed = load(trimmed, { json: true });
  } catch (error) {
    throw new Error(
      `That looks like an OpenAPI spec but could not be read: ${(error as Error).message.split("\n")[0]}`,
    );
  }
  if (!isNode(parsed) || !(text(parsed.openapi) || text(parsed.swagger))) return null;
  if (!isNode(parsed.paths) || Object.keys(parsed.paths).length === 0) {
    throw new Error("That OpenAPI spec has no paths to test.");
  }
  return parsed;
}

export function isConvertedApiSpec(content: string): boolean {
  return content.startsWith(API_SPEC_MARKER);
}

/** The operation's identifier as the converted document writes it. */
export function operationCode(method: string, path: string): string {
  return `${method.toUpperCase()} ${path}`;
}

/**
 * The leading path segments most endpoints share ("/api/wbi/client/v1"), or
 * "". Identifiers leave it out — "POST /auth/token" rather than the whole
 * path — so requirement codes and the TC IDs made from them stay short. More
 * than half the endpoints must share it, so one odd path (a webhook on the
 * caller's own server, say) does not cancel it for the rest; endpoints not
 * under it keep their full path. It never takes a whole path or a {parameter}.
 */
export function commonBasePath(paths: string[]): string {
  const split = paths.map((path) => path.split("/").filter(Boolean)).filter((segments) => segments.length);
  if (!split.length) return "";
  // The largest group by first segment, if it is a majority.
  const groups = new Map<string, string[][]>();
  for (const segments of split) groups.set(segments[0]!, [...(groups.get(segments[0]!) ?? []), segments]);
  const largest = [...groups.values()].sort((a, b) => b.length - a.length)[0]!;
  if (largest.length * 2 <= split.length) return "";

  let length = Math.min(...largest.map((segments) => segments.length)) - 1;
  for (let i = 0; i < length; i += 1) {
    const segment = largest[0]![i]!;
    if (segment.includes("{") || largest.some((segments) => segments[i] !== segment)) length = i;
  }
  return length > 0 ? `/${largest[0]!.slice(0, length).join("/")}` : "";
}

export function relativePath(path: string, base: string): string {
  return base && path.startsWith(`${base}/`) ? path.slice(base.length) : path;
}

/**
 * The section of a converted spec for one operation, found by the identifier
 * a requirement was given ("GET /pets/{petId}") — or by its full endpoint,
 * the identifier documents converted before base paths were left out — or
 * null.
 */
export function apiSpecSection(content: string, code: string): string | null {
  if (!isConvertedApiSpec(content)) return null;
  const wanted = normalizeCode(code);
  for (const section of content.split(/\n(?=### )/)) {
    const identifier = /^Identifier: (.+)$/m.exec(section)?.[1];
    const endpoint = /^Endpoint: (.+)$/m.exec(section)?.[1];
    if ([identifier, endpoint].some((value) => value && normalizeCode(value) === wanted)) {
      return section.trim();
    }
  }
  return null;
}

/**
 * The exact Identifier of the operation a code names, or null. Reading
 * requirements saves this instead of the model's spelling, so codes stay
 * short and keep finding their section: "POST /api/v2/auth/token" and
 * "post auth/token" both become "POST /auth/token".
 */
export function apiSpecIdentifier(content: string, code: string): string | null {
  const section = apiSpecSection(content, code);
  return section ? (/^Identifier: (.+)$/m.exec(section)?.[1]?.trim() ?? null) : null;
}

const normalizeCode = (code: string) =>
  code
    .replace(/`/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase()
    // "POST webhook-url" — a method and a path without its leading slash.
    .replace(/^([A-Z]+) (?!\/)/, "$1 /");

export function openApiToMarkdown(spec: Node): string {
  const resolver = new Resolver(spec);
  const info = node(spec.info);
  const version = text(spec.openapi) ? `OpenAPI ${text(spec.openapi)}` : `Swagger ${text(spec.swagger)}`;
  const out: string[] = [
    API_SPEC_MARKER,
    `# ${text(info.title) || "API"} — API reference`,
    "",
    `Converted from ${version}${text(info.version) ? `, API version ${text(info.version)}` : ""}. Each \`###\` section is one operation; its Identifier is the method and the path below the base path.`,
  ];
  if (text(info.description)) out.push("", prose(text(info.description)));

  const servers = serverUrls(spec);
  if (servers.length) out.push("", "Servers:", ...servers.map((url) => `- ${url}`));
  const base = commonBasePath(Object.keys(node(spec.paths)));
  if (base) out.push("", basePathNote(base));

  const schemes = securitySchemes(spec, resolver);
  if (schemes.size) {
    out.push("", "Authentication schemes:");
    for (const [name, description] of schemes) out.push(`- ${name}: ${description}`);
  }
  const globalSecurity = spec.security;

  // Grouped by first tag, in the spec's own tag order, untagged last.
  const tagOrder = list(spec.tags).map((tag) => text(node(tag).name)).filter(Boolean);
  const tagDescriptions = new Map(
    list(spec.tags).map((tag) => [text(node(tag).name), text(node(tag).description)] as const),
  );
  const groups = new Map<string, string[][]>();
  for (const [path, rawItem] of Object.entries(node(spec.paths))) {
    const item = resolver.resolve(rawItem);
    for (const method of METHODS) {
      if (!isNode(item[method])) continue;
      const operation = item[method] as Node;
      const tag = text(list(operation.tags)[0]) || "Other";
      if (!tagOrder.includes(tag)) tagOrder.push(tag);
      const section = operationSection({
        method,
        path,
        base,
        operation,
        pathParameters: list(item.parameters),
        globalSecurity,
        schemes,
        resolver,
      });
      groups.set(tag, [...(groups.get(tag) ?? []), section]);
    }
  }
  for (const tag of tagOrder) {
    const sections = groups.get(tag);
    if (!sections) continue;
    out.push("", `## ${tag}`);
    if (tagDescriptions.get(tag)) out.push("", prose(tagDescriptions.get(tag)!));
    for (const section of sections) out.push("", ...section);
  }
  return out.join("\n");
}

function serverUrls(spec: Node): string[] {
  if (text(spec.openapi)) {
    return list(spec.servers)
      .map((server) => {
        const url = text(node(server).url);
        const description = text(node(server).description);
        return url && (description ? `${url} (${description})` : url);
      })
      .filter((url): url is string => Boolean(url));
  }
  const host = text(spec.host);
  if (!host) return [];
  const schemes = list(spec.schemes).map(text).filter(Boolean);
  return (schemes.length ? schemes : ["https"]).map((scheme) => `${scheme}://${host}${text(spec.basePath)}`);
}

function securitySchemes(spec: Node, resolver: Resolver): Map<string, string> {
  const raw = text(spec.openapi)
    ? node(node(spec.components).securitySchemes)
    : node(spec.securityDefinitions);
  const schemes = new Map<string, string>();
  for (const [name, value] of Object.entries(raw)) {
    const scheme = resolver.resolve(value);
    const type = text(scheme.type);
    let description: string;
    if (type === "http") {
      const kind = text(scheme.scheme).toLowerCase();
      description =
        kind === "bearer"
          ? `HTTP bearer token${text(scheme.bearerFormat) ? ` (${text(scheme.bearerFormat)})` : ""} in the Authorization header`
          : `HTTP ${kind || "auth"} in the Authorization header`;
    } else if (type === "basic") {
      description = "HTTP basic auth in the Authorization header";
    } else if (type === "apiKey") {
      description = `API key in the ${text(scheme.in) || "header"} "${text(scheme.name)}"`;
    } else if (type === "oauth2") {
      description = "OAuth 2 access token, sent as a bearer token";
    } else if (type === "openIdConnect") {
      description = "OpenID Connect token, sent as a bearer token";
    } else {
      description = type || "unspecified";
    }
    if (text(scheme.description)) description += ` — ${text(scheme.description)}`;
    schemes.set(name, description);
  }
  return schemes;
}

function operationSection(options: {
  method: string;
  path: string;
  base: string;
  operation: Node;
  pathParameters: unknown[];
  globalSecurity: unknown;
  schemes: Map<string, string>;
  resolver: Resolver;
}): string[] {
  const { method, path, operation, resolver } = options;
  const code = operationCode(method, relativePath(path, options.base));
  const summary = text(operation.summary);
  const lines = [
    `### ${code}${summary ? ` — ${summary}` : ""}`,
    `Identifier: ${code}`,
    `Endpoint: ${operationCode(method, path)}`,
  ];
  if (text(operation.operationId)) lines.push(`Operation ID: ${text(operation.operationId)}`);
  if (operation.deprecated === true) lines.push("Deprecated: yes");
  lines.push(`Authentication: ${describeSecurity(operation.security ?? options.globalSecurity, options.schemes)}`);
  if (text(operation.description)) lines.push("", prose(text(operation.description)));

  // Operation parameters override path-level ones of the same name and place.
  const byKey = new Map<string, Node>();
  for (const raw of [...options.pathParameters, ...list(operation.parameters)]) {
    const parameter = resolver.resolve(raw);
    byKey.set(`${text(parameter.in)}:${text(parameter.name)}`, parameter);
  }
  const parameters = [...byKey.values()];
  const plain = parameters.filter((p) => !["body", "formData"].includes(text(p.in)));
  if (plain.length) {
    lines.push("", "Parameters:");
    for (const parameter of plain) lines.push(parameterLine(parameter, resolver));
  }

  // Request body: OpenAPI 3 requestBody, or Swagger 2 body / formData parameters.
  const body = parameters.find((p) => text(p.in) === "body");
  const form = parameters.filter((p) => text(p.in) === "formData");
  if (isNode(operation.requestBody)) {
    const requestBody = resolver.resolve(operation.requestBody);
    const content = node(requestBody.content);
    const mediaTypes = Object.keys(content);
    const media = preferredMedia(content);
    lines.push(
      "",
      `Request body (${mediaTypes.join(", ") || "no content type"}${requestBody.required === true ? ", required" : ", optional"}):`,
    );
    if (text(requestBody.description)) lines.push(prose(text(requestBody.description)));
    if (media) lines.push(...mediaLines(media, resolver));
  } else if (body) {
    const consumes = list(operation.consumes).map(text).join(", ") || "application/json";
    lines.push("", `Request body (${consumes}${body.required === true ? ", required" : ", optional"}):`);
    if (text(body.description)) lines.push(prose(text(body.description)));
    lines.push(...schemaLines(body.schema, resolver, 0, new Set()));
  } else if (form.length) {
    lines.push("", "Request body (form fields):");
    for (const field of form) lines.push(parameterLine(field, resolver));
  }

  const responses = Object.entries(node(operation.responses));
  if (responses.length) {
    lines.push("", "Responses:");
    for (const [status, raw] of responses) {
      const response = resolver.resolve(raw);
      lines.push(`- ${status}${text(response.description) ? ` — ${text(response.description)}` : ""}`);
      if (isNode(response.content)) {
        const media = preferredMedia(response.content);
        if (media) lines.push(...mediaLines(media, resolver, 2));
      } else if (response.schema) {
        lines.push(...schemaLines(response.schema, resolver, 2, new Set()));
        const example = Object.values(node(response.examples))[0];
        if (example !== undefined) lines.push(...exampleLines(example, 2));
      }
    }
  }
  return lines;
}

function describeSecurity(security: unknown, schemes: Map<string, string>): string {
  const requirements = list(security);
  if (security === undefined) return schemes.size ? "not stated" : "none";
  if (requirements.length === 0) return "none (public)";
  // Each entry is an alternative; names inside one entry are all needed.
  return requirements
    .map((requirement) => {
      const names = Object.keys(node(requirement));
      return names.length ? names.join(" + ") : "none";
    })
    .join(" or ");
}

function parameterLine(parameter: Node, resolver: Resolver): string {
  // Swagger 2 puts the type on the parameter; OpenAPI 3 in its schema.
  const schema = isNode(parameter.schema) ? parameter.schema : parameter;
  const facts = [
    text(parameter.in),
    typeLabel(schema, resolver),
    parameter.required === true ? "required" : "optional",
    ...constraints(resolver.resolve(schema)),
  ].filter(Boolean);
  const description = text(parameter.description);
  const example = parameter.example ?? resolver.resolve(schema).example;
  return `- ${text(parameter.name)} (${facts.join(", ")})${description ? ` — ${oneLine(description)}` : ""}${
    example !== undefined ? ` Example: ${oneLine(JSON.stringify(example))}` : ""
  }`;
}

/** The JSON media type when there is one, as the most testable. */
function preferredMedia(content: unknown): Node | null {
  const entries = Object.entries(node(content));
  if (!entries.length) return null;
  const json = entries.find(([type]) => /json/i.test(type));
  return node((json ?? entries[0])![1]);
}

function mediaLines(media: Node, resolver: Resolver, indent = 0): string[] {
  const lines = schemaLines(media.schema, resolver, indent, new Set());
  const example = media.example ?? node(Object.values(node(media.examples))[0]).value;
  if (example !== undefined) lines.push(...exampleLines(example, indent));
  return lines;
}

function exampleLines(example: unknown, indent: number): string[] {
  let json = JSON.stringify(example, null, 2) ?? String(example);
  if (json.length > MAX_EXAMPLE_CHARS) json = `${json.slice(0, MAX_EXAMPLE_CHARS)}\n… (cut)`;
  const pad = " ".repeat(indent);
  return [`${pad}Example:`, `${pad}\`\`\`json`, ...json.split("\n").map((line) => pad + line), `${pad}\`\`\``];
}

/** A schema as a field list, nested objects indented under their field. */
function schemaLines(raw: unknown, resolver: Resolver, indent: number, seen: Set<string>): string[] {
  if (!isNode(raw)) return [];
  const pad = " ".repeat(indent);
  const ref = text(raw.$ref);
  if (ref && seen.has(ref)) return [`${pad}- (same structure as ${refName(ref)} above)`];
  const nextSeen = ref ? new Set(seen).add(ref) : seen;
  const schema = resolver.flatten(raw);

  const properties = node(schema.properties);
  if (Object.keys(properties).length === 0) {
    if (text(schema.type) === "array" || isNode(schema.items)) {
      const items = schema.items;
      const itemSchema = resolver.flatten(items);
      const lines = [`${pad}- (array of ${typeLabel(items, resolver)}${constraints(schema).map((c) => `, ${c}`).join("")})`];
      if (Object.keys(node(itemSchema.properties)).length && seen.size < MAX_DEPTH) {
        lines.push(...schemaLines(items, resolver, indent + 2, nextSeen));
      }
      return lines;
    }
    const label = typeLabel(raw, resolver);
    return label ? [`${pad}- (${[label, ...constraints(schema)].join(", ")})`] : [];
  }

  const required = new Set(list(schema.required).map(text));
  const lines: string[] = [];
  for (const [name, rawProperty] of Object.entries(properties)) {
    const property = resolver.flatten(rawProperty);
    const facts = [
      typeLabel(rawProperty, resolver),
      required.has(name) ? "required" : "optional",
      ...constraints(property),
    ].filter(Boolean);
    const description = text(property.description);
    lines.push(`${pad}- ${name} (${facts.join(", ")})${description ? ` — ${oneLine(description)}` : ""}`);

    const nested =
      Object.keys(node(property.properties)).length > 0
        ? rawProperty
        : Object.keys(node(resolver.flatten(property.items).properties)).length > 0
          ? property.items
          : null;
    if (nested && indent / 2 < MAX_DEPTH) {
      const nestedRef = text(node(nested).$ref);
      lines.push(
        ...(nestedRef && nextSeen.has(nestedRef)
          ? [`${pad}  - (same structure as ${refName(nestedRef)} above)`]
          : schemaLines(nested, resolver, indent + 2, nextSeen)),
      );
    }
  }
  return lines;
}

function typeLabel(raw: unknown, resolver: Resolver): string {
  if (!isNode(raw)) return "";
  const ref = text(raw.$ref);
  const schema = resolver.flatten(raw);
  const named = ref ? refName(ref) : "";
  const type = text(schema.type) || (isNode(schema.properties) ? "object" : "");
  if (type === "array" || isNode(schema.items)) return `array of ${typeLabel(schema.items, resolver) || "items"}`;
  const alternatives = list(schema.oneOf).length ? list(schema.oneOf) : list(schema.anyOf);
  if (alternatives.length) {
    return `one of: ${alternatives.map((option) => typeLabel(option, resolver) || "value").join(" | ")}`;
  }
  const base = named && type === "object" ? `object ${named}` : type || named;
  return [base, text(schema.format)].filter(Boolean).join(", ");
}

function constraints(schema: Node): string[] {
  const facts: string[] = [];
  const values = list(schema.enum);
  if (values.length) facts.push(`one of: ${values.map((v) => JSON.stringify(v)).join(", ")}`);
  if (schema.nullable === true) facts.push("nullable");
  if (schema.readOnly === true) facts.push("read-only");
  if (schema.writeOnly === true) facts.push("write-only");
  const bound = (key: string, label: string) => {
    if (typeof schema[key] === "number") facts.push(`${label} ${schema[key]}`);
  };
  bound("minLength", "min length");
  bound("maxLength", "max length");
  bound("minimum", schema.exclusiveMinimum === true ? "more than" : "min");
  bound("maximum", schema.exclusiveMaximum === true ? "less than" : "max");
  if (typeof schema.exclusiveMinimum === "number") facts.push(`more than ${schema.exclusiveMinimum}`);
  if (typeof schema.exclusiveMaximum === "number") facts.push(`less than ${schema.exclusiveMaximum}`);
  bound("minItems", "min items");
  bound("maxItems", "max items");
  if (text(schema.pattern)) facts.push(`pattern ${text(schema.pattern)}`);
  if (schema.default !== undefined) facts.push(`default ${oneLine(JSON.stringify(schema.default))}`);
  if (schema.example !== undefined && !isNode(schema.example) && !Array.isArray(schema.example)) {
    facts.push(`e.g. ${oneLine(JSON.stringify(schema.example))}`);
  }
  return facts;
}

/**
 * Free text from a spec, with its own Markdown headings made bold: only the
 * converter's headings may start a section, or one endpoint's description
 * ("### Request body") would split it in two. Code blocks are left alone.
 */
export function prose(value: string): string {
  let inFence = false;
  return value
    .split("\n")
    .map((line) => {
      if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
      if (inFence) return line;
      const heading = /^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/.exec(line);
      return heading ? `**${heading[1]}**` : line;
    })
    .join("\n")
    .trim();
}

export function basePathNote(base: string): string {
  return `Base path: ${base} — Identifiers of the endpoints under it leave it out; each section's Endpoint line has the full path.`;
}

const refName = (ref: string) => ref.slice(ref.lastIndexOf("/") + 1);
const oneLine = (value: string) => value.replace(/\s+/g, " ").trim();

/** Local `$ref`s ("#/components/schemas/Pet"); others are left as named. */
class Resolver {
  constructor(private readonly spec: Node) {}

  /** Follow `$ref`s until a real node — at most a few hops, never a loop. */
  resolve(value: unknown): Node {
    let current = node(value);
    for (let hops = 0; hops < 10 && text(current.$ref).startsWith("#/"); hops += 1) {
      current = node(this.pointer(text(current.$ref)));
    }
    return current;
  }

  /** Resolved, with `allOf` parts merged into one object schema. */
  flatten(value: unknown, depth = 0): Node {
    const schema = this.resolve(value);
    const parts = list(schema.allOf);
    if (!parts.length || depth > MAX_DEPTH) return schema;
    const merged: Node = { ...schema, properties: { ...node(schema.properties) }, required: [...list(schema.required)] };
    delete merged.allOf;
    for (const part of parts) {
      const flat = this.flatten(part, depth + 1);
      Object.assign(merged.properties as Node, node(flat.properties));
      (merged.required as unknown[]).push(...list(flat.required));
      if (!merged.type && flat.type) merged.type = flat.type;
      if (!merged.description && flat.description) merged.description = flat.description;
    }
    return merged;
  }

  private pointer(ref: string): unknown {
    let current: unknown = this.spec;
    for (const raw of ref.slice(2).split("/")) {
      const key = decodeURIComponent(raw).replace(/~1/g, "/").replace(/~0/g, "~");
      current = node(current)[key];
    }
    return current;
  }
}
