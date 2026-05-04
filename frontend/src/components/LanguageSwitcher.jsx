import { useState, useRef, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { SUPPORTED_LANGUAGES } from '../i18n/languages'

/**
 * variant:
 *   'dark'     – white text, for colored headers
 *   'light'    – gray text, for white cards
 *   'floating' – white pill with shadow, works on any background (global overlay)
 */
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

  const btnClass =
    variant === 'dark'     ? 'bg-white/20 hover:bg-white/30 text-white' :
    variant === 'floating' ? 'bg-white hover:bg-gray-50 text-gray-700 shadow border border-gray-200' :
                             'bg-gray-100 hover:bg-gray-200 text-gray-700'

  return (
    <div ref={ref} className={`relative ${className}`}>
      <button
        onClick={() => setOpen(o => !o)}
        className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-sm font-medium transition-colors ${btnClass}`}
        aria-label="Change language"
      >
        <span className={`fi fi-${current.flagCode} rounded-sm`} style={{ width: '1.2em', height: '0.9em', display: 'inline-block' }} />
        <span className="text-xs font-semibold tracking-wide">{current.code.toUpperCase()}</span>
        <span className="text-xs opacity-50">▾</span>
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 bg-white rounded-2xl shadow-xl border border-gray-100 overflow-hidden z-[70] min-w-[160px]">
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
              <span className={`fi fi-${lang.flagCode} rounded-sm shrink-0`} style={{ width: '1.33em', height: '1em', display: 'inline-block' }} />
              <span>{lang.label}</span>
              {lang.code === current.code && <span className="ml-auto text-primary-500 text-xs">✓</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
