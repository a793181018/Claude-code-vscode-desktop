import { useState, useEffect } from 'react'
import { restRequest } from '../vscodeApi'

interface AgentInfo {
  name: string
  description: string
  tools: string[]
  model: string
}

const TOOL_OPTIONS = ['Read', 'Write', 'Edit', 'Bash', 'Grep', 'Glob', 'WebFetch', 'WebSearch', 'Agent']

export function AgentsSettings() {
  const [agents, setAgents] = useState<AgentInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [newName, setNewName] = useState('')
  const [newDesc, setNewDesc] = useState('')
  const [newPrompt, setNewPrompt] = useState('')
  const [newTools, setNewTools] = useState<string>('')

  useEffect(() => { loadAgents() }, [])

  async function loadAgents() {
    setLoading(true)
    try {
      const data: any = await restRequest('/api/agents')
      setAgents(data?.agents || [])
    } catch { setAgents([]) }
    setLoading(false)
  }

  async function addAgent() {
    if (!newName.trim() || !newDesc.trim() || !newPrompt.trim()) return
    try {
      await restRequest('/api/agents', 'POST', {
        name: newName.trim(),
        description: newDesc.trim(),
        prompt: newPrompt.trim(),
        tools: newTools ? newTools.split(/[,\s]+/).filter(Boolean) : undefined,
      })
      setNewName(''); setNewDesc(''); setNewPrompt(''); setNewTools('')
      setShowAdd(false)
      loadAgents()
    } catch { /* ignore */ }
  }

  async function removeAgent(name: string) {
    try {
      await restRequest(`/api/agents/${name}`, 'DELETE')
      loadAgents()
    } catch { /* ignore */ }
  }

  return (
    <div className="mcp-settings">
      <div className="mcp-header">
        <h3>Agents</h3>
        <button className="btn-small" onClick={() => setShowAdd(!showAdd)}>
          {showAdd ? 'Cancel' : '+ Add'}
        </button>
      </div>

      {showAdd && (
        <div className="mcp-add-form">
          <input className="mcp-input" placeholder="Agent name (e.g. code-reviewer)" value={newName} onChange={(e) => setNewName(e.target.value)} />
          <input className="mcp-input" placeholder="Description" value={newDesc} onChange={(e) => setNewDesc(e.target.value)} />
          <textarea className="mcp-textarea" placeholder="System prompt" value={newPrompt} onChange={(e) => setNewPrompt(e.target.value)} rows={4} />
          <input className="mcp-input" placeholder="Tools (comma-separated, e.g. Read, Grep, Bash)" value={newTools} onChange={(e) => setNewTools(e.target.value)} />
          <div style={{ fontSize: 10, opacity: 0.5 }}>Available: {TOOL_OPTIONS.join(', ')}</div>
          <button className="btn-small btn-primary" onClick={addAgent}>Add</button>
        </div>
      )}

      {loading ? (
        <div className="mcp-empty">Loading...</div>
      ) : agents.length === 0 ? (
        <div className="mcp-empty">No agents configured</div>
      ) : (
        <div className="mcp-list">
          {agents.map((a) => (
            <div key={a.name} className="mcp-item">
              <div className="mcp-item-info">
                <div className="mcp-item-name">{a.name}</div>
                <div className="mcp-item-cmd">{a.description}</div>
              </div>
              <button className="mcp-item-remove" onClick={() => removeAgent(a.name)} title="Remove">×</button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
