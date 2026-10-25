import { DefinitionError, UsageError } from './errors'

export interface ArgumentDefinition {
  key: string
  name: string
  required: boolean
  variadic: boolean
}

/**
 * Positional arguments are declared as a pattern string such as `<source> [target] [...rest]`:
 *
 * - `<name>` required, `[name]` optional
 * - `<...name>` one or more, `[...name]` zero or more; only the last argument may be variadic
 * - kebab-case names become camelCase keys (`<report-path>` -> `reportPath`)
 */
export type InferArguments<TPattern extends string> = Prettify<ParsePattern<TPattern>>

type CamelCase<T extends string> = T extends `${infer Head}-${infer Tail}`
  ? `${Head}${Capitalize<CamelCase<Tail>>}`
  : T

type ParseArgument<T extends string>
  = T extends `<...${infer Name}>` ? { [K in CamelCase<Name>]: string[] }
    : T extends `[...${infer Name}]` ? { [K in CamelCase<Name>]: string[] }
      : T extends `<${infer Name}>` ? { [K in CamelCase<Name>]: string }
        : T extends `[${infer Name}]` ? { [K in CamelCase<Name>]?: string }
          : Record<never, never>

type ParsePattern<T extends string> = T extends `${infer Head} ${infer Tail}`
  ? ParseArgument<Head> & ParsePattern<Tail>
  : ParseArgument<T>

type Prettify<T> = { [K in keyof T]: T[K] } & {}

export function bindArguments(
  definitions: readonly ArgumentDefinition[],
  positionals: readonly string[],
): Record<string, string | string[] | undefined> {
  const values: Record<string, string | string[] | undefined> = {}
  let index = 0

  for (const definition of definitions) {
    if (definition.variadic) {
      const rest = positionals.slice(index)

      if (definition.required && rest.length === 0) {
        throw new UsageError(`missing required argument <...${definition.name}>`)
      }

      values[definition.key] = rest
      index = positionals.length
      continue
    }

    const value = positionals[index]

    if (value === undefined && definition.required) {
      throw new UsageError(`missing required argument <${definition.name}>`)
    }

    values[definition.key] = value
    index += 1
  }

  const unexpected = positionals[index]

  if (unexpected !== undefined) {
    throw new UsageError(`unexpected argument "${unexpected}"`)
  }

  return values
}

export function parseArgumentPattern(pattern: string | undefined): ArgumentDefinition[] {
  const parts = (pattern ?? '').split(/\s+/u).filter(Boolean)
  const definitions = parts.map((part) => {
    const match = /^(?:<(\.\.\.)?([\w-]+)>|\[(\.\.\.)?([\w-]+)\])$/u.exec(part)

    if (!match) {
      throw new DefinitionError(`Invalid argument "${part}" in pattern "${pattern}". Use <name>, [name], <...name>, or [...name].`)
    }

    const name = match[2] ?? match[4] ?? ''

    return {
      key: name.replace(/-(\w)/gu, (_, character: string) => character.toUpperCase()),
      name,
      required: match[2] !== undefined,
      variadic: (match[1] ?? match[3]) !== undefined,
    }
  })

  for (const [index, definition] of definitions.entries()) {
    if (definition.variadic && index !== definitions.length - 1) {
      throw new DefinitionError(`Variadic argument "${definition.name}" must be last in pattern "${pattern}".`)
    }

    // Binding is positional and greedy, so an optional argument before a required one could
    // never be left empty; reject the pattern instead of guessing which one the user skipped.
    if (definition.required && definitions.slice(0, index).some(previous => !previous.required)) {
      throw new DefinitionError(`Required argument "${definition.name}" cannot follow an optional argument in pattern "${pattern}".`)
    }
  }

  return definitions
}
