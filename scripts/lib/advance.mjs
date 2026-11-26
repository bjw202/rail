// check·advance 명령과 마일스톤 닫힘 알림.
import { atLeast, loadConfig } from './config.mjs'
import { F, fail, now, out, read } from './core.mjs'
import { orca } from './orca.mjs'
import { approvalDate, markRoadmapClosed, nextOpenMilestone, parseRoadmap } from './docs.mjs'
import { gate } from './gates.mjs'
import { staleList, withCommit } from './stale.mjs'
import { disabledParts } from './parts.mjs'
import { contextPercent } from './session.mjs'
import { appendLog, loadState, readEvents, saveState } from './state.mjs'
import { afterClose, candidateLine, usage } from './usage.mjs'
import { cleanMerged } from './worktree.mjs'


export function cmdCheck({ pos, flags }, advance) {
  const target = pos[0]
  if (!target) fail('사용법: check|advance <roadmap|decide|milestone|check|close> [--milestone Mx]', 2)
  const st = loadState()
  const g = gate(target, st, { milestone: flags.milestone })
  if (!g.ok) {
    appendLog('gate_blocked', st, { target, via: advance ? 'advance' : 'check', problems: g.problems, back: g.back })
    process.stderr.write(`[관문] "${target}" 로 갈 수 없습니다. 빠진 것:\n${g.problems.map((p) => `  - ${p}`).join('\n')}\n돌아갈 단계: ${g.back}\n`)
    process.exit(1)
  }
  // 관문이 통과시킨 것도 남긴다(2.2판: 관문이 몇 번 일했는지 센다).
  appendLog('gate_passed', st, { target, via: advance ? 'advance' : 'check' })
  for (const w of g.warnings) out(`[경고] ${w}`)
  if (g.warnings.length && advance) appendLog('gate_warning', st, { target, warnings: g.warnings })
  if (!advance) return out(`[관문] "${target}" 로 가도 됩니다.`)
  const from = st.stage
  const rm = parseRoadmap()
  let closedId = null
  let offAtClose = []
  if (target === 'roadmap') {
    st.gates.brief_approved = approvalDate(read(F.brief) ?? '')
    st.stage = 'roadmap'
  } else if (target === 'decide') {
    st.gates.roadmap_approved = approvalDate(rm.text)
    st.stage = 'decide'
    st.milestone = flags.milestone
    st.step = null
  } else if (target === 'milestone') {
    st.gates.risks_decided[st.milestone] = rm.ms.find((m) => m.id === st.milestone).risks
    st.stage = 'milestone'
  } else if (target === 'check') {
    st.stage = 'check'
    st.step = null
  } else if (target === 'close') {
    closedId = st.milestone
    offAtClose = disabledParts()
    for (const { w, r } of cleanMerged(st)) out(`[worktree] 합쳐진 rail-${w.step} ${r.ok ? '지움' : `남김 — ${r.why}`}`)
    // 2.9판: 장면 판정 없이 닫는 길(관문 close 의 경고)은 판정 대기 목록에 남긴다.
    const rh = st.gates.rehearsed?.[closedId]
    // 판정으로 고친 시험 목록(커밋 포함)을 붙여 둔다. 닫으면 지금 마일스톤이 바뀌어 사건 기록에서 다시 모으지 못한다.
    const sl = staleList(st).map(withCommit)
    if (!st.gates.scene_checked[closedId]) st.gates.scene_pending = { ...(st.gates.scene_pending ?? {}), [closedId]: { at: now(), ...(rh ? { rehearsal: { pass: rh.pass, total: rh.total } } : {}), ...(sl.length ? { stale: sl } : {}) } }
    st.closed.push(st.milestone)
    const marked = markRoadmapClosed(st.milestone)
    appendLog('milestone_closed', st, { scene: st.gates.scene_checked[st.milestone], roadmap_marked: marked })
    const next = nextOpenMilestone(st, rm)
    st.stage = next ? 'decide' : 'done'
    st.milestone = next
    st.step = null
  }
  st.waiting_for = 'none'
  saveState(st)
  appendLog('stage_advance', st, { from, to: st.stage })
  out(`[관문] 통과. 단계: ${from} → ${st.stage}${st.milestone ? ` (${st.milestone})` : ''}`)
  if (closedId) notifyClosed(st, closedId, offAtClose)
  if (closedId && atLeast(2.3)) afterClose(st, closedId, offAtClose)
}

// 마일스톤 닫힘 알림: config 의 notify 가 { bot } 이면 Orca 로 한 줄 요약을 보낸다. 실패해도 닫기는 그대로 성공이다.
export function closeSummary(id, st, off = []) {
  const ev = readEvents().filter((e) => e.milestone === id)
  const start = ev.length ? Date.parse(ev[0].t) : Date.now()
  const min = Math.max(0, Math.round((Date.now() - start) / 60000))
  const time = min >= 60 ? `${Math.floor(min / 60)}시간 ${min % 60}분` : `${min}분`
  const count = (name) => ev.filter((e) => e.event === name).length
  const head = `작업 ${time} · 사람 답 ${count('human_answer')}번 · 레일 수정 ${count('rail_edit')}번`
  if (!atLeast(2.3)) return head
  // 2.3판: 리더의 컨텍스트 사용률과 압축 횟수, 빼기 후보, 이 마일스톤 동안 꺼 둔 부품.
  const cw = contextPercent(st.leader_session)
  const lines = [`${head} · ${cw === null ? 'CW 모름' : `CW ${cw}%`} · 압축 ${count('compact_started')}번`, candidateLine(usage(st).candidates)]
  if (off.length) lines.push(`꺼 둔 부품: ${off.join(', ')} — 리뷰·리허설·장면에서 이 부품이 막았어야 할 결함이 나왔는지 봐 주세요`)
  return lines.join('\n')
}
export function notifyClosed(st, id, off = []) {
  const bot = loadConfig().notify?.bot
  if (typeof bot !== 'string' || !bot.trim()) return
  const subject = `${st.project} ${id} 닫힘`
  const body = closeSummary(id, st, off)
  const r = orca(['orchestration', 'send', '--to', `bot:${bot}`, '--type', 'status', '--subject', subject, '--body', body], 20_000)
  const data = { milestone_closed: id, to: `bot:${bot}`, subject, body }
  if (r.ok) return appendLog('notify_sent', st, data), out(`[알림] bot:${bot} 에 "${subject}" 를 보냈습니다. ${body}`)
  const error = r.error
  appendLog('notify_failed', st, { ...data, error })
  out(`[알림 실패] bot:${bot} 에 보내지 못했습니다(${error}). 닫기는 끝났습니다.`)
}
