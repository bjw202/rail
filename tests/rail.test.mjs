import assert from 'node:assert/strict'
import { rmSync } from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { DECIDED, GOOD_BRIEF, GOOD_ROADMAP, events, put, rail, state, tmp } from './helpers.mjs'

test('빈 상태: status 가 세 줄을 내고 다음 할 일이 브리프 인터뷰다', () => {
  const root = tmp()
  const r = rail(root, 'status')
  assert.equal(r.code, 0)
  const lines = r.out.trim().split('\n')
  assert.equal(lines.length, 3)
  assert.match(lines[0], /^위치: /)
  assert.match(lines[1], /^기다리는 것: 없음/)
  assert.match(lines[2], /^다음 할 일: 기획 · 브리프 인터뷰/)
})

test('status --hook 은 SessionStart 형식의 JSON 을 낸다', () => {
  const j = JSON.parse(rail(tmp(), 'status', '--hook').out)
  assert.match(j.systemMessage, /브리프 인터뷰/)
  assert.equal(j.hookSpecificOutput.hookEventName, 'SessionStart')
  assert.match(j.hookSpecificOutput.additionalContext, /\/rail/)
})

test('status --json 은 부를 스킬을 알려 준다', () => {
  assert.equal(JSON.parse(rail(tmp(), 'status', '--json').out).skill, 'rail-brief')
})

test('관문: 단계를 건너뛰면(brief 에서 milestone) 거절한다', () => {
  const root = tmp()
  const r = rail(root, 'advance', 'milestone', '--milestone', 'M0')
  assert.equal(r.code, 1)
  assert.match(r.err, /"roadmap" 입니다/)
  assert.equal(JSON.parse(rail(root, 'status', '--json').out).stage, 'brief')
})

function toDecide(root) {
  put(root, 'docs/BRIEF.md', GOOD_BRIEF)
  assert.equal(rail(root, 'advance', 'roadmap').code, 0)
  put(root, 'docs/ROADMAP.md', GOOD_ROADMAP)
  assert.equal(rail(root, 'advance', 'decide', '--milestone', 'M0').code, 0)
}

test('관문: 위험 질문이 정해지기 전과 다음 마일스톤의 step 표는 막는다', () => {
  const root = tmp()
  toDecide(root)
  put(root, 'docs/plan/M0.md', '| M0-1 | 구현 | x | y | z | |\n')
  assert.match(rail(root, 'status').out, /관문 위반/)
  put(root, 'docs/decisions/D-01.md', DECIDED)
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
  put(root, 'docs/decisions/D-01.md', DECIDED)
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
  put(root, 'docs/decisions/D-01.md', DECIDED)
  rail(root, 'advance', 'milestone')
  put(root, 'docs/plan/M0.md', '| M0-1 | 구현 | a | b | c | 끝 |\n')
  rail(root, 'advance', 'check')
  rail(root, 'scene', 'M0', '--result', 'fail', '--note', '그림이 안 보임')
  assert.match(rail(root, 'check', 'close').err, /"fail" 로 기록/)
  assert.equal(rail(root, 'reopen').code, 0)
  assert.equal(state(root).stage, 'milestone')
  assert.equal(state(root).gates.scene_checked.M0, undefined)
})

test('ask/answer: 질문은 한 번에 하나, 8개까지, 시각을 기록한다', () => {
  const root = tmp()
  assert.equal(rail(root, 'ask', '누가 쓰나요?').code, 0)
  assert.match(rail(root, 'status').out, /기다리는 것: 사람의 답 — "누가 쓰나요\?"/)
  assert.equal(rail(root, 'ask', '또 하나').code, 1, '답 없이 두 번째 질문 금지')
  assert.equal(rail(root, 'answer', '나요').code, 0)
  assert.equal(rail(root, 'answer', '또').code, 1, '질문 없이 답 금지')
  for (let i = 2; i <= 8; i++) {
    assert.equal(rail(root, 'ask', `Q${i}`).code, 0)
    rail(root, 'answer', 'a')
  }
  const nine = rail(root, 'ask', 'Q9')
  assert.equal(nine.code, 1)
  assert.match(nine.err, /8개까지/)
  assert.equal(rail(root, 'ask', '이 장면이 맞나요?', '--kind', 'approve').code, 0, '승인 질문은 인터뷰 수에 안 센다')
  const ev = events(root)
  assert.equal(ev.filter((e) => e.event === 'human_ask').length, 9)
  const ans = ev.find((e) => e.event === 'human_answer')
  assert.equal(typeof ans.wait_sec, 'number')
  assert.ok(Date.parse(ans.t) > 0)
})

test('log 와 request: 임의 사건과 change/bug 요청을 남긴다', () => {
  const root = tmp()
  assert.equal(rail(root, 'log', 'worker_start', '{"step":"M0-1","agent":"claude"}').code, 0)
  assert.equal(rail(root, 'log', 'note', '그냥 글').code, 0)
  const r = rail(root, 'request', 'change', 'HTML 도 열고 싶어')
  assert.match(r.out, /아직 없/)
  const ev = events(root)
  assert.equal(ev[0].step, 'M0-1')
  assert.equal(ev[1].note, '그냥 글')
  assert.deepEqual([ev[2].event, ev[2].kind, ev[2].text], ['rail_request', 'change', 'HTML 도 열고 싶어'])
  assert.equal(rail(root, 'request', 'nope', 'x').code, 2)
})

test('알 수 없는 명령은 사용법 오류(2)', () => {
  assert.equal(rail(tmp(), 'bogus').code, 2)
})
