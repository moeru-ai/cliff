import type { OptionType } from './options'

/**
 * The only contract between cliff and a parsing library.
 *
 * cliff has already routed the command, removed command-name tokens, and cut everything
 * from a bare `--` onwards, so `argv` holds only flags and positionals for one command.
 * Defaults, choices, and number validation are applied by cliff after `parse` returns.
 */
export interface ArgvParser {
  name: string
  parse: (argv: readonly string[], options: readonly ParserOption[]) => ParsedArgv
}

export interface ParsedArgv {
  /** Values keyed by `ParserOption.key`. Absent flags may be missing or `undefined`. */
  flags: Record<string, unknown>
  positionals: string[]
}

/** What an argv parser needs to know about one option. */
export interface ParserOption {
  /** Kebab-case long flag without the leading `--`. */
  flag: string
  /** camelCase key the parsed value must be stored under. */
  key: string
  multiple: boolean
  short?: string
  type: OptionType
}
