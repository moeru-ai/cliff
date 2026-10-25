import type { ArgvParser } from '../parser'

import process from 'node:process'

import meow from 'meow'

/**
 * Parser backed by meow (yargs-parser).
 *
 * Only meow's flag parsing is used; help, version, and required-flag checks stay in cliff
 * because meow implements them with `process.exit`.
 */
export const meowParser: ArgvParser = {
  name: 'meow',
  parse(argv, flags) {
    // NOTICE: meow assigns `process.title` from package.json on every call. Restore it so
    // parsing has no process-wide side effect.
    // https://github.com/sindresorhus/meow/blob/14a216feea8408d84162fab5f9823c4d5b308ef2/source/index.js#L188
    const title = process.title

    try {
      const result = meow({
        allowUnknownFlags: true,
        argv: [...argv],
        autoHelp: false,
        autoVersion: false,
        booleanDefault: undefined,
        description: false,
        flags: Object.fromEntries(flags.map(flag => [flag.key, {
          // NOTICE: meow throws "The flag --x can only be set once" for a repeated flag that is
          // not `isMultiple`. Collect every flag as an array and let cliff keep the last value,
          // matching cac and `node:util`.
          isMultiple: true,
          shortFlag: flag.short,
          type: flag.type,
        }])),
        // NOTICE: meow requires `importMeta` to find package.json for help and version text.
        // cliff renders those itself, so an empty `pkg` skips the lookup entirely.
        // https://github.com/sindresorhus/meow/blob/14a216feea8408d84162fab5f9823c4d5b308ef2/source/options.js#L91-L95
        importMeta: import.meta,
        pkg: {},
      })

      return {
        flags: result.flags as Record<string, unknown>,
        positionals: result.input.map(String),
      }
    }
    finally {
      process.title = title
    }
  },
}
