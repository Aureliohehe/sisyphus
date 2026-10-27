import { electronAPI } from '@electron-toolkit/preload'
import type { AgentEvent } from '../shared/agent'

interface AttachedFile {
  name: string
  content: string
  size: number
}

declare global {
  interface Window {
    electron: typeof electronAPI
    api: {
      getAgentWorkspace: () => Promise<string | null>
      selectAgentWorkspace: () => Promise<string | null>
      clearAgentWorkspace: () => Promise<void>
      cancelAgent: (requestId: string) => Promise<void>
      onAgentEvent: (listener: (event: AgentEvent) => void) => void
      clearAgentListeners: () => void
      selectAvatar: () => Promise<string | null>
      selectFiles: () => Promise<AttachedFile[]>
      listModels: (baseURL: string, apiKey: string) => Promise<{ name: string; id: string }[]>
      saveFileDialog: (defaultName: string) => Promise<string | null>
      writeFileChunk: (filePath: string, content: string) => Promise<void>
    }
  }
}
