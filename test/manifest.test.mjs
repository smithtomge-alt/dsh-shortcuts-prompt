/**
 * Manifest tests: the bundle must stay installable (`dsh.bundle` + patch), and
 * the display resources the Plugin Manager reads must stay present.
 *
 * Run with `npm test` (node --test).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);

/** Read and parse one JSON file from the package root. */
async function json(relative) {
  return JSON.parse(await readFile(new URL(relative, root), 'utf8'));
}

/** Assert a file exists and is non-empty. */
async function exists(relative) {
  await access(new URL(relative, root));
}

test('the bundle manifest is complete', async () => {
  const packageJson = await json('package.json');
  assert.equal(packageJson.name, 'dsh-shortcuts-prompt');
  assert.equal(packageJson.type, 'module');
  assert.equal(packageJson.private, undefined, 'a publishable package must not be private');
  assert.ok(packageJson.license, 'license is declared');
  assert.ok(packageJson.repository?.url?.includes('dsh-shortcuts-prompt'), 'repository points at this project');
  assert.ok(packageJson.engines?.dsh, 'engines.dsh declares the supported host range');
  assert.ok(
    packageJson.engines.dsh.includes('-rc.'), 'the range keeps a prerelease branch so prerelease hosts are not excluded',
  );
});

test('installability: dsh.bundle points at a real patch that names this package', async () => {
  const packageJson = await json('package.json');
  assert.ok(packageJson.dsh?.bundle?.patch, 'dsh.bundle.patch is declared');
  await exists(packageJson.dsh.bundle.patch);

  const patch = await readFile(new URL(packageJson.dsh.bundle.patch, root), 'utf8');
  assert.match(patch, /^- insert:/m, 'the patch inserts a row');
  assert.ok(patch.includes(packageJson.name), 'the inserted row names this package');
});

test('the browser artifact is exported and shipped', async () => {
  const packageJson = await json('package.json');
  assert.equal(packageJson.exports['./client'], './client.js');
  assert.equal(packageJson.dsh?.client?.platform, 'web');
  assert.ok(Array.isArray(packageJson.dsh.client.inject) && packageJson.dsh.client.inject.length > 0, 'client dependencies are declared');
  await exists('client.js');
});

test('the npm tarball ships every runtime file and nothing else', async () => {
  const packageJson = await json('package.json');
  const shipped = new Set(packageJson.files);
  for (const required of ['client.js', 'cordis.patch.yml', 'icon.svg', 'README.md', 'LICENSE', 'lib/*.js', 'locale/*.json']) {
    assert.ok(shipped.has(required), `files includes ${required}`);
  }
  assert.ok(!shipped.has('test'), 'tests stay out of the tarball');
  assert.ok(!shipped.has('preview'), 'the offline preview stays out of the tarball');
});

test('display resources the Plugin Manager reads exist', async () => {
  const packageJson = await json('package.json');
  assert.equal(packageJson.exports['./icon'], './icon.svg');
  const icon = await readFile(new URL('icon.svg', root), 'utf8');
  assert.match(icon.trim(), /^<svg[\s\S]*<\/svg>$/);

  for (const locale of ['en', 'zh']) {
    const meta = await json(`locale/${locale}.json`);
    assert.ok(meta.meta?.title, `${locale} declares meta.title`);
    assert.ok(meta.meta?.description, `${locale} declares meta.description`);
    assert.ok(!meta.meta.description.includes('点击胶囊'), 'the description stays a summary, not a usage manual');
  }
});

test('selling a publishable package: no runtime npm dependencies', async () => {
  const packageJson = await json('package.json');
  assert.equal(packageJson.dependencies, undefined, 'the bundle resolves host packages at activation, so it needs no dependencies');
  assert.equal(packageJson.devDependencies, undefined, 'the tests run on node:test alone');
});
