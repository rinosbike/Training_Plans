const icons = {
  run:      { emoji: '🏃', color: 'bg-orange-500', label: 'Run' },
  cycle:    { emoji: '🚴', color: 'bg-blue-500',   label: 'Ride' },
  swim:     { emoji: '🏊', color: 'bg-cyan-500',   label: 'Swim' },
  strength: { emoji: '🏋️', color: 'bg-purple-500', label: 'Strength' },
  core:     { emoji: '🧘', color: 'bg-pink-500',   label: 'Core' },
  brick:    { emoji: '🔥', color: 'bg-amber-500',  label: 'Brick' },
  rest:     { emoji: '💤', color: 'bg-gray-300',   label: 'Rest' },
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
  return <span>{(icons[sport] || icons.rest).label}</span>
}

export default icons
