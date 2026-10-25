import type { ArgvParser } from '../parser'

import { parseArgs } from 'node:util'

/** Zero-dependency parser backed by `node:util` `parseArgs`. The default for `createCli`. */
export const nodeParser: ArgvParser = {
  name: 'node',
  parse(argv, options) {
    const { positionals, values } = parseArgs({
      allowNegative: true,
      allowPositionals: true,
      args: [...argv],
      options: Object.fromEntries(options.map(option => [option.flag, {
        multiple: option.multiple,
        // `parseArgs` rejects an explicit `short: undefined`.
        ...(option.short === undefined ? {} : { short: option.short }),
        // Numbers arrive as strings; cliff coerces and validates them after parsing.
        type: option.type === 'boolean' ? 'boolean' as const : 'string' as const,
      }])),
      // Unknown flags are already rejected or explicitly allowed by cliff's router;
      // strict mode would throw on the allowed ones.
      strict: false,
    })

    return {
      flags: Object.fromEntries(options.map(option => [option.key, values[option.flag]])),
      positionals,
    }
  },
}
