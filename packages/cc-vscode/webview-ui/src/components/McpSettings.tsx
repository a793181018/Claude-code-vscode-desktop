import { useState, useEffect } from 'react'
import { restRequest } from '../vscodeApi'

interface McpServer {
  name: string
  command: string
  args: string[]
  url?: string
  disabled?: boolean
}

export function McpSettings() {
  const [servers, setServers] = useState<McpServer[]>([])
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [newName, setNewName] = useState('')
  const [newCommand, setNewCommand] = useState('')
  const [newUrl, setNewUrl] = useState('')

  useEffect(() => { loadServers() }, [])

  async function loadServers() {
    try {
      const data: any = await restRequest('/api/mcp')
      setServers(data?.servers || [])
    } catch (e: any) {
      console.error('McpSettings load error:', e.message || e)
      setServers([])
    }
    setLoading(false)
  }

  async function addServer() {
    if (!newName.trim()) return
    if (!newCommand.trim() && !newUrl.trim()) return
    try {
      await restRequest('/api/mcp', 'POST', {
        name: newName.trim(),
        command: newCommand.trim(),
        url: newUrl.trim() || undefined,
        args: [],
      })
      setNewName('')
      setNewCommand('')
      setNewUrl('')
      setShowAdd(false)
      loadServers()
    } catch { /* ignore */ }
  }

  async function toggleServer(name: string) {
    try {
      await restRequest(`/api/mcp/${name}/toggle`, 'POST')
      loadServers()
    } catch { /* ignore */ }
  }

  async function removeServer(name: string) {
    try {
      await restRequest(`/api/mcp/${name}`, 'DELETE')
      loadServers()
    } catch { /* ignore */ }
  }

  return (
    <div className="mcp-settings">
      <div className="mcp-header">
        <h3>MCP Servers</h3>
        <button className="btn-small" onClick={() => setShowAdd(!showAdd)}>
          {showAdd ? 'Cancel' : '+ Add'}
        </button>
      </div>

      {showAdd && (
        <div className="mcp-add-form">
          <input
            className="mcp-input"
            placeholder="Server name (e.g. web-search)"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
          />
          <input
            className="mcp-input"
            placeholder="URL (e.g. http://192.168.1.100:8000/mcp)"
            value={newUrl}
            onChange={(e) => setNewUrl(e.target.value)}
          />
          <input
            className="mcp-input"
            placeholder="Or command (e.g. npx @playwright/mcp@latest)"
            value={newCommand}
            onChange={(e) => setNewCommand(e.target.value)}
          />
          <button className="btn-small btn-primary" onClick={addServer}>Add</button>
        </div>
      )}

      {loading ? (
        <div className="mcp-empty">Loading...</div>
      ) : servers.length === 0 ? (
        <div className="mcp-empty">No MCP servers configured</div>
      ) : (
        <div className="mcp-list">
          {servers.map((s) => (
            <div key={s.name} className={`mcp-item ${s.disabled ? 'disabled' : ''}`}>
              <button
                className={`toggle-switch ${s.disabled ? 'off' : 'on'}`}
                onClick={() => toggleServer(s.name)}
                title={s.disabled ? 'Enable' : 'Disable'}
              >
                {s.disabled ? '○' : '●'}
              </button>
              <div className="mcp-item-info">
                <div className="mcp-item-name">{s.name}</div>
                <div className="mcp-item-cmd">{s.url || s.command}</div>
              </div>
              <button className="mcp-item-remove" onClick={() => removeServer(s.name)} title="Remove">×</button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
