interface SessionInfo {
  sessionId: string
  title: string
  workDir: string
  createdAt: number
}

interface Props {
  sessions: SessionInfo[]
  activeSessionId: string | null
  onSelect: (sessionId: string) => void
  onNew: () => void
  onDelete: (sessionId: string) => void
}

export function Sidebar({ sessions, activeSessionId, onSelect, onNew, onDelete }: Props) {
  return (
    <div className="sidebar">
      <div className="sidebar-header">
        <h3>Sessions</h3>
        <button className="btn-new" onClick={onNew} title="New Session">
          +
        </button>
      </div>
      <div className="sidebar-list">
        {sessions.length === 0 && (
          <div className="sidebar-empty">No sessions yet</div>
        )}
        {sessions.map((s) => (
          <div
            key={s.sessionId}
            className={`sidebar-item ${s.sessionId === activeSessionId ? 'active' : ''}`}
            onClick={() => onSelect(s.sessionId)}
          >
            <div className="sidebar-item-title">{s.title}</div>
            <div className="sidebar-item-meta">
              {s.workDir && <span className="sidebar-item-dir">{shortPath(s.workDir)}</span>}
            </div>
            <button
              className="sidebar-item-delete"
              onClick={(e) => {
                e.stopPropagation()
                onDelete(s.sessionId)
              }}
              title="Delete"
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}

function shortPath(p: string): string {
  const parts = p.split('/')
  return parts.slice(-2).join('/') || p
}
