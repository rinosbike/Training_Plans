import { useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import api from '../services/api'
import { useAuth } from '../contexts/AuthContext'
import BottomNav from '../components/BottomNav'
import toast from 'react-hot-toast'
import { useTranslation } from 'react-i18next'
import ZaiUsageBar from '../components/ZaiUsageBar'

const ROLE_LABELS = { super_admin: 'Super Admin', admin: 'Admin', user: 'User' }
const ROLE_STYLE = {
  super_admin: 'bg-red-100 text-red-700',
  admin: 'bg-amber-100 text-amber-700',
  user: 'bg-gray-100 text-gray-600',
}

export default function Admin() {
  const { user } = useAuth()
  const { t } = useTranslation('common')
  const qc = useQueryClient()
  const [tab, setTab] = useState('users')
  const [logsUserId, setLogsUserId] = useState(null)
  const [logsSessionId, setLogsSessionId] = useState(null)

  if (user && !['admin', 'super_admin'].includes(user.role)) return <Navigate to="/settings" replace />

  const { data: users = [], isLoading } = useQuery({
    queryKey: ['admin-users'],
    queryFn: () => api.get('/api/admin/users').then(r => r.data),
  })

  const setRole = useMutation({
    mutationFn: ({ id, role }) => api.put(`/api/admin/users/${id}/role`, { role }),
    onSuccess: () => { qc.invalidateQueries(['admin-users']); toast.success('Role updated') },
    onError: (e) => toast.error(e.response?.data?.error || 'Failed to update role'),
  })

  const isSuperAdmin = user?.role === 'super_admin'

  return (
    <div className="min-h-screen bg-gray-50 pb-nav">
      <div className="bg-primary-600 text-white px-4 pt-12 pb-4">
        <h1 className="text-xl font-bold">Admin</h1>
        <p className="text-primary-200 text-sm">{users.length} registered user{users.length !== 1 ? 's' : ''}</p>
      </div>

      <div className="flex border-b border-gray-200 bg-white">
        {(isSuperAdmin ? ['users', 'usage', 'logs'] : ['users', 'usage']).map(tb => (
          <button
            key={tb}
            onClick={() => setTab(tb)}
            className={`flex-1 py-3 text-sm font-medium transition-colors ${
              tab === tb ? 'text-primary-600 border-b-2 border-primary-600' : 'text-gray-500'
            }`}
          >
            {tb === 'users' ? 'Users' : tb === 'usage' ? t('zai.usageTab') : 'AI Coach Logs'}
          </button>
        ))}
      </div>

      <div className="px-4 mt-4">
        {tab === 'users' && (
          <>
            {isLoading && <p className="text-center py-12 text-gray-400 text-sm">Loading...</p>}
            <div className="space-y-2">
              {users.map(u => (
                <UserRow
                  key={u.id}
                  u={u}
                  currentUserId={user?.id}
                  isSuperAdmin={isSuperAdmin}
                  onRoleChange={(role) => setRole.mutate({ id: u.id, role })}
                  pending={setRole.isPending}
                  onViewLogs={isSuperAdmin ? () => { setLogsUserId(u.id); setLogsSessionId(null); setTab('logs') } : null}
                />
              ))}
            </div>
          </>
        )}

        {tab === 'usage' && <UsagePanel />}

        {tab === 'logs' && isSuperAdmin && (
          <LogsPanel
            users={users}
            selectedUserId={logsUserId}
            selectedSessionId={logsSessionId}
            onSelectUser={(id) => { setLogsUserId(id); setLogsSessionId(null) }}
            onSelectSession={setLogsSessionId}
          />
        )}
      </div>

      <BottomNav />
    </div>
  )
}

function UserRow({ u, currentUserId, isSuperAdmin, onRoleChange, pending, onViewLogs }) {
  const [open, setOpen] = useState(false)
  const isSelf = String(u.id) === String(currentUserId)
  const canChangeRole = isSuperAdmin && !isSelf && u.role !== 'super_admin'

  const lastActive = u.last_active
    ? new Date(u.last_active).toLocaleDateString()
    : 'Never'

  return (
    <div className="bg-white rounded-2xl border border-gray-100 px-4 py-3">
      <div className="flex items-center gap-3">
        {u.avatar_url
          ? <img src={u.avatar_url} className="w-9 h-9 rounded-full border border-gray-200" alt="" />
          : <div className="w-9 h-9 rounded-full bg-primary-100 flex items-center justify-center text-sm font-bold text-primary-700">{u.name?.[0] || '?'}</div>
        }
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-gray-900 truncate">{u.name || '—'}</p>
          <p className="text-xs text-gray-400 truncate">{u.email}</p>
        </div>
        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${ROLE_STYLE[u.role] || ROLE_STYLE.user}`}>
          {ROLE_LABELS[u.role] || u.role}
        </span>
        <div className="flex gap-1 shrink-0">
          {onViewLogs && (
            <button
              onClick={onViewLogs}
              className="text-xs px-2 py-1 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50"
              title="View AI logs"
            >
              💬
            </button>
          )}
          {canChangeRole && (
            <button
              onClick={() => setOpen(o => !o)}
              className="text-xs px-2 py-1 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50"
            >
              {open ? '✕' : '···'}
            </button>
          )}
        </div>
      </div>

      <div className="mt-1 text-xs text-gray-400">
        Joined {new Date(u.created_at).toLocaleDateString()} · Last active {lastActive}
      </div>

      {open && canChangeRole && (
        <div className="mt-3 flex gap-2 flex-wrap">
          {['user', 'admin'].filter(r => r !== u.role).map(r => (
            <button
              key={r}
              disabled={pending}
              onClick={() => { onRoleChange(r); setOpen(false) }}
              className={`text-xs px-3 py-1.5 rounded-lg font-medium border transition-colors disabled:opacity-50 ${
                r === 'admin' ? 'border-amber-300 text-amber-700 bg-amber-50 hover:bg-amber-100' : 'border-gray-200 text-gray-600 bg-gray-50 hover:bg-gray-100'
              }`}
            >
              Set as {ROLE_LABELS[r]}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function LogsPanel({ users, selectedUserId, selectedSessionId, onSelectUser, onSelectSession }) {
  const { data: sessionsData, isLoading: loadingSessions } = useQuery({
    queryKey: ['admin-ai-sessions', selectedUserId],
    queryFn: () => api.get(`/api/admin/ai-logs?user_id=${selectedUserId}`).then(r => r.data),
    enabled: !!selectedUserId,
  })

  const { data: threadData, isLoading: loadingThread } = useQuery({
    queryKey: ['admin-ai-thread', selectedSessionId, selectedUserId],
    queryFn: () => api.get(`/api/admin/ai-logs/${selectedSessionId}?user_id=${selectedUserId}`).then(r => r.data),
    enabled: !!selectedSessionId && !!selectedUserId,
  })

  const selectedUser = users.find(u => String(u.id) === String(selectedUserId))

  return (
    <div className="space-y-3">
      {/* User picker */}
      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1.5">Select user</label>
        <select
          value={selectedUserId || ''}
          onChange={e => onSelectUser(e.target.value || null)}
          className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
        >
          <option value="">— pick a user —</option>
          {users.map(u => (
            <option key={u.id} value={u.id}>{u.name || u.email} ({u.email})</option>
          ))}
        </select>
      </div>

      {/* Session list */}
      {selectedUserId && (
        <div>
          {loadingSessions && <p className="text-xs text-gray-400 py-4 text-center">Loading sessions…</p>}
          {sessionsData && sessionsData.sessions.length === 0 && (
            <p className="text-xs text-gray-400 py-4 text-center">No AI sessions for this user.</p>
          )}
          {sessionsData && sessionsData.sessions.length > 0 && (
            <>
              <p className="text-xs font-medium text-gray-500 mb-1.5">
                {sessionsData.sessions.length} session{sessionsData.sessions.length !== 1 ? 's' : ''} for {sessionsData.user.name || sessionsData.user.email}
              </p>
              <div className="space-y-1.5">
                {sessionsData.sessions.map(s => (
                  <button
                    key={s.id}
                    onClick={() => onSelectSession(s.id)}
                    className={`w-full text-left bg-white rounded-xl border px-3 py-2.5 transition-colors ${
                      s.id === selectedSessionId
                        ? 'border-primary-400 bg-primary-50'
                        : 'border-gray-100 hover:bg-gray-50'
                    }`}
                  >
                    <p className="text-sm font-medium text-gray-900 truncate">
                      {s.title || <span className="text-gray-400 italic">Untitled</span>}
                    </p>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {s.message_count} message{s.message_count !== 1 ? 's' : ''} ·{' '}
                      {s.updated_at ? new Date(s.updated_at).toLocaleString(undefined, {
                        month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
                      }) : '—'}
                    </p>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* Message thread */}
      {selectedSessionId && (
        <div className="mt-2">
          <button
            onClick={() => onSelectSession(null)}
            className="text-xs text-primary-600 mb-2 flex items-center gap-1"
          >
            ← Back to sessions
          </button>
          {loadingThread && <p className="text-xs text-gray-400 py-4 text-center">Loading messages…</p>}
          {threadData && (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-gray-500 mb-2">
                {threadData.session.title || 'Untitled session'} · {threadData.messages.length} messages
              </p>
              {threadData.messages.map((m, i) => (
                <div
                  key={i}
                  className={`rounded-xl px-3 py-2 text-xs leading-relaxed whitespace-pre-wrap ${
                    m.role === 'user'
                      ? 'bg-primary-50 border border-primary-100 text-primary-900 ml-6'
                      : 'bg-white border border-gray-200 text-gray-800 mr-6'
                  }`}
                >
                  <span className={`font-semibold text-[10px] uppercase tracking-wide block mb-1 ${
                    m.role === 'user' ? 'text-primary-500' : 'text-gray-400'
                  }`}>
                    {m.role === 'user' ? 'User' : 'AI Coach'}
                    {m.tokens_used ? ` · ${m.tokens_used} tok` : ''}
                    {m.created_at ? ` · ${new Date(m.created_at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}` : ''}
                  </span>
                  {m.content}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function UsagePanel() {
  const { t } = useTranslation('common')
  const { data, isLoading } = useQuery({
    queryKey: ['admin-zai-usage'],
    queryFn: () => api.get('/api/admin/zai-usage').then(r => r.data),
  })
  if (isLoading) return <p className="text-sm text-gray-400">…</p>
  const featureLabel = (f) => t(`zai.f_${f}`, { defaultValue: f })
  const Table = ({ title, rows, nameKey, label }) => (
    <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
      <p className="px-3 py-2 text-xs font-semibold text-gray-600 bg-gray-50">{title} · {t('zai.last30')}</p>
      {rows.length === 0 ? <p className="px-3 py-3 text-xs text-gray-400">{t('zai.none')}</p> : (
        <table className="w-full text-xs">
          <thead><tr className="text-gray-400 text-left">
            <th className="px-3 py-1.5 font-medium"></th>
            <th className="px-2 py-1.5 font-medium text-right">{t('zai.calls')}</th>
            {rows[0].problems !== undefined && <th className="px-2 py-1.5 font-medium text-right">{t('zai.problems')}</th>}
            <th className="px-3 py-1.5 font-medium text-right">{t('zai.tokens')}</th>
          </tr></thead>
          <tbody>
            {rows.map(r => (
              <tr key={r[nameKey]} className="border-t border-gray-50">
                <td className="px-3 py-1.5 text-gray-700 truncate max-w-[10rem]">{label(r[nameKey])}</td>
                <td className="px-2 py-1.5 text-right">{r.calls}</td>
                {r.problems !== undefined && <td className="px-2 py-1.5 text-right">{r.problems}</td>}
                <td className="px-3 py-1.5 text-right">{Number(r.tokens).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
  return (
    <div className="space-y-3">
      <ZaiUsageBar />
      <Table title={t('zai.byFeature')} rows={data?.by_feature || []} nameKey="feature" label={featureLabel} />
      <Table title={t('zai.byUser')} rows={data?.by_user || []} nameKey="user" label={(u) => u} />
    </div>
  )
}
