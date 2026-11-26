// 개발 중 기능 추가(hbo-tube M3-5·M3-6 사건 뒤): 표 승인 답이 그때의 줄 목록을 남기고, 승인 뒤 더한 기능 줄을 시작하기 전에
// "다음 할 일"이 승인 문구를 먼저 낸다(막지는 않는다). 자율 모드면 "## 나중에" 로 옮기라고 한다. 기획서 틀의 "## 나중에" 절은 검사가 요구하지 않는다.
// 규칙: 저장소의 .rail/config.json 값을 단언하지 않는다. 설정은 모두 임시 저장소에 만든다.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { GOOD_PLAN, RAIL, events, put, tmp } from './helpers.mjs'

const HEAD = '| step | 맡는 쪽 | 할 일 | 고쳐도 되는 파일 | 기다리는 step | 완료 기준 | 상태 |\n|---|---|---|---|---|---|---|\n'
const OFF = { commitPolicy: 'auto-local', autonomy: { mode: 'off' } }
const ON = { commitPolicy: 'auto-local', autonomy: { mode: 'on' } }
const Q = '이대로 시작할까요? (시작 / 바꿀 것)'
const row = (id, role = '기능') => `| ${id} | ${role} | 일 ${id} | src/${id}.mjs | 없음 | 기준 | |`

function run(root, args) {
  const env = { ...process.env, ORCA_CLI_COMMAND: '/nonexistent/orca', RAIL_ROOT: root }
  for (const k of ['NODE_TEST_CONTEXT', 'RAIL_NO_TOUCH', 'CLAUDE_CODE_SESSION_ID', 'ORCA_AGENT_SESSION_ID', 'ORCA_TERMINAL_HANDLE']) delete env[k]
  const r = spawnSync(process.execPath, [RAIL, ...args], { encoding: 'utf8', env })
  return { code: r.status, out: r.stdout, err: r.stderr }
}
const ok = (r) => (assert.equal(r.code, 0, r.err + r.out), r)
const next = (root) => JSON.parse(ok(run(root, ['status', '--json'])).out).next
const table = (root, rows) => put(root, 'docs/plan/M0.md', `# M0\n\n${HEAD}${rows.join('\n')}\n`)
function milestoneRoot(config, rows) {
  const root = tmp('railmid-')
  put(root, '.rail/config.json', JSON.stringify(config))
  put(root, '.rail/state.json', JSON.stringify({ project: 'demo', stage: 'milestone', milestone: 'M0', step: null, closed: [], gates: { scene_checked: {}, rehearsed: {} } }))
  put(root, 'docs/PLAN.md', GOOD_PLAN)
  table(root, rows)
  return root
}
const approve = (root, text = '시작') => (ok(run(root, ['ask', Q, '--kind', 'approve'])), ok(run(root, ['answer', text])))

describe('승인 뒤 더한 기능 줄', () => {
  test('표 승인 답은 그때의 줄 목록을 남기고, 처음 표의 줄에는 승인 문구를 다시 내지 않는다', () => {
    const root = milestoneRoot(OFF, [row('M0-1'), row('M0-2')])
    assert.match(next(root), /표를 사람이 승인하지 않았으면/)
    approve(root)
    assert.deepEqual(events(root).at(-1).steps, ['M0-1', 'M0-2'])
    ok(run(root, ['step-start', 'M0-1']))
    assert.doesNotMatch(next(root), /더한 기능/)
  })

  test('승인 뒤 더한 기능 줄을 시작하려 하면 next 가 더한 줄과 승인 문구를 먼저 내고, step-start 는 막지 않는다', () => {
    const root = milestoneRoot(OFF, [row('M0-1'), row('M0-2')])
    approve(root)
    ok(run(root, ['step-start', 'M0-1']))
    table(root, [row('M0-1').replace('| |', '| ⏳ 진행 중 |'), row('M0-2'), row('M0-3'), row('M0-4', '고침')])
    const n = next(root)
    assert.match(n, /함께 시작할 수 있는 step: M0-2, M0-3, M0-4 \(표 승인 뒤 더한 기능 줄 M0-3 을\(를\) 보여 주고 ask "이대로 시작할까요\? \(시작 \/ 바꿀 것\)" --kind approve/)
    assert.ok(!/더한 기능 줄 [^(]*M0-[24]/.test(n), '처음 표의 줄과 고침 줄은 더한 기능 줄이 아니다')
    // 아무 줄도 진행 중이 아닐 때도 같은 문구가 먼저 나온다.
    table(root, [row('M0-1').replace('| |', '| ✅ 끝 |'), row('M0-3')])
    assert.match(next(root), /^step M0-3 진행 — 표 승인 뒤 더한 기능 줄 M0-3 을\(를\) 보여 주고 ask/)
    ok(run(root, ['step-start', 'M0-3']))
    assert.ok(!events(root).some((e) => e.event === 'gate_blocked'))
  })

  test('승인 답이 다시 오면 줄 목록을 새로 찍고 안내가 사라진다', () => {
    const root = milestoneRoot(OFF, [row('M0-1')])
    approve(root)
    ok(run(root, ['step-start', 'M0-1']))
    table(root, [row('M0-1').replace('| |', '| ✅ 끝 |'), row('M0-2')])
    assert.match(next(root), /더한 기능 줄 M0-2/)
    approve(root, '시작')
    assert.deepEqual(events(root).at(-1).steps, ['M0-1', 'M0-2'])
    assert.doesNotMatch(next(root), /더한 기능/)
  })

  test('다른 승인 질문(시험 고치기 허락 등)의 답은 줄 목록을 찍지 않는다', () => {
    const root = milestoneRoot(OFF, [row('M0-1')])
    approve(root)
    ok(run(root, ['step-start', 'M0-1']))
    table(root, [row('M0-1').replace('| |', '| ✅ 끝 |'), row('M0-2')])
    ok(run(root, ['ask', 'M0-1 에서 시험 고치기를 허락할까요? (그 줄과 까닭)', '--kind', 'approve']))
    ok(run(root, ['answer', '그래']))
    assert.equal(events(root).at(-1).steps, undefined)
    assert.match(next(root), /더한 기능 줄 M0-2/)
  })

  test('자율 모드면 승인 문구 대신 "## 나중에" 로 옮기라고 한다(auto_start 의 줄 목록이 기준)', () => {
    const root = milestoneRoot(ON, [row('M0-1')])
    ok(run(root, ['step-start', 'M0-1']))
    table(root, [row('M0-1').replace('| |', '| ✅ 끝 |'), row('M0-2')])
    const n = next(root)
    assert.match(n, /자율 모드: 승인 뒤 더한 기능 M0-2 은\(는\) 기본으로 기획서 "## 나중에" 로 옮기고 표에서 뺀다/)
    assert.doesNotMatch(n, /--kind approve/)
  })

  test('기준 목록이 없으면(옛 기록) 안내하지 않는다', () => {
    const root = milestoneRoot(OFF, [row('M0-1')])
    put(root, '.rail/log.jsonl', JSON.stringify({ t: '2026-11-26T00:00:00.000Z', event: 'human_answer', stage: 'milestone', milestone: 'M0', q: Q, kind: 'approve', text: '시작' }) + '\n')
    ok(run(root, ['step-start', 'M0-1']))
    table(root, [row('M0-1').replace('| |', '| ✅ 끝 |'), row('M0-2')])
    assert.doesNotMatch(next(root), /더한 기능/)
  })
})

describe('기획서의 "## 나중에" 절', () => {
  const TEMPLATE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../templates/.rail/plan/template.md')

  test('틀에 절 머리와 주석 한 줄이 있다', () => {
    const t = readFileSync(TEMPLATE, 'utf8')
    assert.match(t, /\n## 나중에\n<!-- 주인이 "나중에"라고 한 일을 한 줄씩, 주인 말 그대로\. 다음 마일스톤을 기획할 때 읽는다\. -->\n?$/)
  })

  test('"## 나중에" 가 없는 옛 기획서도, 있는 기획서도 기획서 검사를 통과한다', () => {
    for (const sheet of [GOOD_PLAN, `${GOOD_PLAN}\n## 나중에\n- 대문 단추가 있으면 좋겠다 (주인 말)\n`]) {
      const root = tmp('railmidp-')
      put(root, '.rail/state.json', JSON.stringify({ project: 'demo', stage: 'plan', milestone: null, step: null, closed: [], interview: { asked: 3 }, gates: { scene_checked: {} } }))
      put(root, 'docs/PLAN.md', sheet)
      assert.match(next(root), /^기획서가 승인됐습니다/)
    }
  })
})
