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
        <h1 className="text-xl font-bold">User Management</h1>
        <p className="text-primary-200 text-sm">{users.length} registered user{users.length !== 1 ? 's' : ''}</p>
      </div>

      <div className="px-4 mt-4">
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
            />
          ))}
        </div>
      </div>

      <BottomNav />
    </div>
  )
}

function UserRow({ u, currentUserId, isSuperAdmin, onRoleChange, pending }) {
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
        {canChangeRole && (
          <button
            onClick={() => setOpen(o => !o)}
            className="text-xs px-2 py-1 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 shrink-0"
          >
            {open ? '✕' : '···'}
          </button>
        )}
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
