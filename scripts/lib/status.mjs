// 위치와 "다음 할 일" 문구: status, precompact 명령.
import { autonomy, autonomyOn, commitPolicy, loadConfig, railVersion, versionLabel } from './config.mjs'
import { RAIL_CMD, out, strList, today } from './core.mjs'
import { NO_COST } from './budget.mjs'
import { gradeLine, nextOpenMilestone, openRisks, readSheet, sheetProblems, unplanned } from './docs.mjs'
import { featureHint } from './check.mjs'
import { disabledParts, partOff } from './parts.mjs'
import { activeRows, isActive, isDone, isFeatureRole, isFixRole, isImplRole, isReviewRole, isTestRole, planProblems, planViolations, readPlan, startable, stepList } from './plan.mjs'
import { protoCard, protoNext } from './proto.mjs'
import { brokenScenes, pendingClose, pendingScenes, pendingText } from './queue.mjs'
import { SELF_FIX_MAX, sceneProblems, sceneQuestion, selfFix } from './scene.mjs'
import { hookInput, noteLeader } from './session.mjs'
import { staleList, staleText } from './stale.mjs'
import { loadState, readEvents, softLog } from './state.mjs'
import { verifyStatus } from './verify.mjs'
import { openWorkers } from './workers.mjs'
import { isolated, leftLine, leftWorktrees, wtDir } from './worktree.mjs'

export const SKILL_OF = { plan: 'rail-plan', decide: 'rail-plan', milestone: 'rail-milestone', check: 'rail-check' }

// ---------- 상태 표시 ----------
// 절차의 원본은 이 파일 하나다. 스킬에는 코드가 할 수 없는 판단(인터뷰, 카드 쓰기, 지시서 내용)만 남긴다.
export const approveHint = (doc, q, what) => `${what} 보여 주고 ask "${q}" --kind approve 로 묻고 턴을 끝내기. "맞음"이면 answer 로 남긴 뒤 ${doc} 맨 위 승인 줄을 "승인: ${today()}" 로 둔다(없으면 더하고 있으면 날짜를 바꾼다. 사람의 "맞음" 없이 쓰지 않는다)`
export const roleFlag = (row) => (/마지막\s*리뷰/.test(row.role) ? 'final-review' : isTestRole(row) ? 'test' : isReviewRole(row) ? 'review' : isImplRole(row) ? 'impl' : isFeatureRole(row) ? 'feature' : isFixRole(row) ? 'fix' : null)
export function startHint(row) {
  const role = roleFlag(row) ?? '<feature|fix|test|impl|review|final-review>'
  const codex = (strList(loadConfig().codexRoles) ?? ['final-review']).includes(role)
  const sl = role === 'final-review' ? staleList(loadState()) : []
  const stale = sl.length ? `. 명세에 에이전트 판정으로 고친 시험 ${sl.length}건을 그대로 넣고 "이 고침이 시험을 느슨하게 만들지 않았는지(새 동작이 아닌 버그를 덮지 않았는지) 본다"를 한 줄 더한다:\n${staleText(sl)}` : ''
  return `명세 .orchestration/${row.step}-spec.md 를 쓰고 worker start ${row.step} --agent ${codex ? 'codex' : 'claude'} --role ${role} (Orca 가 없으면 하위 에이전트에 같은 명세를 주고 log worker_start)${stale}`
}
export function commitHint(row, step = row.step) {
  const scope = `바뀐 파일이 이 step 의 "고쳐도 되는 파일" 안${isImplRole(row) ? '(tests/·fixtures/ 변경 없음)' : ''}`
  if (isolated(roleFlag(row))) return `커밋 관문(worktree): 작업자가 브랜치 rail/${step} 에 커밋했고 ${wtDir(step)} 에서 checkCommand 가 통과하고 ${scope}(git diff --name-only HEAD...rail/${step})인지 본다. 아니면 작업자 브랜치에서 고치게. 리더는 커밋하지 않는다`
  const pol = commitPolicy() === 'auto-local' ? '묻지 않고 로컬 커밋(푸시 안 함)' : '사람에게 물은 뒤 커밋'
  const test = isTestRole(row) ? ' 시험 step 은 짝 구현 전이라 checkCommand 가 통과가 아니므로 커밋하지 않는다.' : ''
  return `커밋 관문: checkCommand 가 통과하고(마무리 검사 훅도 본다) ${scope}이면 커밋 정책대로 이 step 의 파일만 ${pol}.${test}`
}
// 작업자가 끝난 뒤의 차례. worktree 방식이면 커밋 관문을 그 worktree 에서 먼저 하고, worker done 이 합치고 지운다.
export const afterWorker = (row, step = row.step) => (isolated(roleFlag(row)) ? `${commitHint(row, step)} → worker done ${step} (main 에 합치고 worktree 를 지운다)` : `worker done ${step} → ${commitHint(row)}`)
export const doneHint = (row) => `작업자의 worker_done 이 오면 ${afterWorker(row)} → 마지막에 step-done ${row.step} --note "<시험 결과 한 줄>" [--commit <해시>]`
// 착수 전 결정(D)과 가정 시험(T)의 다음 할 일. 상태의 원본은 기획서 "## 결정과 시험" 의 그 줄이다.
export function cardHint(d, m, st) {
  const id = d.id
  if (id.startsWith('T'))
    return `가정 시험 — .rail/trial/template.md 를 채워 .rail/trial/${id}/spec.md 로 쓰고 버리는 코드로 같은 축 두 방법을 진짜 자료로 시험한다(리더가 하거나 하위 에이전트에 준다). 기획서 ${id} 줄에 "시험: 통과|실패|판단 보류(<기한>) · <숫자> · 감수: <한 줄>"(진짜 자료가 없으면 "통과(작은 예제 범위까지만)"), 통과한 재는 스크립트는 .rail/config.json 의 verify 에 넣는다${/실패/.test(d.why) ? '. 지금 실패라 다른 방법을 시험하거나 그 장면의 착수 전에서 빼고 범위를 줄인다' : ''}`
  const after = `사람이 고르면 answer "<답 그대로>" 뒤 기획서 ${id} 줄을 "결정: 선택함 (<고른 것>) · 이유: <사람 말> · 다시 볼 조건: <한 줄>" 로 고친다("추천대로"면 "결정: AI가 고름(위임) (<고른 것>)", 나중이면 "결정: 미룸(<기한>)")`
  if (st.human_ask) return after
  return `기획서 ${id} 줄 아래에 후보 2~3개(하나는 가장 단순한 안, 후보마다 결과와 깨지는 장면 한 줄)와 추천을 붙여 보이고 ask "${id} 는 A/B/C 중 무엇으로 할까요? (추천대로도 됩니다)" --kind decide 로 묻고 턴을 끝내기. 봐야 아는 결정이면 먼저 docs/decisions/${id}-<이름>.md 시제품 카드("# ${id} (질문 제목)" / "마일스톤: ${m}" / "시제품: 예" / "## 질문" / "## 변주"(- p1-이름: 한두 줄, 2~3개) / "## 스크린샷"(- d-1124.png: 2026-11-24, 데스크톱 폭 1280))를 쓰고 /rail 을 다시 본다. ${after}`
}
// 닫기 전 기획서 "## 살아 있는 세 줄"을 이 마일스톤으로 고쳤는가(줄에 Mx 가 있는가). 관문은 아니고 다음 할 일만 알려 준다.
// 계획 밖 결정 수는 코드가 센 값(docs.mjs unplanned)을 적게 한다.
const livingHint = (sh, m, st) => {
  if (new RegExp(`\\b${m}\\b`).test(sh?.living.join('\n') ?? '')) return ''
  const g = unplanned(st, sh)
  return `먼저 기획서 "## 살아 있는 세 줄"을 ${m} 기준으로 고친다(- 깨진 가정: / - 계획 밖 결정: ${g?.id === m ? `누적 ${g.total}번 (${m} ${g.now})` : `<누적 N번> (${m} <이번 수>)`} · 계획 변경: / - 다음 장면:). "## 나중에" 도 본다. 그다음 `
}
export const SCENE_PREP = (m) =>
  `점검표 .rail/rehearsal/${m}/checklist.md 를 쓰고(0번은 "지금 화면이 오늘 빌드인가") 명세 .orchestration/${m}-rehearsal-spec.md 로 worker start ${m}-rehearsal --agent claude --role rehearsal. 리허설 작업자는 항목마다 .rail/rehearsal/${m}/<번호>.png 와 result.json({"items":[{"id":"0","check":"<항목>","result":"pass|fail","saw":"<본 숫자 한 줄>","shot":"0.png"}]})을 쓰고 rehearsal-record ${m}`

// reopen 뒤 고칠 줄을 아직 시작하지 않았으면 그 까닭(스스로 고치기면 리허설 실패 항목), 아니면 null.
const reopened = (st) => {
  const ev = readEvents().filter((e) => e.milestone === st.milestone)
  const i = ev.findLastIndex((e) => e.event === 'milestone_reopened')
  if (i < 0 || ev.slice(i).some((e) => e.event === 'step_start')) return null
  const f = ev[i].failed
  return f?.length ? `스스로 고치기 ${ev[i].self_fix}번째, 리허설 실패 ${f.map((x) => `${x.id}(${x.check})`).join(', ')}` : '장면 확인 실패로 되돌림'
}
export function describe(st) {
  const m = st.milestone
  const rm = readSheet()
  let waiting = st.human_ask ? `사람의 답 — "${st.human_ask.q}"` : '없음'
  const v = planViolations(st, st.stage === 'milestone' || st.stage === 'check')
  let pos
  let next
  let skill = SKILL_OF[st.stage] ?? null
  if (st.stage === 'plan') {
    pos = `기획 · 기획서 (질문 ${st.interview.asked})`
    const sp = sheetProblems(rm)
    const form = '.rail/plan/template.md 꼴'
    if (!rm)
      next = `기획 · 인터뷰 — docs/plan/refs/ 가 있으면 먼저 보고, 보여 주고 반응 받기로 한 번에 하나씩 묻습니다(ask "<질문 한 줄>" 로 기록하고 턴을 끝내고, 답이 오면 answer "<답 그대로>", 세 번마다 되짚기). 더 물어서 범위·성공 기준·시작 여부가 바뀔지 한 문장으로 말할 수 없으면 멈추고 ${form}로 docs/PLAN.md 를 쓴다`
    else if (sp.length) next = `기획서 마무리 — ${sp[0]}. ${/승인 날짜/.test(sp[0]) ? approveHint('PLAN.md', '이 기획서대로 갈까요? (맞음 / 고칠 문장)', '맨 위 네 줄·성공 장면·첫날 실패 장면·마일스톤 지도를') : form}`
    else (next = `기획서가 승인됐습니다. ${nextOpenMilestone(st, rm)} 착수 전 결정·시험으로 넘어갑니다 (advance decide --milestone ${nextOpenMilestone(st, rm)})`), (skill = 'rail')
  } else if (st.stage === 'decide') {
    pos = `${m} 시작 전 · 착수 전 결정과 시험`
    const open = openRisks(m, rm)
    const unpicked = (rm?.ms.find((x) => x.id === m)?.risks ?? []).find((id) => protoCard(id)?.on && !open.some((d) => d.id === id) && !readEvents().some((e) => e.event === 'proto_picked' && e.proto === id))
    const noCheck = loadConfig().checkCommand ? '' : ' · .rail/config.json 의 checkCommand 가 비었습니다. 제품 스택이 정해졌으면 채우기(예: npm test)'
    if (open.length) next = protoNext(open[0].id) ?? `착수 전 풀기 — 남은 것: ${open.map((d) => d.id).join(', ')}. 지금: ${open[0].id} (${open[0].why}) — ${cardHint(open[0], m, st)}`
    else if (unpicked) next = `시제품 정리 — 고른 변주의 화면을 기준 화면으로 옮기고 시제품 작업 공간 지우기 (proto pick ${unpicked} <변주>). 옮긴 .rail/reference/${m}/ 는 커밋에 넣는다`
    else (next = `${m} 착수 전 결정·시험이 모두 풀렸습니다. 마일스톤을 시작합니다 (advance milestone)${noCheck}`), (skill = 'rail')
  } else if (st.stage === 'milestone') {
    const plan = readPlan(m)
    const rows = plan?.rows ?? null
    const doing = plan ? activeRows(plan, st).map((r) => r.step) : st.step ? [st.step] : []
    pos = `${m} · step 진행${doing.length ? ` (${doing.join(', ')})` : ''}`
    const pp = plan ? planProblems(plan, st) : []
    const row = (id) => plan.rows.find((r) => r.step === id)
    const hasWorker = new Set(openWorkers(st).map((w) => w.step))
    const feat = (id) => isFeatureRole(row(id)) && !partOff('feature-check')
    const go = (id) => (feat(id) ? featureHint(st, row(id), startHint(row(id)), (s) => afterWorker(row(id), s)) : hasWorker.has(id) ? doneHint(row(id)) : `${startHint(row(id))}. 그다음 ${doneHint(row(id))}`)
    if (!rows?.length)
      next = `${m} step 표 ${rows ? '채우기' : '만들기'} — docs/plan/${m}.md 에 현재 마일스톤만. 머리줄 "| step | 맡는 쪽 | 할 일 | 고쳐도 되는 파일 | 기다리는 step | 완료 기준 | 상태 |", 기본은 기능 목록: 줄 하나가 사용자가 알아볼 기능 하나(맡는 쪽 "기능", 할 일 = 기능 이름, 완료 기준 = 무엇이 보이면 끝인지와 확인 명령, 기획서 장면의 "이어지는 step" 이 가리키는 줄은 그 장면의 자동 확인 그대로(그 확인이 배포된 주소처럼 바깥 상태를 보면 그 부분은 마지막 리뷰·리허설 전 배포 뒤의 마일스톤 끝 확인으로 두고, 줄의 완료 기준에는 로컬로 재는 부분만 옮긴다), 작업자 하나가 시험과 구현을 함께)이고 마지막 줄은 "마지막 리뷰"(예전 방식 시험·구현·리뷰도 쓸 수 있다), 기다리는 step 칸은 비우면 앞 step 모두·"없음"이면 안 기다림, 동시에 돌 step 의 파일 칸은 겹치지 않게, 상태 칸은 비우고 어느 칸에도 | 를 쓰지 않는다. 쓴 뒤 ${autonomyOn() ? '자율 모드라 묻지 않고 첫 step-start' : '표를 보여 주고 ask "이대로 시작할까요? (시작 / 바꿀 것)" --kind approve'}`
    else if (pp.length) next = `표 검사 실패 — ${pp[0]}`
    else {
      const open = rows.filter((r) => !isDone(r.status))
      const left = `(남은 ${open.length}/${rows.length})`
      const ready = startable(plan, st).map((r) => r.step)
      // 새 표의 첫 시작 전에는 사람의 표 승인이 먼저다(자율 모드면 묻지 않는다). 승인 뒤 더한 기능 줄(표 승인 답·auto_start 가 남긴 줄 목록에 없는 줄)도 시작 전에 승인을 안내한다. 막지는 않는다.
      const base = readEvents().findLast((e) => e.milestone === m && e.steps?.length && (e.event === 'auto_start' || e.kind === 'approve'))?.steps
      const added = base ? ready.filter((id) => isFeatureRole(row(id)) && !base.includes(id)).join(', ') : ''
      const plus = !added ? '' : autonomyOn() ? `자율 모드: 승인 뒤 더한 기능 ${added} 은(는) 기본으로 기획서 "## 나중에" 로 옮기고 표에서 뺀다. 지금 장면을 깨는 문제를 고치는 줄이면 ` : `표 승인 뒤 더한 기능 줄 ${added} 을(를) 보여 주고 ask "이대로 시작할까요? (시작 / 바꿀 것)" --kind approve 로 묻고 턴을 끝내기. 승인 답이 오면 `
      const also = ready.length ? ` · 함께 시작할 수 있는 step: ${ready.join(', ')} (${plus}각각 step-start)` : ''
      const fresh = !autonomyOn() && !st.gates.plan_approved?.[m] && rows.every((r) => !isDone(r.status) && !isActive(r.status)) ? '표를 사람이 승인하지 않았으면 표를 보여 주고 ask "이대로 시작할까요? (시작 / 바꿀 것)" --kind approve 로 묻고 턴을 끝내기. 승인됐으면 ' : plus
      if (doing.length === 1) next = `step ${doing[0]} 진행 중 — ${go(doing[0])}${also} ${left}`
      else if (doing.length)
        next = `step ${doing.join(', ')} 동시 진행 중 — 끝나는 대로 하나씩(한꺼번에 하지 않는다): 작업자의 worker_done 이 오면 worker done <step> → 그 step 만 커밋 관문(다른 step 이 아직 쓰는 파일 때문에 checkCommand 가 실패하면 그 step 이 끝난 뒤 다시) → step-done <step> --note "<한 줄>"${doing.some((id) => isolated(roleFlag(row(id)))) ? ' (worktree 방식의 만드는 step 은 커밋 관문을 그 worktree 에서 먼저 하고, 그다음 worker done 이 합친다)' : ''}${doing.some(feat) ? ` · 기능 줄은 step-done 전에 확인 step: ${doing.filter(feat).map((id) => `${id}: ${go(id)}`).join('; ')}` : ''}${doing.some((id) => !hasWorker.has(id) && !feat(id)) ? ` · 작업자가 없는 step: ${doing.filter((id) => !hasWorker.has(id) && !feat(id)).map((id) => startHint(row(id))).join('; ')}` : ''}${also} ${left}`
      else if (ready.length === 1) next = `step ${ready[0]} 진행 — ${fresh}먼저 step-start ${ready[0]}, 그다음 ${startHint(row(ready[0]))} ${left}`
      else if (ready.length) next = `step ${ready.join(', ')} 을(를) 동시에 시작할 수 있습니다 — ${fresh}각각 step-start 하고 명세를 써서 worker start <step> 으로 작업자를 나눈 창에 함께 띄우기 (같은 에이전트·역할이면 한 번에) ${left}`
      else if (open.length) next = `step ${open[0].step} 진행 — 먼저 step-start ${open[0].step} ${left}`
      else if (reopened(st))
        next = `고칠 줄 더하기 — ${reopened(st)}. docs/plan/${m}.md 에 항목마다 맡는 쪽 "고침" 줄(완료 기준 = 그 항목이 리허설에서 통과)을 더하고 step-start`
      else {
        const vs = verifyStatus(st)
        next = vs.problems.length ? `${m} step 이 모두 끝났습니다. 먼저 바깥 정답 검증기 — ${vs.problems[0]}. 실패하면 고칠 step 을 표에 더한다` : `${m} step 이 모두 끝났습니다. 장면 확인으로 넘어갑니다 (advance check)`
        skill = 'rail'
      }
    }
  } else if (st.stage === 'check') {
    pos = `${m} · 장면 확인`
    const sc = st.gates.scene_checked[m]
    const before = sceneProblems(st)
    const rh = st.gates.rehearsed?.[m]
    const ask = st.human_ask
    const rehearsing = openWorkers(st).some((w) => w.step === `${m}-rehearsal`)
    if (!sc && before.length)
      next = `장면 확인 전에 — ${before[0]}${/리허설/.test(before[0]) ? (rehearsing ? `. 리허설 작업자의 worker_done 이 오면 worker done ${m}-rehearsal` : `. ${SCENE_PREP(m)}`) : ''}`
    // 판이 바뀌기 전에 연 장면 질문은 지금 판의 문구(답의 꼴과 예시가 든)로 바꿔 묻는다.
    else if (!sc && ask && ['scene', 'approve'].includes(ask.kind) && !ask.follow_up && ask.q !== sceneQuestion(st))
      next = `질문을 바꿔 묻기 — 열린 장면 질문이 ${versionLabel()}의 문구가 아닙니다. ask --scene --replace 로 바꿔 묻고 턴을 끝내기`
    else if (!sc && ask?.kind === 'scene') next = '사람의 장면 답 기다리기 — 답이 오면 answer "<답 그대로>" (판정과 본 것은 스크립트가 가릅니다. [다시 묻기] 가 나오면 그 질문만 그대로 한 번 더 묻고 턴을 끝내기)'
    else if (!sc && rh && selfFix(st).ok)
      next = `스스로 고치기 (${selfFix(st).n + 1}/${SELF_FIX_MAX}) — 리허설 실패 ${rh.failed.map((f) => f.id).join(', ')} 는 기계로 가릴 수 있는 항목이라 사람에게 묻기 전에 고칩니다: reopen --self-fix, 그다음 고칠 줄을 더하고 다시 리허설`
    else if (!sc && rh && pendingClose(st, rm).ok)
      next = `장면 판정 대기로 닫기 — ${pendingClose(st, rm).why}. ${livingHint(rm, m, st)}advance close 로 ${m} 를 판정 대기 목록에 올리고(판정으로 고친 시험 목록도 함께) 다음 마일스톤으로 넘어간다(사람 판정은 돌아왔을 때 scene ${m} --result pass|fail --note "<본 것>")`
    else if (!sc && rh)
      next = `리허설 결과(스크린샷 ${rh.total}장, 통과 ${rh.pass}/${rh.total}${rh.failed.length ? `, 실패 ${rh.failed.map((f) => f.id).join(', ')} 먼저` : ''})를 사람에게 보여 주고 장면 질문하기 (ask --scene). 실패 항목과 스크린샷을 먼저, 통과 항목은 본 숫자와 경로를 한 줄씩. 출력된 질문을 그대로 보이고 턴을 끝내기`
    else if (!sc) next = '장면 점검표 띄우고 사람이 직접 해 보게 하기'
    else if (sc.result !== 'pass') next = '장면 확인이 실패로 기록됐습니다. 고칠 step 을 더하고 다시 확인합니다 (reopen). 새 줄의 상태 칸은 비우고, 새로 정할 것이 생기면 기획서 결정과 시험에 줄을 더하고 계획 밖 결정으로 센다'
    else (next = `${m} 를 닫습니다 — ${livingHint(rm, m, st)}advance close. 출력의 [덜어내기]·[알림 실패] 줄을 사람에게 그대로 전하고, 바뀐 문서는 커밋 정책대로 커밋`), (skill = 'rail')
  } else {
    pos = '모든 마일스톤 완료'
    const open = nextOpenMilestone(st, rm)
    const more = `주인이 기능을 더하자고 하면: 기획서의 관련 장면·결정(다시 볼 조건)·깨진 가정·"## 나중에"·확인 기록(.rail/check/*.json)의 nice 를 읽고, 그 기능이 닿는 지금 코드와 시험을 확인한다. 지금 되는 것과 바뀔 것을 짧게 보여 주고 같은 기획서(맨 위 네 줄·장면·화면·지도)를 고친 뒤 ${approveHint('PLAN.md', '이렇게 고친 기획서대로 갈까요? (맞음 / 고칠 문장)', '고친 줄을')}`
    next = open ? `기획서 마일스톤 지도에 새 마일스톤 ${open} 이 있습니다 — 먼저 달라진 범위와 완료 기준을 주인에게 보여 주고 승인을 받았는지 본다(아직이면 보여 주고 묻는다). 받았으면 advance decide --milestone ${open}` : `남은 일이 없습니다. ${more}`
    skill = open ? 'rail' : 'rail-plan'
  }
  if (st.human_ask && !/answer|질문을 바꿔 묻기/.test(next)) next += ` · 사람 답이 오면 answer "<답 그대로>" (출력이 [다시 묻기] 면 그 질문만 다시 묻고 턴을 끝내기)`
  if (v.length) next = `관문 위반 — ${v[0]}`
  const broken = brokenScenes(st)
  if (broken.length) next = `앞 마일스톤 장면 실패 — ${broken.map((id) => `${id}: "${st.gates.scene_checked[id].note}"`).join(', ')}. 사람과 고칠 것을 정해 지금 표에 고칠 줄을 더하고, 고친 뒤 사람이 보면 scene <Mx> --result pass --note "<본 것>" · 그다음 ${next}`
  const judging = openWorkers(st).filter((w) => /-stale$/.test(w.step)).map((w) => w.step)
  if (judging.length) next += ` · 판정 작업자 ${judging.join(', ')}: worker_done 이 오면 worker done 으로 닫고 .rail/stale/<step>.json 을 커밋한 뒤, stale 줄이 있으면 worker start <step> 이 그 작업자 하나에 시험 고치기를 붙인다(keep 줄은 코드를 고친다)`
  const left = leftLine(leftWorktrees(), new Set(openWorkers(st).map((w) => w.step)))
  if (left) next += ` · ${left}`
  const pending = pendingScenes(st)
  if (pending.length) waiting = `${waiting === '없음' ? '' : `${waiting} · `}사람 장면 판정 대기: ${pendingText(st)} (사람이 말하면 scene <Mx> --result pass|fail --note "<본 것>")`
  return { position: pos, waiting, next, skill, violations: v, grade: gradeLine(unplanned(st, rm)) ?? null }
}

export function cmdStatus({ flags }) {
  // 훅으로 불리면 입력의 session_id 를 리더 세션으로 적는다. 압축 뒤의 세션 시작은 compact 매처 항목(--compact)이 맡는다.
  const input = flags.hook ? hookInput() : {}
  if (flags.hook) noteLeader(input.session_id, input.session_title)
  if (flags.hook && input.source === 'compact' && !flags.compact) return
  const st = loadState()
  const d = describe(st)
  const steps = stepList(st)
  const workers = openWorkers(st)
  const stepText = steps.length ? `\nstep (${st.milestone}):\n${steps.map((x) => `  ${x.mark} ${x.step} ${x.role}`).join('\n')}` : ''
  const workerText = workers.length ? `\n작업자: ${workers.map((w) => `${w.step}(${w.agent ?? '?'}, ${w.role ?? '?'}, 창 ${w.terminal ?? '?'}, 일 ${w.dispatch ?? '?'})`).join(', ')}` : ''
  const noCost = autonomyOn() && !autonomy().budget.costCommand ? `\n[경고] ${NO_COST}` : ''
  const text = `위치: ${d.position}\n기다리는 것: ${d.waiting}\n다음 할 일: ${d.next}${d.grade ? `\n기획 성적: 계획 밖 결정 ${d.grade}` : ''}${noCost}${workerText}${stepText}`
  if (flags.hook && flags.compact) {
    softLog('compact_resumed', st, { session: input.session_id ?? null, source: input.source ?? null })
    const again = `압축됐다. docs/RAIL.md 와 지금 마일스톤의 step 표${st.milestone ? `(docs/plan/${st.milestone}.md)` : ''}를 다시 읽고, 진행 중 작업자를 \`${RAIL_CMD} status\` 로 확인한 뒤 이어서 하라.`
    return out(JSON.stringify({ systemMessage: `[${versionLabel()} 압축 뒤 이어받기]\n${text}`, hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: `[${versionLabel()} 압축 뒤 이어받기]\n${text}\n${again}` } }))
  }
  if (flags.json)
    out(
      JSON.stringify(
        {
          stage: st.stage,
          milestone: st.milestone,
          step: st.step,
          waiting_for: st.waiting_for,
          human_ask: st.human_ask,
          ...d,
          steps,
          rail_version: railVersion(),
          commit_policy: commitPolicy(),
          autonomy: { mode: autonomy().mode, effective: autonomyOn() },
          workers,
          leader_session: st.leader_session ?? null,
          disabled: disabledParts()
        },
        null,
        2
      )
    )
  else if (flags.hook)
    out(
      JSON.stringify({
        systemMessage: `[${versionLabel()}]\n${text}`,
        hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: `[${versionLabel()} 상태]\n${text}\n이 프로젝트는 레일로 진행합니다. 작업 전에 /rail 의 안내와 관문을 따르세요.` }
      })
    )
  else out(text.replace(/^.*/, (first) => `${first} (${versionLabel()})`))
}
// PreCompact 훅이 부른다. 표준 출력이 압축 요약 지시가 된다(Claude Code 가 1만 자에서 자른다). 압축을 막지 않는다.
export function cmdPrecompact() {
  const input = hookInput()
  noteLeader(input.session_id, input.session_title)
  const st = loadState()
  const ev = readEvents()
  const d = describe(st)
  const plan = st.milestone ? readPlan(st.milestone) : null
  const doing = plan ? activeRows(plan, st).map((r) => r.step) : st.step ? [st.step] : []
  const workers = openWorkers(st, ev)
  const ask = st.human_ask
  const cut = (t, n) => (String(t).length > n ? `${String(t).slice(0, n - 1)}…` : String(t))
  const text = [
    `[${versionLabel()} 압축 지시] 아래 사실은 요약에 빠짐없이, 글자 그대로 남겨라.`,
    '반드시 남길 것:',
    `- 레일 위치: ${d.position} (단계 ${st.stage}, 마일스톤 ${st.milestone ?? '없음'}, 진행 중 step ${doing.join(', ') || '없음'})`,
    `- 다음 할 일: ${d.next}`,
    `- 진행 중 작업자: ${workers.length ? '' : '없음'}`,
    ...workers.map((w) => `  - ${w.step}: agent ${w.agent ?? '?'}, role ${w.role ?? '?'}, dispatch ${w.dispatch ?? '?'}, terminal ${w.terminal ?? '?'}`),
    `- 열린 사람 질문 (원문 그대로): ${ask ? `"${cut(ask.q, 2000)}" (종류 ${ask.kind}, ${ask.at} 에 물음)` : '없음'}`,
    `요약하지 말 것: CLAUDE.md, docs/RAIL.md, .claude/skills/rail*/ 의 규칙. 파일에 있으니 압축 뒤 다시 읽는다. 규칙을 요약에 옮겨 적지 마라.`,
    `압축 뒤 할 일: docs/RAIL.md 와 지금 마일스톤의 step 표를 다시 읽고, ${RAIL_CMD} status 로 진행 중 작업자를 확인한 뒤 이어서 한다.`
  ].join('\n')
  softLog('compact_started', st, { trigger: typeof input.trigger === 'string' ? input.trigger : null, session: input.session_id ?? null })
  out(cut(text, 9500))
}
