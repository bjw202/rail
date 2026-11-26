// 폭주 알림 시험(주인 결정 2026-11-26: 알리기만 한다). next --precheck 가 busy(14) 일 때도
// 작업자 나이(autonomy.alertWorkerMinutes)와 마지막 진척 뒤 쓴 돈(autonomy.budget.sinceProgress.usd)을 재고,
// 넘으면 notify.bot 으로 한 번만 알린다. 종료 코드와 멈춤 까닭은 그대로다.
// 규칙: 저장소의 .rail/config.json 값을 단언하지 않는다. 가짜 orca·가짜 비용 명령·설정은 모두 임시 저장소에 만든다.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import path from 'node:path'
import { describe, test } from 'node:test'
import { RAIL, events, put, tmp } from './helpers.mjs'

const MIN = 60_000
const HEAD = '| step | 맡는 쪽 | 할 일 | 고쳐도 되는 파일 | 기다리는 step | 완료 기준 | 상태 |\n|---|---|---|---|---|---|---|\n'
const line = (event, data = {}, ago = 0) => JSON.stringify({ t: new Date(Date.now() - ago).toISOString(), event, stage: 'milestone', milestone: 'M0', ...data })
const started = (ago, step = 'M0-1', dispatch = 'ctx_w1') => line('worker_start', { step, agent: 'claude', role: 'check', terminal: 'term_w1', dispatch }, ago)

// 레일 저장소 하나와 가짜 orca·가짜 비용 명령. cost.txt 의 값을 구간마다 돌려주고, orca-fail 파일이 있으면 send 가 실패한다.
function repo({ log = [], cost = 1, config = {} } = {}) {
  const root = tmp('rail-runaway-')
  put(root, '.rail/config.json', JSON.stringify({ railVersion: '2.9', commitPolicy: 'auto-local', notify: { bot: 'coach' }, ...config, autonomy: { mode: 'on', budget: { costCommand: `node ${JSON.stringify(path.join(root, 'cost.mjs'))}`, sinceProgress: { on: true, usd: 10 }, milestone: { on: false }, daily: { on: false } }, ...config.autonomy } }))
  put(root, '.rail/state.json', JSON.stringify({ project: 'demo', stage: 'milestone', milestone: 'M0', step: null, closed: [], gates: { scene_checked: {}, rehearsed: {} } }))
  put(root, 'docs/ROADMAP.md', '# 로드맵\n승인: 2026-11-24\n## M0 뼈대\n- 끝나는 장면: 화면이 보인다\n- 위험 질문: 없음\n- 예상 기간: 1일\n')
  put(root, 'docs/RAIL.md', '# 레일\n레일 2.9판\n')
  put(root, 'docs/plan/M0.md', `# M0\n\n${HEAD}| M0-1 | 기능 | 화면 | src/a.mjs | 없음 | 보인다 | ⏳ 진행 중 |\n`)
  put(root, '.rail/log.jsonl', log.map((l) => l + '\n').join(''))
  put(root, 'cost.txt', String(cost))
  put(root, 'cost.mjs', `import { readFileSync } from 'node:fs'
const { intervals } = JSON.parse(readFileSync(0, 'utf8'))
const v = readFileSync(${JSON.stringify(path.join(root, 'cost.txt'))}, 'utf8').trim()
if (v === 'fail') process.exit(9)
process.stdout.write(JSON.stringify({ usd: intervals.map(() => Number(v)) }))
`)
  put(root, 'orca.mjs', `#!/usr/bin/env node
import { appendFileSync, existsSync } from 'node:fs'
const a = process.argv.slice(2)
appendFileSync(${JSON.stringify(path.join(root, 'calls.jsonl'))}, JSON.stringify(a) + '\\n')
if (a[1] === 'send' && existsSync(${JSON.stringify(path.join(root, 'orca-fail'))})) { process.stderr.write('보내기 실패'); process.exit(1) }
process.stdout.write(JSON.stringify({ ok: true, result: {} }))
`)
  spawnSync('chmod', ['+x', path.join(root, 'orca.mjs')])
  return root
}
function precheck(root) {
  const base = { ...process.env }
  for (const k of ['CLAUDE_CODE_SESSION_ID', 'ORCA_AGENT_SESSION_ID', 'ORCA_TERMINAL_HANDLE', 'NODE_TEST_CONTEXT', 'RAIL_NO_TOUCH', 'RAIL_STATUSLINE_DIR']) delete base[k]
  const r = spawnSync(process.execPath, [RAIL, 'next', '--precheck'], { encoding: 'utf8', env: { ...base, ORCA_CLI_COMMAND: path.join(root, 'orca.mjs'), CLAUDE_CODE_SESSION_ID: 'runaway-leader', RAIL_ROOT: root } })
  return { code: r.status, out: r.stdout, err: r.stderr }
}
const sends = (root) => (existsSync(path.join(root, 'calls.jsonl')) ? readFileSync(path.join(root, 'calls.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : []).filter((c) => c[1] === 'send')
const opt = (c, k) => c[c.indexOf(k) + 1]
const alerts = (root, name = 'runaway_alert') => events(root).filter((e) => e.event === name)

describe('폭주 알림: busy 여도 알리고, 종료 코드는 그대로', () => {
  test('작업자 61분이면 시간 알림을 한 번 보내고, 두 번째 부름에는 보내지 않는다 (둘 다 14)', () => {
    const root = repo({ log: [started(61 * MIN, 'M16-4-check')] })
    const first = precheck(root)
    assert.equal(first.code, 14, first.out + first.err)
    assert.match(first.out, /^멈춤\(busy\): 작업자 진행 중 — M16-4-check/)
    const s = sends(root)
    assert.equal(s.length, 1)
    assert.deepEqual([opt(s[0], '--to'), opt(s[0], '--type'), opt(s[0], '--subject')], ['bot:coach', 'status', 'demo 작업자 오래 돎: M16-4-check 61분'])
    const body = opt(s[0], '--body')
    for (const want of ['M16-4-check', '역할 check', '창 term_w1', '(61분)', '쓴 돈 $1.00', '마지막 진척']) assert.ok(body.includes(want), `${want} 이 본문에 있어야 한다: ${body}`)
    assert.deepEqual(alerts(root).map((e) => [e.kind, e.key]), [['time', 'ctx_w1']])
    const second = precheck(root)
    assert.equal(second.code, 14)
    assert.equal(sends(root).length, 1, '같은 작업자로 다시 보내지 않는다')
    assert.equal(alerts(root).length, 1)
    rmSync(root, { recursive: true, force: true })
  })

  test('진척 뒤 $10 를 넘으면 돈 알림을 그 진척 구간에 한 번 보내고, 새 진척 뒤에는 다시 보낸다', () => {
    const root = repo({ log: [line('step_done', { step: 'M0-0' }, 20 * MIN), started(10 * MIN)], cost: 11.2 })
    assert.equal(precheck(root).code, 14)
    assert.deepEqual(sends(root).map((c) => opt(c, '--subject')), ['demo 진척 없이 $11.20'])
    assert.match(opt(sends(root)[0], '--body'), /쓴 돈 \$11\.20 \(상한 \$10\.00\)/)
    assert.equal(precheck(root).code, 14)
    assert.equal(sends(root).length, 1, '같은 진척 구간으로 다시 보내지 않는다')
    put(root, '.rail/log.jsonl', readFileSync(path.join(root, '.rail/log.jsonl'), 'utf8') + line('step_done', { step: 'M0-9' }) + '\n')
    assert.equal(precheck(root).code, 14)
    assert.equal(sends(root).length, 2, '새 진척 구간에서 다시 넘으면 한 번 더')
    rmSync(root, { recursive: true, force: true })
  })

  test('상한 안(작업자 30분, $3)이면 알림이 없다', () => {
    const root = repo({ log: [started(30 * MIN)], cost: 3 })
    assert.equal(precheck(root).code, 14)
    assert.deepEqual(sends(root), [])
    assert.deepEqual(alerts(root), [])
    rmSync(root, { recursive: true, force: true })
  })

  test('시간 상한은 config 의 autonomy.alertWorkerMinutes 로 바꾼다', () => {
    const root = repo({ log: [started(30 * MIN)], config: { autonomy: { alertWorkerMinutes: 20 } } })
    assert.equal(precheck(root).code, 14)
    assert.equal(sends(root).length, 1)
    rmSync(root, { recursive: true, force: true })
  })

  test('알림 보내기가 실패해도 종료 코드는 14 이고 runaway_alert_failed 만 남긴다', () => {
    const root = repo({ log: [started(61 * MIN)] })
    put(root, 'orca-fail', '')
    const r = precheck(root)
    assert.equal(r.code, 14, r.out + r.err)
    assert.equal(alerts(root).length, 0)
    const failed = alerts(root, 'runaway_alert_failed')
    assert.equal(failed.length, 1)
    assert.match(failed[0].error, /보내기 실패/)
  })

  test('비용을 못 읽으면 시간 검사만 하고 종료 코드는 14 그대로', () => {
    const root = repo({ log: [started(61 * MIN)], cost: 'fail' })
    assert.equal(precheck(root).code, 14)
    const s = sends(root)
    assert.equal(s.length, 1)
    assert.match(opt(s[0], '--body'), /쓴 돈 모름 — 비용 읽기 실패/)
    rmSync(root, { recursive: true, force: true })
  })

  test('notify.bot 이 없으면 아무것도 보내지 않는다', () => {
    const root = repo({ log: [started(61 * MIN)], config: { notify: {} } })
    assert.equal(precheck(root).code, 14)
    assert.deepEqual(sends(root), [])
    rmSync(root, { recursive: true, force: true })
  })
})
