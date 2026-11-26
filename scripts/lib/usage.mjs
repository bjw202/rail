// 부품 쓰임 세기, 빼기 후보, 레일 크기.
import fs from 'node:fs'
import path from 'node:path'
import { railVersion, versionLabel } from './config.mjs'
import { F, ROOT, fail, out, walk } from './core.mjs'
import { PARTS, PART_IDS, disabledParts, insurance, partOff, partSkipped, writeDisabled } from './parts.mjs'
import { appendLog, loadState, lock, readEvents, unlock } from './state.mjs'


// 사건을 마일스톤으로 나눈다: 사건에 적힌 마일스톤, 없으면(시작 전, 닫힌 뒤 다음 결정 전) 그 뒤에 처음 닫힌 마일스톤, 그것도 없으면 지금 마일스톤.
export function buckets(st, ev) {
  const map = new Map()
  const closeAt = ev.map((e, i) => (e.event === 'milestone_closed' ? i : -1)).filter((i) => i >= 0)
  let c = 0
  ev.forEach((e, i) => {
    while (c < closeAt.length && closeAt[c] < i) c++
    const id = e.milestone ?? (c < closeAt.length ? ev[closeAt[c]].milestone : st.milestone ?? '다음')
    if (!map.has(id)) map.set(id, { id, events: [], closed: false })
    const b = map.get(id)
    b.events.push(e)
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
      bs.map((b) => [b.id, { ran: p.ran ? b.events.filter(p.ran).length : null, blocked: b.events.filter(p.blocked).length, off: b.events.filter((e) => e.event === 'part_disabled' && e.part === p.id).length }])
    )
  }))
  // 빼기 후보: 보험이 아니고, 최근 닫힌 마일스톤 3개 동안 한 번도 막지 않은 부품. 그동안 꺼 보았던 부품은 0 이 증거가 아니므로 뺀다.
  const win = bs.filter((b) => b.closed).slice(-3)
  const touched = (id) => win.some((b) => b.events.some((e) => e.part === id && ['part_disabled', 'policy_change', 'part_enabled'].includes(e.event)))
  const list = win.length < 3 ? [] : parts.filter((p) => !p.insurance && !touched(p.id) && win.every((b) => p.by[b.id].blocked === 0)).map((p) => p.id)
  const why = win.length < 3 ? `닫힌 마일스톤이 ${win.length}개라 아직 뽑지 않습니다. 3개부터 뽑습니다` : `보험이 아니고 ${win.map((b) => b.id).join('·')} 동안 한 번도 막지 않음`
  return { milestones: bs.map((b) => ({ id: b.id, closed: b.closed })), parts, candidates: { list, window: win.map((b) => b.id), why }, disabled: off, insurance: ins }
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
      return `${x.ran ?? '?'}/${x.blocked}${x.off ? ` 꺼짐${x.off}` : ''}`.padEnd(10)
    })
    lines.push(`${p.id.padEnd(18)} ${cells.join(' ')} ${p.name}${p.insurance ? ' [보험]' : ''}${p.disabled ? ' [지금 꺼짐]' : ''}`)
  }
  lines.push('작동 "?" = 막을 때만 기록하는 부품이라 작동 횟수는 세지 않습니다. "꺼짐n" = 꺼져 있어 건너뛴 횟수(part_disabled).')
  lines.push(candidateLine(u.candidates))
  if (u.disabled.length) lines.push(`꺼 둔 부품: ${u.disabled.join(', ')}`)
  out(lines.join('\n'))
}
// 부품 하나가 켜졌는지 스크립트 밖(스킬의 커밋 관문)에서 묻는다. 꺼져 있으면 part_disabled 를 남기고 종료 코드 1.
export function cmdPart({ pos }) {
  const id = pos[0]
  if (!PART_IDS.includes(id)) fail(`사용법: part <${PART_IDS.join('|')}>`, 2)
  if (!partOff(id)) return out(`[부품] ${id} 켜짐`)
  partSkipped(id, loadState(), { where: 'part' })
  out(`[부품] ${id} 꺼짐 — 이 마일스톤 동안 건너뜁니다 (policy set disable)`)
  process.exitCode = 1
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
// 레일 = 설치된 .rail/bin, .rail/hooks, .claude/skills/rail* 과 docs/RAIL.md. 판 번호가 바뀌는 첫 명령 때 rail_size 를 한 번 남긴다.
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
