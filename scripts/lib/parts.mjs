// 부품 목록과 꺼 둔 부품(덜어내기의 대상).
import fs from 'node:fs'
import path from 'node:path'
import { loadConfig } from './config.mjs'
import { F, read, strList } from './core.mjs'
import { appendLog } from './state.mjs'

// ---------- 덜어내기: 부품 쓰임 세기와 끄기 ----------
// 부품 하나하나는 "모델이 혼자 못 한다"는 가정이다. 부품마다 마일스톤별로 작동(돈 횟수)과 막음(실제로 멈추거나 바꾼 횟수)을 사건 기록에서 센다.
// ran 이 null 인 부품은 막을 때만 기록하므로 작동을 세지 않는다(훅, 멈춤 규칙). 부품을 빼는 것은 사람이 정한다.
// evidence: 막기보다 증거를 만드는 부품이라 빼기 후보를 작동으로 본다. auto: 자율 모드가 켜져 있어야 일하는 멈춤 규칙.
// found(m): 막지 않고 일한 횟수를 사건 기록 밖에서 센다. 기능 확인은 확인 기록(.rail/check/<m>-*.json)에 must 가 있었던 수다.
const mustChecks = (m) => (fs.existsSync(F.check) ? fs.readdirSync(F.check) : []).filter((n) => n.startsWith(`${m}-`) && n.endsWith('.json') && (() => { try { return JSON.parse(read(path.join(F.check, n))).must.length > 0 } catch { return false } })()).length
export const gateEv = (e, ...targets) => (e.event === 'gate_passed' || e.event === 'gate_blocked') && targets.includes(e.target)
export const ORDER_TARGETS = ['decide', 'milestone', 'check', 'step-done']
export const PARTS = [
  // 단계 순서 검사: 지금 단계에서 갈 수 있는 다음 단계만 허용한다. 내용 검사가 없어 꺼도 건너뛸 것이 없으므로 끄지 않는다(fixed).
  { id: 'gate:order', fixed: true, name: '단계 순서 검사 (decide·milestone·check·step-done)', ran: (e) => gateEv(e, ...ORDER_TARGETS), blocked: (e) => e.event === 'gate_blocked' && ORDER_TARGETS.includes(e.target) },
  { id: 'gate:close', name: '관문 close (장면 확인 관문)', ran: (e) => gateEv(e, 'close'), blocked: (e) => e.event === 'gate_blocked' && e.target === 'close' },
  { id: 'feature-check', name: '기능 확인 (확인 기록 없이 기능 step 을 끝내지 않음)', ran: (e) => gateEv(e, 'feature-check'), blocked: (e) => e.event === 'gate_blocked' && e.target === 'feature-check', found: mustChecks },
  { id: 'guard-tests', name: '시험 잠금 훅', ran: null, blocked: (e) => e.event === 'hook_blocked' },
  { id: 'stop-check', name: '마무리 검사 훅 (붙잡음)', ran: null, blocked: (e) => e.event === 'hook_held' },
  { id: 'verify', evidence: true, name: '검증기', ran: (e) => e.event === 'verify_run', blocked: (e) => e.event === 'verify_run' && e.ok === false },
  { id: 'rehearsal', evidence: true, name: '장면 리허설 관문', ran: (e) => gateEv(e, 'scene', 'rehearsal-record'), blocked: (e) => e.event === 'gate_blocked' && ['scene', 'rehearsal-record'].includes(e.target) },
  ...['human', 'busy', 'same_failure', 'budget'].map((c) => ({ id: `stop:${c}`, auto: true, name: `자율 멈춤 규칙 (${c})`, ran: null, blocked: (e) => e.event === 'autonomy_stop' && e.code === c }))
]
export const PART_IDS = PARTS.map((p) => p.id)
export const FIXED = PARTS.filter((p) => p.fixed).map((p) => p.id)
// 보험: 드물게 쓰여도 한 번 놓치면 크게 다치는 부품. 빼기 후보에서 빼고, 끄기를 거절한다.
export const INSURANCE_DEFAULT = ['guard-tests', 'stop-check', 'gate:close']
export const insurance = () => strList(loadConfig().insurance) ?? INSURANCE_DEFAULT
// 꺼 둔 부품. 보험, 끄지 않는 부품(fixed), 모르는 이름은 config 에 적혀 있어도 끄지 않는다.
export const disabledParts = () => (strList(loadConfig().disabled) ?? []).filter((id) => PART_IDS.includes(id) && !FIXED.includes(id) && !insurance().includes(id))
export const partOff = (id) => disabledParts().includes(id)
export const partSkipped = (id, st, data = {}) => appendLog('part_disabled', st, { part: id, ...data })
export function writeDisabled(list) {
  const config = loadConfig()
  config.disabled = list
  fs.mkdirSync(path.dirname(F.config), { recursive: true })
  fs.writeFileSync(F.config, JSON.stringify(config, null, 2) + '\n')
}
