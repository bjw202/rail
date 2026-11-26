#!/usr/bin/env node
// PreCompact 훅(2.3판): 표준 출력이 압축 요약 지시가 된다(Claude Code 가 1만 자에서 자른다).
// 지시는 rail.mjs precompact 가 레일 상태(위치, 진행 중 작업자, 열린 사람 질문, 최근 rail_gap)로 만들고 compact_started 를 남긴다.
// 압축을 막지 않는다: 레일이 없거나 고장 나도 아무것도 내지 않고 종료 코드 0 으로 끝낸다.
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readStdinJson, repoRoot } from './lib.mjs'

const RAIL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../scripts/rail.mjs')

async function main() {
  const input = await readStdinJson()
  const root = repoRoot(typeof input.cwd === 'string' && input.cwd ? input.cwd : process.cwd())
  if (!root || !existsSync(path.join(root, '.rail/state.json')) || !existsSync(RAIL)) return
  const env = { ...process.env, RAIL_ROOT: root, RAIL_NO_TOUCH: '1' }
  delete env.NODE_TEST_CONTEXT
  const r = spawnSync(process.execPath, [RAIL, 'precompact'], { input: JSON.stringify(input), encoding: 'utf8', env, timeout: 20_000 })
  if (r.status === 0 && r.stdout) process.stdout.write(r.stdout.slice(0, 9500))
}

main().catch(() => {})
