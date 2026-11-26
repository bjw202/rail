import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
export const RAIL = path.resolve(HERE, '../scripts/rail.mjs')
export const HOOKS = path.resolve(HERE, '../hooks')

export function tmp(prefix = 'rail-') {
  return realpathSync(mkdtempSync(path.join(tmpdir(), prefix)))
}

export function put(root, rel, text) {
  const f = path.join(root, rel)
  mkdirSync(path.dirname(f), { recursive: true })
  writeFileSync(f, text)
}

export function rail(root, ...args) {
  const r = spawnSync(process.execPath, [RAIL, ...args], { encoding: 'utf8', env: { ...process.env, RAIL_ROOT: root } })
  return { code: r.status, out: r.stdout, err: r.stderr }
}

export const state = (root) => JSON.parse(readFileSync(path.join(root, '.rail/state.json'), 'utf8'))
export const events = (root) =>
  readFileSync(path.join(root, '.rail/log.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l))

export const GOOD_BRIEF = `# 브리프
승인: 2026-11-24
## 성공 장면
1. 첫 장면
2. 둘째 장면
3. 셋째 장면
## 만들지 않을 것
- 로그인
`

export const GOOD_ROADMAP = `# 로드맵
승인: 2026-11-24
## M0 뼈대
- 끝나는 장면: 파일 하나가 끝에서 끝까지 보인다
- 위험 질문: D-01 파일 읽는 방법
- 예상 기간: 3일
## M1 핵심
- 끝나는 장면: 목록이 보인다
- 위험 질문: 없음
- 예상 기간: 1주
`

export const DECIDED = `# D-01\n상태: 결정됨\n선택: A\n`

export function runHook(script, input, env = {}) {
  const clean = { ...process.env }
  delete clean.RAIL_ALLOW_TEST_EDIT
  delete clean.RAIL_STOP_CHECK_CMD
  const r = spawnSync(process.execPath, [path.join(HOOKS, script)], { input: JSON.stringify(input), encoding: 'utf8', env: { ...clean, ...env } })
  return { code: r.status, stdout: r.stdout, stderr: r.stderr }
}

export function git(cwd, ...args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`)
  return r.stdout
}

export function makeRepo() {
  const dir = tmp('rail-hook-')
  git(dir, 'init', '-q')
  git(dir, 'config', 'user.email', 'hook@example.com')
  git(dir, 'config', 'user.name', 'hook')
  for (const [f, body] of [
    ['tests/x.test.mjs', 'a\n'],
    ['test/y.mjs', 'b\n'],
    ['fixtures/doc.txt', 'f\n'],
    ['src/a.mjs', 'c\n'],
    ['README.md', 'd\n']
  ]) put(dir, f, body)
  git(dir, 'add', '-A')
  git(dir, 'commit', '-q', '-m', 'init')
  return dir
}

export function denied(r) {
  if (!r.stdout.trim()) return false
  return JSON.parse(r.stdout).hookSpecificOutput?.permissionDecision === 'deny'
}
