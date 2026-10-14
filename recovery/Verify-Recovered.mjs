import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const root = resolve(process.argv[2]);
const source = join(root, 'source');
const logs = join(root, 'verification');
const fixture = join(root, 'fixture', 'application');
await mkdir(logs, { recursive: true });
await mkdir(fixture, { recursive: true });
await writeFile(join(fixture, 'package.json'), JSON.stringify({ name: 'rea-offline-recovery-fixture', type: 'module', main: 'main.js' }));
await writeFile(join(fixture, 'main.js'), 'import { greeting } from "./helper.js"; export function hello(name) { return greeting + name; } throw new Error("Static analysis must not execute this target");\n');
await writeFile(join(fixture, 'helper.js'), 'export const greeting = "hello ";\n');
const dbPath = join(root, 'fixture', 'records.sqlite');
const db = new DatabaseSync(dbPath);
try { db.exec("CREATE TABLE messages(id INTEGER PRIMARY KEY, text TEXT); INSERT INTO messages VALUES(1,'alpha'),(2,'beta');"); }
finally { db.close(); }

const localRequire = createRequire(join(source, 'package.json'));
const { Client } = await import(pathToFileURL(localRequire.resolve('@modelcontextprotocol/client')).href);
const { StdioClientTransport } = await import(pathToFileURL(localRequire.resolve('@modelcontextprotocol/client/stdio')).href);
const { parseEvidence } = await import(pathToFileURL(join(source, 'dist/domain/evidence.js')).href);
const environment = { ...process.env, REA_LOG_LEVEL: 'silent', TURBO_TELEMETRY_DISABLED: '1' };
const runCli = async (name, args) => {
  const reply = await execute(process.execPath, [join(source, 'scripts/rea.mjs'), ...args], {
    cwd: source, env: environment, timeout: 90000, maxBuffer: 16 * 1024 * 1024,
  });
  await writeFile(join(logs, `${name}.stdout`), reply.stdout);
  await writeFile(join(logs, `${name}.stderr`), reply.stderr);
  return reply.stdout;
};

const help = await runCli('cli-help', ['--help']);
assert(help.includes('analyze-javascript-application'));
const cliApplication = parseEvidence(JSON.parse(await runCli('cli-javascript', ['analyze-javascript-application', fixture, '--json'])));
assert.equal(cliApplication.operation, 'analyze_javascript_application');
const graph = cliApplication.normalized_result.graph;
assert(graph.nodes.length > 0 && graph.edges.length > 0);
assert(JSON.stringify(graph).includes('main.js') && JSON.stringify(graph).includes('helper.js'));
const cliSqlite = parseEvidence(JSON.parse(await runCli('cli-sqlite', ['inspect-sqlite-database', dbPath, '--table', 'messages', '--row-limit', '2', '--json'])));
assert.equal(cliSqlite.normalized_result.rows.returned_rows, 2);

const transport = new StdioClientTransport({
  command: process.execPath, args: [join(source, 'scripts/rea.mjs'), 'mcp'],
  cwd: source, env: environment, stderr: 'pipe',
});
let serverStderr = '';
transport.stderr?.on('data', chunk => { serverStderr += chunk.toString(); });
const client = new Client({ name: 'rea-local-recovery-verifier', version: '1.0.0' });
const result = {
  node: process.version, reviewed_commit: '96e7c22a9cc917448ed080e11cde4dacd2a2d70a',
  source, offline_dependency_install: true, source_build: true, cli_help: true,
  local_patches: JSON.parse(await readFile(join(logs, 'applied-patches.json'), 'utf8')).map(patch => patch.id),
  cli_static_javascript: { evidence_id: cliApplication.evidence_id, nodes: graph.nodes.length, edges: graph.edges.length, target_executed: false },
  cli_sqlite: { evidence_id: cliSqlite.evidence_id, rows: cliSqlite.normalized_result.rows.returned_rows },
};
try {
  await client.connect(transport);
  const tools = [];
  let cursor;
  do { const page = await client.listTools(cursor ? { cursor } : {}); tools.push(...page.tools); cursor = page.nextCursor; } while (cursor);
  assert(tools.some(tool => tool.name === 'analyze_javascript_application'));
  assert(tools.some(tool => tool.name === 'inspect_sqlite_database'));
  result.mcp_advertised_tools = tools.length;
  const status = await client.callTool({ name: 'binary_session', arguments: {} });
  await writeFile(join(logs, 'mcp-session-status.json'), JSON.stringify(status, null, 2));
  assert(!status.isError, JSON.stringify(status.content));
  result.mcp_session_status = true;
  const appReply = await client.callTool({ name: 'analyze_javascript_application', arguments: { input_path: fixture } });
  await writeFile(join(logs, 'mcp-javascript.json'), JSON.stringify(appReply, null, 2));
  assert(!appReply.isError, JSON.stringify(appReply.content));
  const mcpApplication = parseEvidence(appReply.structuredContent);
  assert.equal(mcpApplication.normalized_result.graph.nodes.length, graph.nodes.length);
  assert.equal(mcpApplication.normalized_result.graph.edges.length, graph.edges.length);
  result.mcp_static_javascript = { evidence_id: mcpApplication.evidence_id, graph_matches_cli: true };
  const sqliteReply = await client.callTool({ name: 'inspect_sqlite_database', arguments: { path: dbPath, table: 'messages', row_limit: 2 } });
  await writeFile(join(logs, 'mcp-sqlite.json'), JSON.stringify(sqliteReply, null, 2));
  assert(!sqliteReply.isError, JSON.stringify(sqliteReply.content));
  const mcpSqlite = parseEvidence(sqliteReply.structuredContent);
  assert.equal(mcpSqlite.normalized_result.rows.returned_rows, 2);
  result.mcp_sqlite = { evidence_id: mcpSqlite.evidence_id, rows: 2 };
  const bundle = await client.callTool({ name: 'get_evidence_bundle', arguments: {} });
  await writeFile(join(logs, 'mcp-evidence-bundle.json'), JSON.stringify(bundle, null, 2));
  assert(!bundle.isError, JSON.stringify(bundle.content));
  result.mcp_evidence_bundle = true;
} finally {
  await client.close();
  await transport.close();
  await writeFile(join(logs, 'mcp-server.stderr'), serverStderr);
}
try {
  const frida = await import(pathToFileURL(localRequire.resolve('frida')).href);
  result.frida_binding_import = typeof frida.getLocalDevice === 'function';
} catch (cause) { result.frida_binding_import = false; result.frida_import_error = String(cause); }
result.passed = true;
await writeFile(join(logs, 'result.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
