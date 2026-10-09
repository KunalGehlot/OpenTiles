/**
 * Verovio's bundle imports `node:module` behind a Node-only check (`process.versions.node`).
 * Browsers never run that branch; this stub keeps the bundler from warning about an externalised
 * Node built-in.
 */
export function createRequire(): never {
  throw new Error('node:module is not available in the browser');
}
