/**
 * The only contract between cliff and a parsing library.
 *
 * cliff has already routed the command, removed command-name tokens, and cut everything
 * from a bare `--` onwards, so `argv` holds only flags and positionals for one command.
 * Defaults, choices, and schema validation are applied by cliff after `parse` returns.
 */
export interface ArgvParser {
  name: string
  parse: (argv: readonly string[], flags: readonly ParserFlag[]) => ParsedArgv
}

export interface ParsedArgv {
  /** Values keyed by `ParserFlag.key`. Absent flags may be missing or `undefined`. */
  flags: Record<string, unknown>
  positionals: string[]
}

/** What an argv parser needs to know about one flag. */
export interface ParserFlag {
  /** camelCase key the parsed value must be stored under. */
  key: string
  /** Kebab-case long name without `--`. Negated flags arrive as `--no-<long>`. */
  long: string
  multiple: boolean
  short?: string
  type: 'boolean' | 'string'
}
