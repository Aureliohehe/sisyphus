export interface AgentEvent {
  type: 'text_delta' | 'tool_start' | 'tool_end' | 'done' | 'error'
  requestId: string
  text?: string
  tool?: string
  callId?: string
  error?: string
  cancelled?: boolean
}
