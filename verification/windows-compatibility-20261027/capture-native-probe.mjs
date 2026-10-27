import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { stripTypeScriptTypes } from "node:module";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

// Execute the authored capture fixtures and native oracle only.
// This does not build or invoke REA, Vitest, CLI analysis, or MCP comparison.
const [sourceArgument, outputArgument] = process.argv.slice(2);
if (!sourceArgument || !outputArgument)
  throw new Error("Usage: node capture-native-probe.mjs SOURCE_DIRECTORY OUTPUT_JSON");
const testPath = join(
  resolve(sourceArgument),
  "tests/acceptance/applications/applicationWorkflowCli.test.ts",
);
const source = await readFile(testPath, "utf8");
const testStart = source.indexOf(
  'it("compares captured primitives and source values after aliases are replaced"',
);
if (testStart < 0) throw new Error("Pinned capture test was not found");
const section = (start, end, from) => {
  const first = source.indexOf(start, from);
  const last = source.indexOf(end, first);
  if (first < from || last < first) throw new Error("Pinned test structure changed");
  return source.slice(first, last);
};
const fixture = section(
  "    const fields = [",
  "    // Retain a complete CLI",
  testStart,
);
const oracle = section(
  "    for (const [index, value]",
  "    const input = {",
  testStart,
);
const writer = section(
  "const writeComparisonSources = (",
  "// Produce comparison inputs",
  testStart,
);
const body = fixture + "\n" + stripTypeScriptTypes(writer) +
  "\nawait writeComparisonSources(root, sources);\n" + oracle +
  "\nreturn { authoredFixtures: sources.length, fieldsPerFixture: fields.length };";
const temporaryParent = await realpath(tmpdir());
const root = await mkdtemp(join(temporaryParent, "rea-capture-control #"));
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const execute = promisify(execFile);
const expect = (actual) => ({
  toEqual(expected) { assert.deepStrictEqual(actual, expected); },
});
let result;
try {
  const run = new AsyncFunction(
    "root", "join", "mkdir", "writeFile", "execute", "pathToFileURL", "expect", body,
  );
  const observed = await run(root, join, mkdir, writeFile, execute, pathToFileURL, expect);
  result = { passed: true, ...observed };
} catch (cause) {
  result = {
    passed: false,
    code: cause.stderr?.includes("ERR_UNSUPPORTED_ESM_URL_SCHEME")
      ? "ERR_UNSUPPORTED_ESM_URL_SCHEME" : (cause.code ?? null),
    detail: String(cause.message).replaceAll(root, "<TEST_ROOT>").slice(0,1000),
  };
} finally {
  // Only remove the freshly allocated test directory inside the canonical temp root.
  const canonicalRoot = await realpath(root);
  if (dirname(canonicalRoot) !== temporaryParent ||
      !basename(canonicalRoot).startsWith("rea-capture-control #"))
    throw new Error("Temporary cleanup target escaped its owned parent");
  try {
    await rm(canonicalRoot, { recursive: true, force: true });
  } catch (cause) {
    result = { ...result, passed: false, cleanupFailure: String(cause.message) };
  }
}
result = {
  node: process.version,
  platform: process.platform,
  architecture: process.arch,
  testSha256: createHash("sha256").update(source).digest("hex"),
  scope: "authored fixtures and native oracle only; full CLI/MCP case not run",
  ...result,
};
await writeFile(resolve(outputArgument), JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify(result));
if (!result.passed) process.exitCode = 1;
