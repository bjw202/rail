import assert from 'node:assert/strict'
import { rmSync } from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { DECIDED_PLAN, GOOD_PLAN, events, markRehearsed, put, rail, railRepo, state, tmp } from './helpers.mjs'

test('빈 상태: status 가 세 줄을 내고 다음 할 일이 기획 인터뷰다', () => {
  const root = tmp()
  const r = rail(root, 'status')
  assert.equal(r.code, 0)
  const lines = r.out.trim().split('\n')
  assert.equal(lines.length, 3)
  assert.match(lines[0], /^위치: /)
  assert.match(lines[1], /^기다리는 것: 없음/)
  assert.match(lines[2], /^다음 할 일: 기획 · 인터뷰/)
})

test('status --hook 은 SessionStart 형식의 JSON 을 낸다', () => {
  const j = JSON.parse(rail(railRepo(), 'status', '--hook').out)
  assert.match(j.systemMessage, /기획 · 인터뷰/)
  assert.equal(j.hookSpecificOutput.hookEventName, 'SessionStart')
  assert.match(j.hookSpecificOutput.additionalContext, /\/rail/)
})

test('status --json 은 부를 스킬을 알려 준다', () => {
  assert.equal(JSON.parse(rail(tmp(), 'status', '--json').out).skill, 'rail-plan')
})

test('관문: 단계를 건너뛰면(plan 에서 milestone) 거절한다', () => {
  const root = tmp()
  const r = rail(root, 'advance', 'milestone', '--milestone', 'M0')
  assert.equal(r.code, 1)
  assert.match(r.err, /"decide" 입니다/)
  assert.equal(JSON.parse(rail(root, 'status', '--json').out).stage, 'plan')
})

function toDecide(root) {
  put(root, 'docs/PLAN.md', GOOD_PLAN)
  assert.equal(rail(root, 'advance', 'decide', '--milestone', 'M0').code, 0)
}

test('관문: 착수 전 결정이 풀리기 전과 다음 마일스톤의 step 표는 막는다', () => {
  const root = tmp()
  toDecide(root)
  put(root, 'docs/plan/M0.md', '| M0-1 | 구현 | x | y | z | |\n')
  assert.match(rail(root, 'status').out, /관문 위반/)
  put(root, 'docs/PLAN.md', DECIDED_PLAN)
  assert.equal(rail(root, 'advance', 'milestone').code, 0, '표가 먼저 있어도 관문은 순서만 본다')
  put(root, 'docs/plan/M0.md', '| M0-1 | 구현 | x | y | z | |\n')
  // 이제 M0 표는 허용, M1 표는 거절
  assert.equal(rail(root, 'status').out.includes('관문 위반'), false)
  put(root, 'docs/plan/M1.md', '| M1-1 | 구현 | x | y | z | |\n')
  assert.match(rail(root, 'status').out, /관문 위반 — docs\/plan\/M1\.md: .*다음 마일스톤 밖/)
})

test('마일스톤 한 바퀴: step 이 끝나야 check, 장면 확인이 있어야 close', () => {
  const root = tmp()
  toDecide(root)
  put(root, 'docs/PLAN.md', DECIDED_PLAN)
  rail(root, 'advance', 'milestone')
  put(root, 'docs/plan/M0.md', '| step | 맡는 쪽 | 할 일 | 파일 | 완료 | 상태 |\n|---|---|---|---|---|---|\n| M0-1 | 구현 | a | b | c | 끝(11-24) |\n| M0-2 | 구현 | a | b | c | |\n')
  assert.match(rail(root, 'status').out, /step M0-2 진행/)
  put(root, 'docs/plan/M0.md', '| M0-1 | 구현 | a | b | c | 끝(11-24) |\n')
  assert.equal(rail(root, 'advance', 'check').code, 0)
  assert.equal(state(root).stage, 'check')
  // 장면 확인 기록 없이는 닫을 수 없다
  const blocked = rail(root, 'advance', 'close')
  assert.equal(blocked.code, 1)
  assert.match(blocked.err, /사람 장면 확인 기록이 없습니다/)
  assert.match(rail(root, 'scene', 'M0', '--result', 'pass', '--note', '됨').err, /장면 리허설 기록이 없습니다/)
  markRehearsed(root)
  assert.equal(rail(root, 'scene', 'M0', '--result', 'pass').code, 1, '느낀 점 없이는 기록하지 않는다')
  assert.equal(rail(root, 'scene', 'M0', '--result', 'pass', '--note', '됨. 처음 열 때 3초').code, 0)
  assert.equal(rail(root, 'advance', 'close').code, 0)
  const st = state(root)
  assert.deepEqual([st.stage, st.milestone, st.closed], ['decide', 'M1', ['M0']])
  const names = events(root).map((e) => e.event)
  for (const n of ['gate_blocked', 'stage_advance', 'scene_check', 'milestone_closed']) assert.ok(names.includes(n), n)
})

test('장면 확인이 fail 이면 닫을 수 없고, reopen 으로 되돌린다', () => {
  const root = tmp()
  toDecide(root)
  put(root, 'docs/PLAN.md', DECIDED_PLAN)
  rail(root, 'advance', 'milestone')
  put(root, 'docs/plan/M0.md', '| M0-1 | 구현 | a | b | c | 끝 |\n')
  rail(root, 'advance', 'check')
  markRehearsed(root)
  rail(root, 'scene', 'M0', '--result', 'fail', '--note', '그림이 안 보임')
  assert.match(rail(root, 'check', 'close').err, /"fail" 로 기록/)
  assert.equal(rail(root, 'reopen').code, 0)
  assert.equal(state(root).stage, 'milestone')
  assert.equal(state(root).gates.scene_checked.M0, undefined)
})

test('ask/answer: 질문은 한 번에 하나, 개수 상한 없이 세고 세 번마다 되짚기를 알리며, 시각을 기록한다', () => {
  const root = tmp()
  assert.equal(rail(root, 'ask', '누가 쓰나요?').code, 0)
  assert.match(rail(root, 'status').out, /기다리는 것: 사람의 답 — "누가 쓰나요\?"/)
  assert.equal(rail(root, 'ask', '또 하나').code, 1, '답 없이 두 번째 질문 금지')
  assert.equal(rail(root, 'answer', '나요').code, 0)
  assert.equal(rail(root, 'answer', '또').code, 1, '질문 없이 답 금지')
  for (let i = 2; i <= 8; i++) {
    const r = rail(root, 'ask', `Q${i}`)
    assert.equal(r.code, 0)
    assert.equal(/되짚어/.test(r.out), i % 3 === 0, `질문 ${i}`)
    rail(root, 'answer', 'a')
  }
  const nine = rail(root, 'ask', 'Q9')
  assert.equal(nine.code, 0, '기획서 판: 인터뷰 질문 8개 상한을 뺐다')
  assert.match(nine.out, /\[질문 9 · .*되짚어/)
  rail(root, 'answer', 'a')
  assert.equal(rail(root, 'ask', '이 장면이 맞나요?', '--kind', 'approve').code, 0, '승인 질문은 인터뷰 수에 안 센다')
  const ev = events(root)
  assert.equal(ev.filter((e) => e.event === 'human_ask').length, 10)
  const ans = ev.find((e) => e.event === 'human_answer')
  assert.equal(typeof ans.wait_sec, 'number')
  assert.ok(Date.parse(ans.t) > 0)
})

test('log: 임의 사건을 남긴다. request 명령은 없다(사용법 오류 2)', () => {
  const root = tmp()
  assert.equal(rail(root, 'log', 'worker_start', '{"step":"M0-1","agent":"claude"}').code, 0)
  assert.equal(rail(root, 'log', 'note', '그냥 글').code, 0)
  const ev = events(root)
  assert.equal(ev[0].step, 'M0-1')
  assert.equal(ev[1].note, '그냥 글')
  assert.equal(rail(root, 'request', 'change', 'HTML 도 열고 싶어').code, 2)
})

test('알 수 없는 명령은 사용법 오류(2)', () => {
  assert.equal(rail(tmp(), 'bogus').code, 2)
})
