// 레일 2.2판 시험: 자율 모드 정책(사람만, 커밋 정책 auto-local 일 때만), 시작 승인 없는 step 시작(auto_start),
// next 의 멈춤 까닭(done, human, busy, same_failure, off, budget, error)과 --precheck 종료 코드, autonomy_stop 은 바뀔 때만,
// worker start/done 이 가짜 Orca CLI 를 workers.md 차례대로 부르고 기록을 남김, 동시에 불려도 잠금으로 기록이 깨지지 않음.
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { describe, test } from 'node:test'
import { GOOD_PLAN, RAIL, denied, events, git, makeRepo, planDoc, put, runHook, state, tmp } from './helpers.mjs'

const HEAD = '| step | 맡는 쪽 | 할 일 | 고쳐도 되는 파일 | 기다리는 step | 완료 기준 | 상태 |\n|---|---|---|---|---|---|---|\n'
const PLAN = planDoc([['M0']])
const ON = { commitPolicy: 'auto-local', autonomy: { mode: 'on' } }

// 바깥 세션 정보와 진짜 Orca 를 지운 환경으로 rail.mjs 를 부른다.
function cleanEnv(extra = {}) {
  const env = { ...process.env, ...extra }
  for (const k of ['CLAUDE_CODE_SESSION_ID', 'ORCA_AGENT_SESSION_ID', 'ORCA_TERMINAL_HANDLE', 'NODE_TEST_CONTEXT', 'RAIL_NO_TOUCH']) if (!(k in extra)) delete env[k]
  if (!('ORCA_CLI_COMMAND' in extra)) env.ORCA_CLI_COMMAND = '/nonexistent/orca'
  return env
}
function run(root, args, env = {}) {
  const r = spawnSync(process.execPath, [RAIL, ...args], { encoding: 'utf8', env: { ...cleanEnv(env), RAIL_ROOT: root } })
  return { code: r.status, out: r.stdout, err: r.stderr }
}
function runAsync(root, args, env = {}) {
  return new Promise((resolve) => {
    const c = spawn(process.execPath, [RAIL, ...args], { env: { ...cleanEnv(env), RAIL_ROOT: root } })
    let out = ''
    let err = ''
    c.stdout.on('data', (d) => (out += d))
    c.stderr.on('data', (d) => (err += d))
    c.on('close', (code) => resolve({ code, out, err }))
  })
}
const ok = (r) => assert.equal(r.code, 0, r.err + r.out)
const names = (root) => (existsSync(path.join(root, '.rail/log.jsonl')) ? events(root).map((e) => e.event) : [])

// milestone 단계의 M0 저장소. rows 는 step 표 줄, config 는 .rail/config.json.
function milestoneRoot(config = {}, rows = ['| M0-1 | 구현 | 일 | src/a.mjs | | 기준 | |'], st = {}) {
  const root = tmp('rail22-')
  put(root, '.rail/config.json', JSON.stringify(config))
  put(root, '.rail/state.json', JSON.stringify({ project: 'demo', stage: 'milestone', milestone: 'M0', step: null, closed: [], gates: { scene_checked: {} }, ...st }))
  put(root, 'docs/PLAN.md', PLAN)
  put(root, 'docs/plan/M0.md', `# M0\n\n${HEAD}${rows.join('\n')}\n`)
  return root
}
// 가짜 비용 명령: 끝이 정해진 구간(지난 마일스톤)은 past, 끝이 열린 구간(지금까지)은 open 달러를 낸다.
function fakeCost(root, past, open) {
  put(root, 'fake-cost.mjs', `import { readFileSync } from 'node:fs'\nconst { intervals } = JSON.parse(readFileSync(0, 'utf8'))\nprocess.stdout.write(JSON.stringify({ usd: intervals.map((iv) => (iv.to ? ${past} : ${open})) }))\n`)
  return `node ${JSON.stringify(path.join(root, 'fake-cost.mjs'))}`
}
const budgetConfig = (cmd, rules = {}) => ({ commitPolicy: 'auto-local', autonomy: { mode: 'on', budget: { costCommand: cmd, ...rules } } })
const next = (root, env) => {
  const r = run(root, ['next', '--json'], env)
  ok(r)
  return JSON.parse(r.out)
}
const precheck = (root, env) => run(root, ['next', '--precheck'], env)

describe('자율 모드 정책', () => {
  test('기본은 off 이다', () => {
    const root = milestoneRoot({})
    assert.match(run(root, ['policy']).out, /autonomy\.mode\): off/)
    assert.deepEqual(JSON.parse(run(root, ['status', '--json']).out).autonomy, { mode: 'off', effective: false })
  })

  test('커밋 정책이 ask 면 자율 모드 켜기를 거절하고 config 를 바꾸지 않는다', () => {
    const root = milestoneRoot({ commitPolicy: 'ask' })
    const r = run(root, ['policy', 'set', 'autonomy', 'on', '--said', '자율 모드 켜'])
    assert.equal(r.code, 1)
    assert.match(r.err, /자율 모드를 켤 수 없습니다/)
    assert.equal(JSON.parse(readFileSync(path.join(root, '.rail/config.json'), 'utf8')).autonomy, undefined)
    assert.ok(names(root).includes('policy_refused'))
    assert.ok(!names(root).includes('policy_change'))
  })

  test('auto-local 이면 켜고 policy_change 를 남기며, 켜진 동안 커밋 정책을 ask 로 바꾸지 못한다', () => {
    const root = milestoneRoot({ commitPolicy: 'auto-local' })
    ok(run(root, ['policy', 'set', 'autonomy', 'on', '--said', '자율 모드 켜']))
    const c = JSON.parse(readFileSync(path.join(root, '.rail/config.json'), 'utf8'))
    assert.equal(c.autonomy.mode, 'on')
    assert.equal(c.autonomy.budget.sinceProgress.usd, 10)
    const pc = events(root).find((e) => e.event === 'policy_change')
    assert.deepEqual([pc.key, pc.from, pc.to, pc.said], ['autonomy.mode', 'off', 'on', '자율 모드 켜'])
    assert.equal(run(root, ['policy', 'set', 'commit', 'ask']).code, 1)
    ok(run(root, ['policy', 'set', 'autonomy', 'off', '--said', '꺼']))
    ok(run(root, ['policy', 'set', 'commit', 'ask']))
  })
})

describe('시작 승인 없는 step 시작', () => {
  test('자율 모드가 켜져 있으면 첫 step-start 가 auto_start 를 한 번 남긴다', () => {
    const root = milestoneRoot(ON, ['| M0-1 | 구현 | 일 | src/a.mjs | 없음 | 기준 | |', '| M0-2 | 구현 | 일 | src/b.mjs | 없음 | 기준 | |'])
    const r = run(root, ['step-start', 'M0-1'])
    ok(r)
    assert.match(r.out, /시작 승인을 묻지 않고 M0 를 시작했습니다/)
    ok(run(root, ['step-start', 'M0-2']))
    const auto = events(root).filter((e) => e.event === 'auto_start')
    assert.equal(auto.length, 1)
    assert.deepEqual([auto[0].milestone, auto[0].step, auto[0].steps], ['M0', 'M0-1', ['M0-1', 'M0-2']])
    assert.ok(!names(root).includes('human_ask'))
  })

  test('꺼져 있거나 커밋 정책이 ask 면 auto_start 를 남기지 않는다', () => {
    const off = milestoneRoot({ commitPolicy: 'auto-local' })
    ok(run(off, ['step-start', 'M0-1']))
    assert.ok(!names(off).includes('auto_start'))
    const ask = milestoneRoot({ commitPolicy: 'ask', autonomy: { mode: 'on' } })
    ok(run(ask, ['step-start', 'M0-1']))
    assert.ok(!names(ask).includes('auto_start'))
  })
})

describe('next 의 멈춤 까닭과 --precheck', () => {
  test('할 일이 있으면 stop 이 null 이고 precheck 는 0 으로 끝나며 한 줄을 낸다', () => {
    const root = milestoneRoot(budgetConfig(fakeCost(tmp(), 1, 1)))
    const res = next(root)
    assert.equal(res.stop, null)
    assert.match(res.action, /M0-1/)
    const p = precheck(root)
    assert.equal(p.code, 0, p.out + p.err)
    assert.equal(p.out.trim().split('\n').length, 1)
    assert.match(p.out, /^할 일: /)
  })

  test('done: 모든 마일스톤이 닫혔다 (종료 코드 10)', () => {
    const root = milestoneRoot(ON, undefined, { stage: 'done', milestone: null, closed: ['M0'] })
    assert.equal(next(root).stop.code, 'done')
    const p = precheck(root)
    assert.equal(p.code, 10)
    assert.match(p.out, /^멈춤\(done\)/)
  })

  test('human: 사람의 답을 기다린다 (종료 코드 11)', () => {
    const root = milestoneRoot(ON, undefined, { human_ask: { q: 'D-08 은 A/B 중 무엇으로 할까요?', kind: 'decide', at: new Date().toISOString() } })
    const res = next(root)
    assert.equal(res.stop.code, 'human')
    assert.match(res.stop.reason, /D-08/)
    assert.equal(precheck(root).code, 11)
  })

  test('off: 자율 모드가 꺼져 있으면 비용을 읽지 않고 멈춘다 (종료 코드 16)', () => {
    const root = milestoneRoot({ commitPolicy: 'auto-local', autonomy: { mode: 'off', budget: { costCommand: 'exit 9' } } })
    const res = next(root)
    assert.equal(res.stop.code, 'off')
    assert.equal(res.budget, undefined)
    assert.equal(precheck(root).code, 16)
  })

  test('budget: 마지막 진척 뒤 지출이 상한을 넘으면 멈춘다 (종료 코드 12)', () => {
    const root = milestoneRoot(budgetConfig(fakeCost(tmp(), 0, 12), { sinceProgress: { on: true, usd: 10 }, milestone: { on: false } }))
    const res = next(root)
    assert.equal(res.stop.code, 'budget')
    assert.match(res.stop.reason, /\$12\.00.*상한 \$10\.00/)
    assert.equal(res.budget.since_progress.spent, 12)
    assert.equal(precheck(root).code, 12)
    const under = milestoneRoot(budgetConfig(fakeCost(tmp(), 0, 9), { milestone: { on: false } }))
    assert.equal(next(under).stop, null)
  })

  test('budget: 지금 마일스톤 지출이 지난 마일스톤 비용 중간값의 K배를 넘으면 멈춘다', () => {
    const make = (open) => {
      const root = milestoneRoot(budgetConfig(fakeCost(tmp(), 5, open), { sinceProgress: { on: false }, milestone: { on: true, times: 3 } }), undefined, { closed: [] })
      const t = (h) => `2026-11-24T0${h}:00:00.000Z`
      put(root, '.rail/log.jsonl', [
        { t: t(1), event: 'stage_advance', milestone: 'X0' },
        { t: t(2), event: 'milestone_closed', milestone: 'X0' },
        { t: t(3), event: 'milestone_closed', milestone: 'X1' }
      ].map((e) => JSON.stringify(e)).join('\n') + '\n')
      return root
    }
    const over = next(make(16))
    assert.equal(over.stop.code, 'budget')
    assert.equal(over.budget.milestone.limit, 15)
    assert.deepEqual(over.budget.milestone.past.map((p) => p.milestone), ['X0', 'X1'])
    assert.match(over.stop.reason, /중간값 \$5\.00 의 3배 \$15\.00/)
    assert.equal(next(make(14)).stop, null)
  })

  test('budget: 하루 상한은 켰을 때만 본다', () => {
    const cmd = fakeCost(tmp(), 0, 30)
    const off = milestoneRoot(budgetConfig(cmd, { sinceProgress: { on: false }, milestone: { on: false } }))
    assert.equal(next(off).stop, null)
    const on = milestoneRoot(budgetConfig(cmd, { sinceProgress: { on: false }, milestone: { on: false }, daily: { on: true, usd: 25 } }))
    assert.equal(next(on).stop.code, 'budget')
  })

  test('비용을 읽지 못하면 안전한 쪽으로 멈춘다 (error, 종료 코드 15)', () => {
    for (const cmd of ['exit 3', 'echo not-json', `node -e "process.stdout.write(JSON.stringify({usd:[]}))"`, 'node /nonexistent/cost.mjs']) {
      const root = milestoneRoot(budgetConfig(cmd))
      const res = next(root)
      assert.equal(res.stop?.code, 'error', cmd)
      assert.match(res.stop.reason, /비용 읽기 실패/)
      assert.equal(precheck(root).code, 15)
    }
  })

  test('비용 명령이 비었으면 예산 규칙을 쓰지 않고 멈추지 않는다. status 는 경고 한 줄을 낸다', () => {
    const root = milestoneRoot(budgetConfig(''))
    const res = next(root)
    assert.equal(res.stop, null)
    assert.match(res.budget.note, /비용 명령\(autonomy\.budget\.costCommand\)이 비어 예산 규칙을 쓰지 않습니다/)
    assert.equal(precheck(root).code, 0)
    assert.match(run(root, ['next']).out, /^할 일: .*\n  비용 명령/)
    assert.match(run(root, ['status']).out, /\n\[경고\] 비용 명령\(autonomy\.budget\.costCommand\)이 비어/)
    assert.doesNotMatch(run(milestoneRoot(budgetConfig(fakeCost(tmp(), 0, 1))), ['status']).out, /\[경고\] 비용 명령/)
  })

  test('same_failure: 마무리 검사의 같은 실패 지문이 maxSameFailure 번 이어지면 멈춘다 (종료 코드 13)', () => {
    const make = (count) => {
      const root = milestoneRoot(budgetConfig(fakeCost(tmp(), 0, 0)))
      git(root, 'init', '-q')
      put(root, '.git/rail-stop-check.json', JSON.stringify({ failSig: 'abcdef1234', failCount: count }))
      return root
    }
    const res = next(make(3))
    assert.equal(res.stop.code, 'same_failure')
    assert.match(res.stop.reason, /3번/)
    assert.equal(precheck(make(3)).code, 13)
    assert.equal(next(make(2)).stop, null)
  })

  test('busy: 다른 세션의 작업 중 표시가 최근이면 멈추고, 오래됐으면 멈추지 않는다 (종료 코드 14)', () => {
    const cmd = fakeCost(tmp(), 0, 0)
    const at = (min) => new Date(Date.now() - min * 60_000).toISOString()
    const recent = milestoneRoot(budgetConfig(cmd), undefined, { busy: { who: 'claude:other', at: at(5), cmd: 'status' } })
    const res = next(recent)
    assert.equal(res.stop.code, 'busy')
    assert.match(res.stop.reason, /claude:other/)
    assert.equal(precheck(recent).code, 14)
    const old = milestoneRoot(budgetConfig(cmd), undefined, { busy: { who: 'claude:other', at: at(30), cmd: 'status' } })
    assert.equal(next(old).stop, null)
    // 자기 세션의 표시는 next 에서는 멈춤이 아니지만, 바깥에서 보는 precheck 에서는 멈춤이다.
    assert.equal(next(recent, { CLAUDE_CODE_SESSION_ID: 'other' }).stop, null)
    assert.equal(precheck(recent, { CLAUDE_CODE_SESSION_ID: 'other' }).code, 14)
  })

  test('레일 명령은 작업 중 표시를 갱신하고, next 는 갱신하지 않는다', () => {
    const root = milestoneRoot(ON)
    run(root, ['next', '--json'], { CLAUDE_CODE_SESSION_ID: 'leader-1' })
    assert.equal(state(root).busy, undefined)
    ok(run(root, ['status'], { CLAUDE_CODE_SESSION_ID: 'leader-1' }))
    assert.equal(state(root).busy.who, 'claude:leader-1')
    assert.ok(Date.now() - Date.parse(state(root).busy.at) < 60_000)
    ok(run(root, ['status'], { CLAUDE_CODE_SESSION_ID: 'leader-1', RAIL_NO_TOUCH: '1' }))
    ok(run(root, ['step-start', 'M0-1'], { ORCA_AGENT_SESSION_ID: 'w-2' }))
    assert.equal(state(root).busy.who, 'orca:w-2')
    assert.match(state(root).busy.cmd, /^step-start M0-1/)
  })

  test('busy: 닫지 않은 작업자가 있으면 "작업자 진행 중" 으로 멈추고, 닫으면 풀린다', () => {
    const root = milestoneRoot(budgetConfig(fakeCost(tmp(), 0, 0)))
    put(root, '.rail/log.jsonl', JSON.stringify({ t: new Date().toISOString(), event: 'worker_start', milestone: 'M0', step: 'M0-1', agent: 'claude', role: 'impl', terminal: 'term_a', dispatch: 'ctx_a' }) + '\n')
    const res = next(root)
    assert.equal(res.stop.code, 'busy')
    assert.match(res.stop.reason, /작업자 진행 중 — M0-1\(claude, impl\)/)
    assert.equal(precheck(root).code, 14)
    put(root, '.rail/log.jsonl', readFileSync(path.join(root, '.rail/log.jsonl'), 'utf8') + JSON.stringify({ t: new Date().toISOString(), event: 'worker_closed', milestone: 'M0', step: 'M0-1' }) + '\n')
    assert.equal(next(root).stop, null)
  })

  test('autonomy_stop 은 멈춤 까닭이 바뀔 때만 남는다 (precheck 를 여러 번 불러도 쌓이지 않음)', () => {
    const root = milestoneRoot(ON, undefined, { human_ask: { q: '고를까요?', kind: 'decide', at: new Date().toISOString() } })
    for (let i = 0; i < 3; i++) precheck(root)
    let stops = events(root).filter((e) => e.event === 'autonomy_stop')
    assert.deepEqual(stops.map((e) => e.code), ['human'])
    put(root, '.rail/config.json', JSON.stringify({ commitPolicy: 'auto-local', autonomy: { mode: 'off' } }))
    precheck(root)
    precheck(root)
    stops = events(root).filter((e) => e.event === 'autonomy_stop')
    assert.deepEqual(stops.map((e) => e.code), ['human'], '사람 답을 기다리는 동안은 꺼져도 까닭이 human 그대로다')
    const st = state(root)
    st.human_ask = null
    put(root, '.rail/state.json', JSON.stringify(st))
    precheck(root)
    precheck(root)
    stops = events(root).filter((e) => e.event === 'autonomy_stop')
    assert.deepEqual(stops.map((e) => e.code), ['human', 'off'])
    assert.ok(!names(root).some((n) => /precheck|next/.test(n)))
  })
})

// 가짜 Orca CLI: 부른 인자를 calls.jsonl 에 남기고, 창 배치를 layout.json 에 들고 나누기·닫기를 반영한다.
function fakeOrca(root, { show = { state: 'succeeded', stage: 'settled' }, workerStart = 'ok', delayMs = 0 } = {}) {
  const dir = path.join(root, 'fake')
  put(root, 'fake/layout.json', JSON.stringify({ type: 'terminal', handle: 'term_leader', title: '리더' }))
  put(root, 'fake/show.json', JSON.stringify(show))
  const body = `#!/usr/bin/env node
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs'
const dir = ${JSON.stringify(dir)}
const args = process.argv.slice(2)
appendFileSync(dir + '/calls.jsonl', JSON.stringify(args) + '\\n')
const opt = (k) => args[args.indexOf(k) + 1]
const say = (o) => process.stdout.write(JSON.stringify(o))
const layout = () => JSON.parse(readFileSync(dir + '/layout.json', 'utf8'))
const save = (t) => writeFileSync(dir + '/layout.json', JSON.stringify(t))
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
const [a, b] = args
if (a === 'terminal' && b === 'list') say({ ok: true, result: { terminals: [], visualLayouts: [{ root: { type: 'group', tabs: [{ tabId: 'tab1', panes: layout() }] } }] } })
else if (a === 'terminal' && b === 'split') {
  sleep(${delayMs})
  const h = 'term_w' + Math.random().toString(16).slice(2, 8)
  const put = (n) => (n.handle === opt('--terminal') ? { type: 'pane-split', direction: opt('--direction'), first: n, second: { type: 'terminal', handle: h, title: '' } } : n.first ? { ...n, first: put(n.first), second: put(n.second) } : n)
  save(put(layout()))
  say({ ok: true, result: { split: { handle: h, tabId: 'tab1', leafId: 'leaf' } } })
} else if (a === 'terminal' && b === 'close') {
  const drop = (n) => (n.first ? (n.first.handle === opt('--terminal') ? n.second : n.second.handle === opt('--terminal') ? n.first : { ...n, first: drop(n.first), second: drop(n.second) }) : n)
  save(drop(layout()))
  say({ ok: true, result: { close: { handle: opt('--terminal') } } })
} else if (a === 'terminal') say({ ok: true, result: { wait: { satisfied: true } } })
else if (a === 'orchestration' && b === 'worker-start') {
  sleep(${delayMs})
  if (${JSON.stringify(workerStart)} !== 'ok') { process.stderr.write('Error: omit --on and --terminal'); process.exit(1) }
  say({ ok: true, result: { dispatchId: 'ctx_' + opt('--terminal').slice(5), terminal: opt('--terminal') } })
} else if (a === 'orchestration' && b === 'worker-read') say({ ok: true, result: { report: '작업 끝: 시험 3개 통과' } })
else if (a === 'orchestration' && b === 'worker-show') say({ ok: true, result: JSON.parse(readFileSync(dir + '/show.json', 'utf8')) })
else { process.stderr.write('알 수 없는 명령'); process.exit(2) }
`
  put(root, 'fake/orca.mjs', body)
  spawnSync('chmod', ['+x', path.join(dir, 'orca.mjs')])
  const calls = () => (existsSync(path.join(dir, 'calls.jsonl')) ? readFileSync(path.join(dir, 'calls.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : [])
  return { env: { ORCA_CLI_COMMAND: path.join(dir, 'orca.mjs'), ORCA_TERMINAL_HANDLE: 'term_leader' }, calls, layout: () => JSON.parse(readFileSync(path.join(dir, 'layout.json'), 'utf8')) }
}
const PAR = ['| M0-1 | 시험 | 일 | tests/m0-a.test.mjs | 없음 | 기준 | |', '| M0-2a | 구현 | 일 | src/a.mjs | 없음 | 기준 | |', '| M0-2b | 구현 | 일 | src/b.mjs | 없음 | 기준 | |', '| M0-3 | 마지막 리뷰 | 일 | .rail/review/M0-3.json | | 기준 | |']
function workerRoot(fake = {}) {
  const root = milestoneRoot({ commitPolicy: 'auto-local', codexRoles: ['final-review'] }, PAR)
  for (const s of ['M0-1', 'M0-2a', 'M0-2b', 'M0-3']) put(root, `.orchestration/${s}-spec.md`, `# ${s} 짧은 일\n\n할 일\n`)
  return { root, orca: fakeOrca(root, fake) }
}
// PATH 에 codex 하나만 있는 폴더(진짜 codex 가 없는 컴퓨터에서도 같게).
const fakeCodex = (root) => (put(root, 'bin-codex/codex', ''), put(root, 'bin-codex/codex.cmd', ''), path.join(root, 'bin-codex'))
const sub = (calls, a, b) => calls.filter((c) => c[0] === a && c[1] === b)
const opt = (c, k) => c[c.indexOf(k) + 1]

describe('worker start / done', () => {
  test('worker start 는 리더 창을 좌우로 나눠 Claude 를 띄우고, 이름·준비·일 맡기기를 부른 뒤 worker_start 를 남긴다', () => {
    const { root, orca } = workerRoot()
    ok(run(root, ['step-start', 'M0-1'], orca.env))
    const r = run(root, ['worker', 'start', 'M0-1', '--agent', 'claude', '--role', 'test'], orca.env)
    ok(r)
    const calls = orca.calls()
    const [split] = sub(calls, 'terminal', 'split')
    assert.equal(opt(split, '--terminal'), 'term_leader')
    assert.equal(opt(split, '--direction'), 'vertical')
    assert.equal(opt(split, '--command'), "claude --model opus --dangerously-skip-permissions --name 'M0-1 짧은 일'")
    const term = orca.layout().second.handle
    assert.equal(opt(sub(calls, 'terminal', 'set-pane-title')[0], '--title'), 'M0-1 짧은 일')
    assert.equal(opt(sub(calls, 'terminal', 'wait')[0], '--for'), 'tui-idle')
    const [ws] = sub(calls, 'orchestration', 'worker-start')
    assert.deepEqual([opt(ws, '--terminal'), opt(ws, '--worktree'), opt(ws, '--task-title'), opt(ws, '--spec-file')], [term, 'current', 'M0-1 짧은 일', path.join(root, '.orchestration/M0-1-spec.md')])
    const w = events(root).find((e) => e.event === 'worker_start')
    assert.deepEqual([w.step, w.agent, w.role, w.terminal, w.dispatch, w.milestone], ['M0-1', 'claude', 'test', term, `ctx_${term.slice(5)}`, 'M0'])
    assert.equal(next(root, orca.env).stop.code, 'busy')
  })

  test('여러 step 을 한 번에 띄우면 균형 규칙대로 두 번째는 작업자 창을 위아래로 나눈다', () => {
    const { root, orca } = workerRoot()
    ok(run(root, ['step-start', 'M0-2a'], orca.env))
    ok(run(root, ['step-start', 'M0-2b'], orca.env))
    ok(run(root, ['worker', 'start', 'M0-2a', 'M0-2b', '--agent', 'claude', '--role', 'impl'], orca.env))
    const splits = sub(orca.calls(), 'terminal', 'split')
    assert.equal(splits.length, 2)
    assert.equal(opt(splits[0], '--terminal'), 'term_leader')
    assert.notEqual(opt(splits[1], '--terminal'), 'term_leader')
    assert.equal(opt(splits[1], '--direction'), 'horizontal')
    const starts = events(root).filter((e) => e.event === 'worker_start')
    assert.deepEqual(starts.map((e) => e.step), ['M0-2a', 'M0-2b'])
    assert.equal(new Set(starts.map((e) => e.terminal)).size, 2)
  })

  test('Codex 는 업데이트 안내를 끄는 인자를 붙인다', () => {
    const { root, orca } = workerRoot()
    ok(run(root, ['step-start', 'M0-1'], orca.env))
    const r = run(root, ['worker', 'start', 'M0-1', '--agent', 'codex', '--role', 'test'], { ...orca.env, PATH: fakeCodex(root) })
    ok(r)
    assert.equal(opt(sub(orca.calls(), 'terminal', 'split')[0], '--command'), 'codex --dangerously-bypass-approvals-and-sandbox -c check_for_update_on_startup=false')
  })

  test('codex 가 PATH 에 없으면 Claude 작업자로 대신 띄우고 경고와 codex_missing 을 남긴다', () => {
    const { root, orca } = workerRoot()
    const bin = path.join(root, 'bin-no-codex')
    mkdirSync(bin)
    ok(run(root, ['step-start', 'M0-1'], orca.env))
    const r = run(root, ['worker', 'start', 'M0-1', '--agent', 'codex', '--role', 'test'], { ...orca.env, PATH: bin })
    ok(r)
    assert.match(r.out, /\[경고\] codex 명령이 PATH 에 없어 M0-1 를 Claude 작업자로 띄웁니다 \(다른 회사 모델 시각 없음\)/)
    assert.match(opt(sub(orca.calls(), 'terminal', 'split')[0], '--command'), /^claude --model opus /)
    const e = events(root)
    assert.deepEqual(e.find((x) => x.event === 'codex_missing').steps, ['M0-1'])
    assert.equal(e.find((x) => x.event === 'worker_start').agent, 'claude')
  })

  test('step-start 전이거나 명세가 없거나 이미 작업자가 있으면 창을 띄우지 않고 거절한다', () => {
    const { root, orca } = workerRoot()
    const notStarted = run(root, ['worker', 'start', 'M0-1', '--agent', 'claude', '--role', 'test'], orca.env)
    assert.equal(notStarted.code, 1)
    assert.match(notStarted.err, /먼저 step-start M0-1/)
    ok(run(root, ['step-start', 'M0-1'], orca.env))
    const noSpec = run(root, ['worker', 'start', 'M0-1', '--agent', 'claude', '--role', 'test', '--spec-file', '.orchestration/none.md'], orca.env)
    assert.equal(noSpec.code, 1)
    assert.equal(orca.calls().length, 0)
    ok(run(root, ['worker', 'start', 'M0-1', '--agent', 'claude', '--role', 'test'], orca.env))
    const dup = run(root, ['worker', 'start', 'M0-1', '--agent', 'claude', '--role', 'test'], orca.env)
    assert.equal(dup.code, 1)
    assert.match(dup.err, /닫지 않은 작업자/)
    assert.equal(run(root, ['worker', 'start', 'M0-1', '--role', 'test'], orca.env).code, 2)
  })

  test('일 맡기기가 실패하면 나눈 창만 닫고 worker_start 대신 worker_start_failed 를 남긴다', () => {
    const { root, orca } = workerRoot({ workerStart: 'fail' })
    ok(run(root, ['step-start', 'M0-1'], orca.env))
    const r = run(root, ['worker', 'start', 'M0-1', '--agent', 'claude', '--role', 'test'], orca.env)
    assert.equal(r.code, 1)
    assert.match(r.out, /코디네이터에게 알리세요/)
    assert.equal(sub(orca.calls(), 'terminal', 'close').length, 1)
    assert.deepEqual(orca.layout(), { type: 'terminal', handle: 'term_leader', title: '리더' })
    assert.ok(names(root).includes('worker_start_failed'))
    assert.ok(!names(root).includes('worker_start'))
  })

  test('worker done 은 결과 읽기 → 끝났는지 확인 → 그 창 하나만 닫기 → worker_done·worker_closed 를 남긴다', () => {
    const { root, orca } = workerRoot()
    ok(run(root, ['step-start', 'M0-1'], orca.env))
    ok(run(root, ['worker', 'start', 'M0-1', '--agent', 'claude', '--role', 'test'], orca.env))
    const w = events(root).find((e) => e.event === 'worker_start')
    const r = run(root, ['worker', 'done', 'M0-1', '--note', '시험 3개'], orca.env)
    ok(r)
    assert.match(r.out, /시험 3개 통과/)
    const calls = orca.calls()
    const order = calls.map((c) => `${c[0]} ${c[1]}`).filter((c) => /worker-read|worker-show|terminal close/.test(c))
    assert.deepEqual(order, ['orchestration worker-read', 'orchestration worker-show', 'terminal close'])
    const close = sub(calls, 'terminal', 'close')[0]
    assert.equal(opt(close, '--terminal'), w.terminal)
    assert.ok(!close.includes('--tab') && !close.includes('--all'))
    assert.equal(opt(sub(calls, 'orchestration', 'worker-read')[0], '--dispatch'), w.dispatch)
    const done = events(root).find((e) => e.event === 'worker_done')
    const closed = events(root).find((e) => e.event === 'worker_closed')
    assert.deepEqual([done.step, done.result, done.note, done.dispatch], ['M0-1', 'ok', '시험 3개', w.dispatch])
    assert.deepEqual([closed.step, closed.terminal, closed.dispatch], ['M0-1', w.terminal, w.dispatch])
    assert.deepEqual(orca.layout(), { type: 'terminal', handle: 'term_leader', title: '리더' })
    assert.doesNotMatch(next(root, orca.env).stop?.reason ?? '', /작업자 진행 중/)
  })

  test('worker done 은 아직 일하는 작업자의 창을 닫지 않는다 (--force 면 닫는다)', () => {
    const { root, orca } = workerRoot({ show: { state: 'ready', stage: 'input_accepted' } })
    ok(run(root, ['step-start', 'M0-1'], orca.env))
    ok(run(root, ['worker', 'start', 'M0-1', '--agent', 'claude', '--role', 'test'], orca.env))
    const r = run(root, ['worker', 'done', 'M0-1'], orca.env)
    assert.equal(r.code, 1)
    assert.match(r.out, /아직 끝나지 않았습니다/)
    assert.equal(sub(orca.calls(), 'terminal', 'close').length, 0)
    assert.ok(!names(root).includes('worker_done'))
    ok(run(root, ['worker', 'done', 'M0-1', '--force'], orca.env))
    assert.equal(events(root).find((e) => e.event === 'worker_done').forced, true)
    assert.equal(run(root, ['worker', 'done', 'M0-1'], orca.env).code, 1)
  })

  test('log worker_start 를 손으로 쓰면 기록은 하되 worker start 를 쓰라고 경고한다', () => {
    const root = milestoneRoot({})
    const r = run(root, ['log', 'worker_start', '{"step":"M0-1","agent":"claude","role":"impl"}'])
    ok(r)
    assert.match(r.out, /손으로 쓰지 마세요/)
    assert.ok(names(root).includes('worker_start'))
  })
})

describe('파일 잠금', () => {
  test('동시에 부른 worker start 두 개와 step-start 두 개가 기록과 상태 파일을 깨지 않는다', async () => {
    const { root, orca } = workerRoot({ delayMs: 150 })
    const starts = await Promise.all([runAsync(root, ['step-start', 'M0-2a'], orca.env), runAsync(root, ['step-start', 'M0-2b'], orca.env)])
    for (const s of starts) ok(s)
    const plan = readFileSync(path.join(root, 'docs/plan/M0.md'), 'utf8')
    assert.match(plan, /\| M0-2a \|.*⏳ 진행 중 \|/)
    assert.match(plan, /\| M0-2b \|.*⏳ 진행 중 \|/)
    const both = await Promise.all([
      runAsync(root, ['worker', 'start', 'M0-2a', '--agent', 'claude', '--role', 'impl'], orca.env),
      runAsync(root, ['worker', 'start', 'M0-2b', '--agent', 'claude', '--role', 'impl'], orca.env),
      runAsync(root, ['log', 'note', '{"n":1}'], orca.env),
      runAsync(root, ['log', 'note', '{"n":2}'], orca.env)
    ])
    for (const b of both) ok(b)
    const lines = readFileSync(path.join(root, '.rail/log.jsonl'), 'utf8').trim().split('\n')
    for (const l of lines) JSON.parse(l)
    const ws = events(root).filter((e) => e.event === 'worker_start')
    assert.deepEqual(ws.map((e) => e.step).sort(), ['M0-2a', 'M0-2b'])
    assert.equal(new Set(ws.map((e) => e.terminal)).size, 2)
    assert.equal(events(root).filter((e) => e.event === 'step_start').length, 2)
    assert.equal(events(root).filter((e) => e.event === 'note').length, 2)
    assert.equal(sub(orca.calls(), 'terminal', 'split').length, 2)
    assert.ok(state(root).stage === 'milestone')
    assert.ok(!existsSync(path.join(root, '.rail/.lock')))
    const done = await Promise.all([runAsync(root, ['worker', 'done', 'M0-2a'], orca.env), runAsync(root, ['worker', 'done', 'M0-2b'], orca.env)])
    for (const d of done) ok(d)
    assert.equal(events(root).filter((e) => e.event === 'worker_closed').length, 2)
    assert.deepEqual(orca.layout(), { type: 'terminal', handle: 'term_leader', title: '리더' })
  })

  test('살아 있는 다른 프로세스의 잠금은 기다리다 거절하고, 죽은 프로세스의 잠금은 버린다', () => {
    const root = milestoneRoot({})
    put(root, '.rail/.lock', JSON.stringify({ pid: process.pid, at: new Date().toISOString(), cmd: 'test' }))
    const held = run(root, ['log', 'note'], { RAIL_LOCK_WAIT_MS: '300' })
    assert.equal(held.code, 1)
    assert.match(held.err, /잠금/)
    assert.ok(!names(root).includes('note'))
    const dead = spawnSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))'], { encoding: 'utf8' }).stdout
    writeFileSync(path.join(root, '.rail/.lock'), JSON.stringify({ pid: Number(dead), at: new Date().toISOString(), cmd: 'test' }))
    ok(run(root, ['log', 'note'], { RAIL_LOCK_WAIT_MS: '2000' }))
    assert.ok(names(root).includes('note'))
    assert.ok(!existsSync(path.join(root, '.rail/.lock')))
  })
})

describe('마무리 검사가 남기는 진척 (시험 통과 수)', () => {
  test('통과 수가 지난번보다 늘면 passUpAt 을 남기고, next 는 그 시각을 마지막 진척으로 쓴다', () => {
    const repo = makeRepo()
    const cache = () => JSON.parse(readFileSync(path.join(repo, '.git/rail-stop-check.json'), 'utf8'))
    put(repo, 'src/a.mjs', 'c2\n')
    runHook('stop-check.mjs', { cwd: repo }, { RAIL_STOP_CHECK_CMD: "echo 'ℹ pass 5'" })
    assert.equal(cache().passCount, 5)
    assert.equal(cache().passUpAt, undefined)
    put(repo, 'src/a.mjs', 'c3\n')
    runHook('stop-check.mjs', { cwd: repo }, { RAIL_STOP_CHECK_CMD: "echo 'ℹ pass 7'" })
    assert.equal(cache().passCount, 7)
    const up = cache().passUpAt
    assert.ok(Date.now() - Date.parse(up) < 60_000)
    put(repo, '.rail/config.json', JSON.stringify(budgetConfig(fakeCost(tmp(), 0, 1), { milestone: { on: false } })))
    put(repo, '.rail/state.json', JSON.stringify({ stage: 'milestone', milestone: 'M0', closed: [] }))
    put(repo, '.rail/log.jsonl', JSON.stringify({ t: '2026-11-24T01:00:00.000Z', event: 'step_done', milestone: 'M0', step: 'M0-1' }) + '\n')
    assert.equal(next(repo).budget.since_progress.from, up)
  })
})

describe('부품이 일한 기록 (훅과 관문)', () => {
  const guard = (root, f) => runHook('guard-tests.mjs', { hook_event_name: 'PreToolUse', cwd: root, tool_name: 'Edit', tool_input: { file_path: path.join(root, f) } })
  const stop = (root, cmd) => runHook('stop-check.mjs', { hook_event_name: 'Stop', cwd: root, stop_hook_active: false }, { RAIL_STOP_CHECK_CMD: cmd })

  test('시험 잠금 훅이 쓰기를 막으면 hook_blocked 를 남긴다 (레일 저장소가 아니면 남기지 않는다)', () => {
    const repo = makeRepo()
    put(repo, '.rail/config.json', '{}')
    assert.ok(denied(guard(repo, 'tests/x.test.mjs')))
    const b = events(repo).find((e) => e.event === 'hook_blocked')
    assert.deepEqual([b.hook, b.file, b.tool], ['guard-tests', 'tests/x.test.mjs', 'Edit'])
    assert.equal(denied(guard(repo, 'src/a.mjs')), false)
    assert.equal(events(repo).filter((e) => e.event === 'hook_blocked').length, 1)
    const plain = makeRepo()
    assert.ok(denied(guard(plain, 'tests/x.test.mjs')))
    assert.ok(!existsSync(path.join(plain, '.rail')))
  })

  test('마무리 검사가 멈춤을 붙잡으면 hook_held 를 남기고, 기록이 실패해도 붙잡기는 그대로다', () => {
    const repo = makeRepo()
    put(repo, '.rail/config.json', '{}')
    put(repo, 'src/a.mjs', 'c2\n')
    const r = stop(repo, 'exit 1')
    assert.equal(r.code, 2)
    const h = events(repo).find((e) => e.event === 'hook_held')
    assert.equal(h.hook, 'stop-check')
    assert.match(h.reason, /종료 코드 1/)
    const broken = makeRepo()
    mkdirSync(path.join(broken, '.rail/log.jsonl'), { recursive: true })
    put(broken, 'src/a.mjs', 'c2\n')
    assert.equal(stop(broken, 'exit 1').code, 2)
  })

  test('관문이 통과시키면 gate_passed 를 남긴다 (check·advance·step-start·step-done)', () => {
    const root = tmp('rail22-gate-')
    put(root, 'docs/PLAN.md', GOOD_PLAN)
    ok(run(root, ['check', 'decide', '--milestone', 'M0']))
    ok(run(root, ['advance', 'decide', '--milestone', 'M0']))
    const passed = events(root).filter((e) => e.event === 'gate_passed')
    assert.deepEqual(passed.map((e) => [e.target, e.via]), [['decide', 'check'], ['decide', 'advance']])
    const ms = milestoneRoot({})
    ok(run(ms, ['step-start', 'M0-1']))
    ok(run(ms, ['step-done', 'M0-1', '--note', '됨']))
    assert.deepEqual(events(ms).filter((e) => e.event === 'gate_passed').map((e) => [e.target, e.step]), [['step-start', 'M0-1'], ['step-done', 'M0-1']])
    assert.equal(run(ms, ['step-start', 'M0-1']).code, 1)
    assert.equal(events(ms).filter((e) => e.event === 'gate_passed').length, 2)
  })
})
