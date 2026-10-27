import { useEffect, useState } from 'react'
import { FolderOpen, Square, X } from 'lucide-react'
import { useAgentStore } from '../../stores/agentStore'
import { useChatStore } from '../../stores/chatStore'
import { cancelAgent } from '../../services/ai-client'

export default function AgentControls(): JSX.Element {
  const { workspace, requestId, status } = useAgentStore()
  const isLoading = useChatStore((state) => state.isLoading)
  const [error, setError] = useState('')
  const [selecting, setSelecting] = useState(false)

  useEffect(() => {
    window.api.getAgentWorkspace()
      .then((workspace) => useAgentStore.setState({ workspace }))
      .catch(() => setError('无法获取工作目录'))
  }, [])

  const selectWorkspace = async (): Promise<void> => {
    setError('')
    setSelecting(true)
    try {
      const workspace = await window.api.selectAgentWorkspace()
      useAgentStore.setState({ workspace })
    } catch (error) {
      setError(error instanceof Error ? error.message : '无法选择工作目录')
    } finally {
      setSelecting(false)
    }
  }

  const clearWorkspace = async (): Promise<void> => {
    try {
      await window.api.clearAgentWorkspace()
      useAgentStore.setState({ workspace: null })
      setError('')
    } catch {
      setError('无法清除目录，请等待任务结束')
    }
  }

  return (
    <div className="mb-3 text-xs text-muted">
      <div className="flex items-center gap-2 min-w-0">
        <button
          onClick={selectWorkspace}
          disabled={isLoading || selecting}
          title={workspace ?? '选择工作目录，启用只读文件工具'}
          className="flex items-center gap-2 min-w-0 hover:text-white disabled:opacity-50"
        >
          <FolderOpen size={14} className="shrink-0" />
          <span className="truncate">{workspace ? `只读目录：${workspace}` : '选择工作目录，启用智能体'}</span>
        </button>
        {workspace && (
          <button onClick={clearWorkspace} disabled={isLoading || selecting} title="关闭文件工具" className="hover:text-white disabled:opacity-50">
            <X size={12} />
          </button>
        )}
        {requestId && (
          <button
            onClick={() => { cancelAgent().catch(() => setError('停止请求失败，请重试')) }}
            className="ml-auto flex items-center gap-1 shrink-0 text-red-400 hover:text-red-300"
          >
            <Square size={12} />停止
          </button>
        )}
      </div>
      {workspace && <p className="mt-1 text-muted-dim">文件内容可能发送至所选模型，请勿授权含密钥等敏感资料的目录。</p>}
      {status && <p className="mt-1" role="status">{status}</p>}
      {error && <p className="mt-1 text-red-400" role="alert">{error}</p>}
    </div>
  )
}
