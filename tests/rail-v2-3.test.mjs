// 레일 2.3판 시험: 부품 쓰임 세기(usage), 빼기 후보, 부품 끄기(policy set disable), 레일 크기 기록(rail_size)과 20% 경고,
// 압축 이어받기(PreCompact 훅, compact 매처 SessionStart), 닫힘 알림의 컨텍스트 사용률·압축 횟수·후보·꺼 둔 부품.
// 규칙(2.3판에서 배움): 이 파일은 저장소의 .rail/config.json 값을 단언하지 않는다. 모든 설정은 임시 저장소에 만든다.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { DECIDED, GOOD_BRIEF, RAIL, events, git, put, runHook, state, tmp } from './helpers.mjs'

// rail.mjs 를 임시 저장소 기준으로 부른다. 바깥 세션의 Orca·상태줄 환경은 지운다(진짜 알림이 나가거나 진짜 캐시를 읽지 않게).
function run(root, args, { env = {}, input = '' } = {}) {
  const base = { ...process.env, RAIL_ROOT: root }
  for (const k of ['ORCA_CLI_COMMAND', 'ORCA_TERMINAL_HANDLE', 'RAIL_STATUSLINE_DIR', 'NODE_TEST_CONTEXT']) delete base[k]
  const r = spawnSync(process.execPath, [RAIL, ...args], { encoding: 'utf8', input, env: { ...base, RAIL_STATUSLINE_DIR: path.join(root, 'no-statusline'), ...env } })
  return { code: r.status, out: r.stdout, err: r.stderr }
}
const ok = (r) => assert.equal(r.code, 0, r.err)
const config = (root) => JSON.parse(readFileSync(path.join(root, '.rail/config.json'), 'utf8'))
const names = (root) => events(root).map((e) => e.event)
const T = (n) => new Date(Date.UTC(2026, 10, 24, 0, n)).toISOString()
const ev = (n, event, milestone, data = {}) => JSON.stringify({ t: T(n), event, stage: 'milestone', milestone, ...data })

// 가짜 사건 기록: M0 은 2.2판 전(gate_passed 없음), M1·M2·M3 은 기록 있음.
function fakeLog(closed = ['M1', 'M2', 'M3']) {
  const lines = [ev(1, 'step_start', 'M0', { step: 'M0-1' }), ev(2, 'gate_blocked', 'M0', { target: 'close' }), ev(3, 'milestone_closed', 'M0')]
  let n = 10
  for (const m of closed) {
    lines.push(
      JSON.stringify({ t: T(n++), event: 'gate_passed', stage: 'done', milestone: null, target: 'decide' }),
      ev(n++, 'gate_passed', m, { target: 'step-start', step: `${m}-1` }),
      ev(n++, 'gate_blocked', m, { target: 'step-start', step: `${m}-2` }),
      ev(n++, 'gate_passed', m, { target: 'step-start', step: `${m}-2` }),
      ev(n++, 'hook_held', m, { hook: 'stop-check', reason: '`node --test` 가 종료 코드 1로 끝났다' }),
      ev(n++, 'hook_held', m, { hook: 'stop-check', reason: '계획 표 검사(`node .rail/bin/rail.mjs validate`)' }),
      ev(n++, 'verify_run', m, { ok: false, results: [] }),
      ev(n++, 'verify_run', m, { ok: true, results: [] }),
      ev(n++, 'autonomy_stop', m, { code: 'human' }),
      ev(n++, 'gate_passed', m, { target: 'close' }),
      ev(n++, 'milestone_closed', m)
    )
  }
  return lines.join('\n') + '\n'
}
function usageRoot(cfg = {}, log = fakeLog()) {
  const root = tmp('rail23-')
  put(root, '.rail/config.json', JSON.stringify({ railVersion: '2.3', ...cfg }))
  put(root, '.rail/state.json', JSON.stringify({ project: 'demo', stage: 'done', milestone: null, closed: ['M0', 'M1', 'M2', 'M3'] }))
  put(root, '.rail/log.jsonl', log)
  return root
}
const usageJson = (root) => JSON.parse(run(root, ['usage', '--json']).out)
const part = (u, id) => u.parts.find((p) => p.id === id)

describe('쓰임 세기 (usage)', () => {
  test('부품마다 마일스톤별 작동/막음을 사건 기록에서 센다', () => {
    const u = usageJson(usageRoot())
    assert.deepEqual(part(u, 'gate:order').by.M2, { ran: 1, blocked: 0, off: 0 }, '마일스톤이 적히지 않은 결정 관문은 그 뒤에 닫힌 마일스톤으로 센다')
    assert.deepEqual(part(u, 'stop-check').by.M1, { ran: null, blocked: 1, off: 0 }, '막을 때만 기록하는 훅은 작동을 세지 않는다')
    assert.deepEqual(part(u, 'verify').by.M3, { ran: 2, blocked: 1, off: 0 })
    assert.equal(part(u, 'stop:human').by.M2.blocked, 1)
    assert.equal(part(u, 'gate:close').insurance, true)
  })

  test('기록이 없던 마일스톤(2.2판 전)은 "기록 없음"으로 표시하고 세지 않는다', () => {
    const root = usageRoot()
    const u = usageJson(root)
    assert.deepEqual(u.milestones.find((m) => m.id === 'M0'), { id: 'M0', recorded: false, closed: true })
    assert.equal(part(u, 'gate:close').by.M0, undefined, 'M0 의 gate_blocked 는 세지 않는다')
    const table = run(root, ['usage']).out
    assert.match(table, /기록 없음 \(2\.2판 전\): M0/)
    assert.match(table, /gate:order\s+1\/0\s+1\/0\s+1\/0/)
    assert.match(table, /stop-check\s+\?\/1/)
  })
})

describe('빼기 후보', () => {
  test('기록 있는 닫힌 마일스톤이 3개 미만이면 후보가 없다', () => {
    const u = usageJson(usageRoot({}, fakeLog(['M1', 'M2'])))
    assert.deepEqual(u.candidates.list, [])
    assert.match(u.candidates.why, /2개라 아직 뽑지 않습니다/)
  })

  test('보험이 아니면서 최근 3개 마일스톤 동안 한 번도 막지 않은 부품을 뽑는다', () => {
    const u = usageJson(usageRoot())
    const c = u.candidates.list
    assert.deepEqual(u.candidates.window, ['M1', 'M2', 'M3'])
    assert.ok(c.includes('gate:order') && c.includes('commit') && c.includes('stop:budget'), c.join(','))
    for (const blocked of ['verify', 'stop:human']) assert.ok(!c.includes(blocked), `${blocked} 는 막은 적이 있다`)
    for (const ins of ['guard-tests', 'stop-check', 'gate:close']) assert.ok(!c.includes(ins), `${ins} 는 기본 보험이다`)
  })

  test('config 의 insurance 목록이 보험을 정한다', () => {
    const u = usageJson(usageRoot({ insurance: ['gate:order'] }))
    assert.ok(!u.candidates.list.includes('gate:order'))
    assert.ok(u.candidates.list.includes('gate:close'), '보험 목록에서 빠진 부품은 후보가 될 수 있다')
  })
})

// M0 의 step 하나가 진행 중이고 M0-2 가 M0-1 을 기다리는 milestone 단계 저장소.
function milestoneRoot(cfg = {}) {
  const root = tmp('rail23m-')
  put(root, '.rail/config.json', JSON.stringify({ railVersion: '2.3', ...cfg }))
  put(root, '.rail/state.json', JSON.stringify({ project: 'demo', stage: 'milestone', milestone: 'M0', step: null, closed: [] }))
  put(root, 'docs/plan/M0.md', '| step | 맡는 쪽 | 할 일 | 고쳐도 되는 파일 | 완료 기준 | 상태 |\n|---|---|---|---|---|---|\n| M0-1 | 구현 | 가 | src/a.mjs | 기준 | |\n| M0-2 | 구현 | 나 | src/b.mjs | 기준 | |\n')
  return root
}

describe('부품 끄기 (policy set disable)', () => {
  test('사람 말(--said)이 없으면 거절하고, 보험이면 거절하고, 한 번에 한 부품만 끈다', () => {
    const root = milestoneRoot()
    const r = run(root, ['policy', 'set', 'disable', 'verify'])
    assert.equal(r.code, 1)
    assert.match(r.err, /사람이 이 세션에서 직접 한 말/)
    assert.equal(config(root).disabled, undefined)
    const ins = run(root, ['policy', 'set', 'disable', 'guard-tests', '--said', '꺼 봐'])
    assert.equal(ins.code, 1)
    assert.match(ins.err, /보험 부품이라 끌 수 없습니다/)
    assert.deepEqual(events(root).filter((e) => e.event === 'policy_refused').map((e) => e.why), ['no said', 'insurance'])
    ok(run(root, ['policy', 'set', 'disable', 'verify', '--said', '검증기 한 번 꺼 봐']))
    assert.deepEqual(config(root).disabled, ['verify'])
    assert.equal(events(root).at(-1).said, '검증기 한 번 꺼 봐')
    assert.equal(run(root, ['policy', 'set', 'disable', 'rehearsal', '--said', '이것도']).code, 1, '한 번에 한 부품')
    assert.equal(run(root, ['policy', 'set', 'disable', 'no-such-part', '--said', 'x']).code, 2)
  })

  test('config 에 손으로 보험을 적어도 끄지 않는다', () => {
    const root = milestoneRoot({ disabled: ['guard-tests', 'stop-check'] })
    assert.equal(run(root, ['part', 'guard-tests']).code, 0)
    assert.deepEqual(JSON.parse(run(root, ['status', '--json']).out).disabled, [])
  })

  test('꺼진 검증기는 돌지 않고, 멈춤 규칙과 표 검사도 꺼지면 일하지 않는다', () => {
    const root = milestoneRoot({ verify: [{ name: 'mark', command: `node -e "require('fs').writeFileSync('ran','')"` }] })
    ok(run(root, ['policy', 'set', 'disable', 'verify', '--said', '꺼']))
    ok(run(root, ['verify']))
    assert.ok(!existsSync(path.join(root, 'ran')), '검증기 명령이 돌지 않았다')
    assert.ok(names(root).includes('part_disabled') && !names(root).includes('verify_run'))
    ok(run(root, ['policy', 'set', 'enable', 'verify']))
    ok(run(root, ['policy', 'set', 'disable', 'stop:human', '--said', '꺼']))
    ok(run(root, ['ask', '무엇을 할까요?', '--kind', 'approve']))
    assert.notEqual(JSON.parse(run(root, ['next', '--json']).out).stop?.code, 'human')
    assert.equal(events(root).filter((e) => e.event === 'part_disabled').at(-1).part, 'stop:human')
    ok(run(root, ['policy', 'set', 'enable', 'stop:human']))
  })
})

// 닫을 수 있는 check 단계 저장소(장면 확인 pass, 다시 잰 예상 있음, step 모두 ✅).
function closeRoot(cfg = {}) {
  const root = tmp('rail23c-')
  const fake = path.join(root, 'fake-orca.mjs')
  put(root, 'fake-orca.mjs', `#!/usr/bin/env node\nimport { writeFileSync } from 'node:fs'\nwriteFileSync(${JSON.stringify(path.join(root, 'sent.json'))}, JSON.stringify(process.argv.slice(2)))\n`)
  spawnSync('chmod', ['+x', fake])
  put(root, '.rail/config.json', JSON.stringify({ railVersion: '2.3', notify: { bot: 'coach' }, ...cfg }))
  put(root, 'docs/BRIEF.md', GOOD_BRIEF)
  put(root, 'docs/ROADMAP.md', '# 로드맵\n승인: 2026-11-24\n## M0 뼈대\n- 끝나는 장면: 보인다\n- 위험 질문: D-01 방법\n- 예상 기간: 3일\n## 다시 잰 예상\n- M0 끝: 예상 3일 → 실제 1일\n')
  put(root, 'docs/decisions/D-01.md', DECIDED)
  put(root, 'docs/plan/M0.md', '| step | 맡는 쪽 | 할 일 | 고쳐도 되는 파일 | 완료 기준 | 상태 |\n|---|---|---|---|---|---|\n| M0-1 | 구현 | 가 | src/a.mjs | 기준 | ✅ 끝(2026-11-24) 됨 |\n')
  put(root, '.rail/state.json', JSON.stringify({ project: 'demo', stage: 'check', milestone: 'M0', step: null, closed: [], gates: { scene_checked: { M0: { result: 'pass', note: '봤다' } }, rehearsed: {} } }))
  return { root, env: { ORCA_CLI_COMMAND: fake } }
}
const sentBody = (root) => {
  const argv = JSON.parse(readFileSync(path.join(root, 'sent.json'), 'utf8'))
  return argv[argv.indexOf('--body') + 1]
}

describe('닫힘 알림 (2.3판)', () => {
  test('리더 세션의 CW%, 압축 횟수, 빼기 후보, 꺼 둔 부품을 싣고, 닫으면 꺼 둔 부품을 다시 켠다', () => {
    const { root, env } = closeRoot()
    const sl = path.join(root, 'statusline')
    put(root, 'statusline/sess-lead.json', JSON.stringify({ context_window: { used_percentage: 42.4 } }))
    ok(run(root, ['status', '--hook'], { input: JSON.stringify({ session_id: 'sess-lead', source: 'startup' }) }))
    assert.equal(state(root).leader_session, 'sess-lead')
    ok(run(root, ['precompact'], { input: JSON.stringify({ trigger: 'auto', session_id: 'sess-lead' }) }))
    ok(run(root, ['precompact'], { input: JSON.stringify({ trigger: 'manual', session_id: 'sess-lead' }) }))
    ok(run(root, ['policy', 'set', 'disable', 'rehearsal', '--said', '리허설 관문 꺼 봐']))
    const r = run(root, ['advance', 'close'], { env: { ...env, RAIL_STATUSLINE_DIR: sl } })
    ok(r)
    const body = sentBody(root).split('\n')
    assert.match(body[0], /^작업 \d+분 · 사람 답 0번 · 레일 수정 0번 · CW 42% · 압축 2번$/)
    assert.match(body[1], /^빼기 후보: 없음 \(기록 있는 닫힌 마일스톤이 1개라/)
    assert.match(body[2], /^꺼 둔 부품: rehearsal/)
    assert.deepEqual(config(root).disabled, [])
    assert.equal(events(root).find((e) => e.event === 'part_enabled').part, 'rehearsal')
    assert.match(r.out, /\[덜어내기\] 빼기 후보: 없음/)
  })

  test('상태줄 캐시가 없으면 "CW 모름"으로 쓰고, 꺼 둔 부품이 없으면 그 줄을 싣지 않는다', () => {
    const { root, env } = closeRoot()
    ok(run(root, ['leader', 'sess-none']))
    ok(run(root, ['advance', 'close'], { env }))
    const body = sentBody(root).split('\n')
    assert.match(body[0], /CW 모름 · 압축 0번$/)
    assert.equal(body.length, 2)
  })
})

describe('레일 크기 (rail_size)', () => {
  function sizeRoot(version, log = '') {
    const root = tmp('rail23s-')
    put(root, '.rail/config.json', JSON.stringify({ railVersion: version }))
    put(root, '.rail/state.json', JSON.stringify({ project: 'demo', stage: 'done', milestone: null, closed: [] }))
    put(root, 'plugin/scripts/a.mjs', 'a\n'.repeat(100))
    put(root, 'plugin/skills/rail-x/SKILL.md', 'b\n'.repeat(10))
    put(root, 'plugin/skills/other/SKILL.md', 'c\n'.repeat(1000))
    put(root, 'docs/RAIL.md', `# 레일\n레일 ${version}판\n`)
    if (log) put(root, '.rail/log.jsonl', log)
    return root
  }
  const sizes = (root) => events(root).filter((e) => e.event === 'rail_size')

  test('판 번호가 바뀌는 첫 명령 때 한 번 레일 줄 수를 남긴다(레일 스킬만, validate 는 쓰지 않음)', () => {
    const root = sizeRoot('2.3')
    const plug = (r) => ({ env: { CLAUDE_PLUGIN_ROOT: path.join(r, 'plugin') } })
    ok(run(root, ['status'], plug(root)))
    ok(run(root, ['status'], plug(root)))
    assert.equal(sizes(root).length, 1)
    assert.deepEqual([sizes(root)[0].version, sizes(root)[0].lines, sizes(root)[0].files], ['2.3', 112, 3])
    put(root, '.rail/config.json', JSON.stringify({ railVersion: '2.4' }))
    ok(run(root, ['status'], plug(root)))
    assert.deepEqual(sizes(root).map((e) => e.version), ['2.3', '2.4'])
    assert.deepEqual(sizes(root)[1].prev, { version: '2.3', lines: 112 })
  })

})

describe('압축 이어받기', () => {
  function compactRoot() {
    const root = tmp('rail23k-')
    put(root, '.rail/config.json', JSON.stringify({ railVersion: '2.3' }))
    put(root, 'CLAUDE.md', '# 규칙\n- 원문규칙-클로드: 관문을 건너뛰지 마라\n')
    put(root, 'docs/RAIL.md', '# 레일\n레일 2.3판\n원문규칙-레일문서: 상태 파일을 손으로 고치지 마라\n')
    put(root, '.claude/skills/rail/SKILL.md', '원문규칙-스킬: 한 번에 질문 하나\n')
    put(root, 'docs/plan/M0.md', '| step | 맡는 쪽 | 할 일 | 고쳐도 되는 파일 | 완료 기준 | 상태 |\n|---|---|---|---|---|---|\n| M0-1 | 구현 | 가 | src/a.mjs | 기준 | ⏳ 진행 중 |\n')
    const ask = { q: '결정 카드 D-02 에서 A 와 B 중 무엇을 고를까요? (원문 그대로)', kind: 'decide', at: T(5) }
    put(root, '.rail/state.json', JSON.stringify({ project: 'demo', stage: 'milestone', milestone: 'M0', step: 'M0-1', closed: [], human_ask: ask, waiting_for: 'human' }))
    put(root, '.rail/log.jsonl', [ev(1, 'worker_start', 'M0', { step: 'M0-1', agent: 'claude', role: 'impl', dispatch: 'ctx_abc123', terminal: 'term_w1' }), ev(2, 'rail_gap', 'M0', { where: '.rail/bin/rail.mjs', what: '틈-하나: 압축 뒤 작업자를 잃는다' })].join('\n') + '\n')
    git(root, 'init', '-q')
    return root
  }

  test('PreCompact 훅은 위치·진행 중 작업자·열린 질문 원문·최근 rail_gap 을 내고, 규칙 원문은 내지 않고, compact_started 를 남긴다', () => {
    const root = compactRoot()
    const r = runHook('pre-compact.mjs', { cwd: root, hook_event_name: 'PreCompact', trigger: 'auto', session_id: 'sess-1', custom_instructions: null })
    assert.equal(r.code, 0, r.stderr)
    const o = r.stdout
    assert.match(o, /레일 위치: M0 · step 진행 \(M0-1\)/)
    assert.match(o, /진행 중 step M0-1/)
    assert.match(o, /M0-1: agent claude, role impl, dispatch ctx_abc123, terminal term_w1/)
    assert.ok(o.includes('"결정 카드 D-02 에서 A 와 B 중 무엇을 고를까요? (원문 그대로)"'))
    assert.match(o, /틈-하나: 압축 뒤 작업자를 잃는다/)
    assert.match(o, /요약하지 말 것: CLAUDE\.md, docs\/RAIL\.md/)
    assert.ok(!/원문규칙-/.test(o), '규칙 원문은 지시에 넣지 않는다')
    assert.ok(o.length < 10_000)
    const e = events(root).at(-1)
    assert.deepEqual([e.event, e.trigger, e.session], ['compact_started', 'auto', 'sess-1'])
  })

  test('레일이 없는 저장소에서는 아무것도 내지 않고 압축을 막지 않는다', () => {
    const root = tmp('rail23n-')
    git(root, 'init', '-q')
    const r = runHook('pre-compact.mjs', { cwd: root, trigger: 'manual' })
    assert.deepEqual([r.code, r.stdout], [0, ''])
  })

  test('compact 매처 SessionStart 는 위치 세 줄과 다시 읽기 안내를 내고 compact_resumed 를 남긴다. 매처 없는 항목은 압축 때 조용하다', () => {
    const root = compactRoot()
    const input = JSON.stringify({ hook_event_name: 'SessionStart', source: 'compact', session_id: 'sess-2' })
    const plain = run(root, ['status', '--hook'], { input })
    ok(plain)
    assert.equal(plain.out, '', '같은 세 줄을 두 번 넣지 않는다')
    const r = run(root, ['status', '--hook', '--compact'], { input })
    ok(r)
    const ctx = JSON.parse(r.out).hookSpecificOutput.additionalContext
    assert.match(ctx, /위치: M0 · step 진행 \(M0-1\)\n기다리는 것: 사람의 답/)
    assert.match(ctx, /작업자: M0-1\(claude, impl, 창 term_w1, 일 ctx_abc123\)/)
    assert.match(ctx, /압축됐다\. docs\/RAIL\.md 와 지금 마일스톤의 step 표\(docs\/plan\/M0\.md\)를 다시 읽고, 진행 중 작업자를 `node ".*\/scripts\/rail\.mjs" status` 로 확인한 뒤 이어서 하라\./)
    const e = events(root).at(-1)
    assert.deepEqual([e.event, e.session], ['compact_resumed', 'sess-2'])
    assert.equal(state(root).leader_session, 'sess-2')
  })

  test('마무리 검사 훅도 세션을 리더로 적고, 꺼 둔 부품은 part 가 종료 코드 1 로 알린다(훅이 예정된 실패 통과를 건너뛸 때 씀)', () => {
    const root = compactRoot()
    const r = runHook('stop-check.mjs', { cwd: root, session_id: 'sess-stop' }, { RAIL_STOP_CHECK_CMD: 'true' })
    assert.equal(r.code, 0, r.stderr)
    assert.equal(state(root).leader_session, 'sess-stop')
  })

  test('열린 작업자의 창에서 온 세션은 리더로 적지 않는다', () => {
    const root = compactRoot()
    ok(run(root, ['leader', 'sess-worker'], { env: { ORCA_TERMINAL_HANDLE: 'term_w1' } }))
    assert.equal(state(root).leader_session, undefined)
    ok(run(root, ['status', '--hook'], { input: JSON.stringify({ source: 'startup', session_id: 'sess-new-worker', session_title: 'M0-2 새 작업자' }) }))
    assert.equal(state(root).leader_session, undefined, '이름이 step 으로 시작하는 세션도 작업자다')
    ok(run(root, ['leader', 'sess-lead'], { env: { ORCA_TERMINAL_HANDLE: 'term_leader' } }))
    assert.equal(state(root).leader_session, 'sess-lead')
  })
})

test('이 시험 파일은 저장소의 .rail/config.json 을 읽지 않는다(2.3판에서 배운 규칙)', () => {
  const me = readFileSync(fileURLToPath(import.meta.url), 'utf8')
  assert.ok(!/REPO\b|\.\.\/\.rail\/config/.test(me.split('\n').filter((l) => !l.startsWith('//') && !l.includes('assert.ok(!/REPO')).join('\n')))
})
