// 장면 질문과 답, 장면 확인, 장면 리허설, 되돌림.
import fs from 'node:fs'
import path from 'node:path'
import { autonomyOn, railVersion } from './config.mjs'
import { F, fail, now, out, read, unquote } from './core.mjs'
import { partOff, partSkipped } from './parts.mjs'
import { staleList, staleText } from './stale.mjs'
import { appendLog, loadState, readEvents, saveState } from './state.mjs'
import { verifyStatus } from './verify.mjs'

// ---------- 장면 질문과 답 (2.1판) ----------
// 리허설이 본 실제 숫자 한 줄: 0번(오늘 빌드인가)이 아닌 첫 통과 항목, 없으면 본 것이 있는 첫 항목.
export function sceneExample(st) {
  let list = []
  try {
    list = JSON.parse(read(path.join(F.rehearsal, st.milestone, 'result.json')) ?? '{}').items ?? []
  } catch {}
  const has = (it) => typeof it?.saw === 'string' && it.saw.trim()
  const pick = list.find((it) => String(it?.id) !== '0' && it?.result === 'pass' && has(it)) ?? list.find(has) ?? st.gates.rehearsed?.[st.milestone]?.failed?.[0]
  return pick?.saw?.trim() || '<화면에서 본 숫자나 글자>'
}
export function sceneQuestion(st) {
  const rh = st.gates.rehearsed?.[st.milestone]
  const head = rh ? `리허설 결과(스크린샷 ${rh.total}장, 통과 ${rh.pass}/${rh.total})를 보시고` : '장면 점검표대로 직접 해 보시고'
  const sl = staleList(st)
  const tail = sl.length ? `\n이번 마일스톤에서 에이전트 판정으로 고친 시험 ${sl.length}건입니다. "됨"이면 이 목록도 승인한 것으로 남깁니다. 목록에 문제가 있으면 "안 됨"과 그 줄을 알려 주세요:\n${staleText(sl)}` : ''
  return `${head} 됨/안 됨과 본 것 한 줄을 함께 알려 주세요. 답 예: "됨. 본 것: ${sceneExample(st)}"${tail}`
}
// 사람 답에서 판정(pass/fail)과 본 것을 가른다. "본 것:" 뒤가 있으면 그것, 없으면 판정 낱말 뒤의 말.
export function parseSceneAnswer(text) {
  const t = unquote(text)
  const FAIL = /^(?:안\s*(?:됨|됐|돼|되)\S*|실패\S*|틀렸\S*|fail(?![a-z])|no(?![a-z]))/i
  const PASS = /^(?:됨|됐\S*|돼\S*|되었\S*|통과\S*|확인\S*|좋\S*|맞\S*|pass(?![a-z])|ok(?![a-z])|yes(?![a-z])|네(?=$|[\s.,!])|예(?=$|[\s.,!]))/i
  const f = t.match(FAIL)
  const p = f ? null : t.match(PASS)
  const verdict = f ? 'fail' : p ? 'pass' : null
  const rest = verdict ? t.slice((f ?? p)[0].length) : t
  const m = t.match(/본\s*것\s*[:：]\s*([\s\S]*)$/)
  const seen = (m ? m[1] : rest).replace(/^[\s.,!~。·:：\-–—]+/, '').replace(/\s+/g, ' ').trim()
  return { verdict, seen }
}
export function answerScene(st, ask, text, waitSec) {
  const a = parseSceneAnswer(text)
  // 앞 답에서 받은 것과 합친다(되물은 질문의 답).
  const verdict = a.verdict ?? ask.verdict ?? null
  const seen = a.seen || ask.seen || ''
  appendLog('human_answer', st, { q: ask.q, kind: 'scene', text, wait_sec: waitSec, verdict, seen: seen || null })
  if (!verdict || !seen) {
    const ex = sceneExample(st)
    const q = !verdict
      ? `됨인지 안 됨인지를 본 것과 함께 알려 주세요. 답 예: "됨. 본 것: ${seen || ex}"`
      : `${verdict === 'pass' ? '됨' : '안 됨'}으로 받았습니다. 화면에서 본 것 한 줄을 알려 주세요. 답 예: "본 것: ${ex}"`
    st.human_ask = { q, kind: 'scene', at: now(), milestone: st.milestone, rail: railVersion(), follow_up: true, ...(verdict ? { verdict } : {}), ...(seen ? { seen } : {}), ...(ask.stale ? { stale: ask.stale } : {}) }
    saveState(st)
    appendLog('human_ask', st, { q, kind: 'scene', follow_up: true })
    out(`[다시 묻기] 답에 ${!verdict ? '판정(됨/안 됨)' : '본 것'}이 없습니다. 사람에게 한 번만 더 물으세요:\n${q}`)
    return
  }
  st.human_ask = null
  st.waiting_for = 'none'
  saveState(st)
  out(`[답 기록] 기다린 시간 ${waitSec}초 · 판정 ${verdict === 'pass' ? '됨' : '안 됨'} · 본 것: ${seen}`)
  recordScene(st, st.milestone, verdict, seen, ask.stale)
}

export function cmdScene({ pos, flags }) {
  const id = pos[0]
  const st = loadState()
  if (!['pass', 'fail'].includes(flags.result)) fail('사용법: scene <Mx> --result pass|fail --note "느낀 점 한 줄"', 2)
  if (!flags.note?.trim()) fail('사람의 느낀 점 한 줄(--note)이 필요합니다.')
  recordScene(st, id, flags.result, flags.note.trim())
}
// stale: 장면 질문이 보인 판정 시험 목록의 건수. "됨"이면 그 목록도 승인한 것으로 남긴다(닫기 관문이 본다).
export function recordScene(st, id, result, note, stale = 0) {
  // 2.9판: 판정 대기 목록(닫힌 뒤 기다리는 것)이나 안 됨으로 판정된 닫힌 마일스톤은 지금 단계와 상관없이 받는다. 리허설·검증은 닫을 때 봤다.
  const late = st.gates.scene_pending?.[id] ?? (st.closed.includes(id) && st.gates.scene_checked?.[id]?.result === 'fail' ? st.gates.scene_checked[id] : null)
  if (late) {
    // 대기 기록에 붙은 판정 시험 목록은 판정이 바뀌어도(안 됨 → 고친 뒤 됨) 따라간다. "됨"이면 목록도 승인으로 남긴다.
    const sl = late.stale ?? late.stale_lines ?? []
    st.gates.scene_checked[id] = { result, note, at: now(), ...(late.rehearsal ? { rehearsal: late.rehearsal } : {}), late: true, ...(sl.length ? { stale_lines: sl } : {}) }
    delete st.gates.scene_pending?.[id]
    saveState(st)
    appendLog('scene_check', st, { milestone_judged: id, ...st.gates.scene_checked[id] })
    if (sl.length && result === 'pass') appendLog('stale_approved', st, { milestone_judged: id, n: sl.length, lines: sl.map(({ file, line, step }) => ({ file, line, step })) })
    return out(`[장면 확인] ${id} ${result} (판정 대기에서)${result === 'fail' ? '. 자율 모드는 멈춥니다. 사람과 고칠 것을 정해 지금 표에 고칠 줄을 더하세요.' : ''}`)
  }
  if (st.stage !== 'check' || id !== st.milestone) fail(`장면 확인은 "check" 단계의 현재 마일스톤(${st.milestone})에서만 기록합니다.`)
  const problems = sceneProblems(st, true)
  if (problems.length) {
    appendLog('gate_blocked', st, { target: 'scene', problems, back: st.stage })
    fail(`[관문] ${id} 의 장면 확인을 기록할 수 없습니다. 빠진 것:\n${problems.map((p) => `  - ${p}`).join('\n')}`)
  }
  appendLog('gate_passed', st, { target: 'scene' })
  const rh = st.gates.rehearsed?.[id]
  st.gates.scene_checked[id] = { result, note, at: now(), ...(rh ? { rehearsal: { pass: rh.pass, total: rh.total } } : {}), ...(stale ? { stale } : {}) }
  saveState(st)
  appendLog('scene_check', st, st.gates.scene_checked[id])
  if (stale && result === 'pass') appendLog('stale_approved', st, { n: stale, lines: staleList(st).map(({ file, line, step }) => ({ file, line, step })) })
  out(`[장면 확인] ${id} ${result}`)
  if (result === 'fail') out('안 됨으로 기록했습니다. reopen 으로 step 진행 단계로 되돌리고 고칠 step 을 표에 더하세요.')
}

// 사람 장면 확인 앞의 관문: 바깥 정답 검증기(있으면)와 장면 리허설 기록.
export function sceneProblems(st, log = false) {
  const p = [...verifyStatus(st, log).problems]
  const need = !st.gates.rehearsed?.[st.milestone]
  if (need && partOff('rehearsal')) {
    if (log) partSkipped('rehearsal', st, { where: 'scene' })
  } else if (need)
    p.push(`${st.milestone} 의 장면 리허설 기록이 없습니다 (리허설 작업자가 .rail/rehearsal/${st.milestone}/result.json 을 쓰고 rehearsal-record ${st.milestone})`)
  return p
}

// 장면 리허설 기록: .rail/rehearsal/Mx/result.json 의 항목마다 통과/실패, 본 것 한 줄, 스크린샷 파일이 있어야 한다.
export function cmdRehearsalRecord({ pos }) {
  const id = pos[0]
  const st = loadState()
  if (!id) fail('사용법: rehearsal-record <Mx>', 2)
  if (st.stage !== 'check' || id !== st.milestone) fail(`리허설은 "check" 단계의 현재 마일스톤(${st.milestone})에서만 기록합니다.`)
  const dir = path.join(F.rehearsal, id)
  const rel = `.rail/rehearsal/${id}/result.json`
  let doc = null
  try {
    doc = JSON.parse(read(path.join(dir, 'result.json')) ?? 'null')
  } catch {}
  const problems = []
  const list = Array.isArray(doc?.items) ? doc.items : []
  if (!list.length) problems.push(`${rel} 에 items 가 없습니다 ({"items":[{"id","check","result":"pass|fail","saw","shot"}]})`)
  list.forEach((it, i) => {
    const name = `항목 ${it?.id ?? i + 1}`
    if (!['pass', 'fail'].includes(it?.result)) problems.push(`${name}: result 는 pass 또는 fail 입니다`)
    if (typeof it?.saw !== 'string' || !it.saw.trim()) problems.push(`${name}: 본 것 한 줄(saw)이 없습니다`)
    const shot = typeof it?.shot === 'string' && it.shot.trim() ? path.resolve(dir, it.shot) : null
    if (!shot || !shot.startsWith(dir + path.sep) || !fs.existsSync(shot)) problems.push(`${name}: 스크린샷(shot) 파일이 .rail/rehearsal/${id}/ 안에 없습니다`)
  })
  if (problems.length) {
    appendLog('gate_blocked', st, { target: 'rehearsal-record', problems, back: st.stage })
    fail(`[리허설] ${id} 를 기록할 수 없습니다. 빠진 것:\n${problems.map((p) => `  - ${p}`).join('\n')}`)
  }
  appendLog('gate_passed', st, { target: 'rehearsal-record' })
  const failed = list.filter((it) => it.result === 'fail').map((it) => ({ id: String(it.id), check: it.check ?? '', saw: it.saw, ...(it.judge === 'taste' ? { judge: 'taste' } : {}) }))
  const rec = { total: list.length, pass: list.length - failed.length, failed, at: now() }
  st.gates.rehearsed = { ...(st.gates.rehearsed ?? {}), [id]: rec }
  saveState(st)
  appendLog('rehearsal_recorded', st, { file: rel, total: rec.total, pass: rec.pass, failed })
  out(`[리허설] ${id} 통과 ${rec.pass}/${rec.total}, 스크린샷 ${rec.total}장`)
  for (const f of failed) out(`  실패 ${f.id}: ${f.check} — 본 것: ${f.saw}`)
  if (failed.length) out(selfFix(st).ok ? `사람에게 묻기 전에 스스로 고칩니다 (reopen --self-fix, ${selfFix(st).n + 1}/${SELF_FIX_MAX}).` : '사람에게는 실패 항목을 먼저 보여 줍니다.')
}

// 2.9판 스스로 고치기: 자율 모드에서 리허설 실패가 모두 기계로 가릴 수 있는 항목(judge 가 taste 가 아님)이면 마일스톤마다 2번까지 사람에게 묻기 전에 고친다.
export const SELF_FIX_MAX = 2
export function selfFix(st) {
  const failed = st.gates.rehearsed?.[st.milestone]?.failed ?? []
  const n = readEvents().filter((e) => e.event === 'milestone_reopened' && e.milestone === st.milestone && e.self_fix).length
  return { n, ok: autonomyOn() && failed.length > 0 && failed.every((f) => f.judge !== 'taste') && n < SELF_FIX_MAX }
}

export function cmdReopen({ flags }) {
  const st = loadState()
  if (st.stage !== 'check') fail('reopen 은 장면 확인(check) 단계에서만 씁니다.')
  const sf = flags['self-fix'] ? selfFix(st) : null
  if (sf && !sf.ok) fail(`[스스로 고치기] 할 수 없습니다: 리허설 실패가 없거나, 취향·판단 항목(judge taste)이 있거나, 이미 ${SELF_FIX_MAX}번 했습니다. 사람에게 장면 질문을 하세요 (ask --scene).`)
  const failed = sf ? st.gates.rehearsed[st.milestone].failed : null
  delete st.gates.scene_checked[st.milestone]
  if (st.gates.rehearsed) delete st.gates.rehearsed[st.milestone]
  st.stage = 'milestone'
  saveState(st)
  appendLog('milestone_reopened', st, sf ? { self_fix: sf.n + 1, failed } : {})
  out(`[되돌림] ${st.milestone} 를 step 진행 단계로 되돌렸습니다${sf ? ` (스스로 고치기 ${sf.n + 1}/${SELF_FIX_MAX})` : ''}. 고칠 step 을 표에 더하세요.`)
}
