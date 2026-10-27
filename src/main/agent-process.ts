import { app, BrowserWindow, dialog, ipcMain, type WebContents } from 'electron'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createInterface } from 'node:readline'
import { join } from 'node:path'
import type { AIConfig, ChatMessage } from './ai-types'
import type { AgentEvent } from '../shared/agent'

interface PendingRun {
  requestId: string
  sender: WebContents
  timeout: ReturnType<typeof setTimeout>
  cancelTimeout?: ReturnType<typeof setTimeout>
}

let child: ChildProcessWithoutNullStreams | null = null
let pending: PendingRun | null = null
const workspaces = new Map<number, string | null>()

function finish(event: AgentEvent): void {
  const run = pending
  if (!run || event.requestId !== run.requestId) return
  if (event.type === 'done' || event.type === 'error') {
    clearTimeout(run.timeout)
    clearTimeout(run.cancelTimeout)
    pending = null
  }
  if (!run.sender.isDestroyed()) run.sender.send('agent:event', event)
}

function stopRuntime(message = '运行时已停止', cancelled = false): void {
  const process = child
  child = null
  process?.stdin.end()
  process?.kill()
  if (pending) {
    finish(cancelled
      ? { type: 'done', requestId: pending.requestId, cancelled: true }
      : { type: 'error', requestId: pending.requestId, error: message })
  }
}

function ensureRuntime(): ChildProcessWithoutNullStreams {
  if (child) return child
  const filename = process.platform === 'win32' ? 'sisyphus-agent.exe' : 'sisyphus-agent'
  const binary = app.isPackaged
    ? join(process.resourcesPath, 'agent', filename)
    : join(app.getAppPath(), 'build', 'agent', filename)
  const runtime = spawn(binary, [], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
  child = runtime
  const lines = createInterface({ input: runtime.stdout, crlfDelay: Infinity })
  lines.on('line', (line) => {
    if (child !== runtime) return
    try {
      const event = JSON.parse(line) as AgentEvent
      if (!['text_delta', 'tool_start', 'tool_end', 'done', 'error'].includes(event.type)) {
        throw new Error('无效事件')
      }
      finish(event)
    } catch {
      stopRuntime('运行时通信格式错误，请重启应用')
    }
  })
  runtime.stderr.resume()
  runtime.on('error', () => {
    if (child === runtime) stopRuntime('无法启动 Go 运行时，请先执行 npm run build:agent')
  })
  runtime.stdin.on('error', () => {
    if (child === runtime) stopRuntime('Go 运行时连接中断')
  })
  runtime.on('exit', () => {
    lines.close()
    if (child === runtime) stopRuntime('Go 运行时意外退出，请重试')
  })
  return runtime
}

function trackSender(sender: WebContents): void {
  if (workspaces.has(sender.id)) return
  workspaces.set(sender.id, null)
  sender.once('destroyed', () => {
    workspaces.delete(sender.id)
    if (pending?.sender === sender) stopRuntime()
  })
  sender.on('did-start-loading', () => {
    workspaces.set(sender.id, null)
    if (pending?.sender === sender) stopRuntime()
  })
  sender.on('render-process-gone', () => {
    workspaces.set(sender.id, null)
    if (pending?.sender === sender) stopRuntime()
  })
}

export function runAgent(sender: WebContents, config: AIConfig, messages: ChatMessage[], requestId: string): void {
  if (typeof requestId !== 'string' || !/^[a-zA-Z0-9-]{1,128}$/.test(requestId)) {
    throw new Error('请求 ID 无效')
  }
  if (pending) throw new Error('已有任务正在运行，请先停止当前任务')
  trackSender(sender)
  const payload = JSON.stringify({
    type: 'run', requestId, config,
    messages: messages.map(({ role, content }) => ({ role, content })),
    workspace: workspaces.get(sender.id) ?? ''
  }) + '\n'
  if (Buffer.byteLength(payload) > 7 * 1024 * 1024) throw new Error('请求内容过大，请减少附件或对话长度')
  const runtime = ensureRuntime()
  pending = {
    requestId, sender,
    timeout: setTimeout(() => stopRuntime('任务超时，运行时已停止'), 190_000)
  }
  runtime.stdin.write(payload)
}

export function registerAgentHandlers(): void {
  ipcMain.handle('agent:getWorkspace', (event) => {
    trackSender(event.sender)
    return workspaces.get(event.sender.id) ?? null
  })
  ipcMain.handle('agent:selectWorkspace', async (event) => {
    trackSender(event.sender)
    if (pending) throw new Error('请先等待当前任务结束')
    const window = BrowserWindow.fromWebContents(event.sender)
    if (!window) return null
    const result = await dialog.showOpenDialog(window, {
      title: '授权只读工作目录（相关文件内容将发送至所选模型）',
      properties: ['openDirectory']
    })
    if (event.sender.isDestroyed()) return null
    if (pending) throw new Error('请先等待当前任务结束')
    if (!result.canceled && result.filePaths[0]) workspaces.set(event.sender.id, result.filePaths[0])
    return workspaces.get(event.sender.id) ?? null
  })
  ipcMain.handle('agent:clearWorkspace', (event) => {
    if (pending) throw new Error('请先等待当前任务结束')
    trackSender(event.sender)
    workspaces.set(event.sender.id, null)
  })
  ipcMain.handle('agent:cancel', (event, requestId: string) => {
    if (!pending || pending.sender !== event.sender || pending.requestId !== requestId || pending.cancelTimeout) return
    pending.cancelTimeout = setTimeout(() => stopRuntime('任务已停止', true), 2000)
    child?.stdin.write(JSON.stringify({ type: 'cancel', requestId }) + '\n')
  })
  app.on('before-quit', () => stopRuntime())
}
