import { useState, useRef, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { SUPPORTED_LANGUAGES } from '../i18n/languages'

// variant: 'dark' (white text, for colored headers) | 'light' (gray text, for white cards)
export default function LanguageSwitcher({ className = '', variant = 'dark' }) {
  const { i18n } = useTranslation()
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  const current = SUPPORTED_LANGUAGES.find(l => l.code === i18n.language?.slice(0, 2)) || SUPPORTED_LANGUAGES[0]

  useEffect(() => {
    function onClickOutside(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [])

  const btnClass = variant === 'dark'
    ? 'bg-white/20 hover:bg-white/30 text-white'
    : 'bg-gray-100 hover:bg-gray-200 text-gray-700'

  return (
    <div ref={ref} className={`relative ${className}`}>
      <button
        onClick={() => setOpen(o => !o)}
        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sm font-medium transition-colors ${btnClass}`}
        aria-label="Change language"
      >
        <span>{current.flag}</span>
        <span className="hidden sm:inline">{current.label}</span>
        <span className="text-xs opacity-70">▾</span>
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 bg-white rounded-2xl shadow-lg border border-gray-100 overflow-hidden z-50 min-w-[140px]">
          {SUPPORTED_LANGUAGES.map(lang => (
            <button
              key={lang.code}
              onClick={() => { i18n.changeLanguage(lang.code); setOpen(false) }}
              className={`w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-left transition-colors ${
                lang.code === current.code
                  ? 'bg-primary-50 text-primary-700 font-semibold'
                  : 'text-gray-700 hover:bg-gray-50 active:bg-gray-100'
              }`}
            >
              <span className="text-base">{lang.flag}</span>
              <span>{lang.label}</span>
              {lang.code === current.code && <span className="ml-auto text-primary-500">✓</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
