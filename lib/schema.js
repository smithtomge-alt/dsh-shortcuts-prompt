/**
 * Zod schemas for stored records and wire payloads.
 *
 * The schemas come from a `buildSchema(zod)` factory rather than a module-level
 * `import { z } from 'zod'`: a Host plugin installed into a profile resolves
 * that import from the profile's `node_modules`, which holds only the installed
 * bundles. The activation module hands in the running install's `zod` instead,
 * keeping these declarations dependency-free at load time.
 */

/** Upper bounds; mirror the Client's own validation for a fast local error. */
export const LIMITS = {
  /** Longest accepted display name. The name may still be empty. */
  name: 60,
  /** Longest accepted prompt body, in UTF-16 code units. */
  content: 20000,
  /** Most instructions one profile may hold. */
  count: 500,
};

/**
 * Build every schema from one `zod` instance.
 * @param {any} z - the zod namespace resolved from the running installation.
 * @returns {{
 *   instruction: any,
 *   instructionWire: any,
 *   listResult: any,
 *   listOnlyResult: any,
 * }} the schema set.
 */
export function buildSchema(z) {
  /**
   * One stored instruction. `position` is the user-visible order; `name` may be
   * empty because the chip falls back to a summary of the body.
   */
  const instruction = z.object({
    id: z.string().min(1).max(80),
    name: z.string().max(LIMITS.name),
    content: z.string().min(1).max(LIMITS.content),
    position: z.number().int().min(0),
    createdAt: z.number().int().min(0),
    updatedAt: z.number().int().min(0),
    schemaVersion: z.number().int().min(1),
  });

  /** Wire shape of one instruction (identical to the stored shape). */
  const instructionWire = z.object({
    id: z.string(),
    name: z.string(),
    content: z.string(),
    position: z.number().int(),
    createdAt: z.number().int(),
    updatedAt: z.number().int(),
    schemaVersion: z.number().int(),
  });

  return {
    instruction,
    instructionWire,
    /** Result of `list`: every instruction plus an optional storage failure. */
    listResult: z.object({
      instructions: z.array(instructionWire),
      /** Present only when the domain could not be opened. */
      error: z.string().optional(),
    }),
    /** Result of every mutating operation: the list after the change. */
    listOnlyResult: z.object({ instructions: z.array(instructionWire) }),
  };
}
