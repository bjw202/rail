// 덜어내기(hbo-tube 회고, 주인 결정 2026-11-26) 시험: ① 시작 틀의 커밋 정책 auto-local(자율 모드는 따로 꺼짐),
// ② 커밋 관문 기록(commit_gate)과 commit 부품 빼기, ③ 빼기 후보 계산 — 자율 멈춤 규칙은 자율 모드가 꺼진 마일스톤에서 잴 수 없고,
// 검증기·리허설은 막음이 아니라 작동으로 보고, 순서 검사(gate:order)는 후보가 아니다.
// 규칙: 저장소의 .rail/config.json 값을 단언하지 않는다(틀 파일 templates/.rail/config.json 만 읽는다). 설정은 모두 임시 저장소에 만든다.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { RAIL, put, tmp } from './helpers.mjs'

const TEMPLATE = JSON.parse(readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../templates/.rail/config.json'), 'utf8'))
const HEAD = '| step | 맡는 쪽 | 할 일 | 고쳐도 되는 파일 | 기다리는 step | 완료 기준 | 상태 |\n|---|---|---|---|---|---|---|\n'

function run(root, args) {
  const base = { ...process.env }
  for (const k of ['CLAUDE_CODE_SESSION_ID', 'ORCA_AGENT_SESSION_ID', 'ORCA_TERMINAL_HANDLE', 'NODE_TEST_CONTEXT', 'RAIL_STATUSLINE_DIR']) delete base[k]
  const r = spawnSync(process.execPath, [RAIL, ...args], { encoding: 'utf8', env: { ...base, ORCA_CLI_COMMAND: '/nonexistent/orca', RAIL_ROOT: root, RAIL_STATUSLINE_DIR: path.join(root, 'no-statusline') } })
  return { code: r.status, out: r.stdout, err: r.stderr }
}
const ok = (r) => assert.equal(r.code, 0, r.err + r.out)
const T = (n) => new Date(Date.UTC(2026, 10, 26, 0, n)).toISOString()
const ev = (n, event, milestone, data = {}) => JSON.stringify({ t: T(n), event, stage: 'milestone', milestone, ...data })

// M0 의 기능 step 하나에 작업자가 돌고 있는 저장소.
function stepRoot(config) {
  const root = tmp('railtrim-')
  put(root, '.rail/config.json', JSON.stringify(config))
  put(root, '.rail/state.json', JSON.stringify({ project: 'demo', stage: 'milestone', milestone: 'M0', step: null, closed: [], gates: { scene_checked: {}, rehearsed: {} } }))
  put(root, 'docs/plan/M0.md', `# M0\n\n${HEAD}| M0-1 | 구현 | 만들기 | src/a.mjs | 없음 | 통과 | ⏳ 진행 중 |\n`)
  put(root, '.rail/log.jsonl', ev(1, 'worker_start', 'M0', { step: 'M0-1', agent: 'claude', role: 'impl', terminal: 'term_w1', dispatch: 'ctx_w1' }) + '\n')
  return root
}
// 닫힌 마일스톤 셋. 마일스톤마다 순서 검사 통과, 검증기 통과, 리허설 관문 통과(막은 일은 없음). extra(m, n) 로 사건을 더한다.
function usageRoot(config = {}, extra = () => []) {
  const lines = []
  let n = 10
  for (const m of ['M1', 'M2', 'M3'])
    lines.push(
      ev(n++, 'gate_passed', m, { target: 'milestone' }),
      ...extra(m, () => n++),
      ev(n++, 'verify_run', m, { ok: true, results: [] }),
      ev(n++, 'gate_passed', m, { target: 'scene' }),
      ev(n++, 'gate_passed', m, { target: 'close' }),
      ev(n++, 'milestone_closed', m)
    )
  const root = tmp('railtrim-u-')
  put(root, '.rail/config.json', JSON.stringify({ railVersion: '2.9', ...config }))
  put(root, '.rail/state.json', JSON.stringify({ project: 'demo', stage: 'done', milestone: null, closed: ['M1', 'M2', 'M3'] }))
  put(root, '.rail/log.jsonl', lines.join('\n') + '\n')
  return root
}
const usage = (root) => JSON.parse(run(root, ['usage', '--json']).out)
const STOPS = ['stop:human', 'stop:busy', 'stop:same_failure', 'stop:budget']

describe('① 시작 틀의 커밋 정책', () => {
  test('틀의 commitPolicy 는 auto-local 이고 자율 모드는 꺼져 있다', () => {
    assert.equal(TEMPLATE.commitPolicy, 'auto-local')
    assert.equal(TEMPLATE.autonomy.mode, 'off')
  })

  test('틀 설정이면 리더는 묻지 않고 이 step 의 파일만 로컬 커밋하고(푸시 안 함), 자율 모드는 저절로 켜지지 않는다', () => {
    const root = stepRoot(TEMPLATE)
    const next = JSON.parse(run(root, ['status', '--json']).out).next
    assert.match(next, /커밋 정책대로 이 step 의 파일만 묻지 않고 로컬 커밋\(푸시 안 함\)/)
    assert.doesNotMatch(next, /사람에게 물은 뒤/)
    const n = JSON.parse(run(root, ['next', '--json']).out)
    assert.deepEqual(n.autonomy, { mode: 'off', effective: false })
    assert.match(run(root, ['policy']).out, /commitPolicy\): auto-local\n자율 모드\(autonomy\.mode\): off/)
  })
})

describe('② 커밋 관문 기록 빼기', () => {
  test('커밋 안내는 part commit 과 log commit_gate 를 말하지 않고, checkCommand·마무리 검사 훅·고쳐도 되는 파일만 말한다', () => {
    for (const config of [{ commitPolicy: 'ask' }, { commitPolicy: 'auto-local', isolation: 'worktree' }]) {
      const next = JSON.parse(run(stepRoot(config), ['status', '--json']).out).next
      assert.doesNotMatch(next, /commit_gate|part commit/, JSON.stringify(config))
      assert.match(next, /checkCommand 가 통과하고/)
      assert.match(next, /"고쳐도 되는 파일" 안\(tests\/·fixtures\/ 변경 없음\)/)
    }
    assert.match(JSON.parse(run(stepRoot({ commitPolicy: 'ask' }), ['status', '--json']).out).next, /\(마무리 검사 훅도 본다\).*사람에게 물은 뒤 커밋/)
  })

  test('commit 부품과 part 명령이 없고, 예전 기록의 commit_gate 와 꺼 둔 commit 은 오류 없이 무시한다', () => {
    const root = usageRoot({ disabled: ['commit'] }, (m, n) => [ev(n(), 'commit_gate', m, { step: `${m}-1`, ok: false, why: '옛 기록' }), ev(n(), 'part_disabled', m, { part: 'commit', where: 'part' })])
    const u = usage(root)
    assert.ok(!u.parts.some((p) => p.id === 'commit'))
    assert.deepEqual(u.disabled, [])
    ok(run(root, ['usage']))
    ok(run(root, ['status']))
    assert.equal(run(root, ['part', 'commit']).code, 2, 'part 명령은 없다')
    assert.equal(run(root, ['policy', 'set', 'disable', 'commit', '--said', '꺼']).code, 2, '없는 부품')
  })
})

describe('③ 빼기 후보 계산', () => {
  test('자율 모드가 꺼져 있던 마일스톤에서 멈춤 규칙은 "잴 수 없음"이고 후보가 아니다', () => {
    const root = usageRoot()
    const u = usage(root)
    assert.deepEqual(u.milestones.map((m) => m.autonomy), [false, false, false])
    for (const id of STOPS) {
      assert.equal(u.parts.find((p) => p.id === id).by.M1.unmeasured, true, id)
      assert.ok(!u.candidates.list.includes(id), id)
    }
    assert.match(run(root, ['usage']).out, /stop:human\s+잴 수 없음\s+잴 수 없음\s+잴 수 없음/)
    assert.match(run(root, ['usage']).out, /"잴 수 없음" 은 그 마일스톤에 자율 모드가 꺼져 있어/)
  })

  test('자율 모드가 켜져 있었으면 멈춤 규칙도 잰다: 막은 규칙은 남고 안 막은 규칙은 후보', () => {
    const root = usageRoot({ commitPolicy: 'auto-local', autonomy: { mode: 'on' } }, (m, n) => [ev(n(), 'autonomy_stop', m, { code: 'human' })])
    const u = usage(root)
    assert.deepEqual(u.milestones.map((m) => m.autonomy), [true, true, true])
    assert.ok(!u.candidates.list.includes('stop:human'))
    for (const id of ['stop:busy', 'stop:same_failure', 'stop:budget']) assert.ok(u.candidates.list.includes(id), id)
  })

  test('켜짐은 autonomy.mode 의 policy_change 로 따라가고, auto_start 가 있으면 켜진 것으로 본다', () => {
    const turnOn = (m, n) => (m === 'M3' ? [ev(n(), 'policy_change', m, { key: 'autonomy.mode', from: 'off', to: 'on' })] : [])
    const u = usage(usageRoot({ commitPolicy: 'auto-local', autonomy: { mode: 'on' } }, turnOn))
    assert.deepEqual(u.milestones.map((m) => m.autonomy), [false, false, true], '지금 config 가 켜져 있어도 M3 전에는 꺼져 있었다')
    for (const id of STOPS) assert.ok(!u.candidates.list.includes(id), id)
    const auto = usage(usageRoot({}, (m, n) => (m === 'M2' ? [ev(n(), 'auto_start', m, { step: 'M2-1' })] : [])))
    assert.deepEqual(auto.milestones.map((m) => m.autonomy), [false, true, false])
  })

  test('검증기·리허설은 막지 않았어도 돌았으면 후보가 아니고, 한 번도 돌지 않았을 때만 후보', () => {
    const u = usage(usageRoot())
    for (const id of ['verify', 'rehearsal']) assert.ok(!u.candidates.list.includes(id), `${id} 는 돌았다`)
    assert.ok(u.candidates.list.includes('feature-check'), '막는 부품은 막은 적이 없으면 후보')
    const quiet = tmp('railtrim-q-')
    put(quiet, '.rail/config.json', '{}')
    put(quiet, '.rail/state.json', JSON.stringify({ project: 'demo', stage: 'done', milestone: null, closed: ['M1', 'M2', 'M3'] }))
    put(quiet, '.rail/log.jsonl', ['M1', 'M2', 'M3'].map((m, i) => ev(i, 'milestone_closed', m)).join('\n') + '\n')
    const q = usage(quiet)
    for (const id of ['verify', 'rehearsal']) assert.ok(q.candidates.list.includes(id), `${id} 는 돌지 않았다`)
  })

  test('순서 검사(gate:order)는 막은 적이 없어도, 보험 목록에 없어도 후보가 아니다', () => {
    const u = usage(usageRoot({ insurance: [] }))
    assert.equal(u.parts.find((p) => p.id === 'gate:order').by.M1.blocked, 0)
    assert.ok(!u.candidates.list.includes('gate:order'))
    assert.ok(u.candidates.list.includes('gate:close'), '보험에서 빠진 관문은 후보가 될 수 있다')
  })
})
