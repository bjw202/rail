// 문서 읽기: 기획서 docs/PLAN.md 한 장(BRIEF·ROADMAP 을 대신한다)과 시제품 결정 카드.
import { createHash } from 'node:crypto'
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

// 착수 전 항목 하나: 결정(D)은 선택함 (<고른 것>)·AI가 고름(위임)·미룸(<기한>)(바뀜 (→ D-xx) 은 막는다), 시험(T)은 통과·통과(작은 예제 범위까지만)·판단 보류(<기한>)일 때만 시작해도 된다.
// 상태 말은 정해진 말과 정확히 맞아야 한다("통과 못함"은 통과가 아니다). 기한이 지난 미룸·판단 보류는 다시 막는다.
const OK_D = /^(?:선택함|AI\s*가\s*고름\s*\(위임\))(?:\s*\(.*\))?$|^미룸\s*\((\d{4}-\d{2}-\d{2})\)$/
const OK_T = /^통과(?:\s*\(작은 예제 범위까지만\))?$|^판단\s*보류\s*\((\d{4}-\d{2}-\d{2})\)$/
export function decisionStatus(id, sh = readSheet()) {
  const line = sh?.marks.find((x) => x.id === id)?.line
  const [d, k] = id.startsWith('D') ? [true, '결정'] : [false, '시험']
  if (!line) return { id, ok: false, why: '기획서 "## 결정과 시험" 에 이 줄이 없습니다' }
  const s = line.match(new RegExp(`${k}\\s*[:：]\\s*([^·]+)`))?.[1].trim() ?? ''
  const m = s.match(d ? OK_D : OK_T)
  if (m && !(m[1] && m[1] < today())) return { id, ok: true }
  const why = !s ? `"${k}:" 칸이 없습니다` : m ? `"${k}: ${s}" 의 기한 ${m[1]} 이 지났습니다 (다시 정하거나 기한을 새로 붙인다)` : `"${k}: ${s}" 입니다 (${/^(?:미룸|판단\s*보류)/.test(s) ? '기한을 "(2026-12-01)" 꼴로 붙인다' : /^미정/.test(s) ? '사람이 아직 고르지 않음' : /^미실행/.test(s) ? '아직 시험하지 않음' : /^실패/.test(s) ? '다른 방법을 시험하거나 착수 전에서 빼고 범위를 줄인다' : /^바뀜/.test(s) ? '바뀜이면 새 번호를 착수 전에 적는다' : `정해진 말이 아닙니다: ${d ? '선택함 (<고른 것>) · AI가 고름(위임) · 미룸(<기한>)' : '통과 · 통과(작은 예제 범위까지만) · 판단 보류(<기한>)'}`})`
  return { id, ok: false, why }
}
// 마일스톤의 착수 전 항목 중 풀리지 않은 것.
export const openRisks = (id, sh = readSheet()) => (sh?.ms.find((x) => x.id === id)?.risks ?? []).map((r) => decisionStatus(r, sh)).filter((d) => !d.ok)
// 아직 자리표시인 장면: 제목에 "(예상)", 자동 확인이 비었거나 <…>·"기획할 때 정한다" 꼴, 착수 전이 그 꼴. 처음부터 다 채운 기획서는 걸리지 않는다.
const VAGUE = /<[^>]+>|기획할\s*때/
export const draftScenes = (id, sh = readSheet()) => {
  const mine = sh?.ms.find((x) => x.id === id)?.scenes ?? []
  return sh.scenes.filter((s) => mine.includes(s.id) && (/\(예상\)/.test(s.title) || VAGUE.test(field(s.body, '자동\\s*확인') ?? '<>') || VAGUE.test(field(s.body, '착수\\s*전') ?? ''))).map((s) => s.id)
}
// 마일스톤을 시작하지 못하는 까닭. 바로 시작(advance milestone)과 미리 승인(plan approve)이 같은 판정을 쓴다.
export function startProblems(id, sh = readSheet()) {
  const draft = sh ? draftScenes(id, sh) : []
  return [...(draft.length ? [`장면 ${draft.join(', ')} 이(가) 아직 자리표시입니다 (그 마일스톤을 기획해 장면을 채우고 다시 승인받는다)`] : []), ...openRisks(id, sh).map((d) => `착수 전 ${d.id} 가 풀리지 않았습니다 (${d.why})`)]
}
// 계획 밖 결정 수: 마일스톤 시작 때 남긴 "결정과 시험" 번호(gates.plan_marks)에 없던 번호의 수. 닫으면 gates.unplanned 에 남는다.
// 돌려주는 값: { id, now, total, said }  id·now = 지금(시작한 뒤면 지금 마일스톤, 아니면 마지막으로 닫은 것), total = 누적, said = 기획서에 리더가 적은 누적 수.
export function unplanned(st, sh = readSheet()) {
  const base = st.gates.plan_marks?.[st.milestone]
  const counted = { ...(st.gates.unplanned ?? {}), ...(base && !st.closed.includes(st.milestone) ? { [st.milestone]: new Set((sh?.marks ?? []).map((x) => x.id).filter((x) => !base.includes(x))).size } : {}) }
  const id = base ? st.milestone : st.closed.findLast((x) => x in counted)
  if (!id) return null
  const said = sh?.grade?.match(/\d+/)?.[0]
  return { id, now: counted[id], total: Object.values(counted).reduce((a, b) => a + b, 0), said: said === undefined ? null : Number(said) }
}
export const gradeLine = (g) => g && `이번(${g.id}) ${g.now} · 누적 ${g.total} (코드가 셈${g.said !== null && g.said !== g.total ? `, 기획서에 적은 누적 ${g.said}번과 ${Math.abs(g.total - g.said)} 차이` : ''})`
export const cardFile = (id) => (fs.existsSync(F.decisions) ? fs.readdirSync(F.decisions).find((n) => n.startsWith(id + '.') || n.startsWith(id + '-')) ?? null : null)

// "살아 있는 세 줄"의 지문. 장면 확인으로 갈 때 남긴 것과 같으면 이번 마일스톤 동안 고치지 않은 것이다.
export const livingMark = (sh) => createHash('sha1').update((sh?.living ?? []).join('\n').trim()).digest('hex').slice(0, 12)
export const nextOpenMilestone = (st, sh) => sh?.ms.find((m) => !st.closed.includes(m.id))?.id ?? null
// 닫은 마일스톤의 지도 줄 끝에 "✅ (끝 날짜)" 를 붙인다. 이미 붙어 있으면 그대로 둔다.
export function markClosed(id) {
  const sh = readSheet()
  const m = sh?.ms.find((x) => x.id === id)
  if (!m || m.line.includes('✅')) return false
  fs.writeFileSync(F.sheet, sh.text.replace(m.line, `${m.line.trimEnd()} ✅ (${today()})`))
  return true
}
