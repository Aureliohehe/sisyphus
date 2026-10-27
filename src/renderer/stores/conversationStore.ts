import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { logger } from '../logger'

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
}

export interface Conversation {
  id: string
  title: string
  messages: ChatMessage[]
  createdAt: number
  updatedAt: number
  knowledgeSpaceId: string | null
}

interface ConversationState {
  conversations: Conversation[]
  activeId: string | null

  createConversation: (firstMessage: string, knowledgeSpaceId?: string | null) => string
  addMessage: (message: ChatMessage, conversationId?: string | null) => void
  appendToLastMessage: (content: string) => void
  deleteConversation: (id: string) => void
  clearAll: () => void
  setActive: (id: string | null) => void
  getActive: () => Conversation | null
  getActiveMessages: () => ChatMessage[]
  setConversationKnowledgeSpace: (id: string, spaceId: string | null) => void
  clearActiveMessages: () => void
}

let convId = 0
const nextConvId = () => `conv-${Date.now()}-${++convId}`

let msgId = 0
export const nextMsgId = () => `msg-${Date.now()}-${++msgId}`

export const useConversationStore = create<ConversationState>()(
  persist(
    (set, get) => ({
      conversations: [],
      activeId: null,

      createConversation: (firstMessage: string, knowledgeSpaceId: string | null = null) => {
        const id = nextConvId()
        const now = Date.now()
        const title = firstMessage.slice(0, 30) + (firstMessage.length > 30 ? '...' : '')
        logger.info(`[Conversation] Created: ${title} (${id})`)
        const newConv: Conversation = {
          id,
          title,
          messages: [],
          createdAt: now,
          updatedAt: now,
          knowledgeSpaceId
        }
        set((state) => ({
          conversations: [newConv, ...state.conversations],
          activeId: id
        }))
        return id
      },

      addMessage: (message: ChatMessage, conversationId?: string | null) => {
        const activeId = conversationId === undefined ? get().activeId : conversationId
        if (!activeId) return
        set((state) => ({
          conversations: state.conversations.map((c) =>
            c.id === activeId
              ? { ...c, messages: [...c.messages, message], updatedAt: Date.now() }
              : c
          )
        }))
      },

      appendToLastMessage: (content: string) => {
        const { activeId } = get()
        if (!activeId) return
        set((state) => ({
          conversations: state.conversations.map((c) => {
            if (c.id !== activeId) return c
            const msgs = [...c.messages]
            const last = msgs[msgs.length - 1]
            if (last && last.role === 'assistant') {
              msgs[msgs.length - 1] = { ...last, content: last.content + content }
            }
            return { ...c, messages: msgs, updatedAt: Date.now() }
          })
        }))
      },

      deleteConversation: (id: string) => {
        const conv = get().conversations.find((c) => c.id === id)
        logger.info(`[Conversation] Deleted: ${conv?.title ?? id}`)
        set((state) => {
          const filtered = state.conversations.filter((c) => c.id !== id)
          return {
            conversations: filtered,
            activeId: state.activeId === id ? (filtered[0]?.id ?? null) : state.activeId
          }
        })
      },

      clearAll: () => {
        set({ conversations: [], activeId: null })
      },

      setActive: (id: string | null) => {
        logger.debug(`[Conversation] Switched to: ${id}`)
        set({ activeId: id })
      },

      getActive: () => {
        const { conversations, activeId } = get()
        return conversations.find((c) => c.id === activeId) ?? null
      },

      getActiveMessages: () => {
        const active = get().getActive()
        return active?.messages ?? []
      },

      setConversationKnowledgeSpace: (id: string, spaceId: string | null) => {
        set((state) => ({
          conversations: state.conversations.map((c) =>
            c.id === id ? { ...c, knowledgeSpaceId: spaceId } : c
          )
        }))
      },

      clearActiveMessages: () => {
        const { activeId } = get()
        if (!activeId) return
        set((state) => ({
          conversations: state.conversations.map((c) =>
            c.id === activeId ? { ...c, messages: [], updatedAt: Date.now() } : c
          )
        }))
      }
    }),
    {
      name: 'sisyphus-conversations',
      partialize: (state) => ({
        conversations: state.conversations,
        activeId: state.activeId
      })
    }
  )
)
