import { NavLink } from 'react-router-dom'

const tabs = [
  { to: '/',          label: 'Plan',       icon: '📅' },
  { to: '/nutrition', label: 'Food',       icon: '🥗' },
  { to: '/progress',  label: 'Load',       icon: '📈' },
  { to: '/ai-coach',  label: 'AI Coach',   icon: '🤖' },
  { to: '/settings',  label: 'Settings',   icon: '⚙️' },
]

export default function BottomNav() {
  return (
    <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 safe-bottom z-50">
      <div className="flex max-w-lg mx-auto">
        {tabs.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            end={tab.to === '/'}
            className={({ isActive }) =>
              `flex-1 flex flex-col items-center py-2 text-xs font-medium transition-colors ${
                isActive ? 'text-primary-600' : 'text-gray-500'
              }`
            }
          >
            <span className="text-xl mb-0.5">{tab.icon}</span>
            {tab.label}
          </NavLink>
        ))}
      </div>
    </nav>
  )
}
