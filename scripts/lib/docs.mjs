// 문서 읽기: BRIEF.md, ROADMAP.md, 결정 카드.
import fs from 'node:fs'
import path from 'node:path'
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

export function briefProblems() {
  const t = read(F.brief)
  if (t === null) return ['docs/BRIEF.md 가 없습니다. 브리프 인터뷰부터 하세요']
  const p = []
  const scenes = items(section(t, /성공\s*장면/)).length
  if (scenes < 3) p.push(`BRIEF.md 의 "성공 장면"이 ${scenes}개입니다. 3개 이상 필요합니다`)
  const nots = items(section(t, /만들지\s*않을\s*것/)).length
  if (nots < 1) p.push('BRIEF.md 에 "만들지 않을 것"이 없습니다. 1개 이상 필요합니다')
  if (!approvalDate(t)) p.push('BRIEF.md 에 사람의 승인 날짜가 없습니다 (예: "승인: 2026-11-24" 한 줄)')
  return p
}

export function parseRoadmap() {
  const t = read(F.roadmap)
  if (t === null) return null
  const lines = t.split('\n')
  const ms = []
  let cur = null
  for (const l of lines) {
    const h = l.match(/^##\s+(M\d+)\b(.*)$/)
    if (h) {
      cur = { id: h[1], heading: h[2], body: [] }
      ms.push(cur)
    } else if (/^#{1,2}\s/.test(l)) cur = null
    else if (cur) cur.body.push(l)
  }
  const field = (m, name) => {
    const r = m.body.map((l) => l.match(new RegExp(`^\\s*[-*]\\s*${name}\\s*[:：]\\s*(\\S.*)$`))).find(Boolean)
    return r ? r[1].trim() : null
  }
  for (const m of ms) {
    m.scene = field(m, '끝나는\\s*장면')
    m.period = field(m, '예상\\s*기간')
    const rq = field(m, '위험\\s*질문')
    m.riskLine = rq
    m.risks = rq ? [...new Set(rq.match(/D-\d+/g) ?? [])] : []
  }
  return { text: t, ms }
}

export function roadmapProblems(rm = parseRoadmap()) {
  if (!rm) return ['docs/ROADMAP.md 가 없습니다. 로드맵부터 쓰세요']
  const p = []
  if (!approvalDate(rm.text)) p.push('ROADMAP.md 에 사람의 승인 날짜가 없습니다 (예: "승인: 2026-11-24" 한 줄)')
  if (rm.ms.length === 0) p.push('ROADMAP.md 에 마일스톤("## M0 ...")이 없습니다')
  else if (rm.ms[0].id !== 'M0' || !/뼈대/.test(rm.ms[0].heading + rm.ms[0].body.join('\n')))
    p.push('M0 은 항상 "끝에서 끝까지 한 줄 뼈대"여야 합니다 (M0 에 "뼈대"라는 말이 없습니다)')
  for (const m of rm.ms) {
    if (!m.scene) p.push(`${m.id}: "끝나는 장면" 줄이 없습니다`)
    if (!m.period) p.push(`${m.id}: "예상 기간" 줄이 없습니다`)
    if (!m.riskLine) p.push(`${m.id}: "위험 질문" 줄이 없습니다 (없으면 "위험 질문: 없음")`)
    else if (m.risks.length === 0 && !/^없음/.test(m.riskLine)) p.push(`${m.id}: 위험 질문에 D-01 같은 번호를 붙이세요 (없으면 "없음")`)
  }
  return p
}

export const cardFile = (id) => (fs.existsSync(F.decisions) ? fs.readdirSync(F.decisions).find((n) => n.startsWith(id + '.') || n.startsWith(id + '-')) ?? null : null)
export function decisionStatus(id) {
  const file = cardFile(id)
  if (!file) return { id, ok: false, why: '결정 카드 파일이 없습니다' }
  const t = read(path.join(F.decisions, file)) ?? ''
  const status = t.match(/^\s*(?:[-*]\s*)?상태\s*[:：]\s*(\S.*)$/m)
  const choice = t.match(/^\s*(?:[-*]\s*)?선택\s*[:：]\s*(\S.*)$/m)
  if (!status || !/^결정됨/.test(status[1].trim())) return { id, ok: false, why: '"상태: 결정됨" 이 아닙니다 (사람이 아직 고르지 않음)' }
  if (!choice) return { id, ok: false, why: '"선택:" 줄이 없습니다' }
  return { id, ok: true, file }
}

export const nextOpenMilestone = (st, rm) => rm?.ms.find((m) => !st.closed.includes(m.id))?.id ?? null
// 닫은 마일스톤의 ROADMAP 제목에 "✅ (끝 날짜)" 를 붙인다. 이미 붙어 있으면 그대로 둔다.
export function markRoadmapClosed(id) {
  const t = read(F.roadmap)
  if (t === null) return false
  const lines = t.split('\n')
  const i = lines.findIndex((l) => new RegExp(`^##\\s+${id}\\b`).test(l))
  if (i < 0 || lines[i].includes('✅')) return false
  lines[i] = `${lines[i].trimEnd()} ✅ (${today()})`
  fs.writeFileSync(F.roadmap, lines.join('\n'))
  return true
}
