import { useAppStore } from '../../stores/appStore'

const SEARCH_CATEGORIES = ['发现', '金融', '健康', '学术', '专利'] as const

export default function TopNav(): JSX.Element {
  const searchCategory = useAppStore((s) => s.searchCategory)
  const setSearchCategory = useAppStore((s) => s.setSearchCategory)

  return (
    <header className="h-12 border-b border-surface-border flex items-center px-6 gap-1 shrink-0 select-none">
      {SEARCH_CATEGORIES.map((cat) => (
        <button
          key={cat}
          onClick={() => setSearchCategory(searchCategory === cat ? null : cat)}
          className={`nav-chip px-4 py-1.5 text-sm rounded-lg transition-colors ${
            searchCategory === cat
              ? 'text-white bg-surface-light'
              : 'text-muted hover:text-white hover:bg-surface-light'
          }`}
        >
          {cat}
        </button>
      ))}
    </header>
  )
}
