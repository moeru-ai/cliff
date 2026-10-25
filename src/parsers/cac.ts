import type { ArgvParser } from '../parser'

import { cac } from 'cac'

/**
 * Parser backed by cac (mri).
 *
 * Only cac's option parsing is used. Routing, help, and version stay in cliff, so cac's
 * `console.log` help output and its non-awaited actions never come into play.
 */
export const cacParser: ArgvParser = {
  name: 'cac',
  parse(argv, flags) {
    const cli = cac()
    // A bracketed pattern registers cac's default command, which accepts any positionals.
    const command = cli.command('[...positionals]').allowUnknownOptions()

    for (const flag of flags) {
      const names = flag.short === undefined ? `--${flag.long}` : `-${flag.short}, --${flag.long}`

      // NOTICE: cac never tells mri which options are strings, so mri casts numeric-looking
      // values (`--name 007` -> 7) before cac sees them. `String()` afterwards cannot bring
      // back leading zeros or exponent spellings; use the node or meow parser if a string
      // flag must keep them verbatim.
      // https://github.com/cacjs/cac/blob/ae4adb8867ccd93a6702d9024e2e86f462d0a5aa/src/utils.ts#L51-L82
      command.option(
        flag.type === 'boolean' ? names : `${names} <value>`,
        '',
        flag.multiple ? { type: [String] } : undefined,
      )
    }

    // cac expects `process.argv` shape: the executable and script path come first.
    const parsed = cli.parse(['', '', ...argv], { run: false })
    const values = parsed.options as Record<string, unknown>

    return {
      flags: Object.fromEntries(flags.map(flag => [flag.key, values[toCamelCase(flag.long)]])),
      positionals: (parsed.args as unknown[]).map(String),
    }
  },
}

function toCamelCase(long: string): string {
  return long.replace(/-(\w)/gu, (_, character: string) => character.toUpperCase())
}
