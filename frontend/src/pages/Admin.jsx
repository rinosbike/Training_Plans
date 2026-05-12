import { useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import api from '../services/api'
import { useAuth } from '../contexts/AuthContext'
import BottomNav from '../components/BottomNav'
import toast from 'react-hot-toast'

const ROLE_LABELS = { super_admin: 'Super Admin', admin: 'Admin', user: 'User' }
const ROLE_STYLE = {
  super_admin: 'bg-red-100 text-red-700',
  admin: 'bg-amber-100 text-amber-700',
  user: 'bg-gray-100 text-gray-600',
}

export default function Admin() {
  const { user } = useAuth()
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

      {isSuperAdmin && (
        <div className="flex border-b border-gray-200 bg-white">
          {['users', 'logs'].map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`flex-1 py-3 text-sm font-medium transition-colors ${
                tab === t ? 'text-primary-600 border-b-2 border-primary-600' : 'text-gray-500'
              }`}
            >
              {t === 'users' ? 'Users' : 'AI Coach Logs'}
            </button>
          ))}
        </div>
      )}

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
