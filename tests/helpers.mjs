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

// 기획서(docs/PLAN.md) 한 장. ms: [[마일스톤, 착수 전 D-xx·T-xx ...], ...] 마다 장면 하나. marks: { 'D-01': '결정: 선택함 (A)' }.
export function planDoc(ms = [['M0', 'D-01'], ['M1']], marks = {}, approved = true) {
  const risks = [...new Set(ms.flatMap(([, ...r]) => r))]
  return [
    '# 기획서', approved ? '승인: 2026-11-24' : '',
    '- 누가 무엇을: 나는 기록 파일을 열어 본다', '- 이번엔 어디까지: 목록까지', '- 다음 장면: 파일 하나가 보인다', '- 모양: 한 호흡 · 다시 볼 조건: 기록이 1만 개를 넘으면',
    '## 성공 장면',
    ...ms.flatMap(([id, ...r], i) => [`### S${i + 1} ${id} 장면이 보인다`, '- 자동 확인: node --test', '- 진짜 자료: 없음 — 작은 예제 범위까지만', `- 착수 전: ${r.join(', ') || '없음'}`]),
    '## 첫날 실패 장면', '- 빈 폴더를 열면 아무것도 안 보인다',
    '## 결정과 시험', ...risks.map((d) => `- ${d} 방법 — ${marks[d] ?? (d.startsWith('T') ? '시험: 미실행' : '결정: 미정')}`),
    '## 마일스톤 지도', ...ms.map(([id], i) => `- ${id} ${i ? '기능' : '뼈대'} · 장면 S${i + 1} · 예상 1일`), ''
  ].join('\n')
}
export const GOOD_PLAN = planDoc()
export const DECIDED_PLAN = planDoc(undefined, { 'D-01': '결정: 선택함 (A)' })

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
