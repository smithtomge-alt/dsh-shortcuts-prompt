/**
 * Client-contract tests: load the shipped `client.js` bundle exactly the way the
 * browser module table does, activate it against a stub Cordis context, and
 * check the Remote contribution against the rules the real API Gateway and
 * Typert registry enforce before they install a namespace.
 *
 * These are the rules that broke installation twice:
 *   1. the contribution must expose `descriptors` (an array), and
 *   2. every descriptor must carry a Host `service` key, and
 *   3. no method may collide with the namespace service's own members.
 *
 * Run with `npm test` (node --test). No browser, no Harness boot.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

/** Members `RemoteNamespaceService` already owns (gateway client). */
const RESERVED_METHODS = new Set([
  'ctx', 'empty', 'invokeRemote', 'methods', 'name', 'namespace',
  'assertMethodAvailable', 'has', 'install', 'installDirect', 'installScoped', 'remove',
]);

/** Wire-endpoint segment grammar enforced by the Typert registry. */
const WIRE_NAME = /^[A-Za-z0-9_$.-]+$/;

/** Minimal React surface: activation registers a component but never renders. */
const reactStub = {
  createElement: () => null,
  Fragment: Symbol('Fragment'),
  useState: (value) => [typeof value === 'function' ? value() : value, () => {}],
  useEffect: () => {},
  useRef: (value) => ({ current: value }),
  useCallback: (fn) => fn,
  useMemo: (fn) => fn(),
};

/** A DOM stub: activation inserts one <style> element, and never renders. */
const documentStub = {
  createElement: () => ({ dataset: {}, remove() {}, textContent: '' }),
  head: { appendChild() {} },
};

/**
 * Load `client.js` and return the module-table entry it registers.
 * @returns {Promise<{entry: any, packageName: string}>} the bundle entry.
 */
async function loadBundle() {
  const source = await readFile(new URL('../client.js', import.meta.url), 'utf8');
  const previous = globalThis.__ModuleLoader__;
  let entry;
  globalThis.__ModuleLoader__ = {
    load(definition) {
      entry = definition.factory((id) => {
        if (id === 'react') return reactStub;
        throw new Error(`client bundle requires an unexpected module: ${id}`);
      });
    },
  };
  try {
    // A classic script in the browser; Function keeps it out of module scope.
    new Function(source)();
  } finally {
    globalThis.__ModuleLoader__ = previous;
  }
  assert.ok(entry, 'client.js registered a module-table entry');
  const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  return { entry, packageName: packageJson.name };
}

/**
 * Activate the bundle against a stub context and capture its contribution.
 * @param {any} entry - the module-table entry.
 * @returns {Promise<{contribution: any, registered: object, bundles: string[]}>}
 */
async function activate(entry) {
  const previousDocument = globalThis.document;
  globalThis.document = documentStub;
  const registered = { slots: [], locales: [] };
  let contribution;
  const effects = [];
  const ctx = {
    effect(callback) {
      const dispose = callback();
      effects.push(dispose);
      return typeof dispose === 'function' ? dispose : () => {};
    },
    locale: {
      register: (namespace) => { registered.locales.push(namespace); return () => {}; },
      subscribe: () => () => {},
      bind: () => (key) => key,
    },
    slots: {
      inject: (key, callback) => { registered.slots.push(key); callback(); return () => {}; },
      register: (options) => { registered.slots.push(`${options.name}#${options.id}`); return () => {}; },
    },
    remote: {
      async $mount(value) { contribution = value; return async () => {}; },
    },
    get: () => undefined,
  };
  try {
    await entry.apply(ctx);
  } finally {
    globalThis.document = previousDocument;
  }
  return { contribution, registered };
}

/** Validate one descriptor the way the gateway and registry do. */
function assertDescriptor(descriptor) {
  assert.equal(typeof descriptor.id, 'string');
  assert.ok(descriptor.id.length > 0, 'invocation id is non-empty');
  assert.equal(typeof descriptor.service, 'string', 'Host service key is required');
  assert.ok(descriptor.service.length > 0 && !descriptor.service.includes('#'));
  assert.match(descriptor.namespace, WIRE_NAME);
  assert.match(descriptor.method, WIRE_NAME);
  assert.ok(!RESERVED_METHODS.has(descriptor.method), `${descriptor.method} collides with the namespace service`);
  assert.equal(descriptor.invocation.kind, 'direct');

  const checkCodec = (codec, subject) => {
    assert.equal(codec.mode, 'strict', `${subject} is a strict codec`);
    assert.equal(typeof codec.typeSymbol, 'string');
    assert.ok(codec.typeSymbol.length > 0, `${subject} has a type symbol`);
    assert.equal(typeof codec.create, 'function', `${subject} has a create() factory`);
  };
  checkCodec(descriptor.result, `${descriptor.id} result`);

  const wires = new Set();
  for (const parameter of descriptor.parameters) {
    assert.match(parameter.name, WIRE_NAME);
    assert.match(parameter.wire, WIRE_NAME);
    assert.ok(!wires.has(parameter.wire), `${descriptor.id} repeats wire ${parameter.wire}`);
    wires.add(parameter.wire);
    checkCodec(parameter.codec, `${descriptor.id} parameter ${parameter.name}`);
  }
}

test('the bundle registers itself under the package name', async () => {
  const source = await readFile(new URL('../client.js', import.meta.url), 'utf8');
  const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  const id = source.match(/__ModuleLoader__\.load\(\{\s*id:\s*'([^']+)'/)?.[1];
  assert.equal(id, packageJson.name);
});

test('activation mounts a well-formed contribution', async () => {
  const { entry, packageName } = await loadBundle();
  const { contribution, registered } = await activate(entry);
  assert.ok(contribution, 'the bundle called ctx.remote.$mount');
  assert.equal(contribution.package, packageName);
  assert.ok(Array.isArray(contribution.descriptors), 'contribution.descriptors must be an array');

  const endpoints = contribution.descriptors.map((descriptor) => `${descriptor.namespace}/${descriptor.method}`);
  assert.deepEqual(endpoints, [
    'quickPrompts/list',
    'quickPrompts/create',
    'quickPrompts/update',
    'quickPrompts/delete',
    'quickPrompts/move',
  ]);
  for (const descriptor of contribution.descriptors) assertDescriptor(descriptor);

  const argumentWires = Object.fromEntries(contribution.descriptors.map((descriptor) => [
    descriptor.method,
    descriptor.parameters.map((parameter) => parameter.wire),
  ]));
  assert.deepEqual(argumentWires, {
    list: [],
    create: ['name', 'content'],
    update: ['id', 'name', 'content'],
    delete: ['id'],
    move: ['id', 'direction'],
  });
});

test('activation registers the inline entry above the composer', async () => {
  const { entry } = await loadBundle();
  const { registered } = await activate(entry);
  assert.ok(registered.slots.includes('conversation.input.dock'), 'injects into the slot above the composer card');
  assert.ok(registered.slots.includes('conversation.input.dock#quick-prompts'), 'registers this entry in that slot');
  assert.ok(registered.locales.includes('quick-prompts'), 'registers its locale namespace');
});

test('activation never rejects, even when the Remote mount fails', async () => {
  const { entry } = await loadBundle();
  let mounted = 0;
  const previousDocument = globalThis.document;
  const previousError = console.error;
  globalThis.document = documentStub;
  // The bundle reports the failed mount; keep the test output clean.
  console.error = () => {};
  const ctx = {
    effect: (callback) => { callback(); return () => {}; },
    locale: { register: () => () => {}, subscribe: () => () => {}, bind: () => (key) => key },
    slots: { inject: () => () => {}, register: () => () => {} },
    remote: { async $mount() { mounted += 1; throw new Error('boom'); } },
    get: () => undefined,
  };
  // web boot aborts any entry that rejects, so this must resolve.
  try {
    await entry.apply(ctx);
  } finally {
    globalThis.document = previousDocument;
    console.error = previousError;
  }
  assert.equal(mounted, 1);
});
