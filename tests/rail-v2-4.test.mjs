// 레일 2.4판 시험: 시식용 시제품 단계. 가짜 Orca CLI 로 돌린다(진짜 작업자는 띄우지 않는다).
// 시제품 카드는 기록 전 결정 질문 거절, proto start 가 변주마다 새 작업 공간 작업자를 띄우고 지시서에 앞으로 감기·상한·스크린샷 목록을 넣음,
// proto record 형식 검사, proto card 표와 compare.html, proto pick 의 기준 화면 복사와 작업 공간 정리,
// 자율 모드에서 사람 질문 한 번. (커밋 관문의 시제품 브랜치 거절은 M14 뒤 덜어내기에서 지웠다.)
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, test } from 'node:test'
import { RAIL, events, put, state, tmp } from './helpers.mjs'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const ROADMAP = `# 로드맵
승인: 2026-11-24
## M0 뼈대 ✅ (2026-11-20)
- 끝나는 장면: 한 줄이 보인다
- 위험 질문: 없음
- 예상 기간: 1일
## M7 대시보드 다듬기
- 끝나는 장면: 대시보드가 보기 좋다
- 위험 질문: D-09 카드 배치, D-10 글꼴
- 예상 기간: 2일
`
const CARD = `# D-09 프로젝트 카드 배치
상태: 제안
마일스톤: M7
시제품: 예
## 질문
프로젝트 카드를 어떻게 늘어놓을지 정한다.
## 변주
- p1-grid: 같은 크기 카드 3열
- p2-big: 비싼 프로젝트는 큰 카드, 나머지는 작게
- p3-rows: 가로 줄 카드
## 스크린샷
- d-1124.png: 2026-11-24, 데스크톱 폭 1280
- m-1124.png: 2026-11-24, 폰 폭 390
## 후보
### A 같은 크기
### B 큰 카드
## 추천
B. 이유: 비싼 것이 먼저 보인다.
`
const PLAIN = `# D-10 글꼴\n상태: 제안\n마일스톤: M7\n## 질문\n글꼴\n`
const VARIANTS = ['p1-grid', 'p2-big', 'p3-rows']

function cleanEnv(extra = {}) {
  const env = { ...process.env, ...extra }
  for (const k of ['CLAUDE_CODE_SESSION_ID', 'ORCA_AGENT_SESSION_ID', 'ORCA_TERMINAL_HANDLE', 'NODE_TEST_CONTEXT', 'RAIL_NO_TOUCH']) if (!(k in extra)) delete env[k]
  return env
}
const run = (root, args, env = {}) => {
  const r = spawnSync(process.execPath, [RAIL, ...args], { encoding: 'utf8', env: { ...cleanEnv(env), RAIL_ROOT: root } })
  return { code: r.status, out: r.stdout, err: r.stderr }
}
const ok = (r) => assert.equal(r.code, 0, r.err + r.out)

// 가짜 Orca CLI: 부른 인자를 calls.jsonl 에 남긴다. worker-start(new-child)는 작업 공간 경로와 브랜치를 돌려준다.
function fakeOrca(root) {
  const dir = path.join(root, 'fake')
  put(root, 'fake/orca.mjs', `#!/usr/bin/env node
import { appendFileSync } from 'node:fs'
const args = process.argv.slice(2)
appendFileSync(${JSON.stringify(dir)} + '/calls.jsonl', JSON.stringify(args) + '\\n')
const opt = (k) => args[args.indexOf(k) + 1]
const say = (o) => process.stdout.write(JSON.stringify(o))
const [a, b] = args
if (a === 'orchestration' && b === 'worker-start') say({ ok: true, result: { dispatchId: 'ctx_' + opt('--name'), worktree: { path: ${JSON.stringify(path.join(root, 'wt'))} + '/' + opt('--name'), branch: 'bjw/' + opt('--name') } } })
else if (a === 'orchestration' && b === 'worker-show') say({ ok: true, result: { state: 'succeeded', stage: 'settled' } })
else if (a === 'orchestration' && b === 'worker-read') say({ ok: true, result: { report: '시제품 끝' } })
else if (a === 'orchestration' && ['worker-release', 'worker-stop'].includes(b)) say({ ok: true, result: {} })
else if (a === 'worktree' && b === 'rm') say({ ok: true, result: { removed: opt('--worktree') } })
else { process.stderr.write('알 수 없는 명령'); process.exit(2) }
`)
  spawnSync('chmod', ['+x', path.join(dir, 'orca.mjs')])
  const calls = () => (existsSync(path.join(dir, 'calls.jsonl')) ? readFileSync(path.join(dir, 'calls.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : [])
  return { env: { ORCA_CLI_COMMAND: path.join(dir, 'orca.mjs') }, calls }
}
const sub = (calls, a, b) => calls.filter((c) => c[0] === a && c[1] === b)
const opt = (c, k) => c[c.indexOf(k) + 1]

// 결정 단계(M7)의 저장소. config 는 .rail/config.json 에 더할 값.
function protoRoot(config = {}) {
  const root = tmp('rail24-')
  put(root, '.rail/config.json', JSON.stringify({ railVersion: '2.4', ...config }))
  put(root, '.rail/state.json', JSON.stringify({ project: 'demo', stage: 'decide', milestone: 'M7', step: null, closed: ['M0'], gates: { scene_checked: {} } }))
  mkdirSync(path.join(root, '.rail/proto'), { recursive: true })
  copyFileSync(path.join(REPO, 'templates/.rail/proto/template.md'), path.join(root, '.rail/proto/template.md'))
  put(root, 'docs/ROADMAP.md', ROADMAP)
  put(root, 'docs/decisions/D-09-cards.md', CARD)
  put(root, 'docs/decisions/D-10-font.md', PLAIN)
  return { root, orca: fakeOrca(root) }
}
const vdir = (root, v) => path.join(root, '.rail/proto/D-09', v)
// 작업자가 하는 일 흉내: 스크린샷 두 장과 결과 JSON 을 변주 폴더에 쓴다.
function workerResult(root, v, over = {}) {
  for (const s of ['d-1124.png', 'm-1124.png']) put(root, `.rail/proto/D-09/${v}/${s}`, `PNG ${v} ${s}`)
  const r = { shots: ['d-1124.png', 'm-1124.png'], measured: { 'd-1124.png 뜨는 시간': '1.4초' }, good: [`${v} 좋음 1`, `${v} 좋음 2`], bad: [`빈 도구 칸이 보인다`, `${v} 거슬림`], minutes: 6, usd: 0.8, ...over }
  put(root, `.rail/proto/D-09/${v}/result.json`, JSON.stringify(r))
}
const started = (root, orca) => {
  ok(run(root, ['proto', 'start', 'D-09'], orca.env))
  for (const v of VARIANTS) ok(run(root, ['worker', 'done', `D-09:${v}`], orca.env))
}
const recordAll = (root, orca) => {
  for (const v of VARIANTS) {
    workerResult(root, v)
    ok(run(root, ['proto', 'record', 'D-09', v], orca.env))
  }
}

describe('결정 질문 전 시제품 기록', () => {
  test('"시제품: 예" 가 없거나 변주가 2~3개가 아니면 proto start 가 거절한다', () => {
    const { root, orca } = protoRoot()
    const plain = run(root, ['proto', 'start', 'D-10'], orca.env)
    assert.equal(plain.code, 1)
    assert.match(plain.err, /"시제품: 예" 줄이 없습니다/)
    put(root, 'docs/decisions/D-09-cards.md', CARD.replace(/- p2-big.*\n- p3-rows.*\n/, ''))
    assert.match(run(root, ['proto', 'start', 'D-09'], orca.env).err, /변주가 2~3개여야 합니다 \(지금 1개/)
    assert.equal(orca.calls().length, 0, '거절하면 작업자를 띄우지 않는다')
  })
})

describe('proto start', () => {
  test('변주 수만큼 새 작업 공간에 작업자를 띄우고, 지시서 맨 앞에 앞으로 감기와 상한·스크린샷 목록을 넣는다', () => {
    const { root, orca } = protoRoot({ proto: { maxMinutes: 12, maxUSD: 2.5 } })
    const r = run(root, ['proto', 'start', 'D-09'], orca.env)
    ok(r)
    const ws = sub(orca.calls(), 'orchestration', 'worker-start')
    assert.equal(ws.length, 3)
    for (const [i, v] of VARIANTS.entries()) {
      assert.deepEqual([opt(ws[i], '--worktree'), opt(ws[i], '--name'), opt(ws[i], '--base-branch'), opt(ws[i], '--agent')], ['new-child', `proto-D-09-${v}`, 'main', 'claude'])
      assert.equal(opt(ws[i], '--spec-file'), path.join(vdir(root, v), 'spec.md'))
      const spec = readFileSync(path.join(vdir(root, v), 'spec.md'), 'utf8')
      const first = spec.split('\n## ')[1]
      assert.match(first, /^0\. 먼저 할 것\n.*git merge --ff-only main/, '첫 절이 앞으로 감기다')
      assert.match(spec, /시간 12분, 비용 \$2\.5 안/)
      assert.match(spec, new RegExp(`변주: ${v}`))
      assert.match(spec, /`d-1124\.png` — 2026-11-24, 데스크톱 폭 1280/)
      assert.match(spec, /`m-1124\.png` — 2026-11-24, 폰 폭 390/)
      assert.ok(spec.includes(`${vdir(root, v)}/`), '스크린샷은 리더 폴더의 .rail/proto/D-09/<변주>/ 에 둔다')
      assert.ok(spec.includes(path.join(vdir(root, v), 'result.json')))
      assert.doesNotMatch(spec, /\{\{\w+\}\}/, '틀의 빈칸이 모두 채워졌다')
    }
    const starts = events(root).filter((e) => e.event === 'worker_start')
    assert.deepEqual(starts.map((e) => [e.step, e.role, e.proto, e.variant]), VARIANTS.map((v) => [`D-09:${v}`, 'proto', 'D-09', v]))
    assert.equal(starts[0].worktree, path.join(root, 'wt', 'proto-D-09-p1-grid'))
    assert.equal(starts[0].branch, 'bjw/proto-D-09-p1-grid')
    const next = JSON.parse(run(root, ['next', '--json'], orca.env).out)
    assert.equal(next.stop.code, 'busy')
    assert.match(next.stop.reason, /D-09:p1-grid\(claude, proto\)/)
    assert.match(run(root, ['status'], orca.env).out, /시제품 작업자 진행 중/)
    const again = run(root, ['proto', 'start', 'D-09'], orca.env)
    assert.equal(again.code, 1)
    assert.match(again.err, /닫지 않은 시제품 작업자/)
  })

  test('worker done 은 창 핸들이 없는 시제품 작업자를 worker-release 로 놓아 주고 닫힘을 남긴다', () => {
    const { root, orca } = protoRoot()
    ok(run(root, ['proto', 'start', 'D-09'], orca.env))
    const r = run(root, ['worker', 'done', 'D-09:p1-grid'], orca.env)
    ok(r)
    assert.equal(opt(sub(orca.calls(), 'orchestration', 'worker-release')[0], '--dispatch'), 'ctx_proto-D-09-p1-grid')
    const closed = events(root).filter((e) => e.event === 'worker_closed')
    assert.deepEqual(closed.map((e) => [e.step, e.close_error ?? null]), [['D-09:p1-grid', null]])
  })
})

describe('proto record', () => {
  test('빠진 칸, 2개가 안 되는 좋은 점, 변주 폴더 밖 스크린샷, 잘못된 비용을 거절한다', () => {
    const { root, orca } = protoRoot()
    assert.match(run(root, ['proto', 'record', 'D-09', 'p1-grid'], orca.env).err, /없거나 JSON 객체가 아닙니다/)
    assert.equal(run(root, ['proto', 'record', 'D-09', 'p9'], orca.env).code, 2)
    workerResult(root, 'p1-grid', { good: ['하나뿐'], shots: ['d-1124.png', '../p2-big/x.png'], usd: 'free', measured: {} })
    const r = run(root, ['proto', 'record', 'D-09', 'p1-grid'], orca.env)
    assert.equal(r.code, 1)
    for (const m of [/good: 좋은 점이 2개/, /shots: \.\.\/p2-big\/x\.png 가/, /usd: 비용은 숫자이거나/, /measured: 잰 값이 없습니다/]) assert.match(r.err, m)
    put(root, 'bad.json', '{ 깨짐')
    assert.match(run(root, ['proto', 'record', 'D-09', 'p1-grid', '--file', 'bad.json'], orca.env).err, /JSON 이 아닙니다/)
    assert.ok(!events(root).some((e) => e.event === 'proto_record'))
  })

  test('맞는 기록은 result.json 을 다듬어 쓰고 proto_record 를 남긴다. 빠진 화면과 "모름" 비용도 적는다', () => {
    const { root, orca } = protoRoot()
    workerResult(root, 'p1-grid', { shots: ['d-1124.png'], usd: '모름' })
    const r = run(root, ['proto', 'record', 'D-09', 'p1-grid'], orca.env)
    ok(r)
    assert.match(r.out, /빠진 화면: m-1124\.png/)
    assert.match(r.out, /비용 모름/)
    assert.match(r.out, /남은 변주: p2-big, p3-rows/)
    const e = events(root).at(-1)
    assert.deepEqual([e.event, e.proto, e.variant, e.usd, e.missing], ['proto_record', 'D-09', 'p1-grid', null, ['m-1124.png']])
    assert.equal(JSON.parse(readFileSync(path.join(vdir(root, 'p1-grid'), 'result.json'), 'utf8')).usd, null)
  })
})

describe('proto card 와 proto pick', () => {
  test('기록이 다 모이면 카드에 변주별 표를 붙이고 compare.html 을 만들고 "어느 변주로" 질문을 연다', () => {
    const { root, orca } = protoRoot()
    started(root, orca)
    workerResult(root, 'p1-grid')
    ok(run(root, ['proto', 'record', 'D-09', 'p1-grid'], orca.env))
    const early = run(root, ['proto', 'card', 'D-09'], orca.env)
    assert.equal(early.code, 1)
    assert.match(early.err, /p2-big: proto record D-09 p2-big/)
    for (const v of ['p2-big', 'p3-rows']) {
      workerResult(root, v)
      ok(run(root, ['proto', 'record', 'D-09', v], orca.env))
    }
    assert.match(run(root, ['status'], orca.env).out, /proto card D-09/)
    ok(run(root, ['proto', 'card', 'D-09'], orca.env))
    const card = readFileSync(path.join(root, 'docs/decisions/D-09-cards.md'), 'utf8')
    assert.ok(card.startsWith(CARD.trimEnd()), '카드 본문은 그대로 둔다')
    assert.match(card, /## 시제품 결과 \(proto card, \d{4}-\d{2}-\d{2}\)/)
    assert.match(card, /\| p2-big \| 비싼 프로젝트는 큰 카드, 나머지는 작게 \| d-1124\.png 뜨는 시간 1\.4초 \| p2-big 좋음 1; p2-big 좋음 2 \| 빈 도구 칸이 보인다; p2-big 거슬림 \| 6분 · \$0\.80 \| \.rail\/proto\/D-09\/p2-big\/d-1124\.png, \.rail\/proto\/D-09\/p2-big\/m-1124\.png \|/)
    assert.match(card, /- 공통 문제: \(리더가 한 줄로/)
    const page = readFileSync(path.join(root, '.rail/proto/D-09/compare.html'), 'utf8')
    for (const v of VARIANTS) assert.ok(page.includes(`src="${v}/d-1124.png"`), '스크린샷은 상대 경로로 건다')
    assert.match(page, /어느 변주로 할까요\(또는 섞어서\)\?/)
    const ask = state(root).human_ask
    assert.deepEqual([ask.kind, ask.proto], ['decide', 'D-09'])
    assert.match(ask.q, /^어느 변주로 할까요\(또는 섞어서\)\? D-09/)
    // 리더가 공통 문제를 적은 뒤 다시 불러도 그 줄은 남는다.
    writeFileSync(path.join(root, 'docs/decisions/D-09-cards.md'), card.replace(/- 공통 문제: .*/, '- 공통 문제: 세 변주 모두 빈 도구 칸이 보인다'))
    ok(run(root, ['answer', 'p2'], orca.env))
    ok(run(root, ['proto', 'card', 'D-09'], orca.env))
    const again = readFileSync(path.join(root, 'docs/decisions/D-09-cards.md'), 'utf8')
    assert.match(again, /- 공통 문제: 세 변주 모두 빈 도구 칸이 보인다/)
    assert.equal(again.match(/## 시제품 결과/g).length, 1, '표는 바꿔 쓴다')
  })

  test('결정이 기록되면 고른 변주의 스크린샷을 .rail/reference/Mx/ 로 옮기고 시제품 작업 공간과 브랜치를 지운다', () => {
    const { root, orca } = protoRoot()
    started(root, orca)
    recordAll(root, orca)
    ok(run(root, ['proto', 'card', 'D-09'], orca.env))
    ok(run(root, ['answer', 'p2-big 로'], orca.env))
    const early = run(root, ['proto', 'pick', 'D-09', 'p2-big'], orca.env)
    assert.equal(early.code, 1)
    assert.match(early.err, /결정이 아직 기록되지 않았습니다/)
    put(root, 'docs/decisions/D-09-cards.md', readFileSync(path.join(root, 'docs/decisions/D-09-cards.md'), 'utf8').replace('상태: 제안', '상태: 결정됨\n선택: B (p2-big)'))
    put(root, 'docs/decisions/D-10-font.md', PLAIN.replace('상태: 제안', '상태: 결정됨\n선택: A'))
    assert.match(run(root, ['status'], orca.env).out, /proto pick D-09/)
    assert.equal(run(root, ['proto', 'pick', 'D-09', 'p9'], orca.env).code, 2)
    ok(run(root, ['proto', 'pick', 'D-09', 'p2-big'], orca.env))
    const ref = path.join(root, '.rail/reference/M7')
    assert.equal(readFileSync(path.join(ref, 'D-09-p2-big-d-1124.png'), 'utf8'), 'PNG p2-big d-1124.png')
    assert.ok(existsSync(path.join(ref, 'D-09-p2-big-m-1124.png')))
    assert.ok(!existsSync(path.join(ref, 'D-09-p1-grid-d-1124.png')))
    assert.match(readFileSync(path.join(ref, 'README.md'), 'utf8'), /`D-09-p2-big-m-1124\.png` — 2026-11-24, 폰 폭 390/)
    const rm = sub(orca.calls(), 'worktree', 'rm')
    assert.deepEqual(rm.map((c) => opt(c, '--worktree')), VARIANTS.map((v) => `path:${path.join(root, 'wt', `proto-D-09-${v}`)}`))
    assert.ok(rm.every((c) => c.includes('--delete-branch') && c.includes('--force')))
    const picked = events(root).find((e) => e.event === 'proto_picked')
    assert.deepEqual([picked.picked, picked.milestone, picked.removed.every((x) => x.ok)], [['p2-big'], 'M7', true])
    ok(run(root, ['check', 'milestone'], orca.env))
  })
})

describe('자율 모드', () => {
  test('자율 모드에서는 시제품 시작부터 카드까지 사람 없이 돌고, 사람에게는 "어느 변주로" 질문 한 번만 간다', () => {
    const { root, orca } = protoRoot({ commitPolicy: 'auto-local', autonomy: { mode: 'on', budget: { sinceProgress: { on: false }, milestone: { on: false } } } })
    const first = JSON.parse(run(root, ['next', '--json'], orca.env).out)
    assert.equal(first.stop, null)
    assert.match(first.action, /proto start D-09/)
    ok(run(root, ['proto', 'start', 'D-09'], orca.env))
    assert.equal(JSON.parse(run(root, ['next', '--json'], orca.env).out).stop.code, 'busy')
    for (const v of VARIANTS) ok(run(root, ['worker', 'done', `D-09:${v}`], orca.env))
    recordAll(root, orca)
    ok(run(root, ['proto', 'card', 'D-09'], orca.env))
    const asks = events(root).filter((e) => e.event === 'human_ask')
    assert.equal(asks.length, 1)
    assert.match(asks[0].q, /^어느 변주로 할까요\(또는 섞어서\)\?/)
    const stop = JSON.parse(run(root, ['next', '--json'], orca.env).out).stop
    assert.equal(stop.code, 'human')
  })
})
