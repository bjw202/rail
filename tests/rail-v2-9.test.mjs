// 레일 2.9판 시험: 깨우기 교착 막기(Orca 에서 끝난 작업자), 단계 순서 검사 하나로 합치기와 시험 먼저 창 빼기,
// 기능 단위 확인 step, 리허설 실패 스스로 고치기, 뒤 마일스톤 기능 목록 미리 승인과 장면 판정 대기.
// 규칙: 저장소의 .rail/config.json 값(판 번호, autonomy)을 단언하지 않는다. 설정은 모두 임시 저장소에 만든다.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import path from 'node:path'
import { describe, test } from 'node:test'
import { RAIL, events, git, planDoc, put, runHook, state, tmp } from './helpers.mjs'

const HEAD = '| step | 맡는 쪽 | 할 일 | 고쳐도 되는 파일 | 기다리는 step | 완료 기준 | 상태 |\n|---|---|---|---|---|---|---|\n'
const DONE = '✅ 끝(2026-11-25) 됨'
const SHEET = (risks = {}) => planDoc(['M0', 'M1', 'M2', 'M3', 'M4'].map((m) => [m, ...(risks[m] ? [risks[m]] : [])]))
const BUDGET_OFF = { sinceProgress: { on: false }, milestone: { on: false } }
const ON = { railVersion: '2.9', commitPolicy: 'auto-local', autonomy: { mode: 'on', budget: BUDGET_OFF } }
const OFF = { railVersion: '2.9', commitPolicy: 'auto-local', autonomy: { mode: 'off', budget: BUDGET_OFF } }
const MIN = 60_000

function run(root, args, env = {}) {
  const base = { ...process.env }
  for (const k of ['CLAUDE_CODE_SESSION_ID', 'ORCA_AGENT_SESSION_ID', 'ORCA_TERMINAL_HANDLE', 'NODE_TEST_CONTEXT', 'RAIL_NO_TOUCH', 'RAIL_STATUSLINE_DIR']) delete base[k]
  const r = spawnSync(process.execPath, [RAIL, ...args], { encoding: 'utf8', env: { ...base, ORCA_CLI_COMMAND: '/nonexistent/orca', CLAUDE_CODE_SESSION_ID: 'rail29-leader', RAIL_ROOT: root, ...env } })
  return { code: r.status, out: r.stdout, err: r.stderr }
}
const ok = (r) => assert.equal(r.code, 0, r.err + r.out)
const status = (root) => JSON.parse(run(root, ['status', '--json']).out)
const line = (event, milestone, data = {}, ago = 0) => JSON.stringify({ t: new Date(Date.now() - ago).toISOString(), event, stage: 'milestone', milestone, ...data })

// 레일 저장소 하나. rows 는 M0 step 표 줄, st 는 상태 파일에 덧쓸 것, log 는 사건 기록 줄.
function repo({ config = ON, rows = [`| M0-1 | 기능 | 화면 열기 | src/a.mjs | 없음 | 11-24 합계가 보인다 | ⏳ 진행 중 |`], st = {}, log = [], risks = {} } = {}) {
  const root = tmp('rail29-')
  put(root, '.rail/config.json', JSON.stringify(config))
  put(root, '.rail/state.json', JSON.stringify({ project: 'demo', stage: 'milestone', milestone: 'M0', step: null, closed: [], ...st, gates: { scene_checked: {}, rehearsed: {}, ...(st.gates ?? {}) } }))
  put(root, 'docs/PLAN.md', SHEET(risks))
  put(root, 'docs/RAIL.md', '# 레일\n레일 2.9판\n')
  put(root, 'docs/plan/M0.md', `# M0\n\n${HEAD}${rows.join('\n')}\n`)
  put(root, '.rail/log.jsonl', log.map((l) => l + '\n').join(''))
  return root
}

// 가짜 Orca: 부른 인자를 calls.jsonl 에 남기고, worker-show·inbox 에 정해 둔 답을 준다.
function fakeOrca(root, { show = { state: 'succeeded', stage: 'settled' }, inbox = [] } = {}) {
  const f = path.join(root, 'fake-orca.mjs')
  put(root, 'answers.json', JSON.stringify({ show, inbox }))
  put(root, 'fake-orca.mjs', `#!/usr/bin/env node
import { appendFileSync, readFileSync } from 'node:fs'
const dir = ${JSON.stringify(root)}
const a = process.argv.slice(2)
appendFileSync(dir + '/calls.jsonl', JSON.stringify(a) + '\\n')
const ans = JSON.parse(readFileSync(dir + '/answers.json', 'utf8'))
const say = (v) => process.stdout.write(JSON.stringify(v))
if (a[1] === 'worker-show') say({ ok: true, result: { dispatchId: a[a.indexOf('--dispatch') + 1], runId: 'run_x', ...ans.show } })
else if (a[1] === 'inbox') say({ ok: true, result: { messages: ans.inbox } })
else say({ ok: true, result: {} })
`)
  spawnSync('chmod', ['+x', f])
  return { env: { ORCA_CLI_COMMAND: f }, calls: () => (existsSync(path.join(root, 'calls.jsonl')) ? readFileSync(path.join(root, 'calls.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : []) }
}
const started = (ago, step = 'M0-1') => line('worker_start', 'M0', { step, agent: 'claude', role: 'feature', terminal: 'term_w1', dispatch: 'ctx_w1' }, ago)

describe('④ 깨우기 교착: 레일 기록은 busy 인데 작업자는 Orca 에서 끝남', () => {
  test('worker-show 가 끝남(succeeded)이면 precheck 는 종료 코드 0 과 "알림 읽고 이어 가기"를 준다', () => {
    const root = repo({ log: [started(40 * MIN)] })
    const orca = fakeOrca(root)
    const r = run(root, ['next', '--precheck'], orca.env)
    assert.equal(r.code, 0, r.out + r.err)
    assert.match(r.out, /^할 일: 작업자 끝남 알림 읽고 이어 가기 — M0-1\(state succeeded/)
    assert.match(r.out, /worker done M0-1 부터/)
    assert.deepEqual(orca.calls()[0].slice(0, 4), ['orchestration', 'worker-show', '--dispatch', 'ctx_w1'])
  })

  test('worker-show 는 아직이어도 run 우편함에 그 일의 안 읽은 worker_done 이 있으면 끝난 것으로 본다', () => {
    const root = repo({ log: [started(40 * MIN)] })
    const orca = fakeOrca(root, { show: { state: 'ready', stage: 'input_accepted' }, inbox: [{ type: 'worker_done', handled: false, payload: { dispatchId: 'ctx_w1' } }] })
    const r = run(root, ['next', '--precheck'], orca.env)
    assert.equal(r.code, 0, r.out)
    assert.match(r.out, /run 우편함에 안 읽은 worker_done/)
    assert.ok(orca.calls().some((c) => c[1] === 'inbox' && c.includes('run:run_x')))
  })

  test('읽은 알림이거나 남의 일이면, 또 orca 가 없거나 실패하면 지금처럼 busy(14)', () => {
    const root = repo({ log: [started(40 * MIN)] })
    const orca = fakeOrca(root, { show: { state: 'ready', stage: 'input_accepted' }, inbox: [{ type: 'worker_done', handled: true, payload: { dispatchId: 'ctx_w1' } }, { type: 'worker_done', handled: false, payload: { dispatchId: 'ctx_other' } }] })
    const busy = run(root, ['next', '--precheck'], orca.env)
    assert.equal(busy.code, 14, busy.out)
    assert.match(busy.out, /작업자 진행 중 — M0-1/)
    assert.equal(run(root, ['next', '--precheck']).code, 14, '/nonexistent/orca')
    put(root, 'answers.json', 'not json')
    assert.equal(run(root, ['next', '--precheck'], orca.env).code, 14, '가짜 orca 가 고장 나도 busy')
  })

  test('막 띄운 작업자(5분 안)는 Orca 에 묻지 않고 busy 로 둔다', () => {
    const root = repo({ log: [started(1 * MIN)] })
    const orca = fakeOrca(root)
    assert.equal(run(root, ['next', '--precheck'], orca.env).code, 14)
    assert.deepEqual(orca.calls(), [])
  })

  test('끝난 작업자와 도는 작업자가 함께 있으면 끝난 것을 할 일로 주고 도는 것을 적는다', () => {
    const second = line('worker_start', 'M0', { step: 'M0-2', agent: 'claude', role: 'feature', terminal: 'term_w2', dispatch: 'ctx_w2' }, 2 * MIN)
    const root = repo({ log: [started(40 * MIN), second], rows: ['| M0-1 | 기능 | 가 | src/a.mjs | 없음 | 기준 | ⏳ 진행 중 |', '| M0-2 | 기능 | 나 | src/b.mjs | 없음 | 기준 | ⏳ 진행 중 |'] })
    const r = run(root, ['next', '--precheck'], fakeOrca(root).env)
    assert.equal(r.code, 0)
    assert.match(r.out, /M0-1\(state succeeded.* · 아직 도는 작업자: M0-2/)
  })
})

describe('② 덜어내기: 단계 순서 검사 하나, 시험 먼저 창 없음', () => {
  test('부품 목록에 gate:order 하나가 있고 decide·milestone·check·step-done 의 통과를 함께 센다 (기획서 판: roadmap 단계는 없어 세지 않는다)', () => {
    const log = ['roadmap', 'decide', 'milestone', 'check', 'step-done', 'step-start', 'close'].map((t) => line('gate_passed', 'M0', { target: t }))
    const root = repo({ log: [...log, line('milestone_closed', 'M0')] })
    const u = JSON.parse(run(root, ['usage', '--json']).out)
    const ids = u.parts.map((p) => p.id)
    for (const gone of ['gate:roadmap', 'gate:decide', 'gate:milestone', 'gate:check', 'gate:step-done', 'expected-failure', 'gate:step-start', 'validate', 'commit']) assert.ok(!ids.includes(gone), gone)
    for (const kept of ['gate:order', 'gate:close', 'stop-check', 'guard-tests', 'feature-check']) assert.ok(ids.includes(kept), kept)
    const order = u.parts.find((p) => p.id === 'gate:order')
    assert.deepEqual(order.by.M0, { ran: 4, blocked: 0, off: 0 })
  })

  test('step-done 도 단계 순서 검사로 센다', () => {
    const root = repo({ rows: ['| M0-1 | 구현 | 가 | src/a.mjs | 없음 | 기준 | ⏳ 진행 중 |'] })
    ok(run(root, ['step-done', 'M0-1', '--note', '됨']))
    assert.ok(events(root).some((e) => e.event === 'gate_passed' && e.target === 'step-done'))
  })

  test('시험 먼저 창이 없다: status 에 test_window 가 없고, 시험 step 중 새 시험이 실패해도 마무리 검사가 붙잡는다', () => {
    const root = repo({ rows: ['| M0-1 | 시험 | 시험 쓰기 | tests/** | 없음 | 정해진 까닭으로 실패 | |', '| M0-2 | 구현 | 만들기 | src/** | M0-1 | 통과 | |'] })
    git(root, 'init', '-q')
    git(root, 'config', 'user.email', 'rail@example.com')
    git(root, 'config', 'user.name', 'rail')
    git(root, 'add', '-A')
    git(root, 'commit', '-q', '-m', 'init')
    ok(run(root, ['step-start', 'M0-1']))
    assert.equal('test_window' in status(root), false)
    put(root, 'tests/new.test.mjs', "import { test } from 'node:test'\nimport { b } from '../src/b.mjs'\ntest('b', () => b())\n")
    const r = runHook('stop-check.mjs', { hook_event_name: 'Stop', cwd: root, stop_hook_active: false }, { RAIL_STOP_CHECK_CMD: 'node --test' })
    assert.equal(r.code, 2, r.stderr)
    assert.doesNotMatch(r.stderr, /예정된 실패/)
    ok(run(root, ['step-done', 'M0-1', '--note', '시험 씀']))
    const b = JSON.parse(readFileSync(path.join(root, '.rail/test-baseline.json'), 'utf8'))
    assert.deepEqual(Object.keys(b.files), ['tests/new.test.mjs'], '시험 step 이 끝나면 새 시험은 그대로 잠근다')
    for (const k of ['start', 'starts', 'changed', 'changed_by']) assert.equal(k in b, false, k)
  })
})

describe('① 기능 단위: 기능 작업자 뒤 확인 step', () => {
  const closed = (step, ago = 0) => line('worker_closed', 'M0', { step, terminal: 'term_x', dispatch: 'ctx_x' }, ago)
  const startedAs = (step) => line('worker_start', 'M0', { step, agent: 'claude', role: 'x', terminal: 'term_x', dispatch: 'ctx_x' }, 60 * MIN)
  const writeCheck = (root, v) => put(root, '.rail/check/M0-1.json', typeof v === 'string' ? v : JSON.stringify(v))

  test('기능 작업자가 닫히면 다음 할 일이 확인 step 이고, 확인 기록 없이는 step-done 을 거절한다', () => {
    const root = repo({ log: [startedAs('M0-1'), closed('M0-1')] })
    const next = status(root).next
    assert.match(next, /확인 step — .rail\/check\/template\.md 의 빈칸만 채워/)
    assert.match(next, /만든 작업자의 대화·보고서 해석은 넣지 않는다/)
    assert.match(next, /worker start M0-1-check --agent claude --role check/)
    const r = run(root, ['step-done', 'M0-1', '--note', '됨'])
    assert.equal(r.code, 1)
    assert.match(r.err, /확인 기록 .rail\/check\/M0-1\.json 이 없습니다/)
    const b = events(root).at(-1)
    assert.deepEqual([b.event, b.target], ['gate_blocked', 'feature-check'])
  })

  test('기능 작업자가 도는 동안과 확인 작업자가 도는 동안의 다음 할 일', () => {
    const root = repo({ log: [startedAs('M0-1')] })
    assert.match(status(root).next, /worker done M0-1 → 커밋 관문.* → 확인 step/)
    assert.match(run(root, ['step-done', 'M0-1', '--note', '됨']).err, /확인 기록 .rail\/check\/M0-1\.json 이 없습니다/, '작업자가 아직 돌아도 확인 없이 끝내지 않는다')
    put(root, '.rail/log.jsonl', [startedAs('M0-1'), closed('M0-1'), startedAs('M0-1-check')].join('\n') + '\n')
    assert.match(status(root).next, /worker done M0-1-check, 그다음 .rail\/check\/M0-1\.json 의 must/)
  })

  test('must 가 있으면 고침 step 을 내놓고, 고침 작업자가 끝나야 step-done 을 받는다', () => {
    const root = repo({ log: [startedAs('M0-1'), closed('M0-1'), startedAs('M0-1-check'), closed('M0-1-check')] })
    writeCheck(root, { must: [{ what: '빈 날에 합계가 NaN', repro: '.rail/check/M0-1/empty.test.mjs' }], nice: [] })
    assert.match(status(root).next, /고침 step — 확인이 꼭 고칠 것 1건.*worker start M0-1-fix --agent claude --role fix/)
    assert.match(status(root).next, /node --test '\.rail\/check\/M0-1\/\*\.test\.mjs'/)
    assert.match(run(root, ['step-done', 'M0-1', '--note', '됨']).err, /고침 작업자 M0-1-fix 가 끝나지 않았습니다/)
    put(root, '.rail/log.jsonl', readFileSync(path.join(root, '.rail/log.jsonl'), 'utf8') + [startedAs('M0-1-fix'), closed('M0-1-fix')].join('\n') + '\n')
    assert.match(status(root).next, /확인 끝\(must 1건, nice 0건\).*step-done M0-1/)
    ok(run(root, ['step-done', 'M0-1', '--note', '됨']))
    assert.ok(events(root).some((e) => e.event === 'gate_passed' && e.target === 'feature-check'))
  })

  test('must 가 없으면 바로 끝낼 수 있고, 읽지 못하는 기록은 거절한다', () => {
    const root = repo({ log: [startedAs('M0-1'), closed('M0-1')] })
    writeCheck(root, '{"must": "없음"}')
    assert.match(run(root, ['step-done', 'M0-1', '--note', '됨']).err, /M0-1\.json 을 읽지 못했습니다/)
    writeCheck(root, { must: [], nice: [{ what: '글자 크기' }] })
    ok(run(root, ['step-done', 'M0-1', '--note', '됨']))
  })

  test('예전 역할 방식(구현 줄)은 확인 step 없이 그대로 끝나고, feature-check 를 끄면 기능 줄도 그렇다', () => {
    ok(run(repo({ rows: ['| M0-1 | 구현 | 가 | src/a.mjs | 없음 | 기준 | ⏳ 진행 중 |'] }), ['step-done', 'M0-1', '--note', '됨']))
    const root = repo({ config: { ...ON, disabled: ['feature-check'] } })
    ok(run(root, ['step-done', 'M0-1', '--note', '됨']))
  })

  test('새 표를 만들 때의 안내는 기능 목록이 기본이다', () => {
    const root = repo()
    rmSync(path.join(root, 'docs/plan/M0.md'))
    assert.match(status(root).next, /기본은 기능 목록: 줄 하나가 사용자가 알아볼 기능 하나\(맡는 쪽 "기능"/)
  })

  test('확인 작업자의 재현 시험 폴더(.rail/check/<step>/)는 node --test 가 저절로 돌리지 않는다', () => {
    const root = tmp('rail29n-')
    put(root, 'tests/ok.test.mjs', "import { test } from 'node:test'\ntest('ok', () => {})\n")
    put(root, '.rail/check/M0-1/fail.test.mjs', "import { test } from 'node:test'\ntest('fail', () => { throw new Error('재현') })\n")
    const env = { ...process.env }
    delete env.NODE_TEST_CONTEXT
    const all = spawnSync(process.execPath, ['--test'], { cwd: root, encoding: 'utf8', env })
    assert.equal(all.status, 0, all.stdout)
    const only = spawnSync(process.execPath, ['--test', '.rail/check/M0-1/*.test.mjs'], { cwd: root, encoding: 'utf8', env })
    assert.equal(only.status, 1)
    assert.match(only.stdout, /재현/)
  })
})

// check 단계의 M0: step 모두 끝, 리허설 기록 rh.
function checkRepo({ config = ON, rh, st = {}, log = [] } = {}) {
  return repo({ config, rows: [`| M0-1 | 기능 | 가 | src/a.mjs | 없음 | 기준 | ${DONE} |`], st: { stage: 'check', ...st, gates: { rehearsed: { M0: rh }, ...(st.gates ?? {}) } }, log })
}
const FAIL1 = { total: 2, pass: 1, failed: [{ id: '1', check: '합계가 보인다', saw: '$0.00' }], at: '2026-11-25T00:00:00Z' }

describe('③(가) 리허설 실패 스스로 고치기', () => {
  test('자율 모드에서 기계로 가릴 실패면 사람에게 묻기 전에 스스로 고치기를 내놓고, reopen --self-fix 가 되돌린다', () => {
    const root = checkRepo({ rh: FAIL1 })
    assert.match(status(root).next, /^스스로 고치기 \(1\/2\) — 리허설 실패 1 .*reopen --self-fix/)
    ok(run(root, ['reopen', '--self-fix']))
    assert.equal(state(root).stage, 'milestone')
    const e = events(root).at(-1)
    assert.deepEqual([e.event, e.self_fix, e.failed[0].id], ['milestone_reopened', 1, '1'])
    assert.match(status(root).next, /^고칠 줄 더하기 — 스스로 고치기 1번째, 리허설 실패 1\(합계가 보인다\).*맡는 쪽 "고침" 줄/)
  })

  test('두 번 고친 뒤, 취향·판단 항목이 있으면, 자율 모드가 아니면 사람에게 보인다', () => {
    const twice = [1, 2].map((n) => line('milestone_reopened', 'M0', { self_fix: n, failed: FAIL1.failed }))
    const human = /^리허설 결과\(스크린샷 2장, 통과 1\/2, 실패 1 먼저\)/
    assert.match(status(checkRepo({ rh: FAIL1, log: twice })).next, human)
    const taste = { ...FAIL1, failed: [{ ...FAIL1.failed[0], judge: 'taste' }] }
    assert.match(status(checkRepo({ rh: taste })).next, human)
    const off = checkRepo({ rh: FAIL1, config: OFF })
    assert.match(status(off).next, human)
    const r = run(off, ['reopen', '--self-fix'])
    assert.equal(r.code, 1)
    assert.match(r.err, /\[스스로 고치기\] 할 수 없습니다/)
  })

  test('rehearsal-record 는 취향 항목의 judge 를 남긴다', () => {
    const root = checkRepo({ rh: undefined, st: { gates: { rehearsed: {} } } })
    put(root, '.rail/rehearsal/M0/0.png', 'png')
    put(root, '.rail/rehearsal/M0/result.json', JSON.stringify({ items: [{ id: '0', check: '오늘 빌드', result: 'pass', saw: '09:00', shot: '0.png' }, { id: '1', check: '색이 보기 좋다', result: 'fail', saw: '너무 진함', shot: '0.png', judge: 'taste' }] }))
    ok(run(root, ['rehearsal-record', 'M0']))
    assert.deepEqual(state(root).gates.rehearsed.M0.failed[0].judge, 'taste')
  })
})

describe('③(나) 기능 목록 미리 승인과 장면 판정 대기', () => {
  const PLAN = `${HEAD}| M1-1 | 기능 | 가 | src/a.mjs | 없음 | 기준 | |\n`

  test('뒤 마일스톤 표는 승인 전에는 위반(승인 방법 안내)이고, 사람 말과 함께 plan approve 하면 위반이 아니다', () => {
    const root = repo()
    put(root, 'docs/plan/M1.md', PLAN)
    put(root, 'docs/plan/M2.md', PLAN.replace(/M1-1/g, 'M2-1'))
    assert.match(status(root).next, /관문 위반 — docs\/plan\/M1\.md: .*다음 마일스톤 밖의 step 표는 만들지 않습니다 \(사람이 미리 승인했으면 plan approve M1/)
    assert.equal(run(root, ['plan', 'approve', 'M1', 'M2']).code, 2, '사람 말이 없으면 사용법 오류')
    ok(run(root, ['plan', 'approve', 'M1', 'M2', '--said', 'M1, M2 기능 목록 이대로 승인']))
    assert.deepEqual(Object.keys(state(root).gates.plan_approved), ['M1', 'M2'])
    assert.equal(state(root).gates.plan_approved.M1.said, 'M1, M2 기능 목록 이대로 승인')
    assert.doesNotMatch(status(root).next, /관문 위반/)
    assert.equal(events(root).at(-1).event, 'plan_approved')
  })

  test('다음 3개 밖, 표 없음, 착수 전 미결정이면 승인을 거절한다', () => {
    const root = repo({ risks: { M2: 'D-05' } })
    put(root, 'docs/plan/M2.md', PLAN.replace(/M1-1/g, 'M2-1'))
    put(root, 'docs/plan/M4.md', PLAN.replace(/M1-1/g, 'M4-1'))
    const r = run(root, ['plan', 'approve', 'M1', 'M2', 'M4', '--said', '승인'])
    assert.equal(r.code, 1)
    assert.match(r.err, /M1: docs\/plan\/M1\.md 에 기능 줄이 없습니다/)
    assert.match(r.err, /M2: 착수 전 D-05 가 풀리지 않았습니다/)
    assert.match(r.err, /M4: 지금 마일스톤 뒤의 안 닫힌 마일스톤 3개\(M1, M2, M3\) 안에 없습니다/)
    assert.equal(state(root).gates.plan_approved, undefined)
  })

  test('자율 모드 + 리허설 모두 통과 + 다음 마일스톤 승인됨이면 판정 대기로 닫고 승인된 다음 마일스톤을 시작한다', () => {
    const PASS = { total: 3, pass: 3, failed: [], at: '2026-11-25T00:00:00Z' }
    const root = checkRepo({ rh: PASS, st: { gates: { plan_approved: { M1: { at: 'x', said: '승인' } } } } })
    put(root, 'docs/plan/M1.md', PLAN)
    assert.match(status(root).next, /^장면 판정 대기로 닫기 — 리허설 3\/3 통과, 다음 M1 미리 승인됨/)
    const r = run(root, ['advance', 'close'])
    ok(r)
    assert.match(r.out, /M0 를 사람 장면 판정 없이 닫고 판정 대기 목록에 올립니다/)
    let s = state(root)
    assert.deepEqual([s.stage, s.milestone, s.closed], ['decide', 'M1', ['M0']])
    assert.deepEqual(s.gates.scene_pending.M0.rehearsal, { pass: 3, total: 3 })
    assert.match(status(root).waiting, /사람 장면 판정 대기: M0/)
    ok(run(root, ['advance', 'milestone']))
    assert.equal(state(root).stage, 'milestone')
    assert.match(status(root).next, /step M1-1 진행 — 먼저 step-start M1-1/)
    // 사람이 돌아와 판정한다. 안 됨이면 자율 모드가 멈추고, 됨으로 다시 남기면 풀린다.
    ok(run(root, ['scene', 'M0', '--result', 'fail', '--note', '합계 글자가 잘림']))
    s = state(root)
    assert.equal(s.gates.scene_pending.M0, undefined)
    assert.equal(s.gates.scene_checked.M0.result, 'fail')
    const stop = JSON.parse(run(root, ['next', '--json']).out).stop
    assert.equal(stop.code, 'human')
    assert.match(stop.reason, /판정 대기였던 M0 의 장면을 사람이 안 됨으로 판정했습니다/)
    assert.match(status(root).next, /^앞 마일스톤 장면 실패 — M0: "합계 글자가 잘림"/)
    ok(run(root, ['scene', 'M0', '--result', 'pass', '--note', '고친 뒤 봄']))
    assert.equal(JSON.parse(run(root, ['next', '--json']).out).stop, null)
  })

  test('승인된 다음 마일스톤이 없거나, 리허설 실패가 있거나, 자율 모드가 아니면 지금처럼 장면 판정 없이는 닫지 않는다', () => {
    const PASS = { total: 1, pass: 1, failed: [], at: 'x' }
    const approved = { gates: { plan_approved: { M1: { at: 'x', said: '승인' } } } }
    for (const root of [checkRepo({ rh: PASS }), checkRepo({ rh: FAIL1, st: approved, log: [1, 2].map((n) => line('milestone_reopened', 'M0', { self_fix: n })) }), checkRepo({ rh: PASS, st: approved, config: OFF })]) {
      const r = run(root, ['advance', 'close'])
      assert.equal(r.code, 1, r.out)
      assert.match(r.err, /M0 의 사람 장면 확인 기록이 없습니다/)
    }
  })
})
