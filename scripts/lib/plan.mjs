// step 표(docs/plan/Mx.md) 읽기와 검사.
import fs from 'node:fs'
import path from 'node:path'
import { F, fail, read } from './core.mjs'
import { readEvents } from './state.mjs'

// ---------- step 표 ----------
// 표는 머리줄(| step | ... | 상태 |, 다음 줄이 |---|) 기준으로 읽는다. 머리줄이 없으면 기본 6칸으로 본다.
// "상태" 칸은 손으로 채우지 않고 step-start / step-done 이 채운다: ⏳ 진행 중, ✅ 끝(날짜) 한 줄.
// "끝"으로 시작하는 칸은 1판 표와의 호환으로 끝난 것으로 센다.
export const STD_HEAD = ['step', '맡는 쪽', '할 일', '고쳐도 되는 파일', '완료 기준', '상태']
export const STEP_ROW = /^\|\s*M\d+-\w+\s*\|/
export const splitCells = (line) =>
  line
    .trim()
    .replace(/^\|/, '')
    .replace(/(?<!\\)\|$/, '')
    .split(/(?<!\\)\|/)
    .map((c) => c.trim())
export const joinCells = (cells) => `| ${cells.join(' | ')} |`
export const isDone = (s) => /^(✅|끝)/.test(s ?? '')
export const isActive = (s) => /^⏳/.test(s ?? '')
export const isTestRole = (r) => /시험/.test(r.role)
export const isImplRole = (r) => /구현/.test(r.role)
export const isReviewRole = (r) => /리뷰/.test(r.role)
// 기본: 기능 줄 하나 = 사용자가 알아볼 기능 하나(시험과 구현을 함께). 끝나면 확인 작업자가 본다. 고침 줄은 리허설 실패를 고친다.
export const isFeatureRole = (r) => /기능/.test(r.role)
export const isFixRole = (r) => /고침/.test(r.role)

export function readPlan(id) {
  const file = path.join(F.plan, `${id}.md`)
  const text = read(file)
  if (text === null) return null
  const lines = text.split('\n')
  let head = null
  for (let i = 0; i < lines.length - 1; i++) {
    if (!/^\s*\|/.test(lines[i])) continue
    const cells = splitCells(lines[i])
    if (/^step$/i.test(cells[0] ?? '') && cells.includes('상태') && /^\s*\|?\s*:?-{3,}/.test(lines[i + 1])) {
      head = cells
      break
    }
  }
  const cols = head ?? STD_HEAD
  const statusCol = cols.indexOf('상태')
  const roleCol = Math.max(0, cols.findIndex((c) => /맡는\s*쪽/.test(c)))
  const filesCol = cols.findIndex((c) => /파일/.test(c))
  const waitCol = cols.findIndex((c) => /기다/.test(c))
  const rows = []
  lines.forEach((l, i) => {
    if (!STEP_ROW.test(l)) return
    const cells = splitCells(l)
    const wait = waitCol >= 0 ? cells[waitCol] ?? '' : ''
    rows.push({ line: i, step: cells[0], role: cells[roleCol] ?? '', status: cells[statusCol] ?? '', cells, wait, waits: parseWaits(wait), files: filePrefixes(filesCol >= 0 ? cells[filesCol] : '') })
  })
  return { id, file, rel: `docs/plan/${id}.md`, lines, head, cols, statusCol, rows }
}

// "기다리는 step" 칸: 비면 null(표 순서대로 앞 step 을 모두 기다림), "없음"·"-" 이면 [], 아니면 적힌 step 들.
export function parseWaits(cell) {
  const t = String(cell ?? '').trim()
  if (!t) return null
  if (/^(없음|-|—)$/.test(t)) return []
  return [...new Set(t.match(/M\d+-\w+/g) ?? [])]
}
export const waitsOf = (plan, row) => row.waits ?? plan.rows.slice(0, plan.rows.indexOf(row)).map((r) => r.step)
// "고쳐도 되는 파일" 칸의 경로 접두어. 글롭(*, ?, {, [)은 그 앞까지만 본다: "tests/m5-*.mjs" → "tests/m5-", "src/**" → "src/".
export function filePrefixes(cell) {
  return String(cell ?? '')
    .replace(/`/g, ' ')
    .split(/[,\s;、]+/)
    .filter((t) => /^[\w.@~+\-/*?{}[\]]+$/.test(t) && /[/.*]/.test(t) && !/^\.+$/.test(t))
    .map((t) => t.replace(/^\.\//, '').split(/[*?{[]/)[0])
}
// 두 step 의 파일 칸이 겹치는 첫 쌍. 한쪽 경로가 다른 쪽의 접두어면 겹친다고 본다.
export function filesClash(a, b) {
  for (const x of a) for (const y of b) if (x.startsWith(y) || y.startsWith(x)) return [x || '(모든 파일)', y || '(모든 파일)']
  return null
}
export const inScope = (files, row) => (row.files.length ? files.filter((f) => row.files.some((p) => f.startsWith(p))) : files)
// 지금 ⏳ 인 step 들(st.step 도 진행 중으로 센다).
export const activeRows = (plan, st) => plan.rows.filter((r) => !isDone(r.status) && (isActive(r.status) || (st.milestone === plan.id && st.step === r.step)))

// 표 하나의 문제: 칸 수가 머리와 다른 줄, 겹친 step, 끝났다고 기록됐는데 "상태" 칸이 ✅ 가 아닌 step.
export function planProblems(plan, st) {
  const p = []
  const seen = new Set()
  const basis = plan.head ? '머리줄' : '기본 머리줄'
  for (const r of plan.rows) {
    if (r.cells.length !== plan.cols.length)
      p.push(`${plan.rel} ${r.step}: 칸이 ${r.cells.length}개인데 ${basis}은 ${plan.cols.length}칸입니다 (넘치거나 모자란 "|" 를 확인하세요)`)
    if (seen.has(r.step)) p.push(`${plan.rel}: step ${r.step} 줄이 두 번 나옵니다`)
    for (const w of r.waits ?? []) if (!seen.has(w)) p.push(`${plan.rel} ${r.step}: 기다리는 step ${w} 이(가) 표에서 이 줄보다 앞에 없습니다`)
    if (r.wait.trim() && r.waits?.length === 0 && !/^(없음|-|—)$/.test(r.wait.trim())) p.push(`${plan.rel} ${r.step}: "기다리는 step" 칸을 읽지 못했습니다 ("M5-1, M5-2" 꼴, 없으면 "없음")`)
    seen.add(r.step)
  }
  const recorded = new Set(readEvents().filter((e) => e.event === 'step_done').map((e) => e.step))
  const closed = st.closed.includes(plan.id)
  // 시작된 step 이 기다리는 step 은 모두 ✅ 여야 한다.
  const behind = new Map()
  if (st.milestone === plan.id)
    for (const a of activeRows(plan, st)) for (const w of waitsOf(plan, a)) if (!behind.has(w)) behind.set(w, a.step)
  plan.rows.forEach((r) => {
    if (isDone(r.status)) return
    if (recorded.has(r.step)) p.push(`${plan.rel} ${r.step}: step-done 기록이 있는데 "상태" 칸이 ✅ 가 아닙니다`)
    else if (closed) p.push(`${plan.rel} ${r.step}: ${plan.id} 는 닫혔는데 "상태" 칸이 ✅ 가 아닙니다`)
    else if (behind.has(r.step)) p.push(`${plan.rel} ${r.step}: 뒤 step ${behind.get(r.step)} 이 시작됐는데 이 step 의 "상태" 칸이 ✅ 가 아닙니다`)
  })
  return p
}

// 현재 마일스톤 밖의 step 표(docs/plan/Mx.md)가 있으면 위반이다. 관문은 이것을 보지 않고, status 의 "다음 할 일"만 알린다.
export function planViolations(st, allowCurrent) {
  if (!fs.existsSync(F.plan)) return []
  const out = []
  for (const n of fs.readdirSync(F.plan)) {
    const m = n.match(/^(M\d+)\.md$/)
    // 사람이 미리 승인한 기능 목록(plan approve)은 뒤 마일스톤의 것이어도 위반이 아니다.
    if (!m || st.closed.includes(m[1]) || st.gates?.plan_approved?.[m[1]]) continue
    if (m[1] === st.milestone && allowCurrent) continue
    const why =
      m[1] === st.milestone
        ? `${m[1]} 의 위험 질문이 모두 결정되기 전에는 step 표를 만들지 않습니다`
        : `지금은 ${st.milestone ?? '시작 전'} 입니다. 다음 마일스톤 밖의 step 표는 만들지 않습니다 (사람이 미리 승인했으면 plan approve ${m[1]} --said "<사람 말>")`
    out.push(`docs/plan/${n}: ${why}`)
  }
  return out
}

// 마일스톤을 닫으려면(장면 관문) step 표가 바르고 모든 step 의 "상태" 칸이 ✅ 여야 한다. 표 검사(planProblems)는 이 관문, 미리 승인(plan approve), status 의 안내만 쓴다.
export function stepsDoneProblems(st) {
  const plan = readPlan(st.milestone)
  if (plan === null) return [`docs/plan/${st.milestone}.md (step 표)가 없습니다`]
  if (plan.rows.length === 0) return [`docs/plan/${st.milestone}.md 에 step 줄이 없습니다`]
  const p = planProblems(plan, st)
  const open = plan.rows.filter((r) => !isDone(r.status))
  if (open.length) p.push(`아직 끝나지 않은 step: ${open.map((r) => r.step).join(', ')} ("상태" 칸이 ✅ 여야 합니다. step-done 으로 채우세요)`)
  return p
}

// 지금 시작할 수 있는 step: 아직 시작 안 함, 기다리는 step 이 모두 ✅, 진행 중인 step 과 파일 칸이 안 겹침.
export function startable(plan, st) {
  const doing = activeRows(plan, st)
  const ok = []
  for (const r of plan.rows) {
    if (isDone(r.status) || doing.includes(r)) continue
    if (!waitsOf(plan, r).every((w) => isDone(plan.rows.find((x) => x.step === w)?.status))) continue
    if ([...doing, ...ok].some((d) => filesClash(r.files, d.files))) continue
    ok.push(r)
  }
  return ok
}

// 지금 마일스톤의 step 목록: ✅ 끝 / ⏳ 진행 중 / 빈칸 아직.
export function stepList(st) {
  if (!['milestone', 'check'].includes(st.stage) || !st.milestone) return []
  const plan = readPlan(st.milestone)
  if (!plan) return []
  return plan.rows.map((r) => {
    const mark = isDone(r.status) ? '✅' : isActive(r.status) || st.step === r.step ? '⏳' : '  '
    return { step: r.step, role: r.role, mark, status: r.status }
  })
}
export function writeStatus(plan, row, text) {
  const cells = [...row.cells]
  cells[plan.statusCol] = text
  plan.lines[row.line] = joinCells(cells)
  fs.writeFileSync(plan.file, plan.lines.join('\n'))
  const again = readPlan(plan.id).rows.find((r) => r.step === row.step)
  if (again?.status !== text || again.cells.length !== plan.cols.length) fail(`${plan.rel} ${row.step}: 상태 칸을 쓴 뒤 다시 읽었더니 맞지 않습니다. 표를 확인하세요.`)
}
