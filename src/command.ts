import type { InferArguments } from './arguments'
import type { FlagsDefinition, InferFlags } from './flags'
import type { CliIo } from './io'

/**
 * The type-erased form stored in command trees.
 *
 * `action` takes `any` so commands with different flag types can share one `children` array.
 */
export interface Command extends Omit<CommandDefinition, 'action'> {
  action?: (context: CommandContext<any, any>) => CommandResult | Promise<CommandResult>
}

export interface CommandContext<
  TFlags extends FlagsDefinition = FlagsDefinition,
  TArguments extends string = string,
> {
  args: InferArguments<TArguments>
  flags: InferFlags<TFlags>
  io: CliIo
  /** Names from the root to this command, excluding the CLI name: `['config', 'providers', 'ls']`. */
  path: readonly string[]
  /** Tokens after a bare `--`. They are also bound to positional arguments. */
  rest: readonly string[]
  signal?: AbortSignal
}

export interface CommandDefinition<
  TFlags extends FlagsDefinition = FlagsDefinition,
  TArguments extends string = string,
> {
  action?: (context: CommandContext<TFlags, TArguments>) => CommandResult | Promise<CommandResult>
  alias?: readonly string[]
  /** Accept flags this command does not declare, instead of failing with a usage error. */
  allowUnknownFlags?: boolean
  /** Positional argument pattern, such as `<source> [...rest]`. */
  arguments?: TArguments
  children?: readonly Command[]
  /**
   * Run this child when the parent receives no matching subcommand name.
   *
   * Lets `alint src` mean `alint lint src` while `alint config` still routes to `config`.
   */
  default?: boolean
  description: string
  examples?: readonly string[]
  /**
   * Flags this command accepts. Nothing is inherited from parent commands: spread a shared
   * `defineFlags` set into every command that should accept it.
   */
  flags?: TFlags
  /** Longer help paragraph. Falls back to `description`. */
  help?: string
  name: string
}

/** An action returns its exit code; returning nothing means success. */
export type CommandResult = number | void

export function defineCommand<
  const TFlags extends FlagsDefinition = [],
  const TArguments extends string = '',
>(command: CommandDefinition<TFlags, TArguments>): Command {
  return command
}
