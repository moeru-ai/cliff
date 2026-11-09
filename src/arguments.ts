import type { StandardSchemaV1 } from '@standard-schema/spec'

import { createUsageError, DefinitionError } from './errors'

/**
 * One positional argument. Arguments bind to positionals in the order they are declared:
 *
 * - `required: true` must be given; otherwise the argument is optional
 * - `variadic: true` collects every remaining positional into `string[]`; only the last
 *   argument may be variadic
 *
 * The camelCase key comes from the name: `report-path` becomes `reportPath`.
 */
export interface ArgumentDefinition<TName extends string = string> {
  /** Used when the argument is absent. Passed through `schema` like a given value. */
  default?: unknown
  description: string
  name: TName
  required?: boolean
  /**
   * Any Standard Schema (Valibot, Zod, ArkType, ...). It receives the bound value (or the
   * default) and its output is what the action sees, e.g. `v.pipe(v.string(), v.toNumber())`.
   */
  schema?: StandardSchemaV1
  variadic?: boolean
}

export type ArgumentsDefinition = readonly ArgumentDefinition[]

// Mirrors `InferFlags`: `{}` for no arguments, and an open record when the definitions were
// widened (an erased `Command`), since nothing is known about their keys then.
export type InferArguments<T extends ArgumentsDefinition> = [T[number]] extends [never]
  ? Record<never, never>
  : string extends T[number]['name']
    ? Record<string, unknown>
    : { -readonly [TDefinition in T[number] as CamelCase<TDefinition['name']>]: ArgumentValue<TDefinition> }

/** One argument after its definition is checked. */
export interface ResolvedArgument {
  default?: unknown
  description: string
  key: string
  /** How help shows it: `<name>`, `[name]`, `<...name>`, or `[...name]`. */
  label: string
  name: string
  required: boolean
  schema?: StandardSchemaV1
  variadic: boolean
}

type ArgumentValue<TDefinition extends ArgumentDefinition>
  = TDefinition extends { schema: infer TSchema extends StandardSchemaV1 } ? StandardSchemaV1.InferOutput<TSchema>
    : TDefinition extends { variadic: true } ? string[]
      : TDefinition extends { required: true } ? string
        : TDefinition extends { default: unknown } ? string
          : string | undefined

type CamelCase<T extends string> = T extends `${infer Head}-${infer Tail}`
  ? `${Head}${Capitalize<CamelCase<Tail>>}`
  : T

export function bindArguments(
  definitions: readonly ResolvedArgument[],
  positionals: readonly string[],
): Record<string, unknown> {
  const values: Record<string, unknown> = {}
  let index = 0

  for (const definition of definitions) {
    if (definition.variadic) {
      const rest = positionals.slice(index)

      if (definition.required && rest.length === 0) {
        throw createUsageError({ argument: definition.label, code: 'missing-argument' })
      }

      values[definition.key] = rest.length > 0 ? rest : defaultValueOf(definition)
      index = positionals.length
      continue
    }

    const value = positionals[index]

    if (value === undefined && definition.required) {
      throw createUsageError({ argument: definition.label, code: 'missing-argument' })
    }

    values[definition.key] = value ?? defaultValueOf(definition)
    index += 1
  }

  const unexpected = positionals[index]

  if (unexpected !== undefined) {
    throw createUsageError({ code: 'unexpected-argument', received: unexpected })
  }

  return values
}

/** How usage lines and help show an argument: `<name>`, `[name]`, `<...name>`, or `[...name]`. */
export function formatArgument(definition: ArgumentDefinition): string {
  const name = definition.variadic ? `...${definition.name}` : definition.name

  return definition.required ? `<${name}>` : `[${name}]`
}

/** Checks the order and names of one command's arguments, throwing `DefinitionError`. */
export function resolveArguments(definitions: ArgumentsDefinition, owner: string): ResolvedArgument[] {
  const resolved = definitions.map((definition) => {
    if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/iu.test(definition.name)) {
      throw new DefinitionError(`argument "${definition.name}" of ${owner} is not a valid name. Use letters, digits, and single dashes, such as "report-path".`)
    }

    return {
      default: definition.default,
      description: definition.description,
      key: definition.name.replace(/-(\w)/gu, (_, character: string) => character.toUpperCase()),
      label: formatArgument(definition),
      name: definition.name,
      required: definition.required === true,
      schema: definition.schema,
      variadic: definition.variadic === true,
    }
  })

  for (const [index, argument] of resolved.entries()) {
    const label = `argument ${argument.label} of ${owner}`
    const previous = resolved.slice(0, index)

    if (argument.variadic && index !== resolved.length - 1) {
      throw new DefinitionError(`${label} is variadic, so it must be last.`)
    }

    // Binding is positional and greedy, so an optional argument before a required one could
    // never be left empty; reject the order instead of guessing which one the user skipped.
    if (argument.required && previous.some(other => !other.required)) {
      throw new DefinitionError(`${label} is required, so it cannot follow an optional argument.`)
    }

    if (argument.required && argument.default !== undefined) {
      throw new DefinitionError(`${label} is required, so its default could never be used.`)
    }

    const clash = previous.find(other => other.key === argument.key)

    if (clash) {
      throw new DefinitionError(`${label} clashes with argument ${clash.label}.`)
    }
  }

  return resolved
}

function defaultValueOf(argument: ResolvedArgument): unknown {
  if (argument.default !== undefined) {
    return Array.isArray(argument.default) ? [...argument.default] : argument.default
  }

  return argument.variadic ? [] : undefined
}
