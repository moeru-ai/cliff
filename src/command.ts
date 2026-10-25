import type { InferArguments } from './arguments'
import type { CliIo } from './io'
import type { InferOptions, OptionsDefinition } from './options'

/**
 * The type-erased form stored in command trees.
 *
 * `run` takes `any` so commands with different option types can share one `commands` array.
 */
export interface Command extends Omit<CommandDefinition, 'run'> {
  run?: (context: CommandContext<any, any, any>) => CommandResult | Promise<CommandResult>
}

export interface CommandContext<
  TOptions extends OptionsDefinition = OptionsDefinition,
  TArguments extends string = string,
  TGlobals extends Globals = Globals,
> {
  args: InferArguments<TArguments>
  /** Values of options declared by the CLI root and every ancestor command. */
  globals: TGlobals
  io: CliIo
  /** Values of options declared by this command. */
  options: InferOptions<TOptions>
  /** Names from the root to this command, excluding the CLI name: `['config', 'providers', 'ls']`. */
  path: readonly string[]
  /** Tokens after a bare `--`. They are also bound to positional arguments. */
  rest: readonly string[]
  signal?: AbortSignal
}

export interface CommandDefinition<
  TOptions extends OptionsDefinition = OptionsDefinition,
  TArguments extends string = string,
  TGlobals extends Globals = Globals,
> {
  alias?: readonly string[]
  /** Accept flags no command on the path declares, instead of failing with a usage error. */
  allowUnknownOptions?: boolean
  /** Positional argument pattern, such as `<source> [...rest]`. */
  args?: TArguments
  commands?: readonly Command[]
  /**
   * Run this child when the parent receives no matching subcommand name.
   *
   * Lets `alint src` mean `alint lint src` while `alint config` still routes to `config`.
   */
  default?: boolean
  description: string
  examples?: readonly string[]
  /** Longer help paragraph. Falls back to `description`. */
  help?: string
  name: string
  /**
   * Options for this command.
   *
   * On a command that has `commands`, these options are also accepted by every descendant
   * and reach them through `context.globals`.
   */
  options?: TOptions
  run?: (context: CommandContext<TOptions, TArguments, TGlobals>) => CommandResult | Promise<CommandResult>
}

/** A command returns its exit code; returning nothing means success. */
export type CommandResult = number | void

export type Globals = Readonly<Record<string, unknown>>

export function defineCommand<
  const TOptions extends OptionsDefinition = Record<never, never>,
  const TArguments extends string = '',
>(command: CommandDefinition<TOptions, TArguments>): Command {
  return command
}

/**
 * Declares options shared by the whole CLI and a `defineCommand` that sees them typed.
 *
 * ```ts
 * export const globals = defineGlobalOptions({ config: { type: 'string', description: '...' } })
 * export const lint = globals.defineCommand({ name: 'lint', run: ({ globals }) => globals.config })
 * createCli({ name: 'alint', options: globals.options, commands: [lint] })
 * ```
 */
export function defineGlobalOptions<const TGlobalOptions extends OptionsDefinition>(options: TGlobalOptions) {
  return {
    defineCommand<
      const TOptions extends OptionsDefinition = Record<never, never>,
      const TArguments extends string = '',
    >(command: CommandDefinition<TOptions, TArguments, InferOptions<TGlobalOptions>>,
    ): Command {
      return command
    },
    options,
  }
}
