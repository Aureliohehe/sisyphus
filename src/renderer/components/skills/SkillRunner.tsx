import { useState, useRef } from 'react'
import { Pencil, Play, Square, CheckCircle } from 'lucide-react'
import { type Skill } from '../../stores/skillStore'
import { useConversationStore, nextMsgId } from '../../stores/conversationStore'
import { useChatStore } from '../../stores/chatStore'
import { useAppStore } from '../../stores/appStore'
import { cancelAgent, sendChatMessageStream } from '../../services/ai-client'

interface Props {
  skill: Skill
  onEdit: () => void
}

type RunState = null | { status: 'running'; current: number; total: number } | { status: 'done'; total: number } | { status: 'error'; message: string }

export default function SkillRunner({ skill, onEdit }: Props): JSX.Element {
  const [variables, setVariables] = useState<Record<string, string>>({})
  const [runState, setRunState] = useState<RunState>(null)
  const cancelledRef = useRef(false)
  const isLoading = useChatStore((state) => state.isLoading)

  const handleRun = async (): Promise<void> => {
    if (useChatStore.getState().isLoading) return
    const now = new Date()
    const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
    const defaultName = `${skill.name}_${dateStr}.md`

    const filePath = await window.api.saveFileDialog(defaultName)
    if (!filePath || useChatStore.getState().isLoading) return

    let promptsToRun: string[] = []

    if (skill.type === 'template' && skill.template) {
      let rendered = skill.template
      for (const [key, value] of Object.entries(variables)) {
        rendered = rendered.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value)
      }
      promptsToRun = [rendered]
    } else {
      promptsToRun = skill.prompts
    }

    const total = promptsToRun.length
    cancelledRef.current = false

    const header = `# ${skill.name}\n\n${dateStr}\n\n---\n\n`
    await window.api.writeFileChunk(filePath, header)

    setRunState({ status: 'running', current: 0, total })

    const config = useAppStore.getState().getCurrentConfig()

    for (let i = 0; i < total; i++) {
      if (cancelledRef.current) break

      const prompt = promptsToRun[i]
      setRunState({ status: 'running', current: i + 1, total })

      const conversationId = useConversationStore.getState().createConversation(`[技能] ${skill.name} - ${i + 1}/${total}`)
      useConversationStore.getState().addMessage({
        id: nextMsgId(),
        role: 'user',
        content: prompt
      })

      const response = await new Promise<string>((resolve, reject) => {
        useChatStore.getState().setLoading(true)

        sendChatMessageStream(config, [
          { id: nextMsgId(), role: 'user', content: prompt }
        ], {
          onChunk: (chunk) => {
            useChatStore.getState().appendStreamContent(chunk)
          },
          onDone: () => {
            const content = useChatStore.getState().flushStream()
            useConversationStore.getState().addMessage({
              id: nextMsgId(),
              role: 'assistant',
              content
            }, conversationId)
            resolve(content)
          },
          onError: (error) => {
            useChatStore.getState().flushStream()
            reject(new Error(error))
          }
        })
      }).catch((err) => {
        setRunState(cancelledRef.current ? null : { status: 'error', message: err.message })
        return null
      })

      if (response === null) return

      const section = `## ${prompt}\n\n${response}\n\n---\n\n`
      await window.api.writeFileChunk(filePath, section)
    }

    if (!cancelledRef.current) {
      setRunState({ status: 'done', total })
    }
  }

  const handleCancel = (): void => {
    cancelledRef.current = true
    void cancelAgent().catch(() => setRunState({ status: 'error', message: '停止请求失败，请重试' }))
    setRunState(null)
  }

  const isRunning = runState?.status === 'running'

  return (
    <div className="h-full flex flex-col p-6">
      <div className="flex items-center gap-3 mb-6">
        <h2 className="text-lg font-medium text-white flex-1">{skill.name}</h2>
        <button
          onClick={onEdit}
          className="p-2 text-muted hover:text-white hover:bg-surface-lighter rounded-lg transition-colors"
          title="编辑"
        >
          <Pencil size={16} />
        </button>
      </div>

      <div className="flex items-center gap-2 mb-4">
        <span className="px-2 py-0.5 text-xs text-yellow-400 bg-yellow-500/10 rounded">
          {skill.type === 'template' ? '模板变量替换' : '提示词队列'}
        </span>
        <span className="text-xs text-muted-dim">
          {skill.type === 'template' ? `${skill.variables?.length ?? 0} 个变量` : `${skill.prompts.length} 条提示词`}
        </span>
      </div>

      {skill.type === 'template' && skill.variables && skill.variables.length > 0 && !isRunning && runState?.status !== 'done' && (
        <div className="mb-6 space-y-3">
          <label className="block text-xs text-muted-dim">填写变量</label>
          {skill.variables.map((v) => (
            <div key={v}>
              <label className="block text-xs text-muted mb-1">{`{{${v}}}`}</label>
              <input
                value={variables[v] ?? ''}
                onChange={(e) => setVariables({ ...variables, [v]: e.target.value })}
                placeholder={v}
                className="w-full px-3 py-2 text-sm text-white bg-surface-light border border-surface-border rounded-lg outline-none focus:border-muted transition-colors"
              />
            </div>
          ))}
        </div>
      )}

      {skill.type === 'queue' && !isRunning && runState?.status !== 'done' && (
        <div className="mb-6 space-y-2">
          <label className="block text-xs text-muted-dim mb-2">提示词列表</label>
          {skill.prompts.map((p, i) => (
            <div key={i} className="flex gap-2 px-3 py-2 bg-surface-light border border-surface-border rounded-lg">
              <span className="shrink-0 text-xs text-muted-dim">{i + 1}.</span>
              <span className="text-sm text-muted line-clamp-2">{p}</span>
            </div>
          ))}
        </div>
      )}

      {runState && (
        <div className="mb-6">
          {runState.status === 'running' && (
            <div>
              <div className="flex items-center justify-between text-sm text-muted mb-2">
                <span>正在处理 {runState.current}/{runState.total}</span>
                <button
                  onClick={handleCancel}
                  className="flex items-center gap-1 px-2 py-1 text-xs text-red-400 hover:text-red-300 transition-colors"
                >
                  <Square size={12} />
                  取消
                </button>
              </div>
              <div className="w-full h-1.5 bg-surface-light rounded-full overflow-hidden">
                <div
                  className="h-full bg-white/30 rounded-full transition-all duration-300"
                  style={{ width: `${(runState.current / runState.total) * 100}%` }}
                />
              </div>
            </div>
          )}
          {runState.status === 'done' && (
            <div className="flex items-center gap-2 text-sm text-green-400">
              <CheckCircle size={16} />
              <span>完成！共处理 {runState.total} 条</span>
            </div>
          )}
          {runState.status === 'error' && (
            <div className="text-sm text-red-400">
              错误：{runState.message}
            </div>
          )}
        </div>
      )}

      {!isRunning && runState?.status !== 'done' && (
        <button
          onClick={handleRun}
          disabled={isLoading || (skill.type === 'template' && skill.variables?.some((v) => !variables[v]?.trim()))}
          className="flex items-center justify-center gap-2 w-full py-2.5 text-sm text-white bg-surface-lighter border border-surface-border rounded-xl hover:bg-surface-light disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          <Play size={16} />
          <span>运行</span>
        </button>
      )}
    </div>
  )
}
