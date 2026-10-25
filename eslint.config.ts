import { defineConfig } from '@moeru/eslint-config'

export default defineConfig({
  masknet: false,
  perfectionist: true,
  preferArrow: false,
  sonarjs: false,
  sortPackageJsonScripts: false,
  typescript: true,
  unocss: false,
  vue: false,
}, {
  ignores: [
    'CLAUDE.md', // Skip the symbolic link
  ],
}, {
  rules: {
    'antfu/import-dedupe': 'error',
    'import/order': 'off',
    'no-console': 'error',
    'style/padding-line-between-statements': 'error',
  },
})
