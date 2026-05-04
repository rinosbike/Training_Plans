import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useMutation } from '@tanstack/react-query'
import api from '../services/api'
import { useAuth } from '../contexts/AuthContext'
import { SUPPORTED_LANGUAGES, NAMESPACES } from '../i18n/languages'
import toast from 'react-hot-toast'

// Load all locale bundles at build time
const localeModules = import.meta.glob('../locales/**/*.json', { eager: true })

function buildResources() {
  const res = {}
  for (const path in localeModules) {
    const match = path.match(/\.\.\/locales\/(\w+)\/(\w+)\.json$/)
    if (match) {
      const [, lang, ns] = match
      if (!res[lang]) res[lang] = {}
      res[lang][ns] = localeModules[path].default || localeModules[path]
    }
  }
  return res
}

function flattenKeys(obj, prefix = '') {
  const out = {}
  for (const k of Object.keys(obj)) {
    const full = prefix ? `${prefix}.${k}` : k
    if (typeof obj[k] === 'object' && obj[k] !== null) {
      Object.assign(out, flattenKeys(obj[k], full))
    } else {
      out[full] = obj[k]
    }
  }
  return out
}

export default function Translations() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const { t, i18n } = useTranslation('settings')

  const [selectedLang, setSelectedLang] = useState('de')
  const [selectedNs, setSelectedNs] = useState('all')
  const [autoTranslating, setAutoTranslating] = useState(false)
  const [autoResults, setAutoResults] = useState(null)

  if (!user?.is_admin) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-gray-500">Admin access required.</p>
      </div>
    )
  }

  const resources = useMemo(() => buildResources(), [])

  const enKeys = useMemo(() => {
    const merged = {}
    for (const ns of NAMESPACES) {
      const flat = flattenKeys(resources['en']?.[ns] || {})
      for (const [k, v] of Object.entries(flat)) {
        merged[`${ns}.${k}`] = v
      }
    }
    return merged
  }, [resources])

  const stats = useMemo(() => {
    return SUPPORTED_LANGUAGES.filter(l => l.code !== 'en').map(lang => {
      let total = 0, translated = 0
      for (const ns of NAMESPACES) {
        const flat = flattenKeys(resources[lang.code]?.[ns] || {})
        const enFlat = flattenKeys(resources['en']?.[ns] || {})
        for (const k of Object.keys(enFlat)) {
          total++
          if (flat[k] && flat[k] !== '__MISSING__') translated++
        }
      }
      const pct = total > 0 ? Math.round((translated / total) * 100) : 0
      return { ...lang, total, translated, missing: total - translated, pct }
    })
  }, [resources])

  const missingKeys = useMemo(() => {
    const lang = selectedLang
    const keys = []
    const nsList = selectedNs === 'all' ? NAMESPACES : [selectedNs]
    for (const ns of nsList) {
      const enFlat = flattenKeys(resources['en']?.[ns] || {})
      const langFlat = flattenKeys(resources[lang]?.[ns] || {})
      for (const [k, enVal] of Object.entries(enFlat)) {
        if (!langFlat[k] || langFlat[k] === '__MISSING__') {
          keys.push({ ns, key: k, enValue: enVal })
        }
      }
    }
    return keys
  }, [resources, selectedLang, selectedNs])

  async function autoTranslate() {
    setAutoTranslating(true)
    setAutoResults(null)
    try {
      const nsList = selectedNs === 'all' ? NAMESPACES : [selectedNs]
      const byNs = {}
      for (const item of missingKeys) {
        if (!byNs[item.ns]) byNs[item.ns] = {}
        byNs[item.ns][item.key] = item.enValue
      }
      const { data } = await api.post('/api/translations/auto-translate', {
        lang: selectedLang,
        namespaces: byNs,
      })
      setAutoResults(data)
      toast.success(`Translated ${Object.values(data).reduce((n, ns) => n + Object.keys(ns).length, 0)} keys`)
    } catch (e) {
      toast.error('Auto-translate failed')
    } finally {
      setAutoTranslating(false)
    }
  }

  const langInfo = SUPPORTED_LANGUAGES.find(l => l.code === selectedLang)

  return (
    <div className="min-h-screen bg-gray-50 pb-6">
      {/* Header */}
      <div className="bg-primary-600 text-white px-4 pt-12 pb-5">
        <div className="flex items-center gap-3 mb-3">
          <button onClick={() => navigate('/settings')} className="text-primary-200 hover:text-white">←</button>
          <div>
            <h1 className="text-xl font-bold">Translation Management</h1>
            <p className="text-primary-200 text-sm">Admin · {Object.keys(enKeys).length} keys total</p>
          </div>
        </div>

        {/* Language completion pills */}
        <div className="flex gap-2 flex-wrap">
          {stats.map(s => (
            <button
              key={s.code}
              onClick={() => setSelectedLang(s.code)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sm font-medium transition-colors ${
                selectedLang === s.code ? 'bg-white text-primary-700' : 'bg-primary-700/60 text-white'
              }`}
            >
              <span>{s.flag}</span>
              <span>{s.label}</span>
              <span className={`text-xs ml-0.5 ${s.pct === 100 ? 'text-green-400' : s.pct > 50 ? 'text-yellow-300' : 'text-red-300'}`}>
                {s.pct}%
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className="px-4 mt-4 space-y-4">
        {/* Stat cards */}
        {(() => {
          const s = stats.find(s => s.code === selectedLang)
          if (!s) return null
          return (
            <div className="grid grid-cols-3 gap-3">
              <div className="bg-white rounded-2xl p-3 text-center border border-gray-100">
                <p className="text-2xl font-bold text-primary-600">{s.translated}</p>
                <p className="text-xs text-gray-500">Translated</p>
              </div>
              <div className="bg-white rounded-2xl p-3 text-center border border-gray-100">
                <p className="text-2xl font-bold text-red-500">{s.missing}</p>
                <p className="text-xs text-gray-500">Missing</p>
              </div>
              <div className="bg-white rounded-2xl p-3 text-center border border-gray-100">
                <p className={`text-2xl font-bold ${s.pct === 100 ? 'text-green-600' : s.pct > 50 ? 'text-yellow-600' : 'text-red-600'}`}>{s.pct}%</p>
                <p className="text-xs text-gray-500">Complete</p>
              </div>
            </div>
          )
        })()}

        {/* Namespace filter + auto-translate */}
        <div className="flex gap-2 items-center flex-wrap">
          <select
            value={selectedNs}
            onChange={e => setSelectedNs(e.target.value)}
            className="flex-1 min-w-0 border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
          >
            <option value="all">All namespaces</option>
            {NAMESPACES.map(ns => {
              const enFlat = flattenKeys(resources['en']?.[ns] || {})
              const langFlat = flattenKeys(resources[selectedLang]?.[ns] || {})
              const missing = Object.keys(enFlat).filter(k => !langFlat[k] || langFlat[k] === '__MISSING__').length
              return <option key={ns} value={ns}>{ns} ({missing} missing)</option>
            })}
          </select>
          {missingKeys.length > 0 && (
            <button
              onClick={autoTranslate}
              disabled={autoTranslating}
              className="flex items-center gap-1.5 px-4 py-2 bg-primary-600 text-white rounded-xl text-sm font-medium disabled:opacity-50 whitespace-nowrap"
            >
              {autoTranslating ? '⏳ Translating...' : `⚡ Auto-translate ${missingKeys.length} keys`}
            </button>
          )}
        </div>

        {/* Auto-translate results */}
        {autoResults && (
          <div className="bg-green-50 border border-green-200 rounded-2xl p-4">
            <h3 className="font-semibold text-green-800 mb-2">
              Translations ready — copy the JSON below and paste into <code>src/locales/{selectedLang}/[namespace].json</code>
            </h3>
            {Object.entries(autoResults).map(([ns, keys]) => (
              <div key={ns} className="mb-3">
                <p className="text-xs font-semibold text-green-700 uppercase mb-1">{ns}</p>
                <textarea
                  readOnly
                  value={JSON.stringify(keys, null, 2)}
                  className="w-full h-32 text-xs font-mono border border-green-300 rounded-xl px-3 py-2 bg-white"
                  onClick={e => e.target.select()}
                />
              </div>
            ))}
          </div>
        )}

        {/* Missing keys list */}
        {missingKeys.length > 0 ? (
          <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
              <h2 className="font-semibold text-gray-900">{langInfo?.flag} {langInfo?.label} — Missing keys</h2>
              <span className="text-xs text-gray-400 bg-red-50 text-red-600 px-2 py-0.5 rounded-full">{missingKeys.length}</span>
            </div>
            <div className="divide-y divide-gray-50 max-h-[60vh] overflow-y-auto">
              {missingKeys.map(({ ns, key, enValue }) => (
                <div key={`${ns}.${key}`} className="px-4 py-3">
                  <div className="flex items-start gap-2">
                    <span className="text-xs bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded font-mono shrink-0 mt-0.5">{ns}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-mono text-gray-700 truncate">{key}</p>
                      <p className="text-sm text-gray-500 mt-0.5">"{enValue}"</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="text-center py-12">
            <div className="text-4xl mb-3">✅</div>
            <p className="font-semibold text-gray-700">{langInfo?.label} is 100% translated</p>
          </div>
        )}
      </div>
    </div>
  )
}
