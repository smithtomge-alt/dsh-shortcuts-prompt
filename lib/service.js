/**
 * The durable 快捷指令 (quick prompts) service.
 *
 * `base(host)` builds the Service class at activation time from the running
 * installation's Cordis `Service` base and storage-domain helpers, so this
 * module loads without resolving any external package (see `index.js`).
 *
 * Storage is a `storageDomain` KV domain: records are schema-validated on open
 * and every write is durable before it resolves, so a rejected write leaves the
 * list untouched and the Client keeps its panel open with the error.
 */
import { LIMITS, buildSchema } from './schema.js';

/** Package name; also the Remote owner and the Client bundle id. */
const PACKAGE = 'dsh-quick-prompts';

/** Remote namespace, reached by the Client as `ctx.remote.quickPrompts`. */
const NAMESPACE = 'quickPrompts';



/** KV domain name; versioned independently of the record shape. */
const DOMAIN_NAME = 'quick_prompts';

/** Domain table holding every instruction record. */
const TABLE = 'instructions';

/**
 * Build a wire codec for one parameter or result type.
 * @param {string} typeSymbol - schema identity exposed to generated clients.
 * @param {any} schema - runtime validator.
 * @returns {{mode: 'strict', typeSymbol: string, create: () => any}} the codec.
 */
function codec(typeSymbol, schema) {
  return { mode: 'strict', typeSymbol, create: () => schema };
}

/**
 * Describe one Remote parameter.
 * @param {string} name - wire name.
 * @param {string} typeSymbol - schema identity.
 * @param {any} schema - value validator.
 * @returns {object} the parameter descriptor.
 */
function parameter(name, typeSymbol, schema) {
  return {
    name,
    wire: name,
    description: name,
    source: 'json',
    codec: codec(typeSymbol, schema),
    strictCodec: codec(typeSymbol, schema),
  };
}

/**
 * Declare the Remote descriptors for `ctx.typert.register`.
 * @param {any} z - the zod namespace resolved at activation.
 * @param {ReturnType<typeof buildSchema>} schemas - wire schemas.
 * @returns {object[]} descriptors in method order.
 */
function describeMethods(z, schemas) {
  const zName = z.string().min(1).max(LIMITS.name);
  const zContent = z.string().min(1).max(LIMITS.content);
  const zId = z.string().min(1);
  const zDirection = z.enum(['up', 'down']);
  const make = (method, parameters, resultSchema) => ({
    id: `${PACKAGE}#${NAMESPACE}/${method}`,
    namespace: NAMESPACE,
    service: NAMESPACE,
    method,
    invocation: { kind: 'direct' },
    parameters,
    result: codec(`quickPrompts.${method}.result`, resultSchema),
  });
  return [
    make('list', [], schemas.listResult),
    make('create', [parameter('name', 'quickPrompts.name', zName), parameter('content', 'quickPrompts.content', zContent)], schemas.listOnlyResult),
    make('update', [parameter('id', 'quickPrompts.id', zId), parameter('name', 'quickPrompts.name', zName), parameter('content', 'quickPrompts.content', zContent)], schemas.listOnlyResult),
    // NOT `remove`: the Client Gateway's namespace service owns a `remove`
    // method, so a Remote method with that name fails to mount.
    make('delete', [parameter('id', 'quickPrompts.id', zId)], schemas.listOnlyResult),
    make('move', [parameter('id', 'quickPrompts.id', zId), parameter('direction', 'quickPrompts.direction', zDirection)], schemas.listOnlyResult),
  ];
}

/**
 * Validate a typed display name. The name is required, matching the form.
 * @param {unknown} raw - name as typed.
 * @returns {string} the trimmed name, capped at the stored limit.
 * @throws {Error} with a user-facing reason when the name is blank.
 */
function normalizeName(raw) {
  if (typeof raw !== 'string' || raw.trim() === '') {
    throw new Error('Name is required.');
  }
  return raw.trim().slice(0, LIMITS.name);
}

/**
 * Validate a prompt body.
 * @param {unknown} raw - body as typed.
 * @returns {string} the accepted body, trimmed at both ends.
 * @throws {Error} with a user-facing reason when it is missing or too long.
 */
function normalizeContent(raw) {
  if (typeof raw !== 'string' || raw.trim() === '') {
    throw new Error('Prompt content is required.');
  }
  if (raw.length > LIMITS.content) {
    throw new Error(`Prompt content is longer than ${LIMITS.content} characters.`);
  }
  return raw.trim();
}

/**
 * Sort records by stored position, breaking ties by creation time.
 * @param {ReadonlyArray<object>} records - stored instructions.
 * @returns {object[]} a new sorted array.
 */
function ordered(records) {
  return [...records].sort(
    (left, right) => left.position - right.position || left.createdAt - right.createdAt,
  );
}

/**
 * Assign dense 0..n-1 positions to a display order.
 * @param {ReadonlyArray<object>} records - records in display order.
 * @returns {object[]} copies carrying the rewritten positions.
 */
function renumber(records) {
  return records.map((record, index) => ({ ...record, position: index }));
}

/**
 * Mint an id that is unique enough without a UUID service.
 * @param {number} timestamp - creation time used as the sortable prefix.
 * @returns {string} an opaque id.
 */
function makeId(timestamp) {
  const random = Math.random().toString(36).slice(2, 10);
  return `qp-${timestamp.toString(36)}-${random}`;
}

/**
 * Turn any thrown value into text a form can display.
 * @param {unknown} error - thrown value.
 * @returns {string} a non-empty reason.
 */
function reasonOf(error) {
  if (error instanceof Error && error.message !== '') return error.message;
  const text = String(error);
  return text === '' || text === 'undefined' ? 'Unknown failure.' : text;
}

/**
 * Build the Host service class.
 *
 * A Cordis Service — not a bare object — because the Typert Gateway reaches a
 * Remote namespace only through a Service whose `typertRemote` binding matches
 * the requested package and namespace.
 *
 * @param {{
 *   Service: new (ctx: any, name: string) => any,
 *   domain: { defineDomain: Function, domainTable: Function },
 *   zod: any,
 * }} host - the resolved Harness pieces.
 * @returns {{Service: new (ctx: any) => any, descriptors: object[]}} the class
 *   and the descriptors to register.
 */
export function base(host) {
  const schemas = buildSchema(host.zod);
  const descriptors = describeMethods(host.zod, schemas);
  const spec = host.domain.defineDomain({
    name: DOMAIN_NAME,
    version: 1,
    layout: 'per-record',
    tables: { [TABLE]: host.domain.domainTable(schemas.instruction) },
  });

  /** Service holding the instruction list. */
  class QuickPromptsService extends host.Service {
    /**
     * @param {any} ctx - plugin context.
     */
    constructor(ctx) {
      super(ctx, NAMESPACE);
      this.handle = undefined;
      this.openFailure = undefined;
    }

    /**
     * Start the first domain open without throwing during activation.
     * @returns {Promise<void>} resolves once the open settles either way.
     */
    start() {
      return this.ensureDomain().then(() => undefined, () => undefined);
    }

    /**
     * Release the domain handle; called by the plugin's effect disposer.
     * @returns {Promise<void>} resolves once closed.
     */
    async dispose() {
      const open = this.handle;
      this.handle = undefined;
      if (open !== undefined) await open.close().catch(() => {});
    }

    /**
     * Open the durable domain once; a failure is remembered for `list`.
     * @returns {Promise<any | undefined>} the open handle, or undefined.
     */
    async ensureDomain() {
      if (this.handle !== undefined) return this.handle;
      if (this.openFailure !== undefined) return undefined;
      const facility = this.ctx.get('storageDomain');
      if (facility === undefined) {
        this.openFailure = 'Storage is unavailable in this Harness profile.';
        return undefined;
      }
      try {
        const opened = await facility.open(spec);
        this.handle = opened;
        return opened;
      } catch (error) {
        this.openFailure = reasonOf(error);
        return undefined;
      }
    }

    /**
     * Require an open domain, retrying a failed open.
     * @returns {Promise<any>} the open domain handle.
     * @throws {Error} when storage stays unavailable.
     */
    async requireDomain() {
      if (this.handle !== undefined) return this.handle;
      const opened = await this.ensureDomain();
      if (opened === undefined) throw new Error(this.openFailure ?? 'Storage is unavailable.');
      return opened;
    }

    /**
     * Read every record in display order.
     * @returns {object[]} sorted record copies.
     */
    readAll() {
      if (this.handle === undefined) return [];
      return ordered([...this.handle.table(TABLE).entries()].map(([, record]) => record));
    }

    /**
     * Rewrite every position in one durable pass.
     * @param {ReadonlyArray<object>} records - records in display order.
     * @returns {Promise<void>} resolves once every write is durable.
     */
    async persistOrder(records) {
      const table = this.handle.table(TABLE);
      await Promise.all(renumber(records).map((record) => table.put(record.id, record)));
    }

    /**
     * Read the list. A storage outage is returned, not thrown, so the composer
     * strip renders instead of crashing its slot entry.
     * @returns {object} `{ instructions, error? }`.
     */
    list() {
      if (this.handle === undefined) {
        if (this.openFailure === undefined) void this.ensureDomain();
        return this.openFailure === undefined
          ? { instructions: [] }
          : { instructions: [], error: this.openFailure };
      }
      return { instructions: this.readAll() };
    }

    /**
     * Append one instruction at the end of the list.
     * @param {string} name - optional display name.
     * @param {string} content - required prompt body.
     * @returns {Promise<object>} the updated list.
     */
    async create(name, content) {
      const opened = await this.requireDomain();
      const body = normalizeContent(content);
      const records = this.readAll();
      if (records.length >= LIMITS.count) {
        throw new Error(`Cannot hold more than ${LIMITS.count} quick prompts.`);
      }
      const timestamp = Date.now();
      const record = {
        id: makeId(timestamp),
        name: normalizeName(name),
        content: body,
        position: records.length,
        createdAt: timestamp,
        updatedAt: timestamp,
        schemaVersion: 1,
      };
      await opened.table(TABLE).put(record.id, record);
      return { instructions: this.readAll() };
    }

    /**
     * Replace one instruction's name and body, keeping its position.
     * @param {string} id - target instruction id.
     * @param {string} name - optional display name.
     * @param {string} content - required prompt body.
     * @returns {Promise<object>} the updated list.
     */
    async update(id, name, content) {
      const opened = await this.requireDomain();
      const table = opened.table(TABLE);
      const current = table.get(id);
      if (current === undefined) throw new Error('That quick prompt no longer exists.');
      const body = normalizeContent(content);
      await table.put(id, {
        ...current,
        name: normalizeName(name),
        content: body,
        updatedAt: Date.now(),
      });
      return { instructions: this.readAll() };
    }

    /**
     * Delete one instruction and close the gap in the order.
     *
     * Named `delete` on the wire: the Client Gateway's Remote namespace service
     * reserves the method name `remove` for its own bookkeeping.
     * @param {string} id - target instruction id.
     * @returns {Promise<object>} the updated list.
     */
    async delete(id) {
      const opened = await this.requireDomain();
      const table = opened.table(TABLE);
      if (table.get(id) === undefined) throw new Error('That quick prompt no longer exists.');
      await table.delete(id);
      await this.persistOrder(this.readAll());
      return { instructions: this.readAll() };
    }

    /**
     * Swap one instruction with its neighbour; either end is a no-op.
     * @param {string} id - target instruction id.
     * @param {'up' | 'down'} direction - which way to move it.
     * @returns {Promise<object>} the updated list.
     */
    async move(id, direction) {
      await this.requireDomain();
      const records = this.readAll();
      const index = records.findIndex((record) => record.id === id);
      if (index < 0) throw new Error('That quick prompt no longer exists.');
      const target = direction === 'up' ? index - 1 : index + 1;
      if (target < 0 || target >= records.length) return { instructions: records };
      const swapped = [...records];
      swapped[index] = records[target];
      swapped[target] = records[index];
      await this.persistOrder(swapped);
      return { instructions: this.readAll() };
    }
  }

  return { Service: QuickPromptsService, descriptors };
}
