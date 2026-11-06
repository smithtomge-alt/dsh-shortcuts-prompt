/**
 * Host half of the 快捷指令 (quick prompts) plugin.
 *
 * `service.js` owns the durable list and the Remote methods; this module is the
 * activation surface: it mounts the Service and exposes one model-facing tool
 * over the same methods, so the UI and the agent share one implementation.
 *
 * A Host plugin installed into a profile must not import another package:
 * profile `node_modules` holds only the installed bundles, while DSH's own
 * packages stay inside the application. So the Cordis base class and the domain
 * helpers are resolved through `createRequire` against the running installation
 * and handed to `base()` in `service.js` at activation time.
 *
 * @module dsh-shortcuts-prompt
 */
import { createRequire } from 'node:module';
import { base } from './service.js';

/**
 * Service keys the composition must provide before this plugin mounts.
 * Cordis keeps waiting until the keys resolve, so the row stays `pending`
 * instead of failing when a dependency activates later.
 */
export const inject = ['tools', 'storageDomain', 'typert'];

/** Tool name the model sees. */
const TOOL_NAME = 'quick_prompts';

/**
 * Resolve one DSH package through the running installation's module graph.
 * @param {string} name - package specifier.
 * @returns {any} the resolved module namespace.
 */
function loadHostPackage(name) {
  const anchors = [import.meta.url, process.argv[1]];
  for (const anchor of anchors) {
    if (anchor === undefined) continue;
    try {
      return createRequire(anchor)(name);
    } catch (_error) {
      // The CLI entry sits beside the installed packages; try the next anchor.
    }
  }
  throw new Error(
    `quick-prompts: cannot resolve ${name}; this plugin must run inside the Harness install that ships it`,
  );
}

/**
 * Require an id for the operations that address one record.
 * @param {unknown} id - provided id.
 * @returns {string} the id.
 * @throws {Error} when the id is missing.
 */
function checkId(id) {
  if (typeof id !== 'string' || id === '') throw new Error('This action needs an "id".');
  return id;
}

/**
 * Render one result as the text the model reads.
 * @param {any} value - the tool result.
 * @returns {string} a short readable listing.
 */
function summarize(value) {
  const instructions = Array.isArray(value?.instructions) ? value.instructions : [];
  if (value && typeof value.error === 'string' && instructions.length === 0) {
    return `Quick prompts unavailable: ${value.error}`;
  }
  if (instructions.length === 0) return 'No quick prompts saved.';
  const lines = instructions.map((item, index) => {
    const name = typeof item.name === 'string' && item.name !== '' ? item.name : `(unnamed ${item.id})`;
    const body = String(item.content ?? '').replace(/\s+/g, ' ').slice(0, 120);
    return `${index + 1}. ${name} [${item.id}] — ${body}`;
  });
  return `${instructions.length} quick prompt(s):\n${lines.join('\n')}`;
}

/**
 * Register the agent-facing tool over the Service methods.
 * @param {any} ctx - plugin context.
 * @param {any} service - the mounted Service.
 * @returns {() => void} the registration disposer.
 */
function installTool(ctx, service) {
  return ctx.tools.register({
    name: TOOL_NAME,
    description:
      'Manage the user\'s saved quick prompts (快捷指令) shown in a strip above the '
      + 'conversation composer. Call "list" to read them, "create" to add one, '
      + '"update" to edit one, "delete" to remove one, "move" to reorder one. '
      + 'Both a name and the prompt body are required. '
      + 'This is the same data the user edits in the strip\'s management panel.',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['list', 'create', 'update', 'delete', 'move'],
          description: 'Operation to perform.',
        },
        id: { type: 'string', description: 'Target instruction id; used by update/delete/move.' },
        name: { type: 'string', description: 'Display name; required by create/update.' },
        content: { type: 'string', description: 'Prompt body; required by create/update.' },
        direction: { type: 'string', enum: ['up', 'down'], description: 'Direction for move.' },
      },
      required: ['action'],
      additionalProperties: false,
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          instructions: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                name: { type: 'string' },
                content: { type: 'string' },
                position: { type: 'integer' },
                createdAt: { type: 'integer' },
                updatedAt: { type: 'integer' },
                schemaVersion: { type: 'integer' },
              },
            },
          },
          error: { type: 'string' },
        },
        required: ['instructions'],
      },
      render: (_args, value) => [{ type: 'text', text: summarize(value) }],
    },
    execute: async (input) => {
      const { action, id, name, content, direction } = input ?? {};
      switch (action) {
        case 'list':
          return service.list();
        case 'create':
          return service.create(name ?? '', content ?? '');
        case 'update':
          return service.update(checkId(id), name ?? '', content ?? '');
        case 'delete':
          return service.delete(checkId(id));
        case 'move':
          return service.move(checkId(id), direction === 'down' ? 'down' : 'up');
        default:
          throw new Error(`Unknown action "${String(action)}".`);
      }
    },
  });
}

/**
 * Activate the Host half.
 * @param {any} ctx - plugin context.
 */
export function apply(ctx) {
  // `TypertRemoteService` (not the bare Cordis Service) is what gives the
  // instance the `typertRemote` binding the Gateway validates before dispatch.
  // `zod` may be exposed as the namespace (`{ z }`) or as the `z` object itself,
  // depending on how the resolved entry exports it.
  const zodiac = loadHostPackage('zod');
  const built = base({
    Service: loadHostPackage('@deepseek-ai/dsh-typert-protocol').TypertRemoteService,
    domain: loadHostPackage('@deepseek-ai/dsh-storage-domain'),
    zod: zodiac.z ?? zodiac,
  });
  const service = new built.Service(ctx);
  // Registration belongs to activation, next to the Service that serves it.
  ctx.typert.register({
    package: 'dsh-shortcuts-prompt',
    face: 'host',
    schemas: [],
    model: { services: [], events: [], objects: [] },
    invocations: built.descriptors,
  });
  ctx.effect(() => () => service.dispose(), 'quick-prompts: close domain');
  ctx.effect(() => installTool(ctx, service), 'quick-prompts: agent tool');
  void service.start();
}
