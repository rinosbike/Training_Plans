import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import LanguageDetector from 'i18next-browser-languagedetector'
import { SUPPORTED_LANGUAGES, DEFAULT_LANGUAGE, NAMESPACES } from './languages'

const localeModules = import.meta.glob('../locales/**/*.json', { eager: true })

const resources = {}
for (const path in localeModules) {
  const match = path.match(/\.\.\/locales\/(\w+)\/(\w+)\.json$/)
  if (match) {
    const [, lang, ns] = match
    if (!resources[lang]) resources[lang] = {}
    resources[lang][ns] = localeModules[path].default || localeModules[path]
  }
}

// Post-processor: if a translated value is __MISSING__, return the EN fallback
const missingFilter = {
  type: 'postProcessor',
  name: 'missingFilter',
  process(value, key, options, translator) {
    if (value === '__MISSING__') {
      return translator.translate(key, { ...options, lng: 'en', postProcess: [] })
    }
    return value
  },
}

i18n
  .use(missingFilter)
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    fallbackLng: DEFAULT_LANGUAGE,
    supportedLngs: SUPPORTED_LANGUAGES.map(l => l.code),
    nonExplicitSupportedLngs: true,
    load: 'languageOnly',
    ns: NAMESPACES,
    defaultNS: 'common',
    postProcess: ['missingFilter'],
    interpolation: { escapeValue: false },
    detection: {
      order: ['localStorage', 'navigator'],
      lookupLocalStorage: 'i18nextLng',
      caches: ['localStorage'],
    },
  })

export default i18n
