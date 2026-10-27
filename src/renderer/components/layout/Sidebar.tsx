import { useRef } from 'react'
import { X } from 'lucide-react'
import { useAppStore } from '../../stores/appStore'
import { useConversationStore } from '../../stores/conversationStore'
import UserMenuDropdown from './UserMenuDropdown'

const NAV_ITEMS = [
  { id: 'skills', label: '工作流', icon: '⧉' },
  { id: 'spaces', label: '空间', icon: '◻' },
  { id: 'custom', label: '自定义助手', icon: '⚙' },
  { id: 'history', label: '历史', icon: '◷' }
] as const

export default function Sidebar(): JSX.Element {
  const setView = useAppStore((s) => s.setView)
  const { setUserMenuOpen, avatarUrl, username } = useAppStore()
  const conversations = useConversationStore((s) => s.conversations)
  const setActive = useConversationStore((s) => s.setActive)
  const deleteConversation = useConversationStore((s) => s.deleteConversation)
  const userMenuTriggerRef = useRef<HTMLDivElement>(null)

  const handleUserClick = () => {
    setUserMenuOpen(true)
  }

  const handleOpenConversation = (id: string) => {
    setActive(id)
    setView('chat')
  }

  return (
    <aside className="w-[240px] bg-[#0A0A0A] border-r border-surface-border flex flex-col select-none">
      {/* New Chat Button */}
      <div className="p-4">
        <button
          onClick={() => setView('home')}
          className="w-full py-2.5 px-4 bg-white text-black text-sm font-medium rounded-xl hover:bg-gray-200 transition-colors"
        >
          + 新建
        </button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 space-y-0.5">
        {NAV_ITEMS.map((item) => (
          <button
            key={item.id}
            onClick={() => {
              if (item.id === 'custom') setView('custom')
              if (item.id === 'skills') setView('skills')
              if (item.id === 'spaces') setView('knowledge')
              if (item.id === 'history') setView('history')
            }}
            className="sidebar-item w-full flex items-center gap-3 px-3 py-2.5 text-sm text-muted hover:text-white hover:bg-surface-light rounded-lg"
          >
            <span className="text-base w-5 text-center">{item.icon}</span>
            <span>{item.label}</span>
          </button>
        ))}
      </nav>

      {/* History */}
      <div className="px-3 mt-2">
        <div className="text-xs text-muted-dim uppercase tracking-wider px-3 py-2 font-medium">
          最近
        </div>
        <div className="space-y-0.5 max-h-[200px] overflow-y-auto">
          {conversations.length === 0 && (
            <p className="px-3 py-2 text-xs text-muted-dim">暂无对话</p>
          )}
          {conversations.slice(0, 20).map((conv) => (
            <div
              key={conv.id}
              className="group w-full flex items-center gap-1 px-3 py-2 text-sm text-muted hover:text-white hover:bg-surface-light rounded-lg"
            >
              <button
                onClick={() => handleOpenConversation(conv.id)}
                className="flex-1 text-left truncate"
              >
                {conv.title}
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); deleteConversation(conv.id) }}
                className="shrink-0 opacity-0 group-hover:opacity-100 text-muted-dim hover:text-red-400 transition-opacity"
              >
                <X size={14} />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Bottom */}
      <div className="p-3 border-t border-surface-border space-y-2">
        <button
          onClick={() => setView('settings')}
          className="sidebar-item w-full flex items-center gap-3 px-3 py-2 text-sm text-muted hover:text-white hover:bg-surface-light rounded-lg"
        >
          <span className="text-base">⚙</span>
          <span>模型配置</span>
        </button>
        <div
          ref={userMenuTriggerRef}
          onClick={handleUserClick}
          className="relative flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-surface-light rounded-lg transition-colors"
        >
          <div className="w-7 h-7 rounded-full bg-gradient-to-br from-purple-500 to-blue-400 flex items-center justify-center text-xs font-medium text-white overflow-hidden">
            {avatarUrl ? (
              <img src={avatarUrl} alt="avatar" className="w-full h-full object-cover" />
            ) : (
              'U'
            )}
          </div>
          <span className="text-sm text-muted flex-1 truncate">{username || '用户名'}</span>
          <span className="text-muted-dim text-sm">🔔</span>
          <UserMenuDropdown triggerRef={userMenuTriggerRef} />
        </div>
      </div>
    </aside>
  )
}
