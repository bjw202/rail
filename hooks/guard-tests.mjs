#!/usr/bin/env node
// PreToolUse 훅: 이미 있는 시험 파일을 Claude 세션이 고치거나 지우지 못하게 막는다.
// "이미 있는" = git 이 추적하는 시험 파일, 또는 시험 step 이 끝날 때 찍은 기준선(.rail/test-baseline.json)에 든 파일.
// 기준선 덕에 커밋 전의 새 시험도 잠긴다. 기준선 파일 자신도 잠근다. 새 시험 파일 만들기는 허용한다.
// RAIL_ALLOW_TEST_EDIT=1이면 통과한다.
import { existsSync } from 'node:fs'
import path from 'node:path'
import { BASELINE, baselineFiles, git, isTestPath, railLog, readStdinJson, repoRoot, toRepoRel } from './lib.mjs'

const HINT =
  '이미 있는 시험 파일과 fixtures/ 는 구현 작업자가 고치지 않는다. 시험이 틀렸다고 보면 고치지 말고 worker_done에 까닭을 적어라(레일 관문 규칙). ' +
  '리더나 주인이 고쳐야 할 때는 환경 변수 RAIL_ALLOW_TEST_EDIT=1로 우회한다.'

// 기준선에 든 파일 중 spec(파일 또는 폴더)에 걸리는 것. 기준선 파일이 있으면 그 자신도 포함한다.
function inBaseline(root, spec) {
  if (!existsSync(path.join(root, BASELINE))) return null
  const list = [...baselineFiles(root), BASELINE]
  return list.find((f) => spec === '.' || f === spec || f.startsWith(spec.replace(/\/$/, '') + '/')) ?? null
}

// git이 추적하거나 스테이징한 파일 목록(인덱스) 중 pathspec에 맞는 것.
function tracked(root, spec, literal) {
  const args = literal ? ['--literal-pathspecs'] : []
  const r = git(root, [...args, 'ls-files', '-z', '--', spec])
  return r.ok ? r.out.split('\0').filter(Boolean) : []
}

// 파일 도구(Edit, Write 등)가 가리킨 경로가 잠긴 시험 파일이면 그 상대 경로를 돌려준다.
function lockedFile(root, cwd, filePath) {
  if (!filePath) return null
  const rel = toRepoRel(root, path.resolve(cwd, filePath))
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null
  if (inBaseline(root, rel) === rel) return rel
  if (!isTestPath(rel)) return null
  return tracked(root, rel, true).length > 0 ? rel : null
}

// ---- Bash 명령 훑기(최선의 노력) ----

function stripHeredocs(cmd) {
  return cmd.replace(/<<-?\s*(['"]?)(\w+)\1[^\n]*\n[\s\S]*?\n[ \t]*\2(?=\n|$)/g, '\n')
}

// 따옴표와 역슬래시를 읽는 단순한 셸 낱말 쪼개기. 연산자(; & | < > 줄바꿈)는 따로 뗀다.
function tokenize(cmd) {
  const tokens = []
  let cur = ''
  let has = false
  const push = () => {
    if (has) tokens.push({ t: 'w', v: cur })
    cur = ''
    has = false
  }
  for (let i = 0; i < cmd.length; i++) {
    const c = cmd[i]
    if (c === "'") {
      const j = cmd.indexOf("'", i + 1)
      const end = j < 0 ? cmd.length : j
      cur += cmd.slice(i + 1, end)
      has = true
      i = end
    } else if (c === '"') {
      i++
      while (i < cmd.length && cmd[i] !== '"') {
        if (cmd[i] === '\\' && i + 1 < cmd.length) i++
        cur += cmd[i++]
      }
      has = true
    } else if (c === '\\' && i + 1 < cmd.length) {
      cur += cmd[++i]
      has = true
    } else if (/\s/.test(c) && c !== '\n') {
      push()
    } else if (c === '\n' || ';&|<>'.includes(c)) {
      push()
      let op = c
      while (c !== '\n' && i + 1 < cmd.length && ';&|<>'.includes(cmd[i + 1])) op += cmd[++i]
      tokens.push({ t: 'o', v: op })
    } else {
      cur += c
      has = true
    }
  }
  push()
  return tokens
}

// 명령을 ; && || | & 줄바꿈 으로 나눠 각 명령의 낱말과 리다이렉트 대상을 모은다.
function splitCommands(tokens) {
  const cmds = []
  let words = []
  let redirects = []
  const flush = () => {
    if (words.length || redirects.length) cmds.push({ words, redirects })
    words = []
    redirects = []
  }
  for (let i = 0; i < tokens.length; i++) {
    const tk = tokens[i]
    if (tk.t === 'w') {
      words.push(tk.v)
    } else if (tk.v.includes('>')) {
      // 2>&1 처럼 &로 끝나면 파일이 아니라 복사다.
      const next = tokens[i + 1]
      if (!tk.v.endsWith('&') && next?.t === 'w') redirects.push(next.v)
      if (next?.t === 'w') i++
    } else if (tk.v.includes('<') && !tk.v.includes('&')) {
      if (tokens[i + 1]?.t === 'w') i++
    } else {
      flush()
    }
  }
  flush()
  return cmds
}

const WRAPPERS = new Set(['sudo', 'env', 'command', 'time', 'nice', 'nohup', 'exec'])

// 한 명령이 쓰거나 지우는 대상 후보(낱말)를 모은다.
function targetsOf(words) {
  let w = [...words]
  while (w.length && (/^\w+=/.test(w[0]) || WRAPPERS.has(path.basename(w[0])))) w.shift()
  if (!w.length) return { targets: [], nested: [] }
  const name = path.basename(w[0])
  const args = w.slice(1)
  const plain = args.filter((a) => !a.startsWith('-'))
  const hasI = args.some((a) => /^-[a-zA-Z]*i/.test(a) || a === '--in-place' || a.startsWith('--in-place='))
  if (['rm', 'unlink', 'rmdir', 'truncate', 'shred', 'mv', 'tee'].includes(name)) return { targets: plain, nested: [] }
  if (['cp', 'install'].includes(name)) return { targets: plain.slice(-1), nested: [] }
  if ((name === 'sed' || name === 'perl') && hasI) return { targets: plain, nested: [] }
  if (name === 'dd') return { targets: args.filter((a) => a.startsWith('of=')).map((a) => a.slice(3)), nested: [] }
  if (name === 'git') {
    const sub = plain[0]
    if (['checkout', 'restore', 'rm', 'mv'].includes(sub)) {
      const dd = args.indexOf('--')
      const list = dd >= 0 ? args.slice(dd + 1) : plain.slice(1)
      return { targets: list, nested: [] }
    }
  }
  if (['sh', 'bash', 'zsh'].includes(name)) {
    const ci = args.findIndex((a) => /^-[a-zA-Z]*c/.test(a))
    if (ci >= 0 && args[ci + 1]) return { targets: [], nested: [args[ci + 1]] }
  }
  return { targets: [], nested: [] }
}

// 낱말이 가리키는 추적 중인 시험 파일 하나를 돌려준다. 없으면 null.
function lockedWord(root, cwd, word) {
  if (!word || word.includes('$') || word.includes('`') || word === '/dev/null') return null
  const rel = toRepoRel(root, path.resolve(cwd, word))
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null
  const spec = rel === '' ? '.' : rel
  return tracked(root, spec, false).find(isTestPath) ?? inBaseline(root, spec)
}

function lockedByBash(root, cwd, command, depth = 0) {
  if (depth > 3) return null
  const cmds = splitCommands(tokenize(stripHeredocs(command)))
  for (const { words, redirects } of cmds) {
    const { targets, nested } = targetsOf(words)
    for (const word of [...redirects, ...targets]) {
      const hit = lockedWord(root, cwd, word)
      if (hit) return hit
    }
    for (const inner of nested) {
      const hit = lockedByBash(root, cwd, inner, depth + 1)
      if (hit) return hit
    }
  }
  return null
}

function deny(file) {
  const reason = `시험 파일 잠금: ${file} 은(는) 이미 있는 시험 파일(또는 fixtures/)이라 고치거나 지울 수 없다. ${HINT}`
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason }
    })
  )
}

async function main() {
  const input = await readStdinJson()
  const cwd = typeof input.cwd === 'string' && input.cwd ? input.cwd : process.cwd()
  const root = repoRoot(cwd)
  if (!root) return
  const tool = input.tool_name
  const ti = input.tool_input ?? {}
  if (process.env.RAIL_ALLOW_TEST_EDIT === '1') return
  let hit = null
  if (tool === 'Edit' || tool === 'Write' || tool === 'MultiEdit') hit = lockedFile(root, cwd, ti.file_path)
  else if (tool === 'NotebookEdit') hit = lockedFile(root, cwd, ti.notebook_path ?? ti.file_path)
  else if (tool === 'Bash' && typeof ti.command === 'string') hit = lockedByBash(root, cwd, ti.command)
  if (!hit) return
  deny(hit)
  railLog(root, 'hook_blocked', { hook: 'guard-tests', file: hit, tool: tool ?? null })
}

main().catch(() => {
  // 훅이 고장 나도 작업을 막지 않는다(종료 코드 0).
})
