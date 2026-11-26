// 공용 도움 함수: 저장소 경로, 파일 읽기, 출력과 실패, git, 날짜·돈 형식. 다른 레일 모듈을 가져오지 않는다.
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { BASELINE } from '../../hooks/lib.mjs'

// 저장소는 RAIL_ROOT, 없으면 이 파일(<저장소>/.rail/bin/lib/core.mjs)에서 세 단계 위다. 레일 명령은 저장소 맨 위에서 부른다.
export const ROOT = path.resolve(process.env.RAIL_ROOT || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..'))
export const RAIL_CMD = 'node .rail/bin/rail.mjs'
export const F = {
  state: path.join(ROOT, '.rail/state.json'),
  log: path.join(ROOT, '.rail/log.jsonl'),
  sheet: path.join(ROOT, 'docs/PLAN.md'),
  decisions: path.join(ROOT, 'docs/decisions'),
  plan: path.join(ROOT, 'docs/plan'),
  config: path.join(ROOT, '.rail/config.json'),
  railDoc: path.join(ROOT, 'docs/RAIL.md'),
  baseline: path.join(ROOT, BASELINE),
  rehearsal: path.join(ROOT, '.rail/rehearsal'),
  check: path.join(ROOT, '.rail/check')
}
// ---------- 파일 읽고 쓰기 ----------
export const read = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').replace(/^﻿/, '').replace(/\r\n/g, '\n') : null)
export const now = () => new Date().toISOString()
// 사람이 읽는 날짜는 이 컴퓨터의 지역 날짜로 쓴다(YYYY-MM-DD).
export const today = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
// 자식 명령은 부모가 node --test 안이어도 독립된 실행이어야 한다.
export const childEnv = () => {
  const env = { ...process.env }
  delete env.NODE_TEST_CONTEXT
  return env
}
export const lastLines = (text, n) =>
  String(text ?? '')
    .replace(/\x1b\[[0-9;]*[A-Za-z]/g, '')
    .split(/\r?\n/)
    .filter((l) => l.trim())
    .slice(-n)

export function gitIn(args) {
  const r = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })
  return { ok: r.status === 0, out: r.stdout ?? '' }
}
export const isGitTop = () => {
  const r = gitIn(['rev-parse', '--show-toplevel'])
  return r.ok && path.resolve(r.out.trim()) === fs.realpathSync.native(ROOT)
}
export function walk(dir, rel = '') {
  const out = []
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.') || e.name === 'node_modules') continue
    const r = rel ? `${rel}/${e.name}` : e.name
    if (e.isDirectory()) out.push(...walk(path.join(dir, e.name), r))
    else if (e.isFile()) out.push(r)
  }
  return out
}
export const out = (s) => process.stdout.write(s + '\n')
export const fail = (s, code = 1) => {
  process.stderr.write(s + '\n')
  process.exit(code)
}
// 답 앞뒤의 따옴표를 걷는다(답 예를 따옴표째 붙여 넣는 일이 있었다). 뒤 따옴표는 앞을 걷었거나 짝이 없을 때만 걷는다.
export function unquote(text) {
  const t = String(text).trim()
  const head = t.replace(/^["'“”‘’]+\s*/, '')
  const both = head.replace(/\s*["'“”‘’]+$/, '')
  return head !== t || !/["'“”‘’]/.test(both) ? both.trim() : head
}
export const usd = (n) => `$${(Number(n) || 0).toFixed(2)}`
export const clock = (iso) => {
  const d = new Date(iso)
  return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
export const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b)
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2
}
export const strList = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string') : null)
