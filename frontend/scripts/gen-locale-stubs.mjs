import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const localesDir = path.join(__dirname, '../src/locales')
const targetLangs = ['de', 'pl', 'zh']

function deepMissing(obj) {
  const result = {}
  for (const key of Object.keys(obj)) {
    if (typeof obj[key] === 'object' && obj[key] !== null && !Array.isArray(obj[key])) {
      result[key] = deepMissing(obj[key])
    } else {
      result[key] = '__MISSING__'
    }
  }
  return result
}

const enDir = path.join(localesDir, 'en')
const nsFiles = fs.readdirSync(enDir).filter(f => f.endsWith('.json'))

for (const lang of targetLangs) {
  const langDir = path.join(localesDir, lang)
  fs.mkdirSync(langDir, { recursive: true })
  for (const file of nsFiles) {
    const targetPath = path.join(langDir, file)
    if (!fs.existsSync(targetPath)) {
      const enData = JSON.parse(fs.readFileSync(path.join(enDir, file), 'utf-8'))
      fs.writeFileSync(targetPath, JSON.stringify(deepMissing(enData), null, 2) + '\n')
      console.log(`  created ${lang}/${file}`)
    } else {
      console.log(`  skip    ${lang}/${file} (exists)`)
    }
  }
}
console.log('done')
