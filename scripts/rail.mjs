#!/usr/bin/env node
// 레일: 상태 파일(.rail/state.json)과 관문을 코드로 판정한다. 의존성 없음(내장 모듈만).
// 종료 코드: 0 통과, 1 관문에 막힘 또는 거절, 2 사용법 오류.
// 이 파일은 명령을 받아 넘기는 입구다. 하는 일은 lib/ 의 모듈에 한 가지씩 있다(파일마다 맨 위 한 줄이 그 일).
import { cmdCheck } from './lib/advance.mjs'
import { cmdAnswer, cmdAsk } from './lib/ask.mjs'
import { cmdNext } from './lib/autonomy.mjs'
import { fail } from './lib/core.mjs'
import { cmdLog } from './lib/log.mjs'
import { cmdPolicy } from './lib/policy.mjs'
import { cmdPlan } from './lib/queue.mjs'
import { cmdProto } from './lib/proto.mjs'
import { cmdRehearsalRecord, cmdReopen, cmdScene } from './lib/scene.mjs'
import { cmdLeader } from './lib/session.mjs'
import { lock, touchBusy } from './lib/state.mjs'
import { cmdPrecompact, cmdStatus } from './lib/status.mjs'
import { cmdStepDone, cmdStepStart } from './lib/steps.mjs'
import { cmdPart, cmdUsage, noteRailSize } from './lib/usage.mjs'
import { cmdVerify } from './lib/verify.mjs'
import { cmdWorker } from './lib/workers.mjs'
import { cmdWorktree } from './lib/worktree.mjs'

// ---------- 하위 명령 ----------
function parseArgs(argv) {
  const pos = []
  const flags = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith('--')) {
      const k = a.slice(2)
      const bool = ['json', 'hook', 'replace', 'scene', 'precheck', 'budget', 'force', 'compact', 'self-fix'].includes(k)
      flags[k] = bool ? true : argv[++i]
    } else pos.push(a)
  }
  return { pos, flags }
}

const cmds = {
  proto: cmdProto,
  usage: cmdUsage,
  part: cmdPart,
  leader: cmdLeader,
  precompact: cmdPrecompact,
  next: cmdNext,
  worker: cmdWorker,
  worktree: cmdWorktree,
  status: (a) => cmdStatus(a),
  check: (a) => cmdCheck(a, false),
  advance: (a) => cmdCheck(a, true),
  ask: cmdAsk,
  answer: cmdAnswer,
  scene: cmdScene,
  reopen: cmdReopen,
  log: cmdLog,
  'step-start': cmdStepStart,
  'step-done': cmdStepDone,
  policy: cmdPolicy,
  plan: cmdPlan,
  verify: cmdVerify,
  'rehearsal-record': cmdRehearsalRecord
}
const args = parseArgs(process.argv.slice(2))
const name = args.pos.shift()
if (!cmds[name]) fail(`사용법: rail.mjs <${Object.keys(cmds).join('|')}> ...`, 2)
// 읽고-고치고-쓰는 명령은 명령 전체가 잠금을 잡는다. worker 는 Orca 를 기다리는 동안 잠금을 놓으려고 스스로 잡는다.
const LOCKED = new Set(['check', 'advance', 'ask', 'answer', 'scene', 'reopen', 'log', 'step-start', 'step-done', 'policy', 'plan', 'rehearsal-record'])
if (!['next', 'usage', 'part', 'leader', 'precompact'].includes(name)) touchBusy([name, ...args.pos.slice(0, 2)].join(' '))
if (name !== 'usage') noteRailSize()
if (LOCKED.has(name)) lock()
cmds[name](args)
