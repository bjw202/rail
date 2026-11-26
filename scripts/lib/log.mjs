// 손으로 남기는 기록: log, request 명령.
import { fail, out } from './core.mjs'
import { appendLog, loadState } from './state.mjs'

export function cmdLog({ pos }) {
  const [event, json] = pos
  if (!event) fail('사용법: log <event> [json]', 2)
  let data = {}
  if (json) {
    try {
      const v = JSON.parse(json)
      data = v && typeof v === 'object' && !Array.isArray(v) ? v : { value: v }
    } catch {
      data = { note: json }
    }
  }
  const st = loadState()
  appendLog(event, st, data)
  out(`[기록] ${event}`)
  if (['worker_start', 'worker_done', 'worker_closed'].includes(event))
    out(`[경고] ${event} 는 손으로 쓰지 마세요(2.2판). worker start <step> --agent <claude|codex> --role <role> 과 worker done <step> 이 창을 띄우고 닫으며 기록까지 합니다.`)
}
export function cmdRequest({ pos }) {
  const [kind, ...rest] = pos
  if (!['change', 'bug'].includes(kind)) fail('사용법: request <change|bug> "<내용>"', 2)
  appendLog('rail_request', loadState(), { kind, text: rest.join(' ') })
  out(`[레일] "/rail ${kind}" 는 1판에 아직 없습니다. 다음 판에서 만듭니다. 요청은 기록해 두었습니다.`)
}
