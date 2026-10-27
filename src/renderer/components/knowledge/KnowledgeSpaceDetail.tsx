import { useState, useCallback } from 'react'
import {
  ArrowLeft,
  Plus,
  FileText,
  File,
  Trash2,
  Upload,
  Loader2
} from 'lucide-react'
import { useKnowledgeStore } from '../../stores/knowledgeStore'
import { indexDocument, removeDocumentIndex } from '../../services/rag'
import NoteEditor from './NoteEditor'

interface Props {
  spaceId: string
  onBack: () => void
}

export default function KnowledgeSpaceDetail({ spaceId, onBack }: Props): JSX.Element {
  const space = useKnowledgeStore((s) => s.spaces.find((sp) => sp.id === spaceId))
  const docs = useKnowledgeStore((s) => s.docs.filter((d) => d.spaceId === spaceId))
  const addDoc = useKnowledgeStore((s) => s.addDoc)
  const updateDoc = useKnowledgeStore((s) => s.updateDoc)
  const deleteDoc = useKnowledgeStore((s) => s.deleteDoc)

  const [selectedDocId, setSelectedDocId] = useState<string | null>(null)
  const [showNewNote, setShowNewNote] = useState(false)
  const [newNoteTitle, setNewNoteTitle] = useState('')
  const [indexingDocId, setIndexingDocId] = useState<string | null>(null)
  const [indexProgress, setIndexProgress] = useState('')

  const selectedDoc = docs.find((d) => d.id === selectedDocId) ?? null

  const handleCreateNote = (): void => {
    const trimmed = newNoteTitle.trim()
    if (!trimmed) return
    const id = addDoc(spaceId, 'note', trimmed, '')
    setNewNoteTitle('')
    setShowNewNote(false)
    setSelectedDocId(id)
  }

  const handleUploadFile = useCallback(async (): Promise<void> => {
    if (!spaceId) return
    const files = await window.api.selectFiles()
    if (!files || files.length === 0) return

    for (const file of files) {
      const isText = file.name.endsWith('.txt') || file.name.endsWith('.md')
      if (!isText) continue

      const id = addDoc(spaceId, 'file', file.name, file.content)
      setIndexingDocId(id)
      setIndexProgress('正在索引...')

      try {
        await indexDocument(spaceId, id, file.content, (done, total) => {
          setIndexProgress(`索引中 ${done}/${total}`)
        })
      } catch {
        // silently ignore indexing errors; doc is still saved
      }

      setIndexingDocId(null)
      setIndexProgress('')
    }
  }, [spaceId, addDoc])

  const handleDeleteDoc = async (id: string): Promise<void> => {
    if (selectedDocId === id) setSelectedDocId(null)
    removeDocumentIndex(spaceId, id)
    deleteDoc(id)
  }

  const handleSaveNote = (title: string, content: string): void => {
    if (!selectedDoc) return
    updateDoc(selectedDoc.id, title, content)
    // re-index in background
    indexDocument(spaceId, selectedDoc.id, content).catch(() => {
      // ignore indexing errors
    })
  }

  if (!space) {
    return (
      <div className="h-full flex items-center justify-center text-muted-dim text-sm">
        空间不存在
      </div>
    )
  }

  return (
    <div className="h-full flex">
      {/* Left panel — doc list */}
      <div className="w-[280px] border-r border-surface-border flex flex-col">
        <div className="p-4 flex items-center gap-3">
          <button
            onClick={onBack}
            className="p-1.5 text-muted hover:text-white hover:bg-surface-lighter rounded-lg transition-colors"
          >
            <ArrowLeft size={18} />
          </button>
          <h1 className="text-base font-medium text-white truncate flex-1">{space.name}</h1>
        </div>

        <div className="px-3 pb-2 flex gap-2">
          <button
            onClick={() => setShowNewNote(true)}
            className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 text-xs text-white bg-surface-light border border-surface-border rounded-lg hover:bg-surface-lighter transition-colors"
          >
            <Plus size={12} />
            <span>笔记</span>
          </button>
          <button
            onClick={handleUploadFile}
            className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 text-xs text-white bg-surface-light border border-surface-border rounded-lg hover:bg-surface-lighter transition-colors"
          >
            <Upload size={12} />
            <span>文件</span>
          </button>
        </div>

        {indexingDocId && (
          <div className="px-3 py-1.5 flex items-center gap-2 text-xs text-muted">
            <Loader2 size={12} className="animate-spin" />
            <span>{indexProgress}</span>
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-3 space-y-0.5">
          {docs.length === 0 && (
            <p className="px-3 py-8 text-center text-sm text-muted-dim">暂无文档</p>
          )}
          {docs.map((doc) => (
            <button
              key={doc.id}
              onClick={() => setSelectedDocId(doc.id)}
              className={`group w-full flex items-center gap-2 px-3 py-2 text-sm rounded-lg transition-colors ${
                doc.id === selectedDocId
                  ? 'bg-surface-light text-white'
                  : 'text-muted hover:text-white hover:bg-surface-light'
              }`}
            >
              {doc.type === 'note' ? (
                <FileText size={14} className="shrink-0 text-blue-400" />
              ) : (
                <File size={14} className="shrink-0 text-green-400" />
              )}
              <span className="flex-1 text-left truncate">{doc.title}</span>
              <button
                onClick={(e) => { e.stopPropagation(); handleDeleteDoc(doc.id) }}
                className="shrink-0 opacity-0 group-hover:opacity-100 text-muted-dim hover:text-red-400 transition-opacity"
              >
                <Trash2 size={12} />
              </button>
            </button>
          ))}
        </div>
      </div>

      {/* Right panel — content */}
      <div className="flex-1 overflow-y-auto">
        {!selectedDoc && (
          <div className="h-full flex flex-col items-center justify-center text-muted-dim text-sm gap-3">
            <FileText size={40} className="opacity-30" />
            <p>选择或创建一个文档</p>
          </div>
        )}
        {selectedDoc?.type === 'note' && (
          <NoteEditor
            key={selectedDoc.id}
            title={selectedDoc.title}
            content={selectedDoc.content}
            onSave={handleSaveNote}
          />
        )}
        {selectedDoc?.type === 'file' && (
          <div className="h-full flex flex-col p-6">
            <h2 className="text-sm font-medium text-white mb-4">{selectedDoc.title}</h2>
            <div className="flex-1 bg-surface-light border border-surface-border rounded-xl p-4 overflow-auto">
              <pre className="text-xs text-muted whitespace-pre-wrap leading-relaxed font-mono">
                {selectedDoc.content}
              </pre>
            </div>
          </div>
        )}
      </div>

      {showNewNote && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="fixed inset-0 bg-black/60" onClick={() => setShowNewNote(false)} />
          <div className="relative w-full max-w-sm mx-4 bg-surface-light border border-surface-border rounded-2xl shadow-2xl p-5">
            <h2 className="text-sm font-medium text-white mb-4">新建笔记</h2>
            <input
              value={newNoteTitle}
              onChange={(e) => setNewNoteTitle(e.target.value)}
              placeholder="笔记标题"
              className="w-full px-3 py-2 text-sm text-white bg-surface border border-surface-border rounded-lg outline-none focus:border-muted transition-colors"
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCreateNote()
              }}
            />
            <div className="flex justify-end gap-2 mt-4">
              <button
                onClick={() => setShowNewNote(false)}
                className="px-4 py-1.5 text-sm text-muted hover:text-white transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleCreateNote}
                disabled={!newNoteTitle.trim()}
                className="px-4 py-1.5 text-sm text-white bg-surface-lighter border border-surface-border rounded-lg hover:bg-surface disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                创建
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
