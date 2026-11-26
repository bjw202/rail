// 바깥 정답 검증기(verify) 관문, 장면 리허설 관문, 닫힘 알림.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, test } from 'node:test'
import { GOOD_PLAN, RAIL, events, markRehearsed, put, state, tmp } from './helpers.mjs'

const NODE = JSON.stringify(process.execPath)
const exitWith = (code) => `${NODE} -e "process.exit(${code})"`

// helpers.rail 과 같되 환경 변수를 더할 수 있다. 바깥 ORCA_CLI_COMMAND 는 늘 지운다(진짜 알림이 나가지 않게).
function rail(root, ...a) {
  const env = { ...process.env, RAIL_ROOT: root }
  delete env.ORCA_CLI_COMMAND
  delete env.NODE_TEST_CONTEXT
  let extra = {}
  if (a.length && typeof a[a.length - 1] === 'object') extra = a.pop()
  const r = spawnSync(process.execPath, [RAIL, ...a], { encoding: 'utf8', env: { ...env, ...extra } })
  return { code: r.status, out: r.stdout, err: r.stderr }
}
const names = (root) => events(root).map((e) => e.event)
const config = (root, c) => put(root, '.rail/config.json', JSON.stringify(c))

// M0 의 step 하나(구현)가 끝나 check 로 갈 수 있는 저장소.
function ready(cfg = {}, rows = ['| M0-1 | 구현 | a | b | c | |']) {
  const root = tmp()
  config(root, cfg)
  put(root, 'docs/PLAN.md', GOOD_PLAN)
  put(root, 'docs/plan/M0.md', `| step | 맡는 쪽 | 할 일 | 파일 | 완료 | 상태 |\n|---|---|---|---|---|---|\n${rows.join('\n')}\n`)
  put(root, '.rail/state.json', JSON.stringify({ project: 'demo', stage: 'milestone', milestone: 'M0', step: null, gates: { scene_checked: {} }, closed: [] }))
  for (const r of rows) {
    const id = r.split('|')[1].trim()
    assert.equal(rail(root, 'step-start', id).code, 0)
    if (!/리뷰/.test(r)) assert.equal(rail(root, 'step-done', id, '--note', '됨').code, 0)
  }
  return root
}
// 리허설 결과 파일과 스크린샷.
function rehearse(root, id, items) {
  put(root, `.rail/rehearsal/${id}/result.json`, JSON.stringify({ items }))
  for (const it of items) if (it.shot) put(root, `.rail/rehearsal/${id}/${it.shot}`, 'png')
}
const ITEMS = [
  { id: '0', check: '오늘 빌드인가', result: 'pass', saw: '서버 시작 시각 13:28', shot: '0.png' },
  { id: '1', check: '어제로 바꾸면 합계가 바뀌나', result: 'fail', saw: '합계 $150.33 그대로', shot: '1.png' },
]

describe('verify 관문', () => {
  test('검증기가 모두 통과하면 check 로 가고, 이름·결과·시간·출력 끝을 verify_run 에 남긴다', () => {
    const root = ready({ verify: [{ name: 'ok', command: `${exitWith(0)} && echo 끝줄`, why: '시험' }] })
    const v = rail(root, 'verify')
    assert.equal(v.code, 0, v.err)
    const run = events(root).find((e) => e.event === 'verify_run')
    assert.equal(run.ok, true)
    assert.equal(run.results[0].name, 'ok')
    assert.equal(run.results[0].status, 'pass')
    assert.equal(typeof run.results[0].ms, 'number')
    assert.deepEqual(run.results[0].tail, ['끝줄'])
    assert.equal(rail(root, 'advance', 'check').code, 0)
    markRehearsed(root)
    assert.equal(rail(root, 'scene', 'M0', '--result', 'pass', '--note', '봤다').code, 0)
  })

  test('검증기가 하나라도 실패하면 막고 그 이름을 알려 준다', () => {
    const root = ready({ verify: [{ name: 'ok', command: exitWith(0) }, { name: 'bad', command: exitWith(1) }] })
    assert.equal(rail(root, 'verify').code, 1)
    assert.equal(rail(root, 'advance', 'check').code, 0)
    const r = rail(root, 'scene', 'M0', '--result', 'pass', '--note', '봤다')
    assert.equal(r.code, 1)
    assert.match(r.err, /검증기 bad 이\(가\) 실패했습니다/)
    assert.equal(state(root).gates.scene_checked.M0, undefined)
  })

  test('건너뜀(종료 코드 3)은 통과가 아니다', () => {
    const root = ready({ verify: [{ name: 'real', command: exitWith(3) }] })
    const v = rail(root, 'verify')
    assert.equal(v.code, 1)
    assert.match(v.out, /real: 건너뜀/)
    assert.equal(rail(root, 'advance', 'check').code, 0)
    assert.match(rail(root, 'scene', 'M0', '--result', 'pass', '--note', '봤다').err, /real 이\(가\) 건너뜀으로 끝났습니다/)
  })

  test('verify 뒤에 step 이 또 끝나면 다시 돌려야 한다', () => {
    const root = ready({ verify: [{ name: 'ok', command: exitWith(0) }] }, ['| M0-1 | 구현 | a | b | c | |', '| M0-2 | 구현 | a | b | c | |'])
    put(root, '.rail/log.jsonl', '')
    rail(root, 'verify')
    put(root, 'docs/plan/M0.md', readFileSync(path.join(root, 'docs/plan/M0.md'), 'utf8') + '| M0-3 | 구현 | a | b | c | |\n')
    rail(root, 'step-start', 'M0-3')
    rail(root, 'step-done', 'M0-3', '--note', '됨')
    assert.equal(rail(root, 'advance', 'check').code, 0)
    assert.match(rail(root, 'scene', 'M0', '--result', 'pass', '--note', '봤다').err, /마지막 step 뒤에 돌린 verify 기록이 없습니다/)
  })
})

describe('장면 리허설 관문', () => {
  test('2.0판은 리허설 기록 없이 장면 확인을 거절하고, 기록하면 실패 항목을 먼저 알린다', () => {
    const root = ready()
    assert.equal(rail(root, 'advance', 'check').code, 0)
    const blocked = rail(root, 'scene', 'M0', '--result', 'pass', '--note', '봤다')
    assert.equal(blocked.code, 1)
    assert.match(blocked.err, /장면 리허설 기록이 없습니다/)
    assert.match(rail(root, 'status').out, /장면 확인 전에 — .*리허설/)
    put(root, '.rail/rehearsal/M0/result.json', JSON.stringify({ items: [{ id: '0', result: 'pass', saw: '', shot: 'nope.png' }] }))
    const bad = rail(root, 'rehearsal-record', 'M0')
    assert.equal(bad.code, 1)
    assert.match(bad.err, /본 것 한 줄/)
    assert.match(bad.err, /스크린샷/)
    rehearse(root, 'M0', ITEMS)
    const ok = rail(root, 'rehearsal-record', 'M0')
    assert.equal(ok.code, 0, ok.err)
    assert.match(ok.out, /통과 1\/2, 스크린샷 2장/)
    assert.match(ok.out, /실패 1: 어제로 바꾸면/)
    assert.match(rail(root, 'status').out, /통과 1\/2, 실패 1 먼저/)
    assert.equal(rail(root, 'scene', 'M0', '--result', 'pass', '--note', '1번은 새로고침하니 바뀜').code, 0)
    assert.deepEqual(state(root).gates.scene_checked.M0.rehearsal, { pass: 1, total: 2 })
    assert.ok(names(root).includes('rehearsal_recorded'))
  })

  test('check 단계 중간에 검증기가 생기면 그 자리에서 요구하고, 닫힌 마일스톤은 다시 보지 않는다', () => {
    const root = tmp()
    config(root, {})
    put(root, 'docs/PLAN.md', GOOD_PLAN)
    put(root, 'docs/plan/M0.md', '| step | 맡는 쪽 | 할 일 | 파일 | 완료 | 상태 |\n|---|---|---|---|---|---|\n| M0-1 | 구현 | a | b | c | ✅ 끝(2026-11-20) 됨 |\n')
    put(root, 'docs/plan/M1.md', '| step | 맡는 쪽 | 할 일 | 파일 | 완료 | 상태 |\n|---|---|---|---|---|---|\n| M1-1 | 구현 | a | b | c | |\n')
    // M0 은 리허설 기록 없이 닫혔다.
    put(root, '.rail/state.json', JSON.stringify({ project: 'demo', stage: 'milestone', milestone: 'M1', step: null, gates: { scene_checked: { M0: { result: 'pass', note: '확인', at: '2026-11-20T00:00:00Z' } } }, closed: ['M0'] }))
    rail(root, 'step-start', 'M1-1')
    rail(root, 'step-done', 'M1-1', '--note', '됨')
    assert.equal(rail(root, 'advance', 'check').code, 0)
    assert.equal(state(root).stage, 'check')
    config(root, { verify: [{ name: 'ok', command: exitWith(0) }] })
    const blocked = rail(root, 'scene', 'M1', '--result', 'pass', '--note', '봤다')
    assert.equal(blocked.code, 1)
    assert.match(blocked.err, /verify 기록이 없습니다/)
    assert.match(blocked.err, /장면 리허설 기록이 없습니다/)
    assert.equal(rail(root, 'verify').code, 0)
    rehearse(root, 'M1', [ITEMS[0]])
    assert.equal(rail(root, 'rehearsal-record', 'M1').code, 0)
    assert.equal(rail(root, 'scene', 'M1', '--result', 'pass', '--note', '봤다').code, 0)
    assert.equal(rail(root, 'advance', 'close').code, 0)
    assert.deepEqual(state(root).closed, ['M0', 'M1'])
  })

  test('reopen 하면 리허설 기록도 지운다(고친 뒤 다시 해 봐야 한다)', () => {
    const root = ready()
    rail(root, 'advance', 'check')
    rehearse(root, 'M0', [ITEMS[0]])
    rail(root, 'rehearsal-record', 'M0')
    assert.ok(state(root).gates.rehearsed.M0)
    rail(root, 'reopen')
    assert.equal(state(root).gates.rehearsed.M0, undefined)
  })
})

describe('닫힘 알림', () => {
  function toClose(cfg) {
    const root = ready(cfg)
    rail(root, 'advance', 'check')
    markRehearsed(root)
    rail(root, 'ask', '됐나요?', '--kind', 'approve')
    rail(root, 'answer', '됨')
    rail(root, 'log', 'rail_edit', '{"file":".rail/x","why":"y"}')
    rail(root, 'scene', 'M0', '--result', 'pass', '--note', '봤다')
    return root
  }

  test('보내기에 실패해도 닫기는 성공하고 실패를 기록한다', () => {
    const root = toClose({ notify: { bot: 'coach' } })
    const r = rail(root, 'advance', 'close', { ORCA_CLI_COMMAND: path.join(root, 'no-such-orca') })
    assert.equal(r.code, 0, r.err)
    assert.match(r.out, /알림 실패/)
    assert.deepEqual(state(root).closed, ['M0'])
    const ev = events(root).find((e) => e.event === 'notify_failed')
    assert.equal(ev.to, 'bot:coach')
  })

  test('보내면 bot 에게 "<프로젝트> Mx 닫힘" 과 한 줄 요약을 보낸다', () => {
    const root = toClose({ notify: { bot: 'coach' } })
    const fake = path.join(root, 'fake-orca.mjs')
    put(root, 'fake-orca.mjs', `#!/usr/bin/env node\nimport { writeFileSync } from 'node:fs'\nwriteFileSync(${JSON.stringify(path.join(root, 'sent.json'))}, JSON.stringify(process.argv.slice(2)))\n`)
    spawnSync('chmod', ['+x', fake])
    const r = rail(root, 'advance', 'close', { ORCA_CLI_COMMAND: fake })
    assert.equal(r.code, 0, r.err)
    const argv = JSON.parse(readFileSync(path.join(root, 'sent.json'), 'utf8'))
    assert.deepEqual(argv.slice(0, 6), ['orchestration', 'send', '--to', 'bot:coach', '--type', 'status'])
    assert.equal(argv[argv.indexOf('--subject') + 1], 'demo M0 닫힘')
    assert.match(argv[argv.indexOf('--body') + 1], /^작업 \d+분 · 사람 답 1번 · 레일 수정 1번 · CW 모름 · 압축 0번\n빼기 후보: /)
    assert.ok(names(root).includes('notify_sent'))
  })

  test('notify 가 없으면 보내지 않는다', () => {
    const root = toClose({})
    const r = rail(root, 'advance', 'close', { ORCA_CLI_COMMAND: path.join(root, 'no-such-orca') })
    assert.equal(r.code, 0)
    assert.ok(!names(root).some((n) => n.startsWith('notify_')))
  })
})
