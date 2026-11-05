import {
  API_SPEC_MARKER,
  basePathNote,
  commonBasePath,
  operationCode,
  prose,
  relativePath,
} from "@/utils/openapi-markdown";

/**
 * Postman collections (v2.0 / v2.1), as a requirements document — in the same
 * shape as a converted OpenAPI spec, so everything after the upload treats
 * them alike: one `###` section per endpoint, identified by method and path.
 *
 * A collection is a set of example requests, not a schema, so a section shows
 * what the requests send — body fields with their example values — and what
 * their test scripts check. Requests to the same endpoint share one section.
 *
 * Collections often carry real credentials, so variable values are never
 * copied, and literal values of secret-looking fields and headers are hidden.
 */

type Node = Record<string, unknown>;

const isNode = (value: unknown): value is Node =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const node = (value: unknown): Node => (isNode(value) ? value : {});
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

const MAX_EXAMPLE_CHARS = 1_200;
const HIDDEN = "<hidden>";
/**
 * Field, header and query names whose literal values are credentials. A
 * client id is not secret on its own, but it belongs in an environment
 * variable beside its secret, not in a document.
 */
const SECRET_NAME = /pass(word|wd)?|secret|token|api[-_]?key|authorization|pin\b|otp|private|credential|cookie|client[-_]?id/i;
/** `{{name}}`, and Postman Vault's `{{vault:name}}`. */
const VARIABLE = /\{\{\s*([\w.:-]+)\s*\}\}/g;
const HAS_VARIABLE = /\{\{\s*[\w.:-]+\s*\}\}/;

/** The collection in a file's text, or null when it is not one. */
export function parsePostmanCollection(source: string): Node | null {
  const trimmed = source.trim();
  if (!trimmed.startsWith("{") || !/getpostman\.com|_postman_id/.test(trimmed.slice(0, 4_000))) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (error) {
    throw new Error(`That looks like a Postman collection but is not valid JSON: ${(error as Error).message}`);
  }
  if (!isNode(parsed) || !isNode(parsed.info)) return null;
  if (!Array.isArray(parsed.item)) {
    throw new Error("That is an old Postman collection format. Export it again from Postman as Collection v2.1.");
  }
  return parsed;
}

type Request = {
  name: string;
  folder: string;
  method: string;
  path: string;
  item: Node;
  request: Node;
  inheritedAuth: Node | null;
};

export function postmanToMarkdown(collection: Node): string {
  const info = node(collection.info);
  const requests: Request[] = [];
  collect(list(collection.item), [], node(collection.auth).type ? node(collection.auth) : null, requests);
  if (requests.length === 0) throw new Error("That Postman collection has no requests to test.");

  const variables = new Set<string>();
  for (const { request } of requests) {
    for (const match of JSON.stringify(request).matchAll(VARIABLE)) variables.add(match[1]!);
  }
  const declared = list(collection.variable).map((v) => text(node(v).key)).filter(Boolean);

  const out: string[] = [
    API_SPEC_MARKER,
    `# ${text(info.name) || "Postman collection"} — API reference`,
    "",
    "Converted from a Postman collection. Each `###` section is one endpoint; its Identifier is the method and the path below the base path. The request bodies are the collection's examples, and the checks are its test scripts.",
  ];
  if (describe(info.description)) out.push("", describe(info.description));
  const baseVariable = [...variables].find((name) => /base[-_]?url|host|domain/i.test(name));
  if (baseVariable) out.push("", `Server: the {{${baseVariable}}} variable — the environment's API base URL.`);
  const base = commonBasePath(requests.map((request) => request.path));
  if (base) out.push("", basePathNote(base));
  const all = [...new Set([...declared, ...variables])].sort();
  if (all.length) {
    out.push(
      "",
      "Variables the requests use (values are not copied — set them as environment variables):",
      all.map((name) => `{{${name}}}`).join(", "),
    );
  }

  // One section per endpoint, in collection order, grouped by folder.
  const groups = new Map<string, Map<string, Request[]>>();
  for (const request of requests) {
    const byCode = groups.get(request.folder) ?? new Map<string, Request[]>();
    const code = operationCode(request.method, relativePath(request.path, base));
    byCode.set(code, [...(byCode.get(code) ?? []), request]);
    groups.set(request.folder, byCode);
  }
  const seen = new Set<string>();
  for (const [folder, byCode] of groups) {
    out.push("", `## ${folder}`);
    for (const [code, variants] of byCode) {
      // The same endpoint in two folders still gets one identifier each way.
      const identifier = seen.has(code) ? `${code} (${folder})` : code;
      seen.add(code);
      out.push("", ...endpointSection(identifier, variants));
    }
  }
  return out.join("\n");
}

function collect(items: unknown[], folders: string[], auth: Node | null, into: Request[]) {
  for (const raw of items) {
    const item = node(raw);
    const ownAuth = isNode(item.auth) && text(item.auth.type) && text(item.auth.type) !== "inherit" ? item.auth : null;
    if (Array.isArray(item.item)) {
      collect(item.item, [...folders, text(item.name) || "Folder"], ownAuth ?? auth, into);
      continue;
    }
    const request = isNode(item.request) ? item.request : { url: item.request, method: "GET" };
    into.push({
      name: text(item.name) || "Request",
      folder: folders.join(" / ") || "Requests",
      method: text(request.method) || "GET",
      path: requestPath(request.url),
      item,
      request,
      inheritedAuth: auth,
    });
  }
}

/** "/api/customers/{account_no}" from a Postman URL, without host or query. */
function requestPath(url: unknown): string {
  let path: string;
  if (isNode(url) && Array.isArray(url.path)) {
    path = `/${url.path.map((segment) => (typeof segment === "string" ? segment : text(node(segment).value))).join("/")}`;
  } else {
    const raw = typeof url === "string" ? url : text(node(url).raw);
    path = raw
      .replace(/[?#].*$/, "")
      .replace(/^\{\{[^}]+\}\}/, "")
      .replace(/^[a-z]+:\/\/[^/]+/i, "");
    if (!path.startsWith("/")) path = `/${path}`;
  }
  // Postman's ":id" path variables, written the OpenAPI way.
  return path.replace(/\/:([\w-]+)/g, "/{$1}").replace(/\/+$/, "") || "/";
}

function endpointSection(identifier: string, variants: Request[]): string[] {
  const first = variants[0]!;
  const lines = [
    `### ${identifier} — ${first.name}`,
    `Identifier: ${identifier}`,
    `Endpoint: ${operationCode(first.method, first.path)}`,
  ];
  if (variants.length > 1) lines.push(`Requests in the collection: ${variants.map((v) => v.name).join("; ")}`);
  for (const [index, variant] of variants.entries()) {
    if (variants.length > 1) lines.push("", `#### ${index + 1}. ${variant.name}`);
    lines.push(...requestLines(variant));
  }
  return lines;
}

function requestLines({ request, item, inheritedAuth }: Request): string[] {
  const lines: string[] = [];
  lines.push(`Authentication: ${describeAuth(isNode(request.auth) && text(request.auth.type) !== "inherit" ? request.auth : inheritedAuth)}`);
  const description = describe(request.description);
  if (description) lines.push("", description);

  const url = node(request.url);
  const pathVariables = list(url.variable).map(node);
  const query = list(url.query).map(node).filter((q) => q.disabled !== true);
  if (pathVariables.length || query.length) {
    lines.push("", "Parameters:");
    for (const variable of pathVariables) lines.push(parameterLine(variable, "path"));
    for (const parameter of query) lines.push(parameterLine(parameter, "query"));
  }

  const headers = list(request.header).map(node).filter((h) => h.disabled !== true && text(h.key));
  if (headers.length) {
    lines.push("", "Headers:");
    for (const header of headers) lines.push(`- ${text(header.key)}: ${safeValue(text(header.key), text(header.value))}`);
  }

  lines.push(...bodyLines(node(request.body)));

  const { checks, saves } = readTests(item);
  if (checks.length) lines.push("", "Checks in the collection's tests:", ...checks.map((check) => `- ${check}`));
  if (saves.length) lines.push("", `Saves from the response for later requests: ${saves.map((name) => `{{${name}}}`).join(", ")}`);

  const responses = list(item.response).map(node);
  if (responses.length) {
    lines.push("", "Saved example responses:");
    for (const response of responses) {
      lines.push(`- ${response.code ?? "?"} ${text(response.status)}${text(response.name) ? ` — ${text(response.name)}` : ""}`);
      const body = parseLooseJson(text(response.body));
      if (body !== undefined) lines.push(...exampleLines(maskSecrets(body), 2));
    }
  }
  return lines;
}

function describeAuth(auth: Node | null): string {
  if (!auth) return "none";
  const type = text(auth.type);
  const setting = (key: string) => text(node(list(auth[type]).map(node).find((entry) => text(entry.key) === key)).value);
  switch (type) {
    case "noauth":
      return "none";
    case "bearer": {
      const token = setting("token");
      return `bearer token in the Authorization header${token.startsWith("{{") ? ` (${token})` : ""}`;
    }
    case "apikey": {
      const where = setting("in") || "header";
      return `API key in the ${where} "${setting("key") || "?"}"`;
    }
    case "basic":
      return "HTTP basic auth";
    case "oauth2":
      return "OAuth 2 access token, sent as a bearer token";
    default:
      return type || "none";
  }
}

function parameterLine(parameter: Node, where: string): string {
  const key = text(parameter.key);
  const value = text(parameter.value);
  const description = describe(parameter.description);
  return `- ${key} (${where})${description ? ` — ${oneLine(description)}` : ""}${
    value ? ` Example: ${safeValue(key, value)}` : ""
  }`;
}

function bodyLines(body: Node): string[] {
  const mode = text(body.mode);
  if (!mode || body.disabled === true) return [];
  if (mode === "raw") {
    const raw = text(body.raw);
    if (!raw) return [];
    const language = text(node(node(body.options).raw).language) || "text";
    const json = parseLooseJson(raw);
    if (json === undefined) {
      return ["", `Request body (raw ${language}):`, "```", truncate(raw), "```"];
    }
    const masked = maskSecrets(json);
    return ["", "Request body (JSON):", ...fieldLines(masked, 0), ...exampleLines(masked, 0)];
  }
  if (mode === "urlencoded" || mode === "formdata") {
    const fields = list(body[mode]).map(node).filter((f) => f.disabled !== true);
    if (!fields.length) return [];
    return [
      "",
      `Request body (${mode === "urlencoded" ? "form, urlencoded" : "multipart form"}):`,
      ...fields.map((field) => {
        const key = text(field.key);
        const description = describe(field.description);
        const value = text(field.type) === "file" ? "a file" : safeValue(key, text(field.value));
        return `- ${key}${description ? ` — ${oneLine(description)}` : ""}${value ? ` Example: ${value}` : ""}`;
      }),
    ];
  }
  if (mode === "graphql") {
    return ["", "Request body (GraphQL):", "```graphql", truncate(text(node(body.graphql).query)), "```"];
  }
  return ["", `Request body (${mode})`];
}

/** Body fields with the type of their example value, nested ones indented. */
function fieldLines(value: unknown, indent: number): string[] {
  const pad = " ".repeat(indent);
  if (Array.isArray(value)) {
    const item = value[0];
    return isNode(item) ? [`${pad}- (array of objects)`, ...fieldLines(item, indent + 2)] : [`${pad}- (array of ${kind(item)})`];
  }
  if (!isNode(value)) return [];
  const lines: string[] = [];
  for (const [key, field] of Object.entries(value)) {
    const example = isNode(field) || Array.isArray(field) ? "" : ` e.g. ${oneLine(JSON.stringify(field))}`;
    lines.push(`${pad}- ${key} (${kind(field)})${example}`);
    if (isNode(field) || (Array.isArray(field) && isNode(field[0]))) lines.push(...fieldLines(field, indent + 2));
  }
  return lines;
}

function kind(value: unknown): string {
  if (typeof value === "string") return HAS_VARIABLE.test(value) ? "from a variable" : "string";
  if (Array.isArray(value)) return isNode(value[0]) ? "array of objects" : `array of ${kind(value[0])}`;
  if (value === null) return "null";
  return isNode(value) ? "object" : typeof value;
}

/**
 * What a request's test script checks, as plain sentences: the test names,
 * the status codes and content type it insists on, and the variables it
 * saves for later requests. Logging and debugging lines are left out.
 */
function readTests(item: Node): { checks: string[]; saves: string[] } {
  const script = list(item.event)
    .map(node)
    .filter((event) => text(event.listen) === "test")
    .flatMap((event) => {
      const exec = node(event.script).exec;
      return Array.isArray(exec) ? exec.map(String) : [String(exec ?? "")];
    })
    .join("\n");
  const checks: string[] = [];
  const add = (check: string) => {
    if (check && !checks.includes(check)) checks.push(check);
  };
  for (const match of script.matchAll(/pm\.test\(\s*(["'`])(.+?)\1/g)) add(oneLine(match[2]!));
  for (const match of script.matchAll(/to\.have\.status\(\s*(\d{3})\s*\)/g)) add(`status code is ${match[1]}`);
  for (const match of script.matchAll(/pm\.response\.code\)\s*\.to\.(?:be\.oneOf|be\.within)\(\s*\[?([\d,\s]+)\]?\s*\)/g)) {
    add(`status code is one of ${match[1]!.split(",").map((code) => code.trim()).filter(Boolean).join(", ")}`);
  }
  for (const match of script.matchAll(/pm\.response\.code\)\s*\.to\.(?:eql|equal|be\.equal)\(\s*(\d{3})\s*\)/g)) {
    add(`status code is ${match[1]}`);
  }
  if (/pm\.response\.to\.be\.json/.test(script)) add("the response is JSON");
  for (const match of script.matchAll(/to\.have\.(?:jsonBody|property)\(\s*(["'`])(.+?)\1/g)) {
    add(`the response has "${match[2]}"`);
  }
  for (const match of script.matchAll(/responseTime\)\s*\.to\.be\.below\(\s*(\d+)\s*\)/g)) {
    add(`responds within ${match[1]} ms`);
  }
  const saves = [
    ...new Set(
      [...script.matchAll(/pm\.(?:environment|collectionVariables|globals|variables)\.set\(\s*(["'`])([\w.-]+)\1/g)].map(
        (match) => match[2]!,
      ),
    ),
  ];
  return { checks, saves };
}

/**
 * Sample JSON from any spec, pretty-printed with secret-looking fields hidden,
 * or null when the text is not JSON.
 */
export function maskedJson(raw: string): string | null {
  const json = parseLooseJson(raw.trim());
  return json === undefined ? null : JSON.stringify(maskSecrets(json), null, 2);
}

/** JSON as people write it — bare `{{var}}` placeholders and trailing commas allowed. */
function parseLooseJson(raw: string): unknown {
  if (!/^\s*[[{]/.test(raw)) return undefined;
  try {
    return JSON.parse(
      raw
        .replace(/(:\s*|\[\s*|,\s*)(\{\{[\w.:-]+\}\})/g, '$1"$2"')
        // Hand-written samples often end a list with a comma.
        .replace(/,(\s*[}\]])/g, "$1"),
    );
  } catch {
    return undefined;
  }
}

/** Literal values of secret-looking fields replaced; `{{variables}}` kept. */
function maskSecrets(value: unknown, key = ""): unknown {
  if (Array.isArray(value)) return value.map((entry) => maskSecrets(entry, key));
  if (isNode(value)) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, maskSecrets(v, k)]));
  }
  return typeof value === "string" || typeof value === "number" ? safeValue(key, value) : value;
}

function safeValue<T extends string | number>(key: string, value: T): T | string {
  if (!SECRET_NAME.test(key)) return value;
  return typeof value === "string" && /^\s*\{\{[^}]+\}\}\s*$/.test(value) ? value : HIDDEN;
}

function exampleLines(example: unknown, indent: number): string[] {
  const pad = " ".repeat(indent);
  const json = truncate(JSON.stringify(example, null, 2) ?? "");
  return [`${pad}Example:`, `${pad}\`\`\`json`, ...json.split("\n").map((line) => pad + line), `${pad}\`\`\``];
}

/** Postman descriptions are a string or `{ content }`. */
const describe = (value: unknown) => prose(text(value) || text(node(value).content));
const truncate = (value: string) => (value.length > MAX_EXAMPLE_CHARS ? `${value.slice(0, MAX_EXAMPLE_CHARS)}\n… (cut)` : value);
const oneLine = (value: string) => value.replace(/\s+/g, " ").trim();
