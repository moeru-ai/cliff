import type { StandardSchemaV1 } from '@standard-schema/spec'

import { UsageError } from './errors'

/**
 * Runs a flag's or argument's Standard Schema and returns its output.
 *
 * A failure is the user's mistake, not the program's, so it becomes a `UsageError` named after
 * what was typed: `flag --retries: Invalid integer` or `argument <port>: Invalid type`.
 */
export async function validateValue(schema: StandardSchemaV1 | undefined, value: unknown, label: string): Promise<unknown> {
  if (!schema) {
    return value
  }

  const result = await schema['~standard'].validate(value)

  if (result.issues) {
    throw new UsageError(`${label}: ${result.issues.map(issue => issue.message).join('; ')}`)
  }

  return result.value
}
