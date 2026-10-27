import type { ChatMessage } from '../stores/conversationStore'
import { useAgentStore } from '../stores/agentStore'

interface AIConfig {
  apiKey: string
  baseURL: string
  model: string
}

type StreamCallbacks = {
  onChunk: (chunk: string) => void
  onDone: () => void
  onError: (error: string) => void
}

export async function sendChatMessage(config: AIConfig, messages: ChatMessage[]): Promise<string> {
  return await window.electron.ipcRenderer.invoke('ai:chat', config, messages) as string
}

export async function cancelAgent(): Promise<void> {
  const requestId = useAgentStore.getState().requestId
  if (requestId) {
    useAgentStore.setState({ status: '正在停止…' })
    await window.api.cancelAgent(requestId)
  }
}

export async function sendChatMessageStream(
  config: AIConfig,
  messages: ChatMessage[],
  callbacks: StreamCallbacks
): Promise<void> {
  if (useAgentStore.getState().requestId) {
    callbacks.onError('已有任务正在运行，请先停止当前任务')
    return
  }
  const requestId = crypto.randomUUID()
  useAgentStore.setState({ requestId, status: '正在请求模型…' })
  const toolNames: Record<string, string> = {
    list_directory: '列出目录',
    read_file: '读取文件',
    search_text: '搜索文本'
  }

  await new Promise<void>((resolve) => {
    let settled = false
    const finish = (error?: string): void => {
      if (settled) return
      settled = true
      window.api.clearAgentListeners()
      useAgentStore.setState({ requestId: null, status: '' })
      try {
        if (error) callbacks.onError(error)
        else callbacks.onDone()
      } finally {
        resolve()
      }
    }

    window.api.clearAgentListeners()
    window.api.onAgentEvent((event) => {
      if (event.requestId !== requestId || settled) return
      switch (event.type) {
        case 'text_delta':
          if (event.text) callbacks.onChunk(event.text)
          break
        case 'tool_start':
          useAgentStore.setState({ status: `正在${toolNames[event.tool ?? ''] ?? '执行工具'}…` })
          break
        case 'tool_end':
          useAgentStore.setState({ status: event.error ? '工具执行失败，模型正在处理…' : '工具执行完成，正在请求模型…' })
          break
        case 'done':
          finish(event.cancelled ? '任务已停止' : undefined)
          break
        case 'error':
          finish(event.error || '运行时发生错误')
          break
      }
    })
    window.electron.ipcRenderer.invoke('ai:chatStream', config, messages, requestId)
      .catch((error: unknown) => finish(error instanceof Error ? error.message : '无法连接运行时'))
  })
}
