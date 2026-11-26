// 문서 읽기: 기획서 docs/PLAN.md 한 장(BRIEF·ROADMAP 을 대신한다)과 시제품 결정 카드.
import fs from 'node:fs'
import { F, read, today } from './core.mjs'

// ---------- 문서 읽기 ----------
// '## 제목' 중 re 에 맞는 절의 줄들(다음 '#' 제목 앞까지).
export function section(text, re) {
  const lines = text.split('\n')
  const i = lines.findIndex((l) => /^#{1,6}\s/.test(l) && re.test(l))
  if (i < 0) return []
  const out = []
  for (let j = i + 1; j < lines.length && !/^#{1,6}\s/.test(lines[j]); j++) out.push(lines[j])
  return out
}
export const items = (lines) => lines.filter((l) => /^\s*(?:\d+[.)]|[-*])\s+\S/.test(l))
export const approvalDate = (text) => {
  const m = text.match(/^\s*(?:[-*]\s*)?승인(?:\s*날짜)?\s*[:：]\s*(\d{4}-\d{2}-\d{2})\s*$/m)
  return m && !Number.isNaN(Date.parse(m[1])) ? m[1] : null
}
const field = (lines, name) => lines.map((l) => l.match(new RegExp(`^\\s*[-*]\\s*${name}\\s*[:：]\\s*(\\S.*)$`))).find(Boolean)?.[1].trim() ?? null
export const TOP = ['누가 무엇을', '이번엔 어디까지', '다음 장면', '모양']

// 기획서: 성공 장면("### S1 제목" 아래 "- 착수 전: D-01, T-01" 등), 결정과 시험("- D-01 … 결정: 선택함"), 마일스톤 지도("- M0 뼈대 · 장면 S1").
// 마일스톤의 착수 전 목록(risks)은 그 장면들의 착수 전을 모은 것이다.
export function readSheet() {
  const t = read(F.sheet)
  if (t === null) return null
  const scenes = []
  const ms = []
  const marks = []
  let h2 = ''
  let sc = null
  for (const l of t.split('\n')) {
    const h = l.match(/^(#{1,3})\s+(.*)$/)
    if (h) {
      if (h[1].length < 3) h2 = h[2]
      const s = h[1] === '###' && h[2].match(/^(S\d+)\b\s*(.*)$/)
      sc = s ? { id: s[1], title: s[2].trim(), body: [] } : null
      if (sc) scenes.push(sc)
    } else if (sc) sc.body.push(l)
    else if (/마일스톤\s*지도/.test(h2) && /^\s*[-*]\s*M\d+\b/.test(l)) ms.push({ id: l.match(/M\d+/)[0], line: l })
    else if (/결정과\s*시험/.test(h2) && /^\s*[-*]\s*[DT]-\d+\b/.test(l)) marks.push({ id: l.match(/[DT]-\d+/)[0], line: l })
  }
  for (const s of scenes) s.before = [...new Set(field(s.body, '착수\\s*전')?.match(/[DT]-\d+/g) ?? [])]
  for (const m of ms) {
    m.scenes = [...new Set(m.line.replace(/^\s*[-*]\s*M\d+/, '').match(/S\d+/g) ?? [])]
    const mine = scenes.filter((s) => m.scenes.includes(s.id))
    m.risks = [...new Set(mine.flatMap((s) => s.before))]
    m.scene = mine.map((s) => `${s.id} ${s.title}`).join(' / ') || null
  }
  const living = section(t, /살아\s*있는\s*세\s*줄/)
  return { text: t, scenes, ms, marks, living, grade: field(living, '계획\\s*밖\\s*결정')?.split(/\s*[·(]/)[0] || null }
}

// 승인 전에 채울 것. 관문은 보지 않고 status 의 "다음 할 일"만 이것을 알려 준다.
export function sheetProblems(sh = readSheet()) {
  if (!sh) return ['docs/PLAN.md(기획서)가 없습니다. 인터뷰부터 하세요']
  const head = sh.text.split(/\n## /)[0].split('\n')
  const p = TOP.filter((k) => !field(head, k)).map((k) => `기획서 맨 위에 "- ${k}:" 줄이 없습니다`)
  if (!sh.scenes.length) p.push('"## 성공 장면" 에 "### S1 <장면>" 이 없습니다')
  for (const s of sh.scenes) for (const k of ['자동 확인', '진짜 자료']) if (!field(s.body, k)) p.push(`${s.id}: "- ${k}:" 줄이 없습니다${k === '진짜 자료' ? ' (없으면 "없음 — 작은 예제 범위까지만")' : ''}`)
  if (!items(section(sh.text, /첫날\s*실패\s*장면/)).length) p.push('"## 첫날 실패 장면" 이 비었습니다')
  if (!sh.ms.length) p.push('"## 마일스톤 지도" 에 "- M0 뼈대 · 장면 S1 · 예상 …" 줄이 없습니다')
  for (const m of sh.ms) if (!m.scenes.length || m.scenes.some((id) => !sh.scenes.some((s) => s.id === id))) p.push(`${m.id}: 기획서에 있는 성공 장면 번호(S1 등)를 적으세요`)
  for (const id of new Set(sh.scenes.flatMap((s) => s.before))) if (!sh.marks.some((x) => x.id === id)) p.push(`${id}: "## 결정과 시험" 에 줄이 없습니다`)
  if (!approvalDate(sh.text)) p.push('기획서에 사람의 승인 날짜가 없습니다 (예: "승인: 2026-11-24" 한 줄)')
  return p
}

// 착수 전 항목 하나: 결정(D)은 선택함·AI가 고름(위임)·미룸(기한), 시험(T)은 통과·판단 보류(기한)면 시작해도 된다.
export function decisionStatus(id, sh = readSheet()) {
  const line = sh?.marks.find((x) => x.id === id)?.line
  const d = id.startsWith('D')
  if (!line) return { id, ok: false, why: '기획서 "## 결정과 시험" 에 이 줄이 없습니다' }
  const s = line.match(d ? /결정\s*[:：]\s*([^·]+)/ : /시험\s*[:：]\s*([^·]+)/)?.[1].trim() ?? ''
  if (d ? /^(선택함|AI\s*가\s*고름|미룸)/.test(s) : /^(통과|판단\s*보류)/.test(s)) return { id, ok: true }
  return { id, ok: false, why: !s ? `"${d ? '결정' : '시험'}:" 칸이 없습니다` : `"${d ? '결정' : '시험'}: ${s}" 입니다 (${d ? '사람이 아직 고르지 않음' : /^실패/.test(s) ? '다른 방법을 시험하거나 착수 전에서 빼고 범위를 줄인다' : '아직 시험하지 않음'})` }
}
export const cardFile = (id) => (fs.existsSync(F.decisions) ? fs.readdirSync(F.decisions).find((n) => n.startsWith(id + '.') || n.startsWith(id + '-')) ?? null : null)

export const nextOpenMilestone = (st, sh) => sh?.ms.find((m) => !st.closed.includes(m.id))?.id ?? null
// 닫은 마일스톤의 지도 줄 끝에 "✅ (끝 날짜)" 를 붙인다. 이미 붙어 있으면 그대로 둔다.
export function markClosed(id) {
  const sh = readSheet()
  const m = sh?.ms.find((x) => x.id === id)
  if (!m || m.line.includes('✅')) return false
  fs.writeFileSync(F.sheet, sh.text.replace(m.line, `${m.line.trimEnd()} ✅ (${today()})`))
  return true
}
