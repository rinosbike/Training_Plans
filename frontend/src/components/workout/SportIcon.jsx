import { useTranslation } from 'react-i18next'

const icons = {
  run:      { emoji: '🏃', color: 'bg-orange-500' },
  cycle:    { emoji: '🚴', color: 'bg-blue-500'   },
  swim:     { emoji: '🏊', color: 'bg-cyan-500'   },
  strength: { emoji: '🏋️', color: 'bg-purple-500' },
  core:     { emoji: '🧘', color: 'bg-pink-500'   },
  brick:    { emoji: '🔥', color: 'bg-amber-500'  },
  rest:     { emoji: '💤', color: 'bg-gray-300'   },
}

export function SportBadge({ sport, size = 'md' }) {
  const s = icons[sport] || icons.rest
  const sizeClass = size === 'sm' ? 'w-7 h-7 text-sm' : size === 'lg' ? 'w-12 h-12 text-2xl' : 'w-9 h-9 text-lg'
  return (
    <span className={`${sizeClass} ${s.color} rounded-full flex items-center justify-center text-white`}>
      {s.emoji}
    </span>
  )
}

export function SportLabel({ sport }) {
  const { t } = useTranslation('workouts')
  return <span>{t(`sports.${sport}`, sport)}</span>
}

export default icons
