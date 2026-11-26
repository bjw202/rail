// step-start, step-done 명령.
import { BASELINE } from '../../hooks/lib.mjs'
import { readBaseline, testFileHashes, writeBaseline } from './baseline.mjs'
import { autonomyOn } from './config.mjs'
import { fail, gitIn, isGitTop, now, out, today } from './core.mjs'
import { stepGate } from './gates.mjs'
import { partOff } from './parts.mjs'
import { featureProblems } from './check.mjs'
import { activeRows, inScope, isActive, isFeatureRole, isTestRole, readPlan, writeStatus } from './plan.mjs'
import { appendLog, readEvents, saveState } from './state.mjs'
import { leftWorktrees } from './worktree.mjs'


export function cmdStepStart({ pos }) {
  const stepId = pos[0]
  if (!stepId) fail('사용법: step-start <step>', 2)
  const { st, plan, row } = stepGate('step-start', stepId)
  appendLog('gate_passed', st, { target: 'step-start', step: stepId })
  if (!isActive(row.status)) writeStatus(plan, row, '⏳ 진행 중')
  st.step = stepId
  saveState(st)
  const others = activeRows(readPlan(st.milestone), st).filter((r) => r.step !== stepId).map((r) => r.step)
  const first = !readEvents().some((e) => e.event === 'step_start' && e.milestone === st.milestone)
  appendLog('step_start', st, { step: stepId, role: row.role, ...(others.length ? { alongside: others } : {}) })
  out(`[step] ${stepId} 시작 (${row.role}). 상태 칸: ⏳ 진행 중${others.length ? `\n함께 진행 중: ${others.join(', ')}` : ''}`)
  // 자율 모드: 마일스톤의 첫 step 을 사람의 "시작" 승인 없이 열었음을 남긴다.
  if (first && autonomyOn()) {
    appendLog('auto_start', st, { step: stepId, steps: plan.rows.map((r) => r.step) })
    out(`[자율] 시작 승인을 묻지 않고 ${st.milestone} 를 시작했습니다 (auto_start 기록).`)
  }
}

export function cmdStepDone({ pos, flags }) {
  const stepId = pos[0]
  const note = typeof flags.note === 'string' ? flags.note.trim() : ''
  if (!stepId || !note) fail('사용법: step-done <step> --note "<한 줄>" [--commit <hash>]', 2)
  if (/[|\n]/.test(note)) fail('--note 에는 "|" 나 줄바꿈을 쓸 수 없습니다. 표 칸이 늘어납니다.', 2)
  const commit = flags.commit
  if (commit !== undefined && !/^[0-9a-f]{7,40}$/i.test(commit ?? '')) fail('--commit 은 7~40자리 커밋 해시입니다.', 2)
  const { st, plan, row } = stepGate('step-done', stepId)
  if (commit && isGitTop() && !gitIn(['cat-file', '-e', `${commit}^{commit}`]).ok) fail(`[관문] 커밋 ${commit} 이 이 저장소에 없습니다.`)
  const wt = leftWorktrees().filter((w) => !w.merged && (w.step === stepId || w.step.startsWith(`${stepId}-`))).map((w) => w.branch)
  if (wt.length) appendLog('gate_blocked', st, { target: 'worktree-merge', via: 'step-done', step: stepId, problems: wt }), fail(`[관문] step-done ${stepId}: 안 합쳐진 작업자 브랜치가 있습니다: ${wt.join(', ')} (worktree merge <step>)`)
  appendLog('gate_passed', st, { target: 'step-done', step: stepId })
  // 기능 줄은 확인 기록이 있어야(꼭 고칠 것이 있으면 고침 작업자까지 끝나야) 끝난다.
  if (isFeatureRole(row) && !partOff('feature-check')) {
    const fp = featureProblems(st, row)
    if (fp.length) appendLog('gate_blocked', st, { target: 'feature-check', step: stepId, problems: fp }), fail(`[관문] step-done ${stepId} 를 할 수 없습니다. 빠진 것:\n${fp.map((p) => `  - ${p}`).join('\n')}`)
    appendLog('gate_passed', st, { target: 'feature-check', step: stepId })
  }
  const text = `✅ 끝(${today()}) ${note}${commit ? ` · 커밋 ${commit.slice(0, 7)}` : ''}`
  writeStatus(plan, row, text)
  const data = { step: stepId, role: row.role, note, commit: commit ?? null }
  let extra = ''
  if (isTestRole(row)) {
    // 시험 step 이 끝나면 지금의 시험 파일을 기준선에 찍어 커밋 전이어도 잠근다.
    // 아직 도는 다른 시험 step 의 "고쳐도 되는 파일" 안의 것은 그 step 이 끝날 때 잠근다(앞 기준선 값을 둔다).
    const now_ = testFileHashes()
    const base = readBaseline()
    const others = readPlan(st.milestone).rows.filter((r) => r.step !== stepId && isTestRole(r) && isActive(r.status) && r.files.length)
    const mine = (f) => row.files.length && inScope([f], row).length > 0
    const files = {}
    for (const [f, h] of Object.entries(now_)) {
      if (mine(f) || !others.some((r) => inScope([f], r).length)) files[f] = h
      else if (base?.files?.[f]) files[f] = base.files[f]
    }
    writeBaseline({ made_by: 'rail.mjs step-done', at: now(), milestone: st.milestone, step: stepId, files })
    data.baseline = Object.keys(files).length
    extra = `\n[시험 기준선] 시험 파일 ${data.baseline}개를 ${BASELINE} 에 찍었습니다. 이제 커밋 전이어도 잠깁니다.`
  } else {
    const base = readBaseline()?.files
    if (base) {
      const cur = testFileHashes()
      const changed = Object.keys(base).filter((f) => cur[f] !== base[f])
      if (changed.length) {
        data.tests_changed = changed
        extra = `\n[경고] 기준선 뒤에 바뀌거나 사라진 시험 파일: ${changed.join(', ')}`
      }
    }
  }
  // 동시에 도는 step 이 남아 있으면 st.step 은 그중 하나를 가리킨다.
  if (!st.step || st.step === stepId) st.step = activeRows(readPlan(st.milestone), { ...st, step: null })[0]?.step ?? null
  saveState(st)
  appendLog('step_done', st, data)
  out(`[step] ${stepId} 끝. 상태 칸: ${text}${extra}`)
}
