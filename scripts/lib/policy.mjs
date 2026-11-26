// 사람만 바꾸는 정책: 커밋 정책, 자율 모드, 부품 끄고 켜기.
import fs from 'node:fs'
import path from 'node:path'
import { AUTONOMY_DEFAULT, POLICIES, autonomy, commitPolicy, isolation, loadConfig } from './config.mjs'
import { F, fail, out } from './core.mjs'
import { FIXED, PART_IDS, disabledParts, insurance, writeDisabled } from './parts.mjs'
import { appendLog, loadState } from './state.mjs'

// 커밋 정책은 사람만 바꾼다. 스킬은 사람이 이 세션에서 직접 말했을 때만 policy set 을 부른다.
export function cmdPolicy({ pos, flags }) {
  const [verb, name, value] = pos
  if (!verb || verb === 'show')
    return out(`커밋 정책(commitPolicy): ${commitPolicy()}\n자율 모드(autonomy.mode): ${autonomy().mode}\n작업 폴더(isolation): ${isolation()}\n꺼 둔 부품(disabled): ${disabledParts().join(', ') || '없음'} · 보험(insurance): ${insurance().join(', ')}`)
  if (verb === 'set' && name === 'autonomy' && ['on', 'off'].includes(value)) return setAutonomy(value, flags)
  if (verb === 'set' && ['disable', 'enable'].includes(name)) return setPart(name, value, flags)
  const def = POLICIES[name]
  if (verb !== 'set' || !def || !def.values.includes(value))
    fail(`사용법: policy [show] | policy set commit <${POLICIES.commit.values.join('|')}> [--said "<사람이 한 말>"] | policy set isolation <shared|worktree> --said "<사람이 한 말>" | policy set autonomy <on|off> [--said "<사람이 한 말>"] | policy set disable|enable <부품> --said "<사람이 한 말>"`, 2)
  if (name === 'isolation' && !String(flags.said ?? '').trim())
    appendLog('policy_refused', loadState(), { key: def.key, to: value, why: 'no said' }), fail('[정책] 작업 폴더 방식은 사람이 이 세션에서 직접 한 말이 있어야 바꿉니다 (--said "<사람 말 그대로>").')
  const config = loadConfig()
  const from = def.values.includes(config[def.key]) ? config[def.key] : def.default
  if (name === 'commit' && value !== 'auto-local' && autonomy().mode === 'on') {
    appendLog('policy_refused', loadState(), { key: def.key, to: value, why: 'autonomy on', said: flags.said ?? null })
    fail('[정책] 자율 모드가 켜져 있어 커밋 정책을 ask 로 바꿀 수 없습니다. 자율인데 커밋마다 물으면 멈춥니다. 먼저 사람이 policy set autonomy off 를 말해야 합니다.')
  }
  config[def.key] = value
  fs.mkdirSync(path.dirname(F.config), { recursive: true })
  fs.writeFileSync(F.config, JSON.stringify(config, null, 2) + '\n')
  appendLog('policy_change', loadState(), { key: def.key, from, to: value, said: flags.said ?? null })
  out(`[정책] ${def.key}: ${from} → ${value}`)
}
// 자율 모드도 사람만 바꾼다. 커밋 정책이 auto-local 이 아니면 켜기를 거절한다.
export function setAutonomy(value, flags) {
  const from = autonomy().mode
  if (value === 'on' && commitPolicy() !== 'auto-local') {
    appendLog('policy_refused', loadState(), { key: 'autonomy.mode', to: 'on', why: `commitPolicy ${commitPolicy()}`, said: flags.said ?? null })
    fail(`[정책] 자율 모드를 켤 수 없습니다. 커밋 정책이 "${commitPolicy()}" 입니다. 자율인데 커밋마다 물으면 멈추므로, 사람이 먼저 policy set commit auto-local 을 말해야 합니다.`)
  }
  const config = loadConfig()
  const cur = config.autonomy && typeof config.autonomy === 'object' && !Array.isArray(config.autonomy) ? config.autonomy : {}
  config.autonomy = { ...AUTONOMY_DEFAULT, ...cur, mode: value }
  fs.mkdirSync(path.dirname(F.config), { recursive: true })
  fs.writeFileSync(F.config, JSON.stringify(config, null, 2) + '\n')
  appendLog('policy_change', loadState(), { key: 'autonomy.mode', from, to: value, said: flags.said ?? null })
  out(`[정책] autonomy.mode: ${from} → ${value}`)
}

// 끄기는 사람만 한다(--said 에 사람 말 그대로). 보험은 거절, 한 번에 한 부품만. 끈 부품은 그 마일스톤을 닫을 때 다시 켜진다.
export function setPart(verb, id, flags) {
  if (!PART_IDS.includes(id)) fail(`사용법: policy set ${verb} <부품>  (부품: ${PART_IDS.join(', ')})`, 2)
  const said = typeof flags.said === 'string' ? flags.said.trim() : ''
  const st = loadState()
  const cur = disabledParts()
  const refuse = (why, msg) => (appendLog('policy_refused', st, { key: 'disabled', part: id, to: verb, why, said: said || null }), fail(`[정책] ${msg}`))
  if (verb === 'disable') {
    if (!said) refuse('no said', `${id} 를 끄려면 사람이 이 세션에서 직접 한 말이 있어야 합니다 (--said "<사람 말 그대로>"). 끄기는 사람만 합니다.`)
    if (insurance().includes(id)) refuse('insurance', `${id} 는 보험 부품이라 끌 수 없습니다. 드물게 쓰여도 한 번 놓치면 크게 다칩니다 (.rail/config.json 의 insurance).`)
    if (FIXED.includes(id)) refuse('fixed', `${id} 는 순서만 보는 부품이라 끌 것이 없습니다.`)
    if (cur.includes(id)) return out(`[정책] ${id} 는 이미 꺼져 있습니다.`)
    if (cur.length) refuse('one at a time', `이미 ${cur.join(', ')} 가 꺼져 있습니다. 한 번에 한 부품만 끕니다 (먼저 policy set enable ${cur[0]}).`)
  } else if (!cur.includes(id)) return out(`[정책] ${id} 는 이미 켜져 있습니다.`)
  const to = verb === 'disable' ? [id] : cur.filter((x) => x !== id)
  writeDisabled(to)
  appendLog('policy_change', st, { key: 'disabled', part: id, from: cur, to, said: said || null })
  out(`[정책] ${id} ${verb === 'disable' ? '끔 — 이 마일스톤을 닫을 때 다시 켜집니다. 닫힘 알림에 "꺼 둔 부품"으로 실립니다' : '켬'}`)
}
