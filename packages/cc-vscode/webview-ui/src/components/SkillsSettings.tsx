import { useState, useEffect } from 'react'
import { restRequest } from '../vscodeApi'
import { t } from '../i18n'
import { useChatStore } from '../useChatStore'

interface SkillInfo {
  name: string
  description: string
  modelInvocation: boolean
  enabled: boolean
}

export function SkillsSettings() {
  const [skills, setSkills] = useState<SkillInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [scope, setScope] = useState<'project' | 'user'>('project')
  const [showImport, setShowImport] = useState(false)
  const [newName, setNewName] = useState('')
  const [newDesc, setNewDesc] = useState('')
  const [newContent, setNewContent] = useState('')
  const [importPath, setImportPath] = useState('')
  const locale = useChatStore((s) => s.locale)

  useEffect(() => { loadSkills() }, [scope])

  async function loadSkills() {
    setLoading(true)
    try {
      const data: any = await restRequest(`/api/skills?scope=${scope}`)
      setSkills(data?.skills || [])
    } catch { setSkills([]) }
    setLoading(false)
  }

  async function addSkill() {
    if (!newName.trim() || !newDesc.trim()) return
    try {
      await restRequest('/api/skills', 'POST', {
        name: newName.trim(),
        description: newDesc.trim(),
        content: newContent.trim(),
        scope,
      })
      setNewName(''); setNewDesc(''); setNewContent('')
      setShowAdd(false)
      loadSkills()
    } catch { /* ignore */ }
  }

  async function importFromPath() {
    if (!importPath.trim()) return
    try {
      const data: any = await restRequest('/api/skills/import', 'POST', {
        sourcePath: importPath.trim(),
        scope,
      })
      alert(`${t('skills.imported', locale)} ${data.imported} ${t('skills.title', locale).toLowerCase()}`)
      setImportPath('')
      setShowImport(false)
      loadSkills()
    } catch (e: any) { alert(`${t('skills.importFailed', locale)}: ${e.message || e}`) }
  }

  async function toggleSkill(name: string) {
    try {
      await restRequest(`/api/skills/${name}/toggle?scope=${scope}`, 'POST')
      loadSkills()
    } catch { /* ignore */ }
  }

  async function removeSkill(name: string) {
    try {
      await restRequest(`/api/skills/${name}?scope=${scope}`, 'DELETE')
      loadSkills()
    } catch { /* ignore */ }
  }

  return (
    <div className="mcp-settings">
      <div className="mcp-header" style={{ flexWrap: 'wrap', gap: 4 }}>
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <button className={`mcp-tab ${scope === 'project' ? 'active' : ''}`} onClick={() => setScope('project')} style={{ fontSize: 10, padding: '2px 6px' }}>
            {t('skills.scope.project', locale)}
          </button>
          <button className={`mcp-tab ${scope === 'user' ? 'active' : ''}`} onClick={() => setScope('user')} style={{ fontSize: 10, padding: '2px 6px' }}>
            {t('skills.scope.user', locale)}
          </button>
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          <button className="btn-small" onClick={() => { setShowImport(!showImport); setShowAdd(false) }}>
            {showImport ? t('skills.cancel', locale) : t('skills.import', locale)}
          </button>
          <button className="btn-small" onClick={() => { setShowAdd(!showAdd); setShowImport(false) }}>
            {showAdd ? t('skills.cancel', locale) : t('skills.add', locale)}
          </button>
        </div>
      </div>

      {showImport && (
        <div className="mcp-add-form">
          <input className="mcp-input" placeholder={t('skills.importPathPlaceholder', locale)} value={importPath} onChange={(e) => setImportPath(e.target.value)} />
          <button className="btn-small btn-primary" onClick={importFromPath}>{t('skills.import', locale)}</button>
        </div>
      )}

      {showAdd && (
        <div className="mcp-add-form">
          <input className="mcp-input" placeholder={t('skills.namePlaceholder', locale)} value={newName} onChange={(e) => setNewName(e.target.value)} />
          <input className="mcp-input" placeholder={t('skills.descPlaceholder', locale)} value={newDesc} onChange={(e) => setNewDesc(e.target.value)} />
          <textarea
            className="mcp-textarea"
            placeholder={t('skills.contentPlaceholder', locale)}
            value={newContent}
            onChange={(e) => setNewContent(e.target.value)}
            rows={6}
          />
          <button className="btn-small btn-primary" onClick={addSkill}>{t('skills.btnAdd', locale)}</button>
        </div>
      )}

      {loading ? (
        <div className="mcp-empty">{t('error.loading', locale)}</div>
      ) : skills.length === 0 ? (
        <div className="mcp-empty">{t('skills.empty', locale)}</div>
      ) : (
        <div className="mcp-list">
          {skills.map((s) => (
            <div key={s.name} className={`mcp-item ${!s.enabled ? 'disabled' : ''}`}>
              <button
                className={`toggle-switch ${s.enabled ? 'on' : 'off'}`}
                onClick={() => toggleSkill(s.name)}
                title={s.enabled ? t('skills.toggleDisable', locale) : t('skills.toggleEnable', locale)}
              >
                {s.enabled ? '●' : '○'}
              </button>
              <div className="mcp-item-info">
                <div className="mcp-item-name">{s.name}</div>
                <div className="mcp-item-cmd">{s.description}</div>
              </div>
              <button className="mcp-item-remove" onClick={() => removeSkill(s.name)} title={t('skills.remove', locale)}>×</button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
