import type { ArgvParser } from '../parser'

import { parseArgs } from 'node:util'

/** Zero-dependency parser backed by `node:util` `parseArgs`. The default for `createCli`. */
export const nodeParser: ArgvParser = {
  name: 'node',
  parse(argv, flags) {
    const { positionals, values } = parseArgs({
      allowNegative: true,
      allowPositionals: true,
      args: [...argv],
      options: Object.fromEntries(flags.map(flag => [flag.long, {
        multiple: flag.multiple,
        // `parseArgs` rejects an explicit `short: undefined`.
        ...(flag.short === undefined ? {} : { short: flag.short }),
        type: flag.type,
      }])),
      // Unknown flags are already rejected or explicitly allowed by cliff's router;
      // strict mode would throw on the allowed ones.
      strict: false,
    })

    return {
      flags: Object.fromEntries(flags.map(flag => [flag.key, values[flag.long]])),
      positionals,
    }
  },
}
