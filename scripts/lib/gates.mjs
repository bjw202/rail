// 관문 판정: 단계 순서 검사(gate:order), 장면 관문(gate:close), step 시작·끝(stepGate).
import { fail } from './core.mjs'
import { nextOpenMilestone, readSheet } from './docs.mjs'
import { partOff, partSkipped } from './parts.mjs'
import { isDone, readPlan, stepsDoneProblems } from './plan.mjs'
import { pendingClose } from './queue.mjs'
import { staleList } from './stale.mjs'
import { appendLog, loadState } from './state.mjs'
import { leftWorktrees } from './worktree.mjs'

// done → decide: 모든 마일스톤을 닫은 뒤 기획서 마일스톤 지도에 새 마일스톤을 더하면 그 결정 단계로 간다. 남은 마일스톤이 없으면 decide 관문이 막는다.
// 기획서 판: 브리프·로드맵 두 단계를 기획(plan) 한 단계로 합쳤다.
export const NEXT_OF = { plan: 'decide', decide: 'milestone', milestone: 'check', check: 'close', done: 'decide' }

// 2.9판(덜어내기 둘째): 단계 관문은 순서만 본다. 기획 문서 형식과 승인 날짜, 위험 질문 결정, step 표 위반, 모든 step ✅·검증기 통과 확인은 지웠다.
// M12 에서 꺼 두어도 리더가 스스로 지켰다. 무엇을 채울지는 status 의 "다음 할 일"이 알려 준다. close 는 장면 관문(gate:close, 보험)으로 남는다.
const ORDER = {
  decide: (st, rm, opts) => {
    const open = nextOpenMilestone(st, rm)
    if (!opts.milestone) return ['--milestone Mx 를 붙이세요 (다음에 시작할 마일스톤)']
    if (!rm) return ['docs/PLAN.md(기획서)가 없어 다음 마일스톤을 알 수 없습니다']
    if (!open) return ['시작할 마일스톤이 남아 있지 않습니다']
    return opts.milestone === open ? [] : [`다음 마일스톤은 ${open} 입니다 (${opts.milestone} 로 건너뛸 수 없습니다)`]
  },
  milestone: (st, rm, opts) => [
    ...(opts.milestone && opts.milestone !== st.milestone ? [`지금 시작 전 마일스톤은 ${st.milestone} 입니다 (${opts.milestone} 아님)`] : []),
    ...(rm?.ms.some((x) => x.id === st.milestone) ? [] : [`기획서 마일스톤 지도에 ${st.milestone ?? '해당 마일스톤'} 이(가) 없습니다`])
  ],
  // 2.9c: 머리줄만 있는 빈 step 표를 "모두 끝남"으로 넘기지 않는다(M12 rail_gap). 표가 아예 없을 때는 예전처럼 보지 않는다.
  check: (st) => (readPlan(st.milestone)?.rows.length === 0 ? [`docs/plan/${st.milestone}.md 에 step 줄이 없습니다 (step 표를 먼저 채우세요)`] : [])
}
function closeNeeds(st, rm) {
  const content = stepsDoneProblems(st)
  const warnings = []
  const sc = st.gates.scene_checked[st.milestone]
  // 2.9판: 자율 모드에서 리허설이 모두 통과했고 다음 마일스톤이 미리 승인돼 있으면, 사람 판정을 대기 목록에 올리고 닫는다.
  const pc = sc ? null : pendingClose(st, rm)
  if (pc?.ok) warnings.push(`${st.milestone} 를 사람 장면 판정 없이 닫고 판정 대기 목록에 올립니다 (${pc.why})`)
  else if (!sc) content.push(`${st.milestone} 의 사람 장면 확인 기록이 없습니다 (scene 명령)`)
  else if (sc.result !== 'pass') content.push(`${st.milestone} 의 장면 확인이 "${sc.result}" 로 기록돼 있습니다. 고친 뒤 다시 확인하세요`)
  // 판정 대기로 닫으면 목록은 대기 기록에 붙어 사람이 돌아와 본다. 그 밖에는 목록을 보인 장면 질문의 "됨"이 있어야 닫는다.
  const stale = pc?.ok ? 0 : staleList(st).length
  if (stale && !(sc?.stale >= stale)) content.push(`에이전트 판정으로 고친 시험 ${stale}건을 보인 장면 질문에 사람의 "됨" 답이 없습니다 (ask --scene 이 목록을 싣습니다)`)
  // worktree 방식: 안 합쳐진 worktree 가 남으면 닫지 않는다. 합쳐진 것은 advance close 가 지우고 넘어간다.
  const left = leftWorktrees()
  for (const w of left.filter((x) => !x.merged)) content.push(`안 합쳐진 worktree rail-${w.step} 가 남아 있습니다 (worktree merge ${w.step}, 버릴지는 사람이 정한다)`)
  if (left.some((x) => x.merged)) warnings.push(`합쳐진 worktree ${left.filter((x) => x.merged).length}개는 닫으며 지웁니다`)
  return { content, warnings }
}
// 돌려주는 값: { ok, problems, warnings, back }  back = 막혔을 때 돌아갈 단계
// 사람이 한 마일스톤 동안 장면 관문을 끄면(보험에서 뺀 뒤에만 가능) 내용 검사를 건너뛰고 part_disabled 를 남긴다. 순서 검사는 끄지 않는다.
export function gate(target, st, opts = {}) {
  const expected = NEXT_OF[st.stage]
  if (!expected) return { ok: false, problems: [`지금 단계(${st.stage})에서는 갈 곳이 없습니다`], warnings: [], back: st.stage }
  const wrongOrder = target !== expected
  const problems = wrongOrder ? [`지금은 "${st.stage}" 단계라 "${target}" 로 갈 수 없습니다. 다음 단계는 "${expected}" 입니다`] : []
  // 순서가 틀려도 지금 단계에서 갈 다음 단계가 무엇을 요구하는지 함께 알려 준다.
  const rm = readSheet()
  problems.push(...(ORDER[expected]?.(st, rm, opts) ?? []))
  const warnings = []
  if (expected === 'close') {
    const need = closeNeeds(st, rm)
    warnings.push(...need.warnings)
    if (!wrongOrder && partOff('gate:close')) {
      partSkipped('gate:close', st, { target: 'close', skipped: need.content })
      warnings.push(`관문 close 가 꺼져 있어 내용 검사 ${need.content.length}개를 건너뛰었습니다 (policy set disable)`)
    } else problems.push(...need.content)
  }
  return { ok: problems.length === 0, problems, warnings, back: st.stage }
}

// step-start / step-done 이 함께 쓰는 관문: milestone 단계, 지금 마일스톤의 표에 있는 step, 아직 끝나지 않음. 이것 없이는 상태 칸을 쓸 수 없다.
// 2.9판: 표 검사, 기다리는 step 확인은 지웠다. 함께 시작할 수 있는 step 은 status 의 "다음 할 일"이 알려 준다.
// M14 뒤: 2.9c 에서 되살린 파일 겹침 거절은 다시 지웠다. worktree 방식에서는 같은 파일을 둘이 고치면 worktree merge 가 부딪힘으로 알린다.
export function stepGate(cmd, stepId) {
  const st = loadState()
  const refuse = (problems) => {
    appendLog('gate_blocked', st, { target: cmd, step: stepId, problems, back: st.stage })
    fail(`[관문] ${cmd} ${stepId} 를 할 수 없습니다. 빠진 것:\n${problems.map((p) => `  - ${p}`).join('\n')}`)
  }
  if (st.stage !== 'milestone') refuse([`step 은 "milestone" 단계에서만 시작하고 끝냅니다. 지금은 "${st.stage}" 단계입니다`])
  if (stepId.match(/^(M\d+)-/)?.[1] !== st.milestone) refuse([`${stepId} 는 지금 마일스톤(${st.milestone})의 step 이 아닙니다`])
  const plan = readPlan(st.milestone)
  if (!plan) refuse([`docs/plan/${st.milestone}.md (step 표)가 없습니다`])
  const row = plan.rows.find((r) => r.step === stepId)
  if (!row) refuse([`${plan.rel} 에 ${stepId} 줄이 없습니다`])
  if (isDone(row.status)) refuse([`${stepId} 는 이미 끝났습니다 (${row.status})`])
  return { st, plan, row }
}
