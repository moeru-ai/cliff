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
 * POSIX convention for incorrect usage. Commands can throw it too.
 */
export class UsageError extends Error {
  override name = 'UsageError'
}
