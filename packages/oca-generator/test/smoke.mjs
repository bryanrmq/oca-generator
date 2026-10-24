// Runs the built package in plain Node, with no browser globals, and prints what it builds from a project file
// as JSON. `package.test.ts` runs it and compares the result with the web app's export; CI also runs it on Node 20.
// Usage: node test/smoke.mjs [project file] (default: the sample fixture).
import { readFile } from 'node:fs/promises';

// Newer Node versions add some browser-like globals; take them away so the package can't lean on them.
for (const name of ['navigator', 'localStorage', 'sessionStorage']) {
  Object.defineProperty(globalThis, name, { value: undefined, configurable: true, writable: true });
}
for (const name of ['window', 'document', 'self', 'location', 'indexedDB', 'HTMLElement', 'Image', 'FileReader']) {
  if (globalThis[name] !== undefined) throw new Error(`Expected no ${name} global in Node`);
}

const { exportProject, importBundle, parseProjectFile, serializeBundle } = await import('../dist/index.js');

const file = process.argv[2] ?? new URL('./fixtures/sample.credential-project.json', import.meta.url);
const parsed = parseProjectFile(await readFile(file, 'utf8'));
if (!parsed.ok) throw new Error(`Not a project file: ${parsed.error}`);

const result = await exportProject(parsed.project);
if (!result.ok) {
  process.stdout.write(`${JSON.stringify({ ok: false, issues: result.issues }, null, 2)}\n`);
  process.exit(1);
}

// The bundle imports back into a project that builds the same bundle.
const { project: reimported } = await importBundle(JSON.parse(result.outputs.json));
reimported.hosting = parsed.project.hosting;
const again = await exportProject(reimported);
const roundTrip = again.ok && serializeBundle(again.bundle) === result.outputs.json;

process.stdout.write(
  `${JSON.stringify(
    {
      ok: true,
      node: process.version,
      issues: result.issues,
      json: result.outputs.json,
      uri: result.outputs.uri,
      integrity: result.outputs.integrity,
      vct: result.vct,
      issuerMetadata: result.issuerMetadata,
      roundTrip,
    },
    null,
    2,
  )}\n`,
);
if (!roundTrip) process.exit(1);
