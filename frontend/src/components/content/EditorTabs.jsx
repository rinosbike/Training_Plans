import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

export default function EditorTabs({ storyId, active }) {
  const { t } = useTranslation('content')
  const navigate = useNavigate()

  const tabs = [
    { key: 'edit', label: t('tabs.edit', { defaultValue: 'Edit' }), path: `/content/${storyId}` },
    { key: 'preview', label: t('tabs.preview', { defaultValue: 'Preview' }), path: `/content/${storyId}/preview` },
  ]

  return (
    <div className="flex gap-1 bg-white/10 rounded-lg p-0.5 mt-3 w-fit">
      {tabs.map(tab => (
        <button
          key={tab.key}
          onClick={() => tab.key !== active && navigate(tab.path)}
          className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
            tab.key === active ? 'bg-white text-primary-700' : 'text-white/70 hover:text-white'
          }`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  )
}
