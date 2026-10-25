import type { StandardJSONSchemaV1, StandardSchemaV1 } from '@standard-schema/spec'
import type { JSONSchema7 } from 'json-schema'

import { errorMessageFrom } from '@moeru/std'

import { DefinitionError, UsageError } from './errors'

export type InferOptions<T extends OptionsDefinition> = {
  -readonly [K in keyof T]: StandardSchemaV1.InferOutput<T[K]['schema']>
}

export interface OptionDefinition<TSchema extends OptionSchema = OptionSchema> {
  /** Falls back to the schema's JSON Schema `description`. */
  description?: string
  /** Value name shown in help, as in `--config <path>`. */
  placeholder?: string
  /**
   * Validates the parsed value and decides the type `run` receives, so defaults belong here
   * too: `v.optional(v.string(), 'x')`. Its input JSON Schema decides how argv is parsed.
   */
  schema: TSchema
  /** Single-character alias, as in `-c`. */
  short?: string
}

/**
 * A Standard Schema that also implements Standard JSON Schema.
 *
 * Zod 4 and ArkType implement both natively; wrap Valibot schemas with
 * `toStandardJsonSchema` from `@valibot/to-json-schema`. Standard JSON Schema converts
 * synchronously, which keeps `createCli` synchronous and lets it report bad schemas
 * immediately.
 */
export type OptionSchema = StandardJSONSchemaV1 & StandardSchemaV1

/**
 * Options keyed by their camelCase result key.
 *
 * The flag name is derived from the key (`cacheLocation` -> `--cache-location`), so one
 * spelling serves both the command's typed `options` and the command line.
 */
export type OptionsDefinition = Readonly<Record<string, OptionDefinition>>

export type OptionType = 'boolean' | 'number' | 'string'

/** One option after its flag spelling and argv shape are resolved. */
export interface ResolvedOption {
  choices?: readonly string[]
  /** JSON Schema `default`, only used to render help. The schema itself applies defaults. */
  default?: unknown
  description: string
  /** Kebab-case long flag without the leading `--`. */
  flag: string
  key: string
  multiple: boolean
  placeholder?: string
  schema: OptionSchema
  short?: string
  type: OptionType
}

type Shape = Pick<ResolvedOption, 'choices' | 'multiple' | 'type'>

export function normalizeOptionValue(option: ResolvedOption, raw: unknown): unknown {
  // Parsers disagree on edge cases (cac casts numeric strings, meow reports an absent
  // repeatable flag as `[]`, `node:util` keeps everything as strings), so arrays and numbers
  // are normalized here once. Absent flags stay `undefined` so the schema's default applies.
  if (raw === undefined || (Array.isArray(raw) && raw.length === 0)) {
    return undefined
  }

  const items = (Array.isArray(raw) ? raw : [raw]).map(item => coerceValue(option, item))

  return option.multiple ? items : items.at(-1)
}

/** Resolves how one option is parsed from the input JSON Schema of its schema. */
export function resolveOption(key: string, option: OptionDefinition, owner: string): ResolvedOption {
  const label = `option "${key}" of ${owner}`
  const converter = option.schema['~standard'].jsonSchema

  // Plain JavaScript callers bypass the `OptionSchema` type, so check the shape at runtime too.
  if (typeof converter?.input !== 'function') {
    throw new DefinitionError(`${label} needs a schema that implements Standard JSON Schema. Wrap Valibot schemas with \`toStandardJsonSchema\` from \`@valibot/to-json-schema\`.`)
  }

  let json: JSONSchema7

  try {
    // The input side describes what argv must provide, so transforms (string -> number) still
    // convert. Draft 07 is a target the spec asks every implementer to support.
    json = converter.input({ target: 'draft-07' }) as JSONSchema7
  }
  catch (error) {
    throw new DefinitionError(`${label} has a schema that cannot be converted to JSON Schema: ${errorMessageFrom(error) ?? 'unknown error'}`)
  }

  const shape = shapeOf(json)

  if (!shape) {
    throw new DefinitionError(`${label} must be a boolean, number, string, or an array of numbers or strings.`)
  }

  return {
    ...shape,
    default: json.default,
    description: option.description ?? json.description ?? '',
    flag: toFlagName(key),
    key,
    placeholder: option.placeholder,
    schema: option.schema,
    short: option.short,
  }
}

export function toFlagName(key: string): string {
  return key.replace(/[A-Z]/gu, character => `-${character.toLowerCase()}`)
}

export async function validateOptionValue(option: ResolvedOption, value: unknown): Promise<unknown> {
  const result = await option.schema['~standard'].validate(value)

  if (result.issues) {
    throw new UsageError(`option --${option.flag}: ${result.issues.map(issue => issue.message).join('; ')}`)
  }

  return result.value
}

function coerceValue(option: ResolvedOption, value: unknown): unknown {
  if (option.type === 'boolean') {
    return value === true || value === 'true'
  }

  if (option.type === 'number') {
    const number = typeof value === 'number' ? value : Number(String(value).trim() || Number.NaN)

    if (Number.isNaN(number)) {
      throw new UsageError(`option --${option.flag} expects a number, received "${String(value)}"`)
    }

    return number
  }

  return String(value)
}

/**
 * Maps the JSON Schema of one option to the argv shape cliff can parse.
 *
 * `null` branches are dropped because `v.nullish(...)` and friends still read a plain value
 * from argv. Literal unions (`anyOf` of `const`) and `enum` become `choices`.
 */
function shapeOf(json: JSONSchema7): Shape | undefined {
  const branches = (json.anyOf ?? json.oneOf ?? [json])
    .filter((branch): branch is JSONSchema7 => typeof branch === 'object' && branch.type !== 'null')

  if (branches.length > 0 && branches.every(branch => branch.const !== undefined || branch.enum !== undefined)) {
    const literals = branches.flatMap(branch => branch.const !== undefined ? [branch.const] : branch.enum ?? [])

    return literals.every(literal => typeof literal === 'string')
      ? { choices: literals, multiple: false, type: 'string' }
      : undefined
  }

  const [branch, ...others] = branches
  const types = Array.isArray(branch?.type) ? branch.type.filter(type => type !== 'null') : [branch?.type]

  if (!branch || others.length > 0 || types.length !== 1) {
    return undefined
  }

  switch (types[0]) {
    case 'array': {
      const items = typeof branch.items === 'object' && !Array.isArray(branch.items) ? shapeOf(branch.items) : undefined

      return items && !items.multiple && items.type !== 'boolean' ? { ...items, multiple: true } : undefined
    }
    case 'boolean':
      return { multiple: false, type: 'boolean' }
    case 'integer':
    case 'number':
      return { multiple: false, type: 'number' }
    case 'string':
      return { multiple: false, type: 'string' }
    default:
      return undefined
  }
}
