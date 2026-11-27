// 기능 확인: 기능 줄의 작업자가 끝나면 만들지 않은 새 작업자가 완료 기준을 어기는 경우를 찾는다.
// 결과는 .rail/check/<step>.json({"must":[...],"nice":[...]}), 재현 시험은 .rail/check/<step>/*.test.mjs(점 폴더라 node --test 가 저절로 돌리지 않는다).
import path from 'node:path'
import { F, read } from './core.mjs'
import { readEvents } from './state.mjs'
import { openWorkers } from './workers.mjs'

export const checkFile = (step) => path.join(F.check, `${step}.json`)
export function readCheck(step) {
  const text = read(checkFile(step))
  if (text === null) return null
  try {
    const c = JSON.parse(text)
    if (Array.isArray(c?.must) && (c.nice === undefined || Array.isArray(c.nice))) return { must: c.must, nice: c.nice ?? [] }
  } catch {}
  return { error: `.rail/check/${step}.json 을 읽지 못했습니다 ({"must":[{"what","repro"}],"nice":[]} 꼴)` }
}
// 기능 줄이 어디까지 왔나: 만들기 → 확인 → (must 가 있으면) 고침 → 끝낼 수 있음.
export function featureState(st, row) {
  const ev = readEvents().filter((e) => e.milestone === st.milestone)
  const open = new Set(openWorkers(st, ev).map((w) => w.step))
  const closed = (s) => ev.some((e) => e.event === 'worker_closed' && e.step === s)
  const c = readCheck(row.step)
  for (const [s, k] of [[`${row.step}-fix`, 'fixing'], [`${row.step}-check`, 'checking'], [row.step, 'building']]) if (open.has(s)) return { k, c }
  if (!c && !closed(row.step)) return { k: 'build', c }
  if (!c || c.error) return { k: 'check', c }
  return { k: c.must.length && !closed(`${row.step}-fix`) ? 'fix' : 'ready', c }
}
// step-done 이 기능 줄을 끝내기 전에 보는 것: 읽히는 확인 기록, must 가 있으면 닫힌 고침 작업자.
export function featureProblems(st, row) {
  const c = readCheck(row.step)
  if (!c || c.error) return [c?.error ?? `${row.step} 의 확인 기록 .rail/check/${row.step}.json 이 없습니다 (확인 작업자 ${row.step}-check 가 씁니다)`]
  const fixed = readEvents().some((e) => e.milestone === st.milestone && e.event === 'worker_closed' && e.step === `${row.step}-fix`)
  return c.must.length && !fixed ? [`${row.step} 의 확인이 꼭 고칠 것 ${c.must.length}건을 냈는데 고침 작업자 ${row.step}-fix 가 끝나지 않았습니다`] : []
}
// after(step): 작업자가 끝난 뒤의 차례(status 의 afterWorker — worker done 과 커밋 관문, worktree 방식이면 순서가 바뀐다).
// commit: 고침 작업자를 닫은 뒤 고친 코드의 커밋 관문(worktree 방식이면 worker done 이 이미 합쳐 빈 글).
export function featureHint(st, row, startHint, after, commit = '') {
  const s = row.step
  const { k, c } = featureState(st, row)
  const checkSpec = `.rail/check/template.md 의 빈칸만 채워(기능·완료 기준은 표의 ${s} 줄 그대로, 마일스톤 목표는 기획서의 그 마일스톤 성공 장면, 바뀐 파일은 이 기능 커밋의 git show --stat. 만든 작업자의 대화·보고서 해석은 넣지 않는다) .orchestration/${s}-check-spec.md 로 쓰고 worker start ${s}-check --agent claude --role check`
  const keep = `확인 기록과 재현 시험(.rail/check/${s}.json, .rail/check/${s}/)을 커밋해 잠근다(검사 명령이 돌리지 않으므로 커밋 관문을 지난다)`
  const done = `step-done ${s} --note "<시험 결과와 확인 결과 한 줄>"`
  return {
    build: `${startHint}. 그다음 작업자의 worker_done 이 오면 ${after(s)} → 확인 step`,
    building: `작업자의 worker_done 이 오면 ${after(s)} → 확인 step`,
    check: `확인 step — ${c?.error ? `${c.error}. ` : '만든 작업자의 보고에 코드 지도와 다른 구조(새 폴더·모듈, 다른 자료 길)가 있으면 CLAUDE.md "## 코드 지도" 그 줄을 고쳐 이 기능 커밋에 함께 넣는다(리더만 고친다). '}${checkSpec}`,
    checking: `확인 작업자의 worker_done 이 오면 worker done ${s}-check, 그다음 .rail/check/${s}.json 의 must 를 본다`,
    fix: `고침 step — 확인이 꼭 고칠 것 ${c?.must?.length}건을 냈습니다. 먼저 ${keep}. 그다음 must 목록과 재현 시험 경로를 넣은 .orchestration/${s}-fix-spec.md(완료 기준: node --test '.rail/check/${s}/*.test.mjs' 와 전체 node --test 통과, 재현 시험은 고치지 않고, 고친 뒤 tests/ 의 새 파일로 복사해 검사 명령이 돌게 한다. 같은 것을 보는 시험이 이미 있으면 복사하지 않는다)로 worker start ${s}-fix --agent claude --role fix`,
    fixing: `고침 작업자의 worker_done 이 오면 ${after(`${s}-fix`)} → ${done}`,
    ready: `확인 끝(must ${c?.must?.length ?? 0}건, nice ${c?.nice?.length ?? 0}건) — ${keep}(이미 했으면 건너뜀). ${c?.must?.length && commit ? `고친 코드: ${commit}(고침 보고에 지도와 다른 구조가 있으면 코드 지도도 함께). ` : ''}그다음 ${done}`
  }[k]
}
