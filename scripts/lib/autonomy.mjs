// 자율 모드: next 명령과 멈춤 규칙.
import fs from 'node:fs'
import path from 'node:path'
import { budgetStatus } from './budget.mjs'
import { autonomy, autonomyOn, commitPolicy, loadConfig } from './config.mjs'
import { clock, gitIn, isGitTop, out, usd } from './core.mjs'
import { nextOpenMilestone, readSheet } from './docs.mjs'
import { partOff, partSkipped } from './parts.mjs'
import { appendLog, loadState, readEvents, whoAmI } from './state.mjs'
import { describe } from './status.mjs'
import { finishedInOrca, orca } from './orca.mjs'
import { brokenScenes } from './queue.mjs'
import { openWorkers } from './workers.mjs'

// 마무리 검사 훅의 기억(.git 안의 rail-stop-check.json): 같은 실패 지문과 이어진 횟수, 시험 통과 수가 늘어난 시각.
export function stopCheckCache() {
  if (!isGitTop()) return null
  const dir = gitIn(['rev-parse', '--absolute-git-dir']).out.trim()
  if (!dir) return null
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, 'rail-stop-check.json'), 'utf8'))
  } catch {
    return null
  }
}

// 지금 할 일과 멈춤 까닭. 값싼 판정부터 보고, 예산(비용 읽기)은 맨 끝에 본다.
// precheck 는 바깥(Orca 자동화)이 보는 것이라 자기 세션의 작업 중 표시도 남의 것으로 본다.
export const STOP_EXIT = { done: 10, human: 11, budget: 12, same_failure: 13, busy: 14, error: 15, off: 16 }
export function decideNext({ precheck = false, withBudget = false } = {}) {
  let st
  try {
    st = loadState()
  } catch (e) {
    return { action: null, stop: { code: 'error', reason: `상태 파일(.rail/state.json)을 읽지 못했습니다: ${e.message}` } }
  }
  const a = autonomy()
  const ev = readEvents()
  const action = describe(st).next
  const res = { action, stop: null, autonomy: { mode: a.mode, effective: autonomyOn() } }
  const stop = (code, reason) => ((res.stop = res.stop ?? { code, reason }), res)
  // 멈춤 규칙 넷(human, busy, same_failure, budget)은 부품(stop:<까닭>)이다. 꺼 두면 멈추지 않고 part_disabled 를 남긴다.
  const rule = (code, reason) => (partOff(`stop:${code}`) ? partSkipped(`stop:${code}`, st, { reason }) : stop(code, reason))
  const cache = stopCheckCache()
  if (st.stage === 'done' && !nextOpenMilestone(st, readSheet())) stop('done', '모든 마일스톤이 닫혔습니다 (기획서 마일스톤 지도에 새 마일스톤이 없습니다)')
  if (st.human_ask) rule('human', `사람의 답을 기다립니다 — "${st.human_ask.q}"`)
  if (brokenScenes(st).length) rule('human', `판정 대기였던 ${brokenScenes(st).join(', ')} 의 장면을 사람이 안 됨으로 판정했습니다. 앞 마일스톤 장면이 깨지면 뒤로 가지 않습니다`)
  // 레일 기록에서 열린 작업자도 Orca 쪽에서 이미 끝났을 수 있다(worker_done 알림이 리더를 못 깨운 일, M11-7).
  // 끝난 작업자가 있으면 busy 대신 그 알림을 읽고 이어 가는 것이 할 일이다. orca 가 없거나 실패하면 지금처럼 busy.
  const workers = openWorkers(st, ev)
  const finished = workers.map((w) => ({ w, f: finishedInOrca(w) })).filter((x) => x.f)
  const running = workers.filter((w) => !finished.some((x) => x.w === w))
  if (finished.length)
    res.action = `작업자 끝남 알림 읽고 이어 가기 — ${finished.map(({ w, f }) => `${w.step}(${f.how})`).join(', ')}. Orca 우편함의 worker_done 을 읽고 worker done ${finished.map(({ w }) => w.step).join(' ')} 부터 이어 간다${running.length ? ` · 아직 도는 작업자: ${running.map((w) => w.step).join(', ')}` : ''}`
  else if (running.length) rule('busy', `작업자 진행 중 — ${running.map((w) => `${w.step}(${w.agent ?? '?'}, ${w.role ?? '?'})`).join(', ')}. 작업자가 끝나면 Orca 가 리더를 깨웁니다`)
  const b = st.busy
  const me = whoAmI()
  const mine = !precheck && me !== 'unknown' && b?.who === me
  const age = b ? (Date.now() - Date.parse(b.at)) / 60000 : Infinity
  if (b && !mine && age < a.busyMinutes) rule('busy', `다른 세션이 레일 일을 하고 있습니다 — ${b.who} 가 ${Math.max(0, Math.round(age))}분 전 "${b.cmd}" (${a.busyMinutes}분 안)`)
  const n = Number(cache?.failCount) || 0
  if (cache?.failSig && n >= a.maxSameFailure) rule('same_failure', `마무리 검사가 같은 실패로 ${n}번 이어 붙잡았습니다 (지문 ${String(cache.failSig).slice(0, 8)}, 상한 ${a.maxSameFailure}번). 사람이 봐야 합니다`)
  if (a.mode !== 'on') stop('off', '자율 모드가 꺼져 있습니다 (사람이 리더 세션에서 직접 켭니다)')
  else if (commitPolicy() !== 'auto-local') stop('off', `자율 모드가 켜져 있지만 커밋 정책이 "${commitPolicy()}" 라 쓰지 않습니다`)
  if (!res.stop || withBudget) {
    const bs = budgetStatus(st, ev, a, cache)
    res.budget = bs
    if (bs.error) stop('error', `${bs.error}. 안전한 쪽으로 멈춥니다`)
    else if (bs.over) rule('budget', bs.over)
  }
  return res
}
// 멈춤 까닭(code)이 바뀔 때만 autonomy_stop 을 남긴다. 풀리면 code null 로 남긴다. precheck 를 30분마다 불러도 쌓이지 않는다.
export function logStopChange(res) {
  const ev = readEvents()
  const last = [...ev].reverse().find((e) => e.event === 'autonomy_stop')
  const code = res.stop?.code ?? null
  if ((last?.code ?? null) === code) return
  let st = null
  try {
    st = loadState()
  } catch {}
  appendLog('autonomy_stop', st, { code, reason: res.stop?.reason ?? `멈춤 풀림 — ${res.action}` })
}
// 폭주 알림(주인 결정 2026-11-26): busy 여도 작업자 나이와 마지막 진척 뒤 쓴 돈을 재고, 넘으면 notify.bot 에 알리기만 한다.
// 같은 작업자(dispatch, 없으면 step)의 시간 알림과 같은 진척 구간의 돈 알림은 한 번씩. 멈춤 까닭과 종료 코드는 그대로다.
export function runawayAlerts() {
  const bot = loadConfig().notify?.bot
  if (typeof bot !== 'string' || !bot.trim()) return
  const [st, ev, a] = [loadState(), readEvents(), autonomy()]
  const bs = budgetStatus(st, ev, { ...a, budget: { ...a.budget, milestone: { on: false }, daily: { on: false } } }, stopCheckCache())
  const sp = bs.since_progress
  const ws = openWorkers(st, ev).map((w) => ({ w, min: Math.round((Date.now() - Date.parse(w.t)) / 60000) }))
  const alerts = ws.filter((x) => x.min > a.alertWorkerMinutes).map(({ w, min }) => ({ kind: 'time', key: w.dispatch ?? w.step, subject: `${st.project} 작업자 오래 돎: ${w.step} ${min}분` }))
  if (sp && sp.spent > sp.limit) alerts.push({ kind: 'money', key: sp.from, subject: `${st.project} 진척 없이 ${usd(sp.spent)}` })
  const lines = ws.map(({ w, min }) => `${w.step} · 역할 ${w.role ?? '?'} · ${w.agent ?? '?'} · 창 ${w.terminal ?? '?'} · 시작 ${clock(w.t)} (${min}분)`)
  const body = [...lines, sp ? `마지막 진척 ${clock(sp.from)} 뒤 쓴 돈 ${usd(sp.spent)} (상한 ${usd(sp.limit)})` : `쓴 돈 모름 — ${bs.error ?? bs.note}`].join('\n')
  for (const x of alerts.filter((x) => !ev.some((e) => e.event === 'runaway_alert' && e.kind === x.kind && e.key === x.key))) {
    const r = orca(['orchestration', 'send', '--to', `bot:${bot}`, '--type', 'status', '--subject', x.subject, '--body', body], 20_000)
    appendLog(r.ok ? 'runaway_alert' : 'runaway_alert_failed', st, { ...x, to: `bot:${bot}`, body, ...(r.ok ? {} : { error: r.error }) })
  }
}
export function cmdNext({ flags }) {
  let res
  try {
    res = decideNext({ precheck: flags.precheck === true, withBudget: flags.budget === true })
    logStopChange(res)
  } catch (e) {
    res = { action: null, stop: { code: 'error', reason: `판정 중 오류: ${e?.message ?? e}` } }
  }
  if (flags.precheck && res.stop?.code === 'busy') try { runawayAlerts() } catch {}
  const line = res.stop ? `멈춤(${res.stop.code}): ${res.stop.reason}` : `할 일: ${res.action}`
  if (flags.precheck) {
    out(line)
    process.exitCode = res.stop ? STOP_EXIT[res.stop.code] ?? STOP_EXIT.error : 0
    return
  }
  if (flags.json) return out(JSON.stringify(res, null, 2))
  out(line)
  const b = res.budget
  if (b?.since_progress) out(`  마지막 진척 뒤: ${usd(b.since_progress.spent)} / 상한 ${usd(b.since_progress.limit)} (${clock(b.since_progress.from)} 부터)`)
  if (b?.milestone?.limit != null)
    out(`  마일스톤 상한: ${usd(b.milestone.limit)} (지난 ${b.milestone.past.length}개 중간값 ${usd(b.milestone.median)} × ${b.milestone.times})${b.milestone.milestone ? ` · ${b.milestone.milestone} 에 쓴 돈 ${usd(b.milestone.spent)}` : ''}`)
  if (b?.milestone?.note) out(`  마일스톤: ${b.milestone.note}`)
  if (b?.daily) out(`  오늘: ${usd(b.daily.spent)} / 상한 ${usd(b.daily.limit)}`)
  if (b?.error || b?.note) out(`  ${b.error ?? b.note}`)
}
