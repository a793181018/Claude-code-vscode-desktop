interface PendingPermission {
  requestId: string
  toolName: string
  toolUseId?: string
  input: unknown
  description?: string
}

interface Props {
  permission: PendingPermission
  onRespond: (requestId: string, allowed: boolean) => void
}

export function PermissionDialog({ permission, onRespond }: Props) {
  return (
    <div className="permission-overlay">
      <div className="permission-dialog">
        <h3>Permission Required</h3>
        <div className="permission-tool">
          Claude wants to run <strong>{permission.toolName}</strong>
        </div>
        {permission.description && (
          <div className="permission-desc">{permission.description}</div>
        )}
        {permission.input && (
          <pre className="permission-input">
            {JSON.stringify(permission.input, null, 2)}
          </pre>
        )}
        <div className="permission-actions">
          <button
            className="btn-allow"
            onClick={() => onRespond(permission.requestId, true)}
          >
            Allow
          </button>
          <button
            className="btn-deny"
            onClick={() => onRespond(permission.requestId, false)}
          >
            Deny
          </button>
        </div>
      </div>
    </div>
  )
}
