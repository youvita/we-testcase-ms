// The one js-yaml call the app makes (reading OpenAPI specs), typed here
// rather than through @types/js-yaml.
declare module "js-yaml" {
  export function load(text: string, options?: { filename?: string; json?: boolean }): unknown;
}
