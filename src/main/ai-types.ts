export type AIProvider = 'minimax' | 'glm' | 'deepseek'

export interface AIConfig {
  provider?: AIProvider
  apiKey: string
  baseURL: string
  model: string
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp?: number
}

export interface AIModelOption {
  provider: AIProvider
  label: string
  models: { name: string; id: string }[]
  defaultBaseURL: string
}

export const AI_MODELS: AIModelOption[] = [
  {
    provider: 'deepseek',
    label: 'DeepSeek',
    models: [
      { name: 'DeepSeek V4 Flash', id: 'deepseek-chat' },
      { name: 'DeepSeek V4 Pro', id: 'deepseek-reasoner' }
    ],
    defaultBaseURL: 'https://api.deepseek.com/v1'
  },
  {
    provider: 'minimax',
    label: 'MiniMax',
    models: [
      { name: 'MiniMax M2', id: 'abab6.5s-chat' }
    ],
    defaultBaseURL: 'https://api.minimax.chat/v1'
  },
  {
    provider: 'glm',
    label: 'GLM (Zhipu)',
    models: [
      { name: 'GLM-4 Plus', id: 'glm-4-flash' }
    ],
    defaultBaseURL: 'https://open.bigmodel.cn/api/paas/v4'
  }
]
