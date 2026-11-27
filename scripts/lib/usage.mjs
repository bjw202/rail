// 부품 쓰임 세기, 빼기 후보, 레일 크기.
import fs from 'node:fs'
import path from 'node:path'
import { autonomy, railVersion, versionLabel } from './config.mjs'
import { F, ROOT, out, walk } from './core.mjs'
import { PARTS, PART_IDS, disabledParts, insurance, writeDisabled } from './parts.mjs'
import { appendLog, loadState, lock, readEvents, unlock } from './state.mjs'

// 사건을 마일스톤으로 나눈다: 사건에 적힌 마일스톤, 없으면(시작 전, 닫힌 뒤 다음 결정 전) 그 뒤에 처음 닫힌 마일스톤, 그것도 없으면 지금 마일스톤.
// auto: 그 마일스톤 동안 자율 모드가 켜져 있었는가. autonomy.mode 의 policy_change 를 차례로 따라간다(처음 값은 첫 바꿈의 from, 바꾼 적이 없으면 지금 config). auto_start 가 있어도 켜짐.
export function buckets(st, ev) {
  const map = new Map()
  const closeAt = ev.map((e, i) => (e.event === 'milestone_closed' ? i : -1)).filter((i) => i >= 0)
  const isMode = (e) => e.event === 'policy_change' && e.key === 'autonomy.mode'
  let mode = ev.find(isMode)?.from ?? autonomy().mode
  let c = 0
  ev.forEach((e, i) => {
    while (c < closeAt.length && closeAt[c] < i) c++
    const id = e.milestone ?? (c < closeAt.length ? ev[closeAt[c]].milestone : st.milestone ?? '다음')
    if (!map.has(id)) map.set(id, { id, events: [], closed: false, auto: false })
    const b = map.get(id)
    b.events.push(e)
    if (isMode(e)) mode = e.to
    if (mode === 'on' || e.event === 'auto_start') b.auto = true
    if (e.event === 'milestone_closed') b.closed = true
  })
  // 마지막으로 닫은 뒤의 사건(다음 마일스톤 전)은 세지 않는다.
  return [...map.values()].filter((b) => b.id !== '다음')
}
export function usage(st = loadState(), ev = readEvents()) {
  const bs = buckets(st, ev)
  const ins = insurance()
  const off = disabledParts()
  const parts = PARTS.map((p) => ({
    id: p.id,
    name: p.name,
    insurance: ins.includes(p.id),
    disabled: off.includes(p.id),
    counts_ran: Boolean(p.ran),
    by: Object.fromEntries(
      bs.map((b) => [b.id, { ran: p.ran ? b.events.filter(p.ran).length : null, blocked: b.events.filter(p.blocked).length, ...(p.found ? { found: p.found(b.id) } : {}), off: b.events.filter((e) => e.event === 'part_disabled' && e.part === p.id).length, ...(p.auto && !b.auto ? { unmeasured: true } : {}) }])
    )
  }))
  // 빼기 후보: 최근 닫힌 마일스톤 3개 모두에서 일하지 않은 부품. 막는 부품은 한 번도 막지 않고 찾은 것(found)도 없을 때, 증거를 만드는 부품(evidence)은 한 번도 돌지 않았을 때.
  // 보험, 순서 검사(fixed), 자율 모드가 꺼져 있어 잴 수 없던 멈춤 규칙, 그동안 꺼 보았던 부품(0 이 증거가 아님)은 뺀다.
  const win = bs.filter((b) => b.closed).slice(-3)
  const touched = (id) => win.some((b) => b.events.some((e) => e.part === id && ['part_disabled', 'policy_change', 'part_enabled'].includes(e.event)))
  const idle = (p, x) => !x.unmeasured && (p.evidence ? x.ran === 0 : x.blocked === 0 && !x.found)
  const list = win.length < 3 ? [] : PARTS.filter((p, i) => !parts[i].insurance && !p.fixed && !touched(p.id) && win.every((b) => idle(p, parts[i].by[b.id]))).map((p) => p.id)
  const why = win.length < 3 ? `닫힌 마일스톤이 ${win.length}개라 아직 뽑지 않습니다. 3개부터 뽑습니다` : `최근 닫힌 ${win.map((b) => b.id).join('·')} 에서 막는 부품은 한 번도 안 막았고(기능 확인은 must 도 못 찾았고), 검증기·리허설은 한 번도 안 돈 것. 보험·순서 검사·잴 수 없는 멈춤 규칙은 보지 않음`
  return { milestones: bs.map((b) => ({ id: b.id, closed: b.closed, autonomy: b.auto })), parts, candidates: { list, window: win.map((b) => b.id), why }, disabled: off, insurance: ins }
}
export const candidateLine = (c) => `빼기 후보: ${c.list.length ? c.list.join(', ') : '없음'} (${c.why})`
export function cmdUsage({ flags }) {
  const u = usage()
  if (flags.json) return out(JSON.stringify(u, null, 2))
  const lines = [`[쓰임] 부품마다 작동/막음, 마일스톤별 (사건 기록에서 셈, ${versionLabel()})`]
  const head = ['부품'.padEnd(18), ...u.milestones.map((m) => `${m.id}${m.closed ? '' : '(진행)'}`.padEnd(10))].join(' ')
  lines.push(`${head} 이름`)
  for (const p of u.parts) {
    const cells = u.milestones.map((m) => {
      const x = p.by[m.id]
      return (x.unmeasured ? '잴 수 없음' : `${x.ran ?? '?'}/${x.blocked}${x.found ? ` 찾음${x.found}` : ''}${x.off ? ` 꺼짐${x.off}` : ''}`).padEnd(10)
    })
    lines.push(`${p.id.padEnd(18)} ${cells.join(' ')} ${p.name}${p.insurance ? ' [보험]' : ''}${p.disabled ? ' [지금 꺼짐]' : ''}`)
  }
  lines.push('칸은 "돈 횟수/막은 횟수"입니다. "?" 는 막을 때만 기록하는 부품이라 돈 횟수를 모른다는 뜻, "찾음n" 은 확인 기록 n개에 must 가 있었다는 뜻(막지 않고 일함), "꺼짐n" 은 꺼 두어 n번 건너뛰었다는 뜻입니다.')
  lines.push('"잴 수 없음" 은 그 마일스톤에 자율 모드가 꺼져 있어 멈춤 규칙이 일할 기회가 없었다는 뜻이라 빼기 후보로 보지 않습니다. 검증기와 리허설은 막기보다 증거를 만드는 부품이라, 돌았으면 후보가 아닙니다.')
  lines.push(candidateLine(u.candidates))
  if (u.disabled.length) lines.push(`꺼 둔 부품: ${u.disabled.join(', ')}`)
  out(lines.join('\n'))
}
// 마일스톤을 닫은 뒤: 빼기 후보를 알리고, 꺼 둔 부품을 다시 켠다.
export function afterClose(st, id, off) {
  out(`[덜어내기] ${candidateLine(usage(st).candidates)}`)
  if (!off.length) return
  writeDisabled([])
  for (const p of off) appendLog('part_enabled', st, { part: p, why: `${id} 닫힘` })
  out(`[덜어내기] 꺼 둔 부품 ${off.join(', ')} 을(를) 다시 켰습니다. ${id} 의 리뷰·리허설·장면에서 이 부품이 막았어야 할 결함이 나왔는지 사람이 봅니다.`)
}

// ---------- 레일 크기 ----------
// 레일 = 설치된 .rail/bin, .rail/hooks, .claude/skills/rail* 과 docs/RAIL.md. 설치한 레일 커밋이 바뀌는 첫 명령 때 rail_size 를 한 번 남긴다.
export function railSize() {
  const skills = path.join(ROOT, '.claude/skills')
  const dirs = ['.rail/bin', '.rail/hooks', ...(fs.existsSync(skills) ? fs.readdirSync(skills).filter((n) => n.startsWith('rail')).map((n) => `.claude/skills/${n}`) : [])]
  const files = dirs.filter((d) => fs.existsSync(path.join(ROOT, d))).flatMap((d) => walk(path.join(ROOT, d)).map((f) => path.join(ROOT, d, f)))
  if (fs.existsSync(F.railDoc)) files.push(F.railDoc)
  const lines = files.reduce((n, f) => n + (fs.readFileSync(f, 'utf8').match(/\n/g)?.length ?? 0), 0)
  return { lines, files: files.length }
}
export function noteRailSize() {
  if (!fs.existsSync(F.state) || !lock(2000, true)) return
  try {
    const v = railVersion()
    const last = readEvents().findLast((e) => e.event === 'rail_size')
    if (last?.version === v) return
    appendLog('rail_size', loadState(), { version: v, ...railSize(), parts: PART_IDS.length, ...(last ? { prev: { version: last.version, lines: last.lines } } : {}) })
  } catch {
    // 크기 기록은 건너뛰어도 된다.
  } finally {
    unlock()
  }
}
