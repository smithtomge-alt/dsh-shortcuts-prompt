/**
 * Host-half tests: durability-independent CRUD over a Map-backed stand-in for
 * the storage domain, plus the invariants the Remote contract depends on.
 *
 * Run with `npm test` (node --test). No dependencies, no Harness boot.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { base } from '../lib/service.js';

/** Minimal Cordis Service stand-in: the factory only calls super(ctx, name). */
class Service {
  constructor(ctx, name) {
    this.ctx = ctx;
    this.name = name;
  }
}

/** A zod-shaped builder good enough for the schemas this package declares. */
function fakeZod() {
  const make = (check) => ({
    check,
    min() { return this; },
    max() { return this; },
    int() { return this; },
    optional() {
      return { ...this, check: (value) => value === undefined || check(value) };
    },
  });
  const string = () => make((value) => typeof value === 'string');
  const number = () => make((value) => typeof value === 'number');
  const array = (item) => make((value) => Array.isArray(value) && value.every((entry) => item.check(entry)));
  const object = (shape) => make((value) => value !== null && typeof value === 'object'
    && Object.entries(shape).every(([key, schema]) => schema.check(value[key])));
  const enumeration = (values) => make((value) => values.includes(value));
  return { string, number, array, object, enum: enumeration };
}

/**
 * Build one service over a Map-backed domain.
 * @returns {{service: any, rows: Map<string, object>, built: object}} the fixture.
 */
function fixture() {
  const rows = new Map();
  const handle = {
    table: () => ({
      entries: () => rows.entries(),
      get: (key) => rows.get(key),
      put: async (key, value) => { rows.set(key, value); },
      delete: async (key) => rows.delete(key),
    }),
    close: async () => {},
  };
  const domain = { defineDomain: (spec) => spec, domainTable: () => ({}) };
  const ctx = { get: (name) => (name === 'storageDomain' ? { open: async () => handle } : undefined) };
  const built = base({ Service, domain, zod: fakeZod() });
  return { service: new built.Service(ctx), rows, built };
}

/** Remote method names the Client Gateway's namespace service already owns. */
const RESERVED = new Set([
  'ctx', 'empty', 'invokeRemote', 'methods', 'name', 'namespace',
  'assertMethodAvailable', 'has', 'install', 'installDirect', 'installScoped', 'remove',
]);

test('starts with no instructions', async () => {
  const { service } = fixture();
  await service.start();
  assert.deepEqual(service.list(), { instructions: [] });
});

test('descriptors are wire-safe and complete', () => {
  const { built } = fixture();
  assert.deepEqual(built.descriptors.map((d) => d.method), ['list', 'create', 'update', 'delete', 'move']);
  for (const descriptor of built.descriptors) {
    assert.equal(descriptor.namespace, 'quickPrompts');
    assert.equal(descriptor.service, 'quickPrompts', 'the Host service key the Gateway dispatches to');
    assert.equal(descriptor.invocation.kind, 'direct');
    assert.ok(!RESERVED.has(descriptor.method), `${descriptor.method} collides with the namespace service`);
    assert.equal(descriptor.id, `dsh-shortcuts-prompt#quickPrompts/${descriptor.method}`);
    assert.equal(descriptor.result.mode, 'strict');
    assert.equal(typeof descriptor.result.create, 'function');
    for (const parameter of descriptor.parameters) {
      assert.equal(parameter.source, 'json');
      assert.equal(parameter.codec.mode, 'strict');
      assert.equal(parameter.strictCodec.mode, 'strict');
      assert.equal(typeof parameter.wire, 'string');
    }
  }
});

test('create trims the body and stores the required name', async () => {
  const { service } = fixture();
  await service.start();
  const { instructions } = await service.create('  代码审查  ', '  第一行\n第二行  ');
  assert.equal(instructions.length, 1);
  assert.equal(instructions[0].name, '代码审查');
  assert.equal(instructions[0].content, '第一行\n第二行');
  assert.equal(instructions[0].position, 0);
});

test('create and update reject a blank name without touching stored data', async () => {
  const { service, rows } = fixture();
  await service.start();
  const { instructions } = await service.create('名称', '内容');
  const id = instructions[0].id;

  await assert.rejects(() => service.create('', 'body'), /Name is required\./);
  await assert.rejects(() => service.create('   ', 'body'), /Name is required\./);
  await assert.rejects(() => service.update(id, '', 'body'), /Name is required\./);

  assert.equal(rows.size, 1);
  assert.equal(rows.get(id).name, '名称');
  assert.equal(rows.get(id).content, '内容');
});

test('content is required and trimmed', async () => {
  const { service } = fixture();
  await service.start();
  await assert.rejects(() => service.create('名称', ''), /content is required/i);
  await assert.rejects(() => service.create('名称', '   '), /content is required/i);
});

test('create appends in order; move swaps neighbours and renumbers densely', async () => {
  const { service } = fixture();
  await service.start();
  await service.create('A', 'a');
  await service.create('B', 'b');
  await service.create('C', 'c');

  let { instructions } = await service.move((await service.list()).instructions[2].id, 'up');
  assert.deepEqual(instructions.map((item) => item.name), ['A', 'C', 'B']);
  assert.deepEqual(instructions.map((item) => item.position), [0, 1, 2]);

  const second = (await service.list()).instructions[1].id;
  ({ instructions } = await service.move(second, 'up'));
  assert.deepEqual(instructions.map((item) => item.name), ['C', 'A', 'B']);
  assert.deepEqual(instructions.map((item) => item.position), [0, 1, 2]);
});

test('move at either end is a no-op', async () => {
  const { service } = fixture();
  await service.start();
  await service.create('A', 'a');
  await service.create('B', 'b');
  const before = (await service.list()).instructions.map((item) => item.id);
  const atTop = await service.move(before[0], 'up');
  const atBottom = await service.move(before[1], 'down');
  assert.deepEqual(atTop.instructions.map((item) => item.id), before);
  assert.deepEqual(atBottom.instructions.map((item) => item.id), before);
});

test('update edits in place and keeps the position', async () => {
  const { service } = fixture();
  await service.start();
  await service.create('A', 'a');
  await service.create('B', 'b');
  const id = (await service.list()).instructions[1].id;
  const { instructions } = await service.update(id, 'B2', 'b2');
  assert.deepEqual(instructions.map((item) => item.name), ['A', 'B2']);
  assert.equal(instructions[1].position, 1);
});

test('delete removes the row and closes the gap', async () => {
  const { service, rows } = fixture();
  await service.start();
  await service.create('A', 'a');
  await service.create('B', 'b');
  await service.create('C', 'c');
  const middle = (await service.list()).instructions[1].id;
  const { instructions } = await service.delete(middle);
  assert.deepEqual(instructions.map((item) => item.name), ['A', 'C']);
  assert.deepEqual(instructions.map((item) => item.position), [0, 1]);
  assert.equal(rows.has(middle), false);
});

test('addressing a missing instruction reports it', async () => {
  const { service } = fixture();
  await service.start();
  await assert.rejects(() => service.update('missing', 'n', 'c'), /no longer exists/);
  await assert.rejects(() => service.delete('missing'), /no longer exists/);
  await assert.rejects(() => service.move('missing', 'up'), /no longer exists/);
});

test('a storage outage is reported in the list instead of thrown', async () => {
  const built = base({ Service, domain: { defineDomain: (spec) => spec, domainTable: () => ({}) }, zod: fakeZod() });
  const service = new built.Service({ get: () => undefined });
  await service.start();
  const listed = service.list();
  assert.deepEqual(listed.instructions, []);
  assert.match(listed.error, /Storage is unavailable/);
  await assert.rejects(() => service.create('n', 'c'), /Storage is unavailable/);
});
