import { useChatStore } from '../useChatStore'
import { t } from '../i18n'

const MODELS = [
  { id: 'claude-sonnet-4-20250514', key: 'model.sonnet' },
  { id: 'claude-haiku-4-20250514', key: 'model.haiku' },
  { id: 'claude-opus-4-7', key: 'model.opus' },
]

const PERM_MODES = [
  { id: 'bypassPermissions', key: 'perm.bypass' },
  { id: 'acceptEdits', key: 'perm.acceptEdits' },
  { id: 'default', key: 'perm.default' },
  { id: 'plan', key: 'perm.plan' },
]

export function SettingsBar() {
  const model = useChatStore((s) => s.activeModel)
  const permMode = useChatStore((s) => s.activePermissionMode)
  const locale = useChatStore((s) => s.locale)
  const setRuntimeConfig = useChatStore((s) => s.setRuntimeConfig)
  const setPermissionMode = useChatStore((s) => s.setPermissionMode)
  const toggleLocale = useChatStore((s) => s.toggleLocale)
  const chatState = useChatStore((s) => s.chatState)
  const sessionId = useChatStore((s) => s.sessionId)
  const disabled = !sessionId || chatState !== 'idle'

  return (
    <div className="settings-bar">
      <div className="settings-group">
        <label className="settings-label">{t('settings.model', locale)}</label>
        <select
          className="settings-select"
          value={model}
          disabled={disabled}
          onChange={(e) => setRuntimeConfig(e.target.value)}
        >
          {MODELS.map((m) => (
            <option key={m.id} value={m.id}>{t(m.key, locale)}</option>
          ))}
        </select>
      </div>
      <div className="settings-group">
        <label className="settings-label">{t('settings.permission', locale)}</label>
        <select
          className="settings-select"
          value={permMode}
          disabled={disabled}
          onChange={(e) => setPermissionMode(e.target.value)}
        >
          {PERM_MODES.map((m) => (
            <option key={m.id} value={m.id}>{t(m.key, locale)}</option>
          ))}
        </select>
      </div>
      <div className="settings-spacer" />
      <div className="settings-group">
        <button className="lang-toggle" onClick={toggleLocale} title="Toggle language">
          {locale === 'en' ? 'EN' : '中'}
        </button>
      </div>
      <div className="settings-tokens">
        <TokenUsage locale={locale} />
      </div>
    </div>
  )
}

function TokenUsage({ locale }: { locale: string }) {
  const usage = useChatStore((s) => s.tokenUsage)
  return (
    <span className="token-usage">
      Tok: {usage.input_tokens}+{usage.output_tokens}
    </span>
  )
}
