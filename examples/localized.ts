import type { UsageIssue } from '@moeru/cliff'

import { createCli, defineCommand } from '@moeru/cliff'

const serve = defineCommand({
  action: ({ args, flags, io }) => {
    io.stdout.write(`在 ${args.port} 端口启动（日志级别：${flags.log}）\n`)
  },
  arguments: [{ description: '监听的端口', name: 'port', required: true }],
  description: '启动开发服务器',
  flags: [{ default: 'info', description: '日志级别', flag: '-l, --log <debug|info|warn>' }],
  name: 'serve',
})

// Codes left out fall back to the English `message`.
function translate(issue: undefined | UsageIssue, message: string): string {
  switch (issue?.code) {
    case 'invalid-choice':
      return `选项 ${issue.flag} 只能是 ${issue.choices.join('、')} 之一，收到了“${issue.received}”`
    case 'missing-argument':
      return `缺少必填参数 ${issue.argument}`
    case 'unknown-flag':
      return `未知的选项 ${issue.flag}`
    default:
      return message
  }
}

export const cli = createCli({
  children: [serve],
  description: '一个中文界面的示例工具。',
  name: 'tool-zh',
  renderUsageError: ({ command, issue, message }) =>
    `错误：${translate(issue, message)}\n\n运行 \`${command} --help\` 查看用法。\n`,
})
