#!/usr/bin/env node
// Stop 훅: Claude 세션이 멈추려 할 때, 작업 폴더가 바뀌었으면
// 마지막 통과 뒤 바뀌었으면 빌드와 시험을 돌린다.
// 2.9판(덜어내기 둘째): 먼저 돌리던 계획 표 검사(rail.mjs validate)를 뺐다. 표는 step-start·step-done 이 상태 칸을 쓰며 읽는다.
// 실패하면 종료 코드 2와 표준 오류의 이유로 세션이 이어서 고치게 한다.
// 2.9판: 시험 먼저 step 뒤의 "예정된 실패" 창을 뺐다(M10·M11 동안 쓰이지 않음). 실패는 모두 붙잡는다.
import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { BASELINE, git, railLog, readStdinJson, repoRoot } from './lib.mjs'

const RAIL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../scripts/rail.mjs')
// 부모가 node --test 안이어도 검사 명령은 독립된 시험 실행이어야 한다.
function childEnv() {
  const env = { ...process.env }
  delete env.NODE_TEST_CONTEXT
  return env
}
// 검사 명령은 .rail/config.json 의 checkCommand 다. 비어 있으면(제품 스택이 아직 없으면) 건너뛴다.
// RAIL_STOP_CHECK_CMD 환경 변수가 있으면 그것이 우선한다(시험용).
function readCommand(root) {
  if (process.env.RAIL_STOP_CHECK_CMD) return process.env.RAIL_STOP_CHECK_CMD
  try {
    const c = JSON.parse(readFileSync(path.join(root, '.rail/config.json'), 'utf8')).checkCommand
    return typeof c === 'string' ? c.trim() : ''
  } catch {
    return ''
  }
}
let COMMAND = ''
const TIMEOUT_MS = Number(process.env.RAIL_STOP_CHECK_TIMEOUT_MS) || 5 * 60 * 1000
const MAX_HOLDS = 2 // 같은 실패로 붙잡는 최대 횟수
const TAIL_LINES = 30

// 작업 폴더 상태 지문: git status, 추적 파일 diff, 새 파일 내용. 바뀐 파일 목록도 함께 돌려준다.
// 레일 자신의 기록(상태·로그)은 제품 변경이 아니므로 제외한다.
const SKIP = [':(exclude).rail/state.json', ':(exclude).rail/log.jsonl', `:(exclude)${BASELINE}`]
function snapshot(root) {
  const status = git(root, ['status', '--porcelain', '-z', '-uall', '--', '.', ...SKIP]).out
  const entries = status.split('\0').filter(Boolean)
  const changed = []
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i]
    changed.push(e.slice(3))
    if (e[0] === 'R' || e[0] === 'C') i++ // 이름 바꿈은 원래 이름이 다음 항목에 따로 온다
  }
  const h = createHash('sha256')
  h.update(status)
  h.update(git(root, ['diff', 'HEAD', '--binary', '--', '.', ...SKIP]).out)
  const untracked = git(root, ['ls-files', '-z', '--others', '--exclude-standard', '--', '.', ...SKIP]).out.split('\0').filter(Boolean)
  for (const f of untracked.sort()) {
    h.update(f)
    try {
      const abs = path.join(root, f)
      if (statSync(abs).size < 5_000_000) h.update(readFileSync(abs))
    } catch {
      // 사라진 파일은 건너뛴다.
    }
  }
  return { hash: h.digest('hex'), changed }
}

function readCache(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return {}
  }
}

const tail = (text) =>
  text
    .replace(/\x1b\[[0-9;]*[A-Za-z]/g, '')
    .split(/\r?\n/)
    .filter((l, i, a) => l.trim() !== '' || i < a.length - 1)
    .slice(-TAIL_LINES)
    .join('\n')

// 명령을 돌리고 {code, output, timedOut}을 준다. 시간이 넘으면 우리가 띄운 프로세스 묶음만 끈다.
function run(root) {
  return new Promise((resolve) => {
    const posix = process.platform !== 'win32'
    const child = spawn(COMMAND, { cwd: root, shell: true, detached: posix, env: childEnv(), stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    const keep = (d) => (output = (output + d).slice(-200_000))
    child.stdout.on('data', keep)
    child.stderr.on('data', keep)
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      try {
        if (posix) process.kill(-child.pid, 'SIGKILL')
        else child.kill()
      } catch {
        // 이미 끝났다.
      }
    }, TIMEOUT_MS)
    child.on('error', (e) => {
      clearTimeout(timer)
      resolve({ code: 127, output: String(e), timedOut: false })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ code: code ?? 1, output, timedOut })
    })
  })
}

const stripAnsi = (t) => t.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '')

// 통과 수(ℹ pass N). 레일 자율 모드가 "진척"(시험 통과 수가 늘어난 때)을 재는 데 쓴다(2.2판).
function passCount(text) {
  const all = [...stripAnsi(text).matchAll(/^(?:ℹ|#) pass (\d+)\s*$/gm)]
  return all.length ? Number(all.at(-1)[1]) : null
}
// 지난번보다 통과 수가 늘었으면 그 시각을 passUpAt 으로 남긴다.
function passPatch(cache, output) {
  const n = passCount(output)
  if (n === null) return {}
  const up = typeof cache.passCount === 'number' && n > cache.passCount
  return { passCount: n, ...(up ? { passUpAt: new Date().toISOString() } : {}) }
}

// 실패 지문에 쓸 글: 돌릴 때마다 달라지는 걸린 시간(duration_ms 2811.1, (37.6ms))과 시각(ISO 시각, 12:59, 12:59:03)을 지운다.
// 지우지 않으면 같은 실패가 매번 새 실패로 보여 붙잡는 횟수 상한이 듣지 않는다(M3 에서 서버 시작 시각 12:59 → 13:00).
function stableText(body) {
  return String(body)
    .replace(/\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:[.,]\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?/g, '<시각>')
    .replace(/(?<![\d:])\d{1,2}:\d{2}(?::\d{2}(?:[.,]\d+)?)?(?![\d:])/g, '<시각>')
    .replace(/\d+(?:\.\d+)?\s*ms\b/g, '<ms>')
    .replace(/duration_ms\s+\S+/g, 'duration_ms <ms>')
}

// 열린 사람 질문(.rail/state.json 의 human_ask). 없거나 읽지 못하면 null.
function openQuestion(root) {
  try {
    const a = JSON.parse(readFileSync(path.join(root, '.rail/state.json'), 'utf8')).human_ask
    return a && typeof a === 'object' && a.q ? a : null
  } catch {
    return null
  }
}

function warn(message) {
  process.stderr.write(`[레일 마무리 검사] ${message}\n`)
  process.stdout.write(JSON.stringify({ systemMessage: `레일 마무리 검사: ${message}` }))
}

async function main() {
  const input = await readStdinJson()
  const cwd = typeof input.cwd === 'string' && input.cwd ? input.cwd : process.cwd()
  const root = repoRoot(cwd)
  if (!root) return
  // 2.3판: 이 세션을 리더 세션으로 적는다(닫힘 알림의 컨텍스트 사용률). 작업자 창의 세션은 rail.mjs 가 거른다.
  if (typeof input.session_id === 'string' && existsSync(RAIL) && existsSync(path.join(root, '.rail/state.json')))
    spawnSync(process.execPath, [RAIL, 'leader', input.session_id], { env: { ...childEnv(), RAIL_ROOT: root, RAIL_NO_TOUCH: '1' }, timeout: 10_000 })
  COMMAND = readCommand(root)
  const gitDir = git(root, ['rev-parse', '--absolute-git-dir']).out.trim()
  const cacheFile = gitDir ? path.join(gitDir, 'rail-stop-check.json') : null
  const cache = cacheFile ? readCache(cacheFile) : {}
  const save = (patch) => {
    if (cacheFile) writeFileSync(cacheFile, JSON.stringify({ ...cache, ...patch }))
  }

  // 실패로 붙잡는다. 같은 실패는 MAX_HOLDS 번까지만 붙잡고 그 뒤에는 경고와 함께 통과시킨다.
  // 사람의 답을 기다리는 중(state 의 human_ask)이면 붙잡지 않는다. 그 질문 동안 같은 실패는 한 번만 알린다(2.1판).
  const hold = (what, body) => {
    const sig = createHash('sha256').update(stableText(body)).digest('hex')
    const ask = openQuestion(root)
    if (ask) {
      const key = `${sig}:${ask.at ?? ask.q}`
      if (cache.waitKey === key) return
      save({ waitKey: key })
      warn(`사람의 답을 기다리는 중이라 멈춤을 붙잡지 않는다(질문: "${ask.q}"). 실패는 남아 있다: ${what}. 답을 받은 뒤 고친다.`)
      return
    }
    const prevCount = cache.failSig === sig ? (cache.failCount ?? 0) : 0
    if (input.stop_hook_active === true && prevCount >= MAX_HOLDS) {
      save({ failSig: sig, failCount: prevCount })
      warn(`같은 실패로 이미 ${prevCount}번 붙잡았다. 이번에는 통과시킨다. 실패가 남아 있다: ${what}`)
      return
    }
    save({ failSig: sig, failCount: prevCount + 1 })
    process.stderr.write(`마무리 검사 실패: ${what}. 고친 뒤 다시 멈춰라.\n${body}\n`)
    process.exitCode = 2
    railLog(root, 'hook_held', { hook: 'stop-check', reason: what, count: prevCount + 1 })
  }

  const before = snapshot(root)
  if (before.changed.length === 0) return // 바뀐 것이 없다

  if (!COMMAND) return // 검사 명령이 아직 정해지지 않았다
  if (before.changed.every((f) => f.endsWith('.md'))) return // 문서만 바뀌었다
  if (cache.passedHash === before.hash) return // 마지막 통과 뒤 그대로다

  // 빌드와 시험
  const result = await run(root)
  if (result.timedOut) {
    warn(`${Math.round(TIMEOUT_MS / 1000)}초가 지나 검사를 멈췄다. 세션은 막지 않는다. 직접 \`${COMMAND}\`를 돌려 확인하라.`)
    return
  }
  if (result.code === 0) {
    // 빌드가 dist를 다시 쓸 수 있으니 돌린 뒤의 상태를 통과 지문으로 남긴다.
    save({ passedHash: snapshot(root).hash, failSig: null, failCount: 0, ...passPatch(cache, result.output) })
    return
  }
  hold(`\`${COMMAND}\` 가 종료 코드 ${result.code}로 끝났다`, `마지막 ${TAIL_LINES}줄:\n${tail(result.output)}`)
}

main().catch((e) => {
  // 훅이 고장 나도 작업을 막지 않는다. 이유만 남긴다.
  process.stderr.write(`[레일 마무리 검사] 훅 오류로 건너뜀: ${e?.message ?? e}\n`)
})
