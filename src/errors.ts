export interface UsageErrorOptions extends ErrorOptions {
  issue?: UsageIssue
}

/**
 * The structured form of a usage mistake, keyed by `code`.
 *
 * Flags appear as typed or as `--<long>`, arguments by their help label (`<port>`), and
 * commands by their path from the CLI name (`tool config`).
 */
export type UsageIssue
  = | { argument: string, code: 'missing-argument' }
    | { choices: readonly string[], code: 'invalid-choice', flag: string, received: string }
    | { code: 'flag-requires-value', flag: string }
    | { code: 'invalid-value', label: string, messages: readonly string[], target: 'argument' | 'flag' }
    | { code: 'missing-command', command: string }
    | { code: 'unexpected-argument', received: string }
    | { code: 'unknown-command', command: string, received: string }
    | { code: 'unknown-flag', flag: string }

/**
 * A mistake in the command tree itself, such as two children sharing a name.
 *
 * Thrown by `createCli` before any argv is parsed, so it surfaces during development.
 */
export class DefinitionError extends Error {
  override name = 'DefinitionError'
}

/**
 * A command-line usage mistake: unknown flag, missing argument, bad value.
 *
 * The CLI reports it on stderr with a `--help` hint and exits with code 2, matching the
 * POSIX convention for incorrect usage. Commands can throw it too, with or without an `issue`.
 */
export class UsageError extends Error {
  /** What went wrong, for a `renderUsageError` that words it itself. Every error cliff throws has one. */
  readonly issue?: UsageIssue
  override name = 'UsageError'

  constructor(message: string, options: UsageErrorOptions = {}) {
    super(message, options)
    this.issue = options.issue
  }
}

/** Builds the `UsageError` cliff throws for `issue`, with its default English message. */
export function createUsageError(issue: UsageIssue): UsageError {
  return new UsageError(describeIssue(issue), { issue })
}

/** The default English wording of `issue`, which is also `UsageError.message`. */
export function describeIssue(issue: UsageIssue): string {
  switch (issue.code) {
    case 'flag-requires-value':
      return `flag ${issue.flag} requires a value`
    case 'invalid-choice':
      return `flag ${issue.flag} must be one of ${issue.choices.join(', ')}, received "${issue.received}"`
    case 'invalid-value':
      return `${issue.target} ${issue.label}: ${issue.messages.join('; ')}`
    case 'missing-argument':
      return `missing required argument ${issue.argument}`
    case 'missing-command':
      return `missing command for "${issue.command}"`
    case 'unexpected-argument':
      return `unexpected argument "${issue.received}"`
    case 'unknown-command':
      return `unknown command "${issue.received}" for "${issue.command}"`
    case 'unknown-flag':
      return `unknown flag ${issue.flag}`
  }
}
