import { Fragment } from 'react'

// Small, dependency-free renderer for the subset of Markdown the AI coach writes: headings, bold/italic/code, bullet and
// numbered lists, pipe tables and rules. It builds React elements only (no HTML injection), and tolerates the partial text
// seen while a reply is still streaming.

function inline(text, keyPrefix) {
  const out = []
  const re = /(\*\*([^*]+?)\*\*|`([^`]+?)`|\*([^*\s][^*]*?)\*)/g
  let last = 0
  let m
  let n = 0
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index))
    const key = `${keyPrefix}-${n++}`
    if (m[2] !== undefined) out.push(<strong key={key}>{m[2]}</strong>)
    else if (m[3] !== undefined) out.push(<code key={key} className="bg-gray-100 rounded px-1 text-[0.85em]">{m[3]}</code>)
    else out.push(<em key={key}>{m[4]}</em>)
    last = m.index + m[0].length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

const isTableRow = (l) => /^\s*\|.*\|\s*$/.test(l)
const isTableSep = (l) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l) && l.includes('-')
const cells = (l) => l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim())

export function parseBlocks(src) {
  const lines = (src || '').replace(/\r/g, '').split('\n')
  const blocks = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (!line.trim()) { i++; continue }

    const h = line.match(/^(#{1,4})\s+(.*)$/)
    if (h) { blocks.push({ type: 'heading', level: h[1].length, text: h[2] }); i++; continue }

    if (/^\s*([-*_])\1{2,}\s*$/.test(line)) { blocks.push({ type: 'rule' }); i++; continue }

    if (isTableRow(line) && i + 1 < lines.length && isTableSep(lines[i + 1])) {
      const head = cells(line)
      i += 2
      const rows = []
      while (i < lines.length && isTableRow(lines[i])) { rows.push(cells(lines[i])); i++ }
      blocks.push({ type: 'table', head, rows })
      continue
    }

    const ul = line.match(/^\s*[-*•]\s+(.*)$/)
    const ol = line.match(/^\s*\d+[.)]\s+(.*)$/)
    if (ul || ol) {
      const ordered = !!ol
      const re = ordered ? /^\s*\d+[.)]\s+(.*)$/ : /^\s*[-*•]\s+(.*)$/
      const items = []
      while (i < lines.length) {
        const mm = lines[i].match(re)
        if (!mm) break
        items.push(mm[1]); i++
      }
      blocks.push({ type: 'list', ordered, items })
      continue
    }

    const para = []
    while (i < lines.length && lines[i].trim() && !/^(#{1,4}\s|\s*[-*•]\s|\s*\d+[.)]\s)/.test(lines[i])
           && !(isTableRow(lines[i]) && i + 1 < lines.length && isTableSep(lines[i + 1]))) {
      para.push(lines[i]); i++
    }
    if (para.length) blocks.push({ type: 'para', text: para.join('\n') })
    else i++ // a line no rule above claims; skip it so the loop always advances
  }
  return blocks
}

const HEADING = {
  1: 'text-base font-bold mt-1 mb-1.5',
  2: 'text-sm font-bold mt-2 mb-1',
  3: 'text-sm font-semibold mt-2 mb-1',
  4: 'text-sm font-semibold mt-1.5 mb-0.5',
}

export default function Markdown({ text }) {
  const blocks = parseBlocks(text)
  return (
    <div className="space-y-2 break-words">
      {blocks.map((b, i) => {
        const k = `b${i}`
        if (b.type === 'heading') return <p key={k} className={HEADING[b.level]}>{inline(b.text, k)}</p>
        if (b.type === 'rule') return <hr key={k} className="border-gray-200" />
        if (b.type === 'para') {
          return <p key={k}>{b.text.split('\n').map((l, j) => <Fragment key={j}>{j > 0 && <br />}{inline(l, `${k}-${j}`)}</Fragment>)}</p>
        }
        if (b.type === 'list') {
          const Tag = b.ordered ? 'ol' : 'ul'
          return (
            <Tag key={k} className={`${b.ordered ? 'list-decimal' : 'list-disc'} pl-5 space-y-0.5`}>
              {b.items.map((it, j) => <li key={j}>{inline(it, `${k}-${j}`)}</li>)}
            </Tag>
          )
        }
        return (
          <div key={k} className="overflow-x-auto -mx-1">
            <table className="text-xs border-collapse min-w-full">
              <thead>
                <tr>{b.head.map((c, j) => <th key={j} className="border-b border-gray-300 px-2 py-1 text-left font-semibold">{inline(c, `${k}h${j}`)}</th>)}</tr>
              </thead>
              <tbody>
                {b.rows.map((r, j) => (
                  <tr key={j} className="border-b border-gray-100">
                    {r.map((c, x) => <td key={x} className="px-2 py-1 align-top">{inline(c, `${k}r${j}-${x}`)}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      })}
    </div>
  )
}
