// Orca CLI 부르기를 한 곳에 모은다. ORCA_CLI_COMMAND 가 있으면 그것을 부른다(시험의 가짜 orca).
import { spawnSync } from 'node:child_process'
import { lastLines } from './core.mjs'

export function orca(args, timeout = 90_000) {
  const bin = process.env.ORCA_CLI_COMMAND || 'orca'
  // .mjs 가짜 orca 는 node 로 부른다(Windows 는 #! 줄을 읽지 않는다).
  const r = /\.m?js$/.test(bin) ? spawnSync(process.execPath, [bin, ...args], { encoding: 'utf8', timeout, maxBuffer: 64 * 1024 * 1024 }) : spawnSync(bin, args, { encoding: 'utf8', timeout, maxBuffer: 64 * 1024 * 1024 })
  let json = null
  try {
    json = JSON.parse(r.stdout)
  } catch {}
  const ok = r.status === 0 && !r.error && json?.ok !== false
  const why = r.error?.message ?? (json?.error ? (typeof json.error === 'string' ? json.error : json.error.message ?? JSON.stringify(json.error)) : null) ?? (lastLines(r.stderr || r.stdout, 3).join(' / ') || `종료 코드 ${r.status}`)
  return { ok, json, text: `${r.stdout ?? ''}\n${r.stderr ?? ''}`, error: ok ? null : why }
}

export const SETTLED = new Set(['succeeded', 'failed', 'cancelled', 'canceled', 'released', 'abandoned', 'stopped', 'settled'])
// worker-show 결과가 끝난 일인가.
export const isSettled = (show) => Boolean(show?.ok && (show.json?.result?.stage === 'settled' || SETTLED.has(show.json?.result?.state)))

// 레일 기록에서는 열린 작업자가 Orca 쪽에서 이미 끝났는가(2.9판 깨우기 교착 막기).
// 끝났으면 { how } 를, 아직이거나 알 수 없으면(orca 가 없거나 실패) null 을 준다. null 이면 부르는 쪽은 지금처럼 busy 로 둔다.
// 알림은 보통 곧바로 리더를 깨우므로, 띄운 지 ASK_AFTER_MIN 분이 지난 작업자만 묻는다(next 마다 orca 를 부르지 않게).
export const ASK_AFTER_MIN = 5
export function finishedInOrca(w) {
  if (typeof w?.dispatch !== 'string' || !w.dispatch || !(Date.now() - Date.parse(w.t) > ASK_AFTER_MIN * 60_000)) return null
  const show = orca(['orchestration', 'worker-show', '--dispatch', w.dispatch, '--json'], 15_000)
  if (!show.ok) return null
  const r = show.json?.result ?? {}
  if (isSettled(show)) return { how: `state ${r.state ?? '?'}, stage ${r.stage ?? '?'}` }
  if (typeof r.runId !== 'string') return null
  const box = orca(['orchestration', 'inbox', '--terminal', `run:${r.runId}`, '--json'], 15_000)
  const msgs = box.ok && Array.isArray(box.json?.result?.messages) ? box.json.result.messages : []
  return msgs.some((m) => m?.type === 'worker_done' && m.handled === false && m.payload?.dispatchId === w.dispatch) ? { how: `run 우편함에 안 읽은 worker_done` } : null
}
