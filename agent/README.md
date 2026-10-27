# Go Agent 运行时

Go 1.24+，仅使用标准库。Electron 启动一个子进程，通过 stdin/stdout 交换逐行 JSON，不监听端口。现有聊天和技能队列通过此运行时执行；`ai:chat` 单次调用和模型列表暂时保留原实现。

## 使用

在项目根目录：

```bash
npm install
npm run dev
```

1. 在设置中配置 OpenAI 兼容接口、密钥和模型。启用文件工具需要模型支持 `tools` / `tool_calls`，应用不会在接口不支持时静默降级。
2. 在首页或聊天输入框上方选择工作目录。
3. 输入例如“列出目录，阅读 README.md，总结这个项目”。
4. 可查看当前工具状态，点击“停止”取消整个任务。

未选择目录时仍通过 Go 普通聊天，不发送工具定义。目录授权仅在当前窗口会话有效，刷新或重启后需要重新选择；不是按会话持久化。选择后，后续聊天和技能任务均可使用该目录，点击目录旁的关闭按钮撤销授权。

本版采用非流式模型请求，在最终回复完成后发送一个 `text_delta` 事件；工具状态实时发送。不模拟逐字输出。工具调用历史仅在单次任务内保留，会话中只保存用户消息和最终回答。

## 文件

- `main.go`：JSON Lines 协议、单任务调度、取消、总超时。
- `provider.go`：OpenAI 兼容模型请求。
- `runner.go`：模型 → 工具 → 模型，最多 10 轮。
- `tools.go`：`list_directory`、`read_file`、`search_text`。
- `../src/main/agent-process.ts`：子进程生命周期、工作目录授权、IPC 转发。

## 协议

每行一个 JSON 对象，所有任务事件带 `requestId`。stdout 专用于协议，诊断信息只写 stderr。密钥仅通过 stdin 传入，不放在命令行参数中。

输入示意（实际发送时每个对象必须单独占一行）：

```json
{"type":"run","requestId":"task-1","config":{"baseURL":"https://api.example.com/v1","apiKey":"YOUR_KEY","model":"your-model"},"workspace":"/path/selected/by/user","messages":[{"role":"user","content":"总结 README.md"}]}
{"type":"cancel","requestId":"task-1"}
```

Electron 从原生目录选择器记录 `workspace`，不接受聊天消息或模型提供的目录授权。

输出类型：

- `tool_start` / `tool_end`：`tool`、`callId`，失败时额外带 `error`。
- `text_delta`：`text`，本版为最终完整回答。
- `done`：任务结束；取消时 `cancelled: true`。
- `error`：`error`，本次任务失败。

单任务只有一个终止事件（`done` 或 `error`）。同一时刻只接受一个任务；stdin 关闭会取消任务并退出。Electron 退出、窗口关闭、页面刷新会终止对应任务；异常退出后下次请求可重新启动运行时。

## 边界与限制

- 只读工具，没有写文件、Shell、网络搜索或 MCP。
- 文件访问通过 `os.OpenRoot`，拒绝绝对路径、`..` 越界及指向目录外的符号链接。不是针对挂载点、硬链接等的完整操作系统沙箱。
- 目录列表最多 200 项；读取仅支持 64 KiB 以内的普通 UTF-8 文本文件。
- 搜索为大小写敏感字面量匹配，最多 50 条结果；跳过符号链接、`.git`、`node_modules`、二进制及大文件。扫描上限约 2000 个条目 / 8 MiB 文本，返回截断和跳过信息。
- 每轮最多 16 次工具调用，最多 10 次模型请求；单次 HTTP 请求 90 秒，总任务 3 分钟。Electron 另有 190 秒兜底，并在取消无响应超过 2 秒时结束子进程。
- 模型响应最多 2 MiB，Electron 发出的请求最多 7 MiB。
- 读取到的内容会发送至用户配置的模型供应商。请不要授权包含密钥、凭证或其他敏感文件的目录；本版没有逐文件批准或秘密检测。
- 现有手动附件、RAG、技能导出功能保留，工具的只读限制不改变用户主动执行的导出行为。

## 检查与打包

```bash
npm run test:agent
npm run typecheck
npm run build
npm run package
```

`test:agent` 使用 Go race detector，需要支持该检测器的平台和 C 编译器；也可在 `agent/` 内运行 `go test ./...`。测试使用本地模拟模型接口，不需要真实密钥。

`dev`、`build`、`package` 自动构建 Go 可执行文件到 `build/agent/`，打包后复制到 `resources/agent/`。终端用户无需安装 Go。

默认构建当前系统和 CPU 架构。跨平台打包时，必须让 `GOOS` / `GOARCH` 与 electron-builder 目标一致，例如在具备相应打包条件的环境中：

```bash
GOOS=windows GOARCH=amd64 npm run build
npx electron-builder --win --x64
```

一次只为一个目标平台和架构构建安装包。macOS 签名/公证、各平台安装包和实际供应商兼容性仍需在目标环境验证。修改 Go、主进程或 preload 后必须完整重启应用。
