import { useState, useRef, useEffect } from 'react'
import { Paperclip, X, BookOpen, Terminal } from 'lucide-react'
import { useAppStore, AI_MODELS, type ModelOption } from '../../stores/appStore'
import { useChatStore } from '../../stores/chatStore'
import { useConversationStore, nextMsgId } from '../../stores/conversationStore'
import { useAssistantStore, type CustomAssistant } from '../../stores/assistantStore'
import { useKnowledgeStore } from '../../stores/knowledgeStore'
import { sendChatMessageStream } from '../../services/ai-client'
import { buildRAGSystemPrompt } from '../../services/rag'
import { filterCommands, executeCommand, parseCommand } from '../../services/commands'
import AgentControls from '../chat/AgentControls'

function formatAttachments(files: { name: string; content: string }[]): string {
  return files
    .map((f) => `[文件: ${f.name}]\n${f.content}`)
    .join('\n\n')
}

export default function InputBox(): JSX.Element {
  const [value, setValue] = useState('')
  const [showModelMenu, setShowModelMenu] = useState(false)
  const [showKBMenu, setShowKBMenu] = useState(false)
  const [attachments, setAttachments] = useState<{ name: string; content: string; size: number }[]>([])
  const [knowledgeSpaceId, setKnowledgeSpaceId] = useState<string | null>(null)

  const selectedProvider = useAppStore((s) => s.selectedProvider)
  const selectedModel = useAppStore((s) => s.selectedModel)
  const setProvider = useAppStore((s) => s.setProvider)
  const setModel = useAppStore((s) => s.setModel)
  const setView = useAppStore((s) => s.setView)
  const getCurrentConfig = useAppStore((s) => s.getCurrentConfig)
  const searchCategory = useAppStore((s) => s.searchCategory)
  const createConversation = useConversationStore((s) => s.createConversation)
  const addMessage = useConversationStore((s) => s.addMessage)
  const setLoading = useChatStore((s) => s.setLoading)
  const appendStreamContent = useChatStore((s) => s.appendStreamContent)
  const flushStream = useChatStore((s) => s.flushStream)
  const isLoading = useChatStore((s) => s.isLoading)
  const dynamicModels = useAppStore((s) => s.dynamicModels)

  const activeAssistant = useAssistantStore((s) => {
    const id = s.activeAssistantId
    return s.assistants.find((a) => a.id === id) ?? null
  })
  const setActiveAssistant = useAssistantStore((s) => s.setActiveAssistant)
  const assistants = useAssistantStore((s) => s.assistants)

  const spaces = useKnowledgeStore((s) => s.spaces)
  const activeSpace = spaces.find((s) => s.id === knowledgeSpaceId)

  const currentProviderData = AI_MODELS.find((m) => m.provider === selectedProvider)
  const selectedModelName = currentProviderData?.models.find((m) => m.id === selectedModel)?.name || selectedModel

  const [localAssistantId, setLocalAssistantId] = useState<string | null>(null)
  const [showAssistantMenu, setShowAssistantMenu] = useState(false)
  const [assistantQuery, setAssistantQuery] = useState('')
  const [selectedAssistantIndex, setSelectedAssistantIndex] = useState(0)
  const assistantMenuRef = useRef<HTMLDivElement>(null)

  const [showCommandMenu, setShowCommandMenu] = useState(false)
  const [commandQuery, setCommandQuery] = useState('')
  const [selectedCommandIndex, setSelectedCommandIndex] = useState(0)
  const commandMenuRef = useRef<HTMLDivElement>(null)

  const filteredCommands = filterCommands(commandQuery)

  const localAssistant = localAssistantId
    ? assistants.find((a) => a.id === localAssistantId) ?? null
    : null

  const effectiveAssistant = localAssistant ?? activeAssistant

  const filteredAssistants = assistants.filter((a) =>
    a.name.toLowerCase().includes(assistantQuery.toLowerCase())
  )

  useEffect(() => {
    if (showAssistantMenu && assistantMenuRef.current) {
      const selected = assistantMenuRef.current.querySelector('[data-selected="true"]') as HTMLElement
      if (selected) {
        selected.scrollIntoView({ block: 'nearest' })
      }
    }
  }, [selectedAssistantIndex, showAssistantMenu])

  useEffect(() => {
    if (showCommandMenu && commandMenuRef.current) {
      const selected = commandMenuRef.current.querySelector('[data-selected="true"]') as HTMLElement
      if (selected) {
        selected.scrollIntoView({ block: 'nearest' })
      }
    }
  }, [selectedCommandIndex, showCommandMenu])

  const handleAttach = async (): Promise<void> => {
    const files = await window.api.selectFiles()
    if (files && files.length > 0) {
      setAttachments((prev) => [...prev, ...files])
    }
  }

  const removeAttachment = (index: number): void => {
    setAttachments((prev) => prev.filter((_, i) => i !== index))
  }

  const selectAssistant = (assistant: CustomAssistant): void => {
    const atIndex = value.lastIndexOf('@')
    if (atIndex !== -1) {
      const newValue = value.slice(0, atIndex) + value.slice(atIndex + 1 + assistantQuery.length)
      setValue(newValue)
    }
    setLocalAssistantId(assistant.id)
    setShowAssistantMenu(false)
    setAssistantQuery('')
    setSelectedAssistantIndex(0)
  }

  const clearLocalAssistant = (): void => {
    setLocalAssistantId(null)
  }

  const runCommand = (commandId: string): void => {
    const result = executeCommand(commandId)

    switch (result.type) {
      case 'navigate':
        setView(result.view)
        break
      case 'clearMessages':
        // On home page, no active conversation to clear; silently ignore
        break
      case 'showModelMenu':
        setShowModelMenu(true)
        break
      case 'showAssistantMenu':
        setShowAssistantMenu(true)
        setAssistantQuery('')
        setSelectedAssistantIndex(0)
        break
      case 'showHelp':
        // Show help as a temporary message in the input placeholder area is tricky;
        // Instead, we create a conversation with help text
        break
      case 'none':
        break
    }

    setValue('')
    setShowCommandMenu(false)
    setCommandQuery('')
    setSelectedCommandIndex(0)
  }

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>): void => {
    const newValue = e.target.value
    setValue(newValue)

    // Command menu logic
    if (!showCommandMenu && !showAssistantMenu) {
      if (newValue.startsWith('/')) {
        setShowCommandMenu(true)
        setCommandQuery(newValue.slice(1))
        setSelectedCommandIndex(0)
      }
    } else if (showCommandMenu) {
      if (!newValue.startsWith('/')) {
        setShowCommandMenu(false)
        setCommandQuery('')
      } else {
        setCommandQuery(newValue.slice(1))
      }
    }

    // Assistant menu logic
    if (!showAssistantMenu && !showCommandMenu) {
      if (newValue.endsWith('@')) {
        setShowAssistantMenu(true)
        setAssistantQuery('')
        setSelectedAssistantIndex(0)
      }
    } else if (showAssistantMenu) {
      const atIndex = newValue.lastIndexOf('@')
      if (atIndex === -1) {
        setShowAssistantMenu(false)
        setAssistantQuery('')
      } else {
        setAssistantQuery(newValue.slice(atIndex + 1))
      }
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent): void => {
    if (showCommandMenu) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelectedCommandIndex((prev) =>
          Math.min(prev + 1, filteredCommands.length - 1)
        )
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelectedCommandIndex((prev) => Math.max(prev - 1, 0))
      } else if (e.key === 'Enter') {
        e.preventDefault()
        if (filteredCommands[selectedCommandIndex]) {
          runCommand(filteredCommands[selectedCommandIndex].id)
        }
      } else if (e.key === 'Escape') {
        setShowCommandMenu(false)
        setCommandQuery('')
        setSelectedCommandIndex(0)
      }
      return
    }

    if (showAssistantMenu) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelectedAssistantIndex((prev) =>
          Math.min(prev + 1, filteredAssistants.length - 1)
        )
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelectedAssistantIndex((prev) => Math.max(prev - 1, 0))
      } else if (e.key === 'Enter') {
        e.preventDefault()
        if (filteredAssistants[selectedAssistantIndex]) {
          selectAssistant(filteredAssistants[selectedAssistantIndex])
        }
      } else if (e.key === 'Escape') {
        setShowAssistantMenu(false)
        setAssistantQuery('')
        setSelectedAssistantIndex(0)
      }
      return
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      const trimmed = value.trim()
      const { commandId } = parseCommand(trimmed)
      if (commandId) {
        runCommand(commandId)
      } else {
        handleSubmit()
      }
    }
  }

  const handleSubmit = async (): Promise<void> => {
    const trimmed = value.trim()
    if ((!trimmed && attachments.length === 0) || isLoading) return

    const fullContent = attachments.length > 0
      ? formatAttachments(attachments) + (trimmed ? '\n\n' + trimmed : '')
      : trimmed

    const convId = createConversation(fullContent, knowledgeSpaceId)
    const userMsg = { id: nextMsgId(), role: 'user' as const, content: fullContent }
    addMessage(userMsg)
    setValue('')
    setAttachments([])

    setLoading(true)
    setView('chat')

    const config = getCurrentConfig()

    const messages: { id: string; role: 'user' | 'assistant' | 'system'; content: string }[] = []

    let systemContent = ''
    if (effectiveAssistant) {
      systemContent += effectiveAssistant.systemPrompt
    }

    const categoryPrompts: Record<string, string> = {
      '发现': '你是一个探索型助手，善于发现新知识和创新观点。',
      '金融': '你是一个金融专家，擅长分析金融市场、投资策略和风险管理。',
      '健康': '你是一个健康顾问，提供医学知识、健康建议和生活方式指导。',
      '学术': '你是一个学术研究助手，擅长文献综述、研究方法和学术写作。',
      '专利': '你是一个专利分析师，擅长专利检索、技术分析和知识产权咨询。',
    }

    if (searchCategory && categoryPrompts[searchCategory]) {
      if (systemContent) systemContent += '\n\n'
      systemContent += categoryPrompts[searchCategory]
    }

    if (knowledgeSpaceId) {
      try {
        const ragPrompt = await buildRAGSystemPrompt(knowledgeSpaceId, trimmed || fullContent.slice(0, 200))
        if (ragPrompt) {
          if (systemContent) systemContent += '\n\n'
          systemContent += ragPrompt
        }
      } catch {
        // RAG failed, continue without it
      }
    }

    if (systemContent) {
      messages.push({ id: 'system-0', role: 'system', content: systemContent })
    }

    messages.push(userMsg)

    setLocalAssistantId(null)

    try {
      await sendChatMessageStream(config, messages, {
        onChunk: (chunk) => appendStreamContent(chunk),
        onDone: () => {
          const content = flushStream()
          if (content) {
            addMessage({ id: nextMsgId(), role: 'assistant', content }, convId)
          }
          setLoading(false)
        },
        onError: (error) => {
          flushStream()
          addMessage({ id: nextMsgId(), role: 'assistant', content: `提示：${error}` }, convId)
          setLoading(false)
        }
      })
    } catch (err) {
      setLoading(false)
      addMessage({
        id: nextMsgId(),
        role: 'assistant',
        content: `连接错误：${err instanceof Error ? err.message : '未知错误'}`
      }, convId)
    }
  }

  return (
    <div className="w-full max-w-[680px] mx-auto px-4">
      <AgentControls />
      <div className="capsule-input relative rounded-[28px]">
        <textarea
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder="问任何事情..."
          rows={2}
          className="w-full bg-transparent text-white placeholder-muted-dim text-base px-5 pt-4 pb-2 resize-none outline-none leading-relaxed"
          style={{ minHeight: '64px', maxHeight: '200px' }}
        />

        {showCommandMenu && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => { setShowCommandMenu(false); setCommandQuery(''); setSelectedCommandIndex(0) }} />
            <div
              ref={commandMenuRef}
              className="absolute left-4 right-4 z-20 bg-surface-light border border-surface-border rounded-xl shadow-2xl py-1.5 max-h-[200px] overflow-y-auto"
              style={{ bottom: 'calc(100% + 4px)' }}
            >
              {filteredCommands.length === 0 && (
                <div className="px-3 py-2 text-xs text-muted-dim">无匹配命令</div>
              )}
              {filteredCommands.map((cmd, i) => (
                <button
                  key={cmd.id}
                  data-selected={i === selectedCommandIndex}
                  onClick={() => runCommand(cmd.id)}
                  className={`w-full text-left px-3 py-2 text-sm transition-colors flex items-center gap-2
                    ${i === selectedCommandIndex ? 'bg-surface-lighter text-white' : 'text-muted hover:bg-surface-lighter'}`}
                >
                  <Terminal size={14} />
                  <span className="font-mono">{cmd.name}</span>
                  <span className="text-xs text-muted-dim ml-auto">{cmd.description}</span>
                </button>
              ))}
            </div>
          </>
        )}

        {showAssistantMenu && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => { setShowAssistantMenu(false); setAssistantQuery(''); setSelectedAssistantIndex(0) }} />
            <div
              ref={assistantMenuRef}
              className="absolute left-4 right-4 z-20 bg-surface-light border border-surface-border rounded-xl shadow-2xl py-2 max-h-[280px] overflow-y-auto"
              style={{ bottom: 'calc(100% + 4px)' }}
            >
              <div className="px-4 pb-2 mb-1 border-b border-white/5">
                <span className="text-xs text-muted-dim font-medium">选择助手</span>
              </div>
              {filteredAssistants.length === 0 && (
                <div className="px-4 py-3 text-xs text-muted-dim">无匹配助手</div>
              )}
              {filteredAssistants.map((a, i) => {
                const desc = a.systemPrompt.slice(0, 40) + (a.systemPrompt.length > 40 ? '...' : '')
                const isSelected = i === selectedAssistantIndex
                return (
                  <button
                    key={a.id}
                    data-selected={isSelected}
                    onClick={() => selectAssistant(a)}
                    className={`w-full text-left px-4 py-2.5 transition-colors ${
                      isSelected
                        ? 'bg-white/5 border-l-2 border-l-white/60'
                        : 'hover:bg-white/5 border-l-2 border-l-transparent'
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <div className="shrink-0 w-7 h-7 rounded-full bg-white/10 flex items-center justify-center text-white/60 text-xs">
                        {a.name.charAt(0)}
                      </div>
                      <div className="flex flex-col min-w-0">
                        <span className="text-sm text-white font-medium">{a.name}</span>
                        <span className="text-xs text-muted-dim truncate max-w-[240px]">{desc}</span>
                      </div>
                    </div>
                  </button>
                )
              })}
            </div>
          </>
        )}

        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-1.5 px-4 pb-1">
            {attachments.map((file, i) => (
              <span
                key={i}
                className="inline-flex items-center gap-1 px-2 py-0.5 text-xs text-muted bg-surface-lighter rounded-md border border-surface-border"
              >
                <Paperclip size={10} />
                <span className="max-w-[120px] truncate">{file.name}</span>
                <button
                  onClick={() => removeAttachment(i)}
                  className="text-muted-dim hover:text-red-400 transition-colors"
                >
                  <X size={10} />
                </button>
              </span>
            ))}
          </div>
        )}

        {effectiveAssistant && (
          <div className="flex items-center gap-1.5 px-4 pb-1">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs text-white/60 bg-white/5 rounded-full">
              <span className="font-medium truncate max-w-[140px]">{effectiveAssistant.name}</span>
              {localAssistant && <span className="text-[10px] text-muted-dim">本次</span>}
              <button
                onClick={localAssistant ? clearLocalAssistant : () => setActiveAssistant(null)}
                className="text-muted-dim hover:text-white transition-colors ml-0.5"
              >
                <X size={9} />
              </button>
            </span>
          </div>
        )}

        {activeSpace && (
          <div className="flex items-center gap-1.5 px-4 pb-1">
            <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs text-blue-400 bg-blue-500/10 rounded-md border border-blue-500/20">
              <BookOpen size={10} />
              <span className="max-w-[140px] truncate">{activeSpace.name}</span>
              <button
                onClick={() => setKnowledgeSpaceId(null)}
                className="text-blue-400/60 hover:text-red-400 transition-colors"
              >
                <X size={10} />
              </button>
            </span>
          </div>
        )}

        <div className="flex items-center justify-between px-4 pb-3">
          <div className="flex items-center gap-1">
            <button
              onClick={handleAttach}
              className="p-2 text-muted hover:text-white hover:bg-surface-lighter rounded-lg transition-colors"
              title="上传附件"
            >
              <Paperclip size={16} />
            </button>
            <button className="p-2 text-muted hover:text-white hover:bg-surface-lighter rounded-lg transition-colors">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                <circle cx="8" cy="8" r="6" />
                <path d="M8 4v4l3 2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>

            <div className="relative">
              <button
                onClick={() => setShowKBMenu(!showKBMenu)}
                className="p-2 text-muted hover:text-white hover:bg-surface-lighter rounded-lg transition-colors"
                title="知识空间"
              >
                <BookOpen size={16} />
              </button>
              {showKBMenu && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setShowKBMenu(false)} />
                  <div className="absolute bottom-full left-0 mb-1 z-20 w-48 bg-surface-light border border-surface-border rounded-xl shadow-2xl py-1">
                    <button
                      onClick={() => { setKnowledgeSpaceId(null); setShowKBMenu(false) }}
                      className={`w-full text-left px-3 py-1.5 text-xs hover:bg-surface-lighter transition-colors ${
                        !knowledgeSpaceId ? 'text-white' : 'text-muted'
                      }`}
                    >
                      不使用知识空间
                    </button>
                    {spaces.map((s) => (
                      <button
                        key={s.id}
                        onClick={() => { setKnowledgeSpaceId(s.id); setShowKBMenu(false) }}
                        className={`w-full text-left px-3 py-1.5 text-xs hover:bg-surface-lighter transition-colors ${
                          knowledgeSpaceId === s.id ? 'text-white' : 'text-muted'
                        }`}
                      >
                        {s.name}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="relative">
              <button
                onClick={() => setShowModelMenu(!showModelMenu)}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-muted hover:text-white hover:bg-surface-lighter rounded-lg transition-colors"
              >
                <span className="w-1.5 h-1.5 rounded-full bg-green-400" />
                <span>{currentProviderData?.label}</span>
                <span className="text-muted-dim">{selectedModelName}</span>
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M2 4l3 3 3-3" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>

              {showModelMenu && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setShowModelMenu(false)} />
                  <div className="absolute bottom-full right-0 mb-1 z-20 w-56 bg-surface-light border border-surface-border rounded-xl shadow-2xl py-1.5">
                    {AI_MODELS.map((provider) => {
                          const models: ModelOption[] = dynamicModels[provider.provider] || provider.models
                          return (
                      <div key={provider.provider}>
                        <div className="px-3 py-1.5 text-xs text-muted-dim font-medium">
                          {provider.label}
                        </div>
                        {models.map((m) => (
                          <button
                            key={m.id}
                            onClick={() => {
                              setProvider(provider.provider)
                              setModel(m.id)
                              setShowModelMenu(false)
                            }}
                            className={`w-full text-left px-3 py-1.5 text-sm hover:bg-surface-lighter transition-colors flex items-center gap-2
                              ${selectedProvider === provider.provider && selectedModel === m.id ? 'text-white' : 'text-muted'}`}
                          >
                            {selectedProvider === provider.provider && selectedModel === m.id && (
                              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M2 6l3 3 5-6" strokeLinecap="round" strokeLinejoin="round" />
                              </svg>
                            )}
                            <span className={selectedProvider === provider.provider && selectedModel === m.id ? '' : 'ml-5'}>
                              {m.name}
                            </span>
                          </button>
                        ))}
                      </div>
                          )
                    })}
                  </div>
                </>
              )}
            </div>

            <button
              onClick={handleSubmit}
              disabled={isLoading || (!value.trim() && attachments.length === 0)}
              className="p-2 text-white disabled:text-muted-dim hover:bg-surface-lighter rounded-lg transition-colors"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M2 8l12-6-4 12-3-6z" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
