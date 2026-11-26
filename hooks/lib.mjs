// 두 가드 훅이 함께 쓰는 도우미: 표준 입력 JSON 읽기와 git 호출. 내장 모듈만 쓴다.
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export function readStdinJson() {
  return new Promise((resolve) => {
    let raw = ''
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', (chunk) => (raw += chunk))
    process.stdin.on('end', () => {
      try {
        resolve(JSON.parse(raw || '{}'))
      } catch {
        resolve({})
      }
    })
    process.stdin.on('error', () => resolve({}))
  })
}

// git 명령 하나를 돌려 {ok, out}을 준다. 실패해도 던지지 않는다.
export function git(cwd, args, opts = {}) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, ...opts })
  return { ok: r.status === 0, out: r.stdout ?? '' }
}

// 저장소 맨 위 폴더. git 저장소가 아니면 null.
export function repoRoot(cwd) {
  const r = git(cwd, ['rev-parse', '--show-toplevel'])
  return r.ok ? path.resolve(r.out.trim()) : null
}

// 저장소 기준 상대 경로를 슬래시로 쓴다(Windows에서도 같은 꼴로 비교하려고).
export function toRepoRel(root, absolute) {
  return path.relative(root, absolute).split(path.sep).join('/')
}

// 잠글 시험 경로인가: tests/**, test/**, fixtures/**(사람이 넣은 시험지), **/__tests__/**, **/*.test.*, **/*.spec.*
// rail.mjs 의 시험 기준선(test-baseline.json)도 같은 규칙으로 시험 파일을 고른다.
export function isTestPath(rel) {
  const parts = rel.split('/')
  if (parts[0] === 'tests' || parts[0] === 'test' || parts[0] === 'fixtures') return true
  if (parts.includes('__tests__')) return true
  return /\.(test|spec)\./.test(parts[parts.length - 1] ?? '')
}

// 시험 step 이 끝날 때 rail.mjs 가 찍은 시험 파일 목록. 없거나 깨졌으면 빈 목록.
export const BASELINE = '.rail/test-baseline.json'
export function baselineFiles(root) {
  try {
    const files = JSON.parse(readFileSync(path.join(root, BASELINE), 'utf8')).files
    return files && typeof files === 'object' ? Object.keys(files) : []
  } catch {
    return []
  }
}

// rail.mjs: 설치된 레포에서는 .rail/hooks 옆의 .rail/bin, 레일 저장소 안에서는 hooks 옆의 scripts.
export const RAIL_BIN = ['bin', 'scripts'].map((d) => path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', d, 'rail.mjs')).find(existsSync) ?? null
// 자식 명령은 부모가 node --test 안이어도 독립된 실행이어야 한다. 레일을 부를 때는 저장소를 RAIL_ROOT 로 준다.
export function childEnv(root = null) {
  const env = { ...process.env, ...(root ? { RAIL_ROOT: root, RAIL_NO_TOUCH: '1' } : {}) }
  delete env.NODE_TEST_CONTEXT
  return env
}
// 훅이 한 일을 레일 사건 기록에 남긴다(부품이 얼마나 쓰이는지 세려고). rail.mjs log 를 불러 같은 잠금을 쓴다.
// 레일 저장소(.rail/ 가 있음)일 때만 남기고, 기록이 실패하거나 늦어도 훅의 판정은 바꾸지 않는다.
export function railLog(root, event, data) {
  try {
    if (!existsSync(path.join(root, '.rail')) || !RAIL_BIN) return
    spawnSync(process.execPath, [RAIL_BIN, 'log', event, JSON.stringify(data)], { env: childEnv(root), encoding: 'utf8', timeout: 5000 })
  } catch {
    // 기록하지 못해도 훅은 하던 대로 한다.
  }
}
