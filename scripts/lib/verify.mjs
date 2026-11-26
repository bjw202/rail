// 바깥 정답 검증기: 장면 질문 앞에서 보는 기록과 verify 명령.
import { spawnSync } from 'node:child_process'
import { SKIP_CODE, verifiers } from './config.mjs'
import { RAIL_CMD, ROOT, childEnv, lastLines, out } from './core.mjs'
import { partOff, partSkipped } from './parts.mjs'
import { appendLog, loadState, readEvents } from './state.mjs'


// 이 마일스톤의 마지막 step-done 뒤에 돈 verify 가 모든 검증기를 통과했는가. 장면 질문 앞(sceneProblems)과 status 의 "먼저 검증기" 안내가 본다.
// 2.9판(덜어내기 둘째): 관문 check 는 이것을 보지 않는다. 검증기가 없으면 막지 않는다(예전 마일스톤과 호환).
export function verifyStatus(st, log = false) {
  if (partOff('verify')) {
    if (log) partSkipped('verify', st, { where: 'gate' })
    return { problems: [], warnings: ['검증기(verify)가 꺼져 있어 바깥 정답 확인 없이 넘어갑니다 (policy set disable)'] }
  }
  const list = verifiers()
  if (!list.length) return { problems: [], warnings: ['검증기가 없습니다 (.rail/config.json 의 verify). 바깥 정답 확인 없이 넘어갑니다'] }
  const ev = readEvents()
  let lastDone = -1
  let run = null
  ev.forEach((e, i) => {
    if (e.milestone !== st.milestone) return
    if (e.event === 'step_done') lastDone = i
    if (e.event === 'verify_run') run = { i, e }
  })
  if (!run || run.i < lastDone) return { problems: [`${st.milestone} 의 마지막 step 뒤에 돌린 verify 기록이 없습니다 (${RAIL_CMD} verify)`], warnings: [] }
  const problems = []
  for (const v of list) {
    const r = (run.e.results ?? []).find((x) => x.name === v.name)
    if (!r) problems.push(`검증기 ${v.name} 이(가) 마지막 verify 에 없습니다. verify 를 다시 돌리세요`)
    else if (r.status === 'skip') problems.push(`검증기 ${v.name} 이(가) 건너뜀으로 끝났습니다. 실제 기록이 있는 컴퓨터에서 verify 를 다시 돌리세요`)
    else if (r.status !== 'pass') problems.push(`검증기 ${v.name} 이(가) 실패했습니다 (종료 코드 ${r.code}). 고친 뒤 verify 를 다시 돌리세요`)
  }
  return { problems, warnings: [] }
}


// 바깥 정답 검증기를 모두 돌리고 이름·결과·걸린 시간·출력 끝 몇 줄을 verify_run 으로 남긴다.
export function cmdVerify() {
  const list = verifiers()
  const st = loadState()
  if (partOff('verify')) return partSkipped('verify', st, { where: 'verify' }), out('[검증] 검증기(verify)가 꺼져 있어 돌리지 않습니다 (policy set disable). 장면 질문 앞에서 막지 않습니다.')
  if (!list.length) return out('[검증] 검증기가 없습니다 (.rail/config.json 의 verify). 장면 질문 앞에서 막지 않습니다.')
  const results = []
  for (const v of list) {
    const t0 = Date.now()
    const r = spawnSync(v.command, { shell: true, cwd: ROOT, encoding: 'utf8', env: childEnv(), timeout: (Number(v.timeoutSec) || 900) * 1000, maxBuffer: 64 * 1024 * 1024 })
    const code = r.status
    const status = code === 0 ? 'pass' : code === SKIP_CODE ? 'skip' : 'fail'
    const tail = lastLines(`${r.stdout ?? ''}\n${r.stderr ?? ''}${r.error ? `\n${r.error.message}` : ''}`, 8)
    results.push({ name: v.name, status, code, ms: Date.now() - t0, tail })
    out(`[검증] ${v.name}: ${{ pass: '통과', skip: '건너뜀', fail: '실패' }[status]} (${((Date.now() - t0) / 1000).toFixed(1)}초)\n${tail.map((l) => `    ${l}`).join('\n')}`)
  }
  const ok = results.every((r) => r.status === 'pass')
  appendLog('verify_run', st, { ok, results })
  out(ok ? `[검증] 모두 통과 (${results.length}개)` : '[검증] 통과하지 못한 검증기가 있습니다. 장면 질문 앞에서 이 기록을 봅니다.')
  if (!ok) process.exitCode = 1
}
