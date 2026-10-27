import { mkdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const root = fileURLToPath(new URL('../', import.meta.url))
const output = join(root, 'build', 'agent')
const goos = process.env.GOOS || ({ win32: 'windows', darwin: 'darwin', linux: 'linux' })[process.platform]
const goarch = process.env.GOARCH || ({ x64: 'amd64', arm64: 'arm64', ia32: '386' })[process.arch]
if (!goos || !goarch) throw new Error('不支持的目标平台，请设置 GOOS 和 GOARCH')
mkdirSync(output, { recursive: true })
const filename = goos === 'windows' ? 'sisyphus-agent.exe' : 'sisyphus-agent'
const result = spawnSync('go', ['build', '-trimpath', '-o', join(output, filename), '.'], {
  cwd: join(root, 'agent'),
  stdio: 'inherit',
  env: { ...process.env, GOOS: goos, GOARCH: goarch, CGO_ENABLED: '0' }
})
if (result.error) {
  console.error('无法构建 Go 运行时，请安装 Go 1.24 或更高版本。', result.error.message)
}
process.exit(result.status ?? 1)
