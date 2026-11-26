// 판정으로 고친 시험이 있어도 자율 밤샘은 판정 대기로 닫고 다음 마일스톤으로 간다(주인 결정 2026-11-25).
// 목록은 판정 대기 기록과 status 의 "판정 대기" 안내에 실리고, 사람이 나중에 "됨"이면 목록도 승인으로 남는다.
// 자율이 꺼져 있으면 예전처럼 목록을 실은 장면 질문을 기다린다. 설정은 모두 임시 저장소에 만든다.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { describe, test } from 'node:test'
import { RAIL, events, planDoc, put, state, tmp } from './helpers.mjs'

const HEAD = '| step | 맡는 쪽 | 할 일 | 고쳐도 되는 파일 | 기다리는 step | 완료 기준 | 상태 |\n|---|---|---|---|---|---|---|\n'
const DONE = '✅ 끝(2026-11-25) 됨'
const PLAN = planDoc([['M0'], ['M1'], ['M2']])
const BUDGET_OFF = { sinceProgress: { on: false }, milestone: { on: false } }
const cfg = (mode) => ({ railVersion: '2.9', commitPolicy: 'auto-local', staleTests: 'agent', autonomy: { mode, budget: BUDGET_OFF } })
const PASS = { total: 3, pass: 3, failed: [], at: '2026-11-25T00:00:00Z' }
const STALE_START = {
  t: '2026-11-25T00:00:00.000Z', event: 'worker_start', stage: 'milestone', milestone: 'M0', step: 'M0-1', test_edit: true, allowed_by: 'stale', stale_file: '.rail/stale/M0-1.json',
  stale_lines: [{ file: 'tests/a.test.mjs', line: 3, pinned: '합계 $3.20', changed_by: 'M0-1 할 일 "합계 칸 바꾸기"' }]
}

function run(root, args) {
  const env = { ...process.env, ORCA_CLI_COMMAND: '/nonexistent/orca', CLAUDE_CODE_SESSION_ID: 'stale-queue-leader', RAIL_ROOT: root }
  for (const k of ['ORCA_AGENT_SESSION_ID', 'ORCA_TERMINAL_HANDLE', 'NODE_TEST_CONTEXT', 'RAIL_NO_TOUCH', 'RAIL_STATUSLINE_DIR', 'RAIL_ALLOW_TEST_EDIT']) delete env[k]
  const r = spawnSync(process.execPath, [RAIL, ...args], { encoding: 'utf8', env })
  return { code: r.status, out: r.stdout, err: r.stderr }
}
const ok = (r) => assert.equal(r.code, 0, r.err + r.out)
const status = (root) => JSON.parse(run(root, ['status', '--json']).out)

// check 단계의 M0: step 모두 끝, 리허설 모두 통과, M1 미리 승인, 판정으로 고친 시험 한 줄.
function repo(mode = 'on') {
  const root = tmp('railstaleq-')
  put(root, '.rail/config.json', JSON.stringify(cfg(mode)))
  put(root, 'docs/PLAN.md', PLAN)
  put(root, 'docs/RAIL.md', '# 레일\n레일 2.9판\n')
  put(root, 'docs/plan/M0.md', `# M0\n\n${HEAD}| M0-1 | 기능 | 합계 칸 바꾸기 | src/a.mjs | 없음 | 기준 | ${DONE} |\n`)
  put(root, 'docs/plan/M1.md', `# M1\n\n${HEAD}| M1-1 | 기능 | 다음 기능 | src/b.mjs | 없음 | 기준 | |\n`)
  const gates = { scene_checked: {}, rehearsed: { M0: PASS }, plan_approved: { M1: { at: 'x', said: '승인' } } }
  put(root, '.rail/state.json', JSON.stringify({ project: 'demo', stage: 'check', milestone: 'M0', step: null, closed: [], gates }))
  put(root, '.rail/log.jsonl', JSON.stringify(STALE_START) + '\n')
  return root
}
const LIST = /tests\/a\.test\.mjs:3 — M0-1 할 일 "합계 칸 바꾸기" 로 바뀐 동작\(옛 값: 합계 \$3\.20\) · M0-1, 커밋 없음/

describe('판정으로 고친 시험이 있는 마일스톤의 판정 대기 닫기', () => {
  test('자율 + 다음 마일스톤 승인이면 판정 대기로 닫고 다음으로 가며, 대기 기록과 판정 대기 안내에 목록이 실린다', () => {
    const root = repo()
    assert.match(status(root).next, /^장면 판정 대기로 닫기 — 리허설 3\/3 통과, 다음 M1 미리 승인됨, 판정으로 고친 시험 1건은 대기 기록에 붙임/)
    const r = run(root, ['advance', 'close'])
    ok(r)
    assert.match(r.out, /M0 를 사람 장면 판정 없이 닫고 판정 대기 목록에 올립니다/)
    const s = state(root)
    assert.deepEqual([s.stage, s.milestone, s.closed], ['decide', 'M1', ['M0']])
    assert.deepEqual(s.gates.scene_pending.M0.stale, [{ ...STALE_START.stale_lines[0], step: 'M0-1', commit: '없음' }])
    const w = status(root).waiting
    assert.match(w, /사람 장면 판정 대기: M0 — 에이전트 판정으로 고친 시험 1건이 붙어 있습니다\. "됨"이면 이 목록도 승인한 것으로 남깁니다/)
    assert.match(w, LIST)
    ok(run(root, ['advance', 'milestone']))
    assert.equal(state(root).stage, 'milestone')
  })

  test('나중에 사람이 "됨"이면 목록도 승인으로 남는다', () => {
    const root = repo()
    ok(run(root, ['advance', 'close']))
    ok(run(root, ['scene', 'M0', '--result', 'pass', '--note', '합계 $3.40 이 보인다']))
    const s = state(root)
    assert.equal(s.gates.scene_pending.M0, undefined)
    assert.equal(s.gates.scene_checked.M0.result, 'pass')
    assert.equal(s.gates.scene_checked.M0.stale_lines.length, 1)
    const ap = events(root).filter((e) => e.event === 'stale_approved')
    assert.equal(ap.length, 1)
    assert.equal(ap[0].milestone_judged, 'M0')
    assert.deepEqual(ap[0].lines, [{ file: 'tests/a.test.mjs', line: 3, step: 'M0-1' }])
    assert.doesNotMatch(status(root).waiting, /판정 대기/)
  })

  test('"안 됨"이면 승인으로 남기지 않고 자율이 서며, 고친 뒤 "됨"이면 그때 목록을 승인한다', () => {
    const root = repo()
    ok(run(root, ['advance', 'close']))
    ok(run(root, ['scene', 'M0', '--result', 'fail', '--note', 'a.test 3줄은 버그를 덮었다']))
    assert.ok(!events(root).some((e) => e.event === 'stale_approved'))
    const stop = JSON.parse(run(root, ['next', '--json']).out).stop
    assert.equal(stop.code, 'human')
    assert.match(status(root).next, /^앞 마일스톤 장면 실패 — M0/)
    ok(run(root, ['scene', 'M0', '--result', 'pass', '--note', '고친 뒤 봄']))
    assert.equal(events(root).filter((e) => e.event === 'stale_approved').length, 1)
    assert.equal(JSON.parse(run(root, ['next', '--json']).out).stop, null)
  })

  test('자율이 꺼져 있으면 예전처럼 판정 대기로 닫지 않고, 목록을 실은 장면 질문을 기다린다', () => {
    const root = repo('off')
    const r = run(root, ['advance', 'close'])
    assert.equal(r.code, 1, r.out)
    assert.match(r.err, /M0 의 사람 장면 확인 기록이 없습니다/)
    assert.match(r.err, /판정으로 고친 시험 1건을 보인 장면 질문/)
    assert.equal(state(root).gates.scene_pending, undefined)
    const q = run(root, ['ask', '--scene'])
    ok(q)
    assert.match(q.out, /에이전트 판정으로 고친 시험 1건/)
    assert.match(q.out, LIST)
    ok(run(root, ['answer', '됨. 본 것: 합계 $3.40']))
    ok(run(root, ['advance', 'close']))
    assert.equal(events(root).filter((e) => e.event === 'stale_approved').length, 1)
  })
})
