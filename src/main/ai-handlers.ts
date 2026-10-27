// src/main/ai-handlers.ts
import { ipcMain } from 'electron'
import logger from 'electron-log/main'
import type { AIConfig, ChatMessage } from './ai-types'
import { registerAgentHandlers, runAgent } from './agent-process'

export function registerAIHandlers(): void {
  logger.info('[AI] Registering AI handlers')
  registerAgentHandlers()

  ipcMain.handle('ai:listModels', async (_event, baseURL: string, apiKey: string) => {
    const startTime = Date.now()
    try {
      logger.debug(`[AI] Fetching models from ${baseURL}/models`)
      const url = baseURL.replace(/\/+$/, '') + '/models'
      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${apiKey}`
        }
      })
      if (!response.ok) {
        if (response.status === 401 || response.status === 403 || response.status === 404) {
          logger.warn(`[AI] Models endpoint returned ${response.status}, returning empty list`)
          return []
        }
        throw new Error(`HTTP ${response.status}`)
      }
      const data = await response.json()
      const models = data.data && Array.isArray(data.data)
        ? data.data.map((m: { id: string }) => ({ name: m.id, id: m.id }))
        : []
      logger.info(`[AI] Fetched ${models.length} models (${Date.now() - startTime}ms)`)
      return models
    } catch (error) {
      logger.error(`[AI] Failed to fetch models: ${error instanceof Error ? error.message : 'Unknown error'}`)
      throw new Error(`Failed to fetch models: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  })

  ipcMain.handle('ai:chat', async (_event, config: AIConfig, messages: ChatMessage[]) => {
    const startTime = Date.now()
    try {
      logger.debug(`[AI] Request to ${config.baseURL}/chat/completions (model: ${config.model})`)
      const response = await fetch(`${config.baseURL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.apiKey}`
        },
        body: JSON.stringify({
          model: config.model,
          messages: messages.map((m) => ({ role: m.role, content: m.content })),
          stream: false
        })
      })

      if (!response.ok) {
        const errBody = await response.text()
        logger.error(`[AI] Response ${response.status}: ${errBody}`)
        throw new Error(`AI API error ${response.status}: ${errBody}`)
      }

      const data = await response.json()
      const content = data.choices[0]?.message?.content || ''
      logger.info(`[AI] Response 200, ${content.length} chars (${Date.now() - startTime}ms)`)
      return content
    } catch (error) {
      logger.error(`[AI] Request failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
      throw new Error(`AI request failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  })

  ipcMain.handle('ai:chatStream', (event, config: AIConfig, messages: ChatMessage[], requestId: string) => {
    runAgent(event.sender, config, messages, requestId)
  })
}
