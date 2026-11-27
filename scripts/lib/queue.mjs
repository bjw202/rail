// 밤샘 자율: 미리 승인한 뒤 마일스톤의 기능 목록(plan approve)과 사람 장면 판정 대기 목록.
import { autonomyOn } from './config.mjs'
import { fail, now, out } from './core.mjs'
import { nextOpenMilestone, readSheet, startProblems } from './docs.mjs'
import { planProblems, readPlan } from './plan.mjs'
import { staleList, staleText } from './stale.mjs'
import { appendLog, loadState, saveState } from './state.mjs'

export const MAX_AHEAD = 3
// 지금 마일스톤 뒤에 아직 안 닫힌 마일스톤(앞에서부터 MAX_AHEAD 개).
const ahead = (st, rm) => (rm?.ms ?? []).filter((m) => !st.closed.includes(m.id) && m.id !== st.milestone).slice(0, MAX_AHEAD)
export const pendingScenes = (st) => Object.keys(st.gates.scene_pending ?? {})
// 판정 대기에서 사람이 안 됨이라 한 마일스톤. 고친 뒤 다시 됨으로 남길 때까지 자율 모드는 멈춘다.
export const brokenScenes = (st) => st.closed.filter((id) => st.gates.scene_checked?.[id]?.result === 'fail')

// 판정 없이 닫고 대기 목록에 올려도 되는가: 자율 모드, 리허설 모두 통과, 깨진 장면 없음, 다음 마일스톤이 미리 승인됨.
// 판정으로 고친 시험이 있으면 그 목록을 대기 기록에 붙여 닫는다(주인 결정 2026-11-25). 사람은 돌아와 장면을 판정할 때 목록을 함께 본다.
export function pendingClose(st, rm = readSheet()) {
  const rh = st.gates.rehearsed?.[st.milestone]
  const next = nextOpenMilestone({ ...st, closed: [...st.closed, st.milestone] }, rm)
  const ok = autonomyOn() && rh && !rh.failed?.length && !brokenScenes(st).length && Boolean(next && st.gates.plan_approved?.[next])
  const n = ok ? staleList(st).length : 0
  return { ok, next, why: ok ? `리허설 ${rh.pass}/${rh.total} 통과, 다음 ${next} 미리 승인됨${n ? `, 판정으로 고친 시험 ${n}건은 대기 기록에 붙임` : ''}` : null }
}
// status 의 "기다리는 것": 판정 대기 마일스톤마다 사람에게 보일 글. 판정으로 고친 시험이 붙어 있으면 그 목록을 싣는다.
export const pendingText = (st) =>
  pendingScenes(st)
    .map((id) => {
      const sl = st.gates.scene_pending[id].stale ?? []
      return `${id}${sl.length ? ` — 에이전트 판정으로 고친 시험 ${sl.length}건이 붙어 있습니다. "됨"이면 이 목록도 승인한 것으로 남깁니다. 목록에 문제가 있으면 "안 됨"과 그 줄을 알려 주세요:\n${staleText(sl)}\n` : ''}`
    })
    .join(', ')

// plan approve <Mx> ... --said "<사람 말>": 사람이 이 세션에서 직접 승인한 뒤 마일스톤의 기능 목록을 남긴다.
export function cmdPlan({ pos, flags }) {
  const [verb, ...ids] = pos
  const said = typeof flags.said === 'string' ? flags.said.trim() : ''
  if (verb !== 'approve' || !ids.length || !said) fail('사용법: plan approve <Mx> [<My> ...] --said "<사람이 한 말 그대로>"', 2)
  const st = loadState()
  const rm = readSheet()
  const can = ahead(st, rm)
  const problems = ids.flatMap((id) => {
    const m = can.find((x) => x.id === id)
    if (!m) return [`${id}: 지금 마일스톤 뒤의 안 닫힌 마일스톤 ${MAX_AHEAD}개(${can.map((x) => x.id).join(', ') || '없음'}) 안에 없습니다`]
    const plan = readPlan(id)
    if (!plan?.rows.length) return [`${id}: docs/plan/${id}.md 에 기능 줄이 없습니다`]
    return [...planProblems(plan, st), ...startProblems(id, rm).map((p) => `${id}: ${p}`)]
  })
  if (problems.length) fail(`[미리 승인] 남길 수 없습니다:\n${problems.map((p) => `  - ${p}`).join('\n')}`)
  st.gates.plan_approved = { ...(st.gates.plan_approved ?? {}), ...Object.fromEntries(ids.map((id) => [id, { at: now(), said }])) }
  saveState(st)
  appendLog('plan_approved', st, { milestones: ids, said })
  out(`[미리 승인] ${ids.join(', ')} 의 기능 목록. 자율 모드는 마일스톤이 닫히면 승인된 다음 마일스톤으로 넘어갑니다.`)
}
