// 훅 입력, 리더 세션, 컨텍스트 사용률.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import tty from 'node:tty'
import { F } from './core.mjs'
import { loadState, lock, saveState, unlock } from './state.mjs'
import { openWorkers } from './workers.mjs'

// ---------- 압축 이어받기 ----------
// 훅 입력(표준 입력의 JSON).
// 터미널이나 /dev/null(문자 장치)이면 읽지 않는다. 훅은 파이프로 JSON 을 주고 닫는다.
// Windows 는 파이프를 FIFO 로 알려 주지 않으므로 터미널만 거르고, 파이프 끝의 EOF 오류는 끝으로 본다.
export function hookInput() {
  try {
    const fd = process.platform === 'win32' ? null : fs.fstatSync(0)
    if (fd ? !fd.isFIFO() && !fd.isFile() && !fd.isSocket() : tty.isatty(0)) return {}
    const v = JSON.parse(readStdin() || '{}')
    return v && typeof v === 'object' ? v : {}
  } catch {
    return {}
  }
}
function readStdin() {
  const [parts, buf] = [[], Buffer.alloc(1 << 16)]
  for (let n; (n = readChunk(buf)); ) parts.push(Buffer.from(buf.subarray(0, n)))
  return Buffer.concat(parts).toString('utf8')
}
function readChunk(buf) {
  try {
    return fs.readSync(0, buf)
  } catch (e) {
    if (e.code === 'EOF') return 0
    throw e
  }
}
// 리더 세션 번호를 상태의 leader_session 에 적는다(세션 시작·마무리 때). 열린 작업자의 창에서 온 세션과,
// 이름이 step 으로 시작하는 세션(worker start 가 --name "M6-1 ..." 으로 띄움, 창이 기록되기 전의 세션 시작)은 리더가 아니다.
export function noteLeader(sid, title) {
  if (typeof title === 'string' && /^M\d+-/.test(title)) return
  if (typeof sid !== 'string' || !/^[\w-]{1,128}$/.test(sid) || !fs.existsSync(F.state) || !lock(2000, true)) return
  try {
    const st = loadState()
    const term = process.env.ORCA_TERMINAL_HANDLE
    if (term && openWorkers(st).some((w) => w.terminal === term)) return
    if (st.leader_session === sid) return
    st.leader_session = sid
    saveState(st)
  } catch {
    // 적지 못해도 훅은 하던 대로 한다.
  } finally {
    unlock()
  }
}
export const cmdLeader = ({ pos }) => noteLeader(pos[0])
// 주인의 상태줄 스크립트가 세션마다 남기는 컨텍스트 사용률. 없으면 null("CW 모름").
export function contextPercent(sid) {
  if (typeof sid !== 'string' || !/^[\w-]{1,128}$/.test(sid)) return null
  const dir = process.env.RAIL_STATUSLINE_DIR || path.join(os.homedir(), '.claude/cache/statusline')
  try {
    const n = Number(JSON.parse(fs.readFileSync(path.join(dir, `${sid}.json`), 'utf8'))?.context_window?.used_percentage)
    return Number.isFinite(n) ? Math.round(n) : null
  } catch {
    return null
  }
}
