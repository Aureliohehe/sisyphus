import { useState, useRef, useEffect } from 'react'
import { Paperclip, X, Bot, BookOpen, Terminal } from 'lucide-react'
import { useAppStore, AI_MODELS } from '../../stores/appStore'
import { useChatStore } from '../../stores/chatStore'
import { useConversationStore, nextMsgId } from '../../stores/conversationStore'
import { useAssistantStore } from '../../stores/assistantStore'
import { useKnowledgeStore } from '../../stores/knowledgeStore'
import { sendChatMessageStream } from '../../services/ai-client'
import { buildRAGSystemPrompt } from '../../services/rag'
import { filterCommands, executeCommand, parseCommand } from '../../services/commands'
import AgentControls from './AgentControls'

function formatAttachments(files: { name: string; content: string }[]): string {
  return files
    .map((f) => `[文件: ${f.name}]\n${f.content}`)
    .join('\n\n')
}

export default function ChatInput(): JSX.Element {
  const [value, setValue] = useState('')
  const [showModelMenu, setShowModelMenu] = useState(false)
  const [showKBMenu, setShowKBMenu] = useState(false)
  const [attachments, setAttachments] = useState<{ name: string; content: string; size: number }[]>([])
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const setView = useAppStore((s) => s.setView)
  const selectedProvider = useAppStore((s) => s.selectedProvider)
  const selectedModel = useAppStore((s) => s.selectedModel)
  const setProvider = useAppStore((s) => s.setProvider)
  const setModel = useAppStore((s) => s.setModel)
  const getCurrentConfig = useAppStore((s) => s.getCurrentConfig)
  const dynamicModels = useAppStore((s) => s.dynamicModels)

  const getActiveMessages = useConversationStore((s) => s.getActiveMessages)
  const addMessage = useConversationStore((s) => s.addMessage)
  const conversations = useConversationStore((s) => s.conversations)
  const activeId = useConversationStore((s) => s.activeId)
  const setConversationKnowledgeSpace = useConversationStore((s) => s.setConversationKnowledgeSpace)
  const isLoading = useChatStore((s) => s.isLoading)
  const setLoading = useChatStore((s) => s.setLoading)
  const appendStreamContent = useChatStore((s) => s.appendStreamContent)
  const flushStream = useChatStore((s) => s.flushStream)

  const activeAssistant = useAssistantStore((s) => {
    const id = s.activeAssistantId
    return s.assistants.find((a) => a.id === id) ?? null
  })
  const setActiveAssistant = useAssistantStore((s) => s.setActiveAssistant)

  const spaces = useKnowledgeStore((s) => s.spaces)

  const activeConv = conversations.find((c) => c.id === activeId)
  const knowledgeSpaceId = activeConv?.knowledgeSpaceId ?? null
  const activeSpace = spaces.find((s) => s.id === knowledgeSpaceId)

  const clearActiveMessages = useConversationStore((s) => s.clearActiveMessages)

  const currentProviderData = AI_MODELS.find((m) => m.provider === selectedProvider)

  const [showCommandMenu, setShowCommandMenu] = useState(false)
  const [commandQuery, setCommandQuery] = useState('')
  const [selectedCommandIndex, setSelectedCommandIndex] = useState(0)
  const commandMenuRef = useRef<HTMLDivElement>(null)

  const filteredCommands = filterCommands(commandQuery)

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
      textareaRef.current.style.height = textareaRef.current.scrollHeight + 'px'
    }
  }, [value])

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

  const runCommand = (commandId: string): void => {
    const result = executeCommand(commandId)

    switch (result.type) {
      case 'navigate':
        setView(result.view)
        break
      case 'clearMessages':
        clearActiveMessages()
        break
      case 'showModelMenu':
        setShowModelMenu(true)
        break
      case 'showAssistantMenu':
        // ChatInput doesn't have assistant selection menu, ignore
        break
      case 'showHelp':
        addMessage({
          id: nextMsgId(),
          role: 'assistant',
          content: `可用命令：\n${result.commands.map((c) => `${c.name} - ${c.description}`).join('\n')}`
        })
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

    if (!showCommandMenu) {
      if (newValue.startsWith('/')) {
        setShowCommandMenu(true)
        setCommandQuery(newValue.slice(1))
        setSelectedCommandIndex(0)
      }
    } else {
      if (!newValue.startsWith('/')) {
        setShowCommandMenu(false)
        setCommandQuery('')
      } else {
        setCommandQuery(newValue.slice(1))
      }
    }
  }

  const handleSend = async (): Promise<void> => {
    const trimmed = value.trim()
    if ((!trimmed && attachments.length === 0) || isLoading) return

    const fullContent = attachments.length > 0
      ? formatAttachments(attachments) + (trimmed ? '\n\n' + trimmed : '')
      : trimmed

    const userMsg = { id: nextMsgId(), role: 'user' as const, content: fullContent }
    addMessage(userMsg)
    const history = getActiveMessages()
    setValue('')
    setAttachments([])
    setLoading(true)

    const config = getCurrentConfig()
    const allMessages: { id: string; role: 'user' | 'assistant' | 'system'; content: string }[] = []

    // Build system prompt: assistant + RAG
    let systemContent = ''
    if (activeAssistant) {
      systemContent += activeAssistant.systemPrompt
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
      allMessages.push({ id: 'system-0', role: 'system', content: systemContent })
    }

    allMessages.push(...history)

    try {
      await sendChatMessageStream(config, allMessages, {
        onChunk: (chunk) => appendStreamContent(chunk),
        onDone: () => {
          const content = flushStream()
          if (content) {
            addMessage({ id: nextMsgId(), role: 'assistant', content }, activeId)
          }
          setLoading(false)
        },
        onError: (error) => {
          flushStream()
          addMessage({
            id: nextMsgId(),
            role: 'assistant',
            content: `提示：${error}`
          }, activeId)
          setLoading(false)
        }
      })
    } catch (err) {
      setLoading(false)
      addMessage({
        id: nextMsgId(),
        role: 'assistant',
        content: `连接错误：${err instanceof Error ? err.message : '未知错误'}`
      }, activeId)
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

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      const trimmed = value.trim()
      const { commandId } = parseCommand(trimmed)
      if (commandId) {
        runCommand(commandId)
      } else {
        handleSend()
      }
    }
  }

  return (
    <div className="border-t border-surface-border bg-surface">
      <div className="max-w-[740px] mx-auto p-4">
        <AgentControls />
        <div className="capsule-input relative rounded-[28px]">
          <textarea
            ref={textareaRef}
            value={value}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            placeholder="输入消息..."
            rows={1}
            className="w-full bg-transparent text-white placeholder-muted-dim text-sm px-4 pt-3 pb-2 resize-none outline-none leading-relaxed"
            style={{ maxHeight: '160px' }}
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

          {activeAssistant && (
            <div className="flex items-center gap-1.5 px-4 pb-1">
              <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs text-green-400 bg-green-500/10 rounded-md border border-green-500/20">
                <Bot size={10} />
                <span className="max-w-[140px] truncate">{activeAssistant.name}</span>
                <button
                  onClick={() => setActiveAssistant(null)}
                  className="text-green-400/60 hover:text-red-400 transition-colors"
                >
                  <X size={10} />
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
                  onClick={() => {
                    if (activeId) setConversationKnowledgeSpace(activeId, null)
                  }}
                  className="text-blue-400/60 hover:text-red-400 transition-colors"
                >
                  <X size={10} />
                </button>
              </span>
            </div>
          )}

          <div className="flex items-center justify-between px-3 pb-2.5">
            <div className="flex items-center gap-1">
              <button
                onClick={handleAttach}
                className="p-1.5 text-muted hover:text-white hover:bg-surface-lighter rounded-lg transition-colors"
                title="上传附件"
              >
                <Paperclip size={14} />
              </button>

              <div className="relative">
                <button
                  onClick={() => setShowKBMenu(!showKBMenu)}
                  className="p-1.5 text-muted hover:text-white hover:bg-surface-lighter rounded-lg transition-colors"
                  title="知识空间"
                >
                  <BookOpen size={14} />
                </button>
                {showKBMenu && (
                  <>
                    <div className="fixed inset-0 z-10" onClick={() => setShowKBMenu(false)} />
                    <div className="absolute bottom-full left-0 mb-1 z-20 w-48 bg-surface-light border border-surface-border rounded-xl shadow-2xl py-1">
                      <button
                        onClick={() => {
                          if (activeId) setConversationKnowledgeSpace(activeId, null)
                          setShowKBMenu(false)
                        }}
                        className={`w-full text-left px-3 py-1.5 text-xs hover:bg-surface-lighter transition-colors ${
                          !knowledgeSpaceId ? 'text-white' : 'text-muted'
                        }`}
                      >
                        不使用知识空间
                      </button>
                      {spaces.map((s) => (
                        <button
                          key={s.id}
                          onClick={() => {
                            if (activeId) setConversationKnowledgeSpace(activeId, s.id)
                            setShowKBMenu(false)
                          }}
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
                  className="flex items-center gap-1 px-2 py-1 text-xs text-muted hover:text-white hover:bg-surface-lighter rounded-lg transition-colors"
                >
                  <span className="w-1 h-1 rounded-full bg-green-400" />
                  <span className="max-w-[80px] truncate">{currentProviderData?.label}</span>
                </button>

                {showModelMenu && (
                  <>
                    <div className="fixed inset-0 z-10" onClick={() => setShowModelMenu(false)} />
                    <div className="absolute bottom-full right-0 mb-1 z-20 w-48 bg-surface-light border border-surface-border rounded-xl shadow-2xl py-1">
                      {AI_MODELS.map((provider) => {
                          const models = dynamicModels[provider.provider] || provider.models
                          return (
                        <div key={provider.provider}>
                          <div className="px-3 py-1 text-[10px] text-muted-dim font-medium">{provider.label}</div>
                          {models.map((m) => (
                            <button
                              key={m.id}
                              onClick={() => {
                                setProvider(provider.provider)
                                setModel(m.id)
                                setShowModelMenu(false)
                              }}
                              className={`w-full text-left px-3 py-1 text-xs hover:bg-surface-lighter transition-colors
                                ${selectedProvider === provider.provider && selectedModel === m.id ? 'text-white' : 'text-muted'}`}
                            >
                              {m.name}
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
                onClick={handleSend}
                disabled={isLoading || (!value.trim() && attachments.length === 0)}
                className="p-1.5 text-white disabled:text-muted-dim hover:bg-surface-lighter rounded-lg transition-colors"
              >
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M2 8l12-6-4 12-3-6z" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
