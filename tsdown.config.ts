import { defineConfig } from 'tsdown'

export default defineConfig({
  clean: true,
  dts: true,
  entry: {
    'index': 'src/index.ts',
    'parsers/cac': 'src/parsers/cac.ts',
    'parsers/meow': 'src/parsers/meow.ts',
    'parsers/node': 'src/parsers/node.ts',
    'testing': 'src/testing.ts',
  },
  format: 'esm',
})
