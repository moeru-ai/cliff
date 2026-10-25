import type { StandardSchemaV1 } from '@standard-schema/spec'

import { DefinitionError, UsageError } from './errors'

/**
 * One flag, written the way help shows it:
 *
 * - `--dirty` boolean, `false` when absent
 * - `--no-cache` boolean named `cache`, `true` when absent
 * - `-c, --config <path>` string value, `undefined` when absent
 * - `--format <stylish|json>` one of the listed values
 * - `--rule <pattern...>` repeatable, collected into `string[]`
 *
 * The camelCase key comes from the long name: `--timeout-ms` becomes `timeoutMs`.
 */
export interface FlagDefinition<TFlag extends string = string> {
  /** Used when the flag is absent. Passed through `schema` like a parsed value. */
  default?: unknown
  description: string
  flag: TFlag
  /**
   * Any Standard Schema (Valibot, Zod, ArkType, ...). It receives the parsed value (or the
   * default) and its output is what the action sees, e.g. `v.pipe(v.string(), v.toNumber())`.
   */
  schema?: StandardSchemaV1
}

export type FlagsDefinition = readonly FlagDefinition[]

// A command without flags gets `{}` rather than a mapped type over `never`, which TypeScript
// turns into a `never` index signature. A non-literal `flag` means the definitions were widened
// (an erased `Command`, or an array built without `defineFlags`), so nothing is known about keys.
export type InferFlags<T extends FlagsDefinition> = [T[number]] extends [never]
  ? Record<never, never>
  : string extends T[number]['flag']
    ? Record<string, unknown>
    : { -readonly [TDefinition in T[number] as FlagKey<TDefinition['flag']>]: FlagValue<TDefinition> }

/** One flag after its spelling is parsed. */
export interface ResolvedFlag {
  choices?: readonly string[]
  default?: unknown
  description: string
  key: string
  /** Kebab-case long name without `--` or the `no-` prefix. */
  long: string
  multiple: boolean
  /** Declared as `--no-<long>`: a boolean that is `true` unless negated. */
  negated: boolean
  placeholder?: string
  schema?: StandardSchemaV1
  short?: string
  /** The flag as written, used verbatim in help. */
  spelling: string
  type: 'boolean' | 'string'
}

type CamelCase<T extends string> = T extends `${infer Head}-${infer Tail}`
  ? `${Head}${Capitalize<CamelCase<Tail>>}`
  : T

type FlagKey<T extends string> = CamelCase<LongName<T>>

type FlagValue<TDefinition extends FlagDefinition>
  = TDefinition extends { schema: infer TSchema extends StandardSchemaV1 } ? StandardSchemaV1.InferOutput<TSchema>
    : TDefinition extends { default: unknown } ? NonNullable<RawValue<Spelling<TDefinition['flag']>>>
      : RawValue<Spelling<TDefinition['flag']>>

type LongName<T extends string> = Spelling<T> extends `--no-${infer Name}` ? Name
  : Spelling<T> extends `--${infer Name} <${string}>` ? Name
    : Spelling<T> extends `--${infer Name}` ? Name
      : never

type RawValue<TLong extends string>
  = TLong extends `--${string} <${infer Placeholder}...>` ? Split<Placeholder>[]
    : TLong extends `--${string} <${infer Placeholder}>` ? Split<Placeholder> | undefined
      : boolean

/** The long part of the spelling, without the `-c, ` short prefix. */
type Spelling<T extends string> = T extends `-${string}, ${infer Long}` ? Long : T

/** `<stylish|json>` narrows the value to its alternatives; any other placeholder is a `string`. */
type Split<T extends string> = T extends `${string}|${string}` ? SplitChoices<T> : string

type SplitChoices<T extends string> = T extends `${infer Head}|${infer Tail}` ? Head | SplitChoices<Tail> : T

/**
 * Keeps flag spellings as literal types so a shared set can be spread into several commands:
 *
 * ```ts
 * export const configFlags = defineFlags([{ flag: '-c, --config <path>', description: 'Config file' }])
 * defineCommand({ name: 'lint', flags: [...configFlags, { flag: '--dirty', description: '...' }] })
 * ```
 */
export function defineFlags<const T extends FlagsDefinition>(flags: T): T {
  return flags
}

export function normalizeFlagValue(flag: ResolvedFlag, raw: unknown): unknown {
  // Parsers disagree on edge cases (cac casts numeric strings, meow reports an absent
  // repeatable flag as `[]`), so absence, arrays, and strings are normalized here once.
  if (raw === undefined || (Array.isArray(raw) && raw.length === 0)) {
    return defaultValueOf(flag)
  }

  const items = (Array.isArray(raw) ? raw : [raw]).map((item) => {
    if (flag.type === 'boolean') {
      return item === true || item === 'true'
    }

    const text = String(item)

    if (flag.choices && !flag.choices.includes(text)) {
      throw new UsageError(`flag --${flag.long} must be one of ${flag.choices.join(', ')}, received "${text}"`)
    }

    return text
  })

  return flag.multiple ? items : items.at(-1)
}

export function resolveFlag(definition: FlagDefinition, owner: string): ResolvedFlag {
  const match = /^(?:-([a-z]), )?--([a-z][a-z0-9]*(?:-[a-z0-9]+)*)(?: <([^<>]+)>)?$/iu.exec(definition.flag)

  if (!match) {
    throw new DefinitionError(`flag "${definition.flag}" of ${owner} is not a valid spelling. Use "--name", "--no-name", "-n, --name <value>", or "--name <value...>".`)
  }

  const [, short, name = '', rawPlaceholder] = match
  const negated = name.startsWith('no-')

  if (negated && rawPlaceholder !== undefined) {
    throw new DefinitionError(`flag "${definition.flag}" of ${owner} is negated, so it cannot take a value.`)
  }

  const multiple = rawPlaceholder?.endsWith('...') === true
  const placeholder = multiple ? rawPlaceholder!.slice(0, -3) : rawPlaceholder
  const long = negated ? name.slice(3) : name

  return {
    choices: placeholder?.includes('|') ? placeholder.split('|') : undefined,
    default: definition.default,
    description: definition.description,
    key: long.replace(/-(\w)/gu, (_, character: string) => character.toUpperCase()),
    long,
    multiple,
    negated,
    placeholder,
    schema: definition.schema,
    short,
    spelling: definition.flag,
    type: placeholder === undefined ? 'boolean' : 'string',
  }
}

export async function validateFlagValue(flag: ResolvedFlag, value: unknown): Promise<unknown> {
  if (!flag.schema) {
    return value
  }

  const result = await flag.schema['~standard'].validate(value)

  if (result.issues) {
    throw new UsageError(`flag --${flag.long}: ${result.issues.map(issue => issue.message).join('; ')}`)
  }

  return result.value
}

function defaultValueOf(flag: ResolvedFlag): unknown {
  if (flag.default !== undefined) {
    return Array.isArray(flag.default) ? [...flag.default] : flag.default
  }

  if (flag.multiple) {
    return []
  }

  // A `--no-<name>` flag exists to turn something off, so it is on until negated.
  if (flag.type === 'boolean') {
    return flag.negated
  }

  return undefined
}
