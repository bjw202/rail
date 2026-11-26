// 레일 2.1판 시험: 독립된 step 동시 진행(기다리는 step 칸, 파일 겹침 거절, 동시 시험 step 의 예정된 실패),
// 열린 질문 바꿔 묻기(ask --replace), 장면 답 한 번에 받기(ask --scene, answer 가 판정과 본 것을 가름),
// 사람 답을 기다리는 동안의 마무리 검사, 시각만 다른 실패는 같은 지문.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, test } from 'node:test'
import { denied, events, git, makeRepo, put, rail, runHook, state, tmp } from './helpers.mjs'

const HEAD = '| step | 맡는 쪽 | 할 일 | 고쳐도 되는 파일 | 기다리는 step | 완료 기준 | 상태 |\n|---|---|---|---|---|---|---|\n'
const OLD_HEAD = '| step | 맡는 쪽 | 할 일 | 고쳐도 되는 파일 | 완료 기준 | 상태 |\n|---|---|---|---|---|---|\n'
const MILESTONE = { project: 'demo', stage: 'milestone', milestone: 'M0', step: null, closed: [] }
const row = (step, role, files, wait = '') => `| ${step} | ${role} | 일 | ${files} | ${wait} | 기준 | |`

function railRoot(table, { withGit = false } = {}) {
  const root = tmp('rail21-')
  put(root, '.rail/state.json', JSON.stringify(MILESTONE))
  put(root, 'docs/plan/M0.md', `# M0\n\n## step\n${table}`)
  if (withGit) {
    put(root, 'src/have.mjs', 'export const a = 1\n')
    put(root, 'tests/old.test.mjs', "import { test } from 'node:test'\ntest('옛 시험', () => {})\n")
    git(root, 'init', '-q')
    git(root, 'config', 'user.email', 'rail@example.com')
    git(root, 'config', 'user.name', 'rail')
    git(root, 'add', '-A')
    git(root, 'commit', '-q', '-m', 'init')
  }
  return root
}
const ok = (r) => assert.equal(r.code, 0, r.err)
const baseline = (root) => JSON.parse(readFileSync(path.join(root, '.rail/test-baseline.json'), 'utf8'))

describe('독립된 step 동시 진행', () => {
  test('기다리는 step 이 같은 두 step 은 동시에 시작하고, status 가 둘 다 보여 주며, 칸이 빈 뒤 step 은 둘 다 기다린다', () => {
    const root = railRoot(HEAD + [row('M0-1', '구현', 'src/core.mjs'), row('M0-2a', '구현', 'src/a.mjs', 'M0-1'), row('M0-2b', '구현', 'src/b.mjs', 'M0-1'), row('M0-3', '리뷰', '.rail/review/M0-3.json')].join('\n') + '\n')
    ok(rail(root, 'step-start', 'M0-1'))
    ok(rail(root, 'step-done', 'M0-1', '--note', '됨'))
    assert.match(rail(root, 'status').out, /step M0-2a, M0-2b 을\(를\) 동시에 시작할 수 있습니다/)
    ok(rail(root, 'step-start', 'M0-2a'))
    assert.match(rail(root, 'status').out, /함께 시작할 수 있는 step: M0-2b/)
    const b = rail(root, 'step-start', 'M0-2b')
    ok(b)
    assert.match(b.out, /함께 진행 중: M0-2a/)
    assert.deepEqual(events(root).at(-1).alongside, ['M0-2a'])
    const s = rail(root, 'status').out
    assert.match(s, /M0 · step 진행 \(M0-2a, M0-2b\)/)
    assert.match(s, /step M0-2a, M0-2b 동시 진행 중/)
    assert.deepEqual(JSON.parse(rail(root, 'status', '--json').out).steps.map((x) => x.mark), ['✅', '⏳', '⏳', '  '])
    ok(rail(root, 'step-done', 'M0-2b', '--note', '먼저 끝남'))
    assert.equal(state(root).step, 'M0-2a', '남은 진행 중 step 을 가리킨다')
    ok(rail(root, 'step-done', 'M0-2a', '--note', '됨'))
    assert.equal(state(root).step, null)
    ok(rail(root, 'step-start', 'M0-3'))
  })

})

describe('열린 질문 바꿔 묻기', () => {
  test('ask --replace 는 열린 질문을 닫고 새 질문을 열며 ask_replaced 를 남기고, 사람 답으로 세지 않는다', () => {
    const root = tmp()
    put(root, '.rail/state.json', JSON.stringify({ ...MILESTONE, stage: 'brief' }))
    ok(rail(root, 'ask', '옛 문구 질문'))
    const refused = rail(root, 'ask', '새 문구 질문')
    assert.equal(refused.code, 1)
    assert.match(refused.err, /ask --replace/)
    const r = rail(root, 'ask', '--replace', '새 문구 질문', '--why', '레일 판이 바뀌어 문구가 달라짐')
    ok(r)
    assert.match(r.out, /질문 바꿈/)
    const st = state(root)
    assert.equal(st.human_ask.q, '새 문구 질문')
    assert.equal(st.human_ask.kind, 'interview')
    assert.equal(st.interview.asked, 1, '인터뷰 질문을 바꿔 물어도 질문 수는 그대로')
    const ev = events(root)
    const rep = ev.find((e) => e.event === 'ask_replaced')
    assert.deepEqual([rep.old, rep.new, rep.why], ['옛 문구 질문', '새 문구 질문', '레일 판이 바뀌어 문구가 달라짐'])
    assert.equal(ev.filter((e) => e.event === 'human_answer').length, 0)
    ok(rail(root, 'answer', '답'))
    assert.equal(events(root).filter((e) => e.event === 'human_answer').length, 1)
  })
})

describe('장면 질문과 답 (2.1판)', () => {
  const ITEMS = [
    { id: '0', check: '오늘 빌드인가', result: 'pass', saw: '서버 시작 시각 13:28', shot: '0.png' },
    { id: '1', check: '전날을 누르면 합계가 바뀌나', result: 'pass', saw: '11-23 합계 $150.33 그대로', shot: '1.png' },
  ]
  // check 단계, 리허설 기록까지 마친 저장소.
  function checkStage() {
    const root = tmp()
    put(root, '.rail/config.json', JSON.stringify({ railVersion: '2.1' }))
    put(root, '.rail/state.json', JSON.stringify({ ...MILESTONE, stage: 'check', gates: { scene_checked: {} } }))
    put(root, '.rail/rehearsal/M0/result.json', JSON.stringify({ items: ITEMS }))
    for (const it of ITEMS) put(root, `.rail/rehearsal/M0/${it.shot}`, 'png')
    ok(rail(root, 'rehearsal-record', 'M0'))
    return root
  }

  test('장면 질문은 판이 정한 문구로, 답의 꼴과 리허설의 실제 숫자를 예시로 든다. 옛 문구가 열려 있으면 status 가 바꿔 묻기를 알린다', () => {
    const root = checkStage()
    ok(rail(root, 'ask', '리허설 결과를 보시고 됨/안 됨을 알려 주세요', '--kind', 'approve'))
    assert.match(rail(root, 'status').out, /다음 할 일: 질문을 바꿔 묻기 — 열린 장면 질문이 레일 2\.1판의 문구가 아닙니다/)
    const r = rail(root, 'ask', '--scene', '--replace')
    ok(r)
    const q = state(root).human_ask.q
    assert.match(q, /스크린샷 2장, 통과 2\/2/)
    assert.match(q, /답 예: "됨\. 본 것: 11-23 합계 \$150\.33 그대로"/)
    assert.equal(state(root).human_ask.kind, 'scene')
    assert.ok(events(root).some((e) => e.event === 'ask_replaced' && e.new === q))
    assert.match(rail(root, 'status').out, /사람의 장면 답 기다리기/)
  })

  test('"됨"만 오면 본 것만 한 번 더 묻고 장면은 아직 기록하지 않는다. 이어 온 본 것으로 기록한다', () => {
    const root = checkStage()
    ok(rail(root, 'ask', '--scene'))
    const r = rail(root, 'answer', '됨')
    ok(r)
    assert.match(r.out, /\[다시 묻기\] 답에 본 것이 없습니다/)
    const st = state(root)
    assert.equal(st.gates.scene_checked.M0, undefined)
    assert.equal(st.human_ask.verdict, 'pass')
    assert.equal(st.human_ask.follow_up, true)
    assert.doesNotMatch(rail(root, 'status').out, /바꿔 묻기/)
    ok(rail(root, 'answer', '11-23 합계 $150.33 그대로'))
    const sc = state(root).gates.scene_checked.M0
    assert.deepEqual([sc.result, sc.note], ['pass', '11-23 합계 $150.33 그대로'])
    assert.equal(state(root).human_ask, null)
  })

  test('"됨. 본 것: …" 은 한 번에 판정과 본 것을 갈라 바로 기록한다. "안 됨" 은 fail 로 기록한다', () => {
    const root = checkStage()
    ok(rail(root, 'ask', '--scene'))
    const r = rail(root, 'answer', '됨. 본 것: 11-23 합계 $150.33 그대로')
    ok(r)
    assert.match(r.out, /\[장면 확인\] M0 pass/)
    assert.deepEqual(state(root).gates.scene_checked.M0.note, '11-23 합계 $150.33 그대로')
    const ans = events(root).find((e) => e.event === 'human_answer')
    assert.deepEqual([ans.verdict, ans.seen], ['pass', '11-23 합계 $150.33 그대로'])

    const bad = checkStage()
    ok(rail(bad, 'ask', '--scene'))
    ok(rail(bad, 'answer', '안 됨, 전날을 눌러도 $150.33 그대로'))
    assert.deepEqual(state(bad).gates.scene_checked.M0.result, 'fail')
    assert.equal(state(bad).gates.scene_checked.M0.note, '전날을 눌러도 $150.33 그대로')
  })

  test('판정 낱말만 있는 답("확인했어")도 본 것을 다시 묻고, 판정이 없는 답은 판정을 다시 묻는다', () => {
    const root = checkStage()
    ok(rail(root, 'ask', '--scene'))
    assert.match(rail(root, 'answer', '확인했어').out, /본 것이 없습니다/)
    const other = checkStage()
    ok(rail(other, 'ask', '--scene'))
    assert.match(rail(other, 'answer', '첫 화면 1.5초').out, /판정\(됨\/안 됨\)이 없습니다/)
    ok(rail(other, 'answer', '됨'))
    assert.equal(state(other).gates.scene_checked.M0.note, '첫 화면 1.5초')
  })
})

describe('마무리 검사: 사람 답을 기다리는 동안과 시각만 다른 실패', () => {
  const FAIL = { RAIL_STOP_CHECK_CMD: "node -e \"console.log('boom: 시험 실패'); process.exit(1)\"" }
  const stop = (r, env, extra = {}) => runHook('stop-check.mjs', { hook_event_name: 'Stop', cwd: r, stop_hook_active: false, ...extra }, env)
  const touch = (r) => put(r, 'src/a.mjs', `changed ${Math.random()}\n`)

  test('열린 사람 질문이 있으면 실패로 붙잡지 않고, 같은 실패는 한 번만 알린다. 답을 받은 뒤에는 다시 붙잡는다', () => {
    const r = makeRepo()
    touch(r)
    put(r, '.rail/state.json', JSON.stringify({ stage: 'milestone', milestone: 'M0', human_ask: { q: 'D-07 은 A/B 중 무엇으로 할까요?', kind: 'decide', at: '2026-11-24T04:00:00.000Z' } }))
    const first = stop(r, FAIL)
    assert.equal(first.code, 0, first.stderr)
    assert.match(first.stderr, /사람의 답을 기다리는 중이라 멈춤을 붙잡지 않는다/)
    const second = stop(r, FAIL, { stop_hook_active: true })
    assert.equal(second.code, 0)
    assert.equal(second.stderr, '', '두 번째는 알리지 않는다')
    put(r, '.rail/state.json', JSON.stringify({ stage: 'milestone', milestone: 'M0', human_ask: null }))
    assert.equal(stop(r, FAIL).code, 2)
  })

  test('출력의 시각(ISO 시각, 12:59 꼴)만 다른 실패는 같은 지문으로 보고 붙잡는 횟수 상한이 듣는다', () => {
    const r = makeRepo()
    touch(r)
    const cmd = `node -e "const h=10+Math.floor(Math.random()*13),m=String(Math.floor(Math.random()*60)).padStart(2,'0');console.log('서버 시작 '+h+':'+m+':0'+Math.floor(Math.random()*10)+' 화면 바닥 '+h+':'+m+' 기록 '+new Date(Date.now()-Math.floor(Math.random()*1e9)).toISOString());console.log('✖ 합계가 다르다');process.exit(1)"`
    const env = { RAIL_STOP_CHECK_CMD: cmd }
    assert.equal(stop(r, env).code, 2)
    assert.equal(stop(r, env, { stop_hook_active: true }).code, 2)
    const third = stop(r, env, { stop_hook_active: true })
    assert.equal(third.code, 0, third.stderr)
    assert.match(third.stderr, /같은 실패로 이미 2번 붙잡았다/)
  })
})
