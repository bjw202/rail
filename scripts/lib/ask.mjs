// 사람에게 묻고 답을 받는 명령: ask, answer.
import { railVersion } from './config.mjs'
import { fail, now, out } from './core.mjs'
import { answerScene, sceneProblems, sceneQuestion } from './scene.mjs'
import { staleList } from './stale.mjs'
import { appendLog, loadState, saveState } from './state.mjs'

export const MAX_QUESTIONS = 8
// ask: 사람에게 묻는 질문 하나를 기록한다. 한 번에 하나다.
// --replace: 열린 질문을 닫고 새 질문을 연다(판이 바뀌어 문구가 달라졌을 때 등). ask_replaced 로 남기고 사람 답으로 세지 않는다.
// --scene: 장면 질문을 이 판이 정한 문구로 만든다(리허설 숫자와 답 예시가 든다).
export function cmdAsk({ pos, flags }) {
  const st = loadState()
  const scene = flags.scene === true
  if (scene) {
    if (st.stage !== 'check') fail(`장면 질문은 "check" 단계에서만 묻습니다. 지금은 "${st.stage}" 단계입니다.`)
    const p = sceneProblems(st, true)
    if (p.length) fail(`[관문] ${st.milestone} 의 장면 질문을 아직 할 수 없습니다. 빠진 것:\n${p.map((x) => `  - ${x}`).join('\n')}`)
  }
  const q = scene ? sceneQuestion(st) : pos[0]
  if (!q) fail('사용법: ask "<질문>" [--kind interview|approve|decide] [--replace [--why "<까닭>"]] | ask --scene [--replace]', 2)
  const old = st.human_ask
  if (old && flags.replace !== true)
    fail(`앞 질문에 아직 답이 없습니다: "${old.q}"\n한 번에 질문은 하나입니다. 먼저 answer 로 답을 기록하세요. 질문을 바꿔 물으려면 ask --replace "<새 질문>" (장면 질문은 ask --scene --replace).`)
  const kind = scene ? 'scene' : flags.kind ?? (old ? old.kind : st.stage === 'brief' ? 'interview' : 'other')
  const sameSlot = old && old.kind === 'interview' && kind === 'interview' // 인터뷰 질문을 바꿔 물으면 질문 수는 그대로다
  if (kind === 'interview' && !sameSlot) {
    if (st.interview.asked >= MAX_QUESTIONS) fail(`인터뷰 질문은 ${MAX_QUESTIONS}개까지입니다. 이제 BRIEF.md 를 쓰세요.`)
    st.interview.asked += 1
  }
  const stale = scene ? staleList(st).length : 0
  st.human_ask = { q, kind, at: now(), ...(scene ? { milestone: st.milestone, rail: railVersion() } : {}), ...(stale ? { stale } : {}) }
  st.waiting_for = 'human'
  saveState(st)
  if (old) appendLog('ask_replaced', st, { old: old.q, new: q, why: typeof flags.why === 'string' ? flags.why : null, kind, old_kind: old.kind })
  else appendLog('human_ask', st, { q, kind, n: kind === 'interview' ? st.interview.asked : undefined })
  out(`[${old ? '질문 바꿈' : '질문'}${kind === 'interview' ? ` ${st.interview.asked}/${MAX_QUESTIONS}` : ''}] ${q}`)
}

export function cmdAnswer({ pos }) {
  const text = pos.join(' ').trim()
  const st = loadState()
  if (!st.human_ask) fail('기다리는 질문이 없습니다.')
  if (!text) fail('사용법: answer "<사람의 답>"', 2)
  const ask = st.human_ask
  const waitSec = Math.round((Date.now() - Date.parse(ask.at)) / 1000)
  if (ask.kind === 'scene') return answerScene(st, ask, text, waitSec)
  appendLog('human_answer', st, { q: ask.q, kind: ask.kind, text, wait_sec: waitSec })
  st.human_ask = null
  st.waiting_for = 'none'
  saveState(st)
  out(`[답 기록] 기다린 시간 ${waitSec}초`)
}
