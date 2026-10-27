import { create } from 'zustand'

interface AgentState {
  workspace: string | null
  requestId: string | null
  status: string
}

export const useAgentStore = create<AgentState>(() => ({
  workspace: null,
  requestId: null,
  status: ''
}))
