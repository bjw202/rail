// 상태 파일(.rail/state.json), 파일 잠금, 사건 기록(.rail/log.jsonl), 작업 중 표시.
import fs from 'node:fs'
import path from 'node:path'
import { F, ROOT, fail, now, read } from './core.mjs'

// file 을 주면 다른 레포의 기록을 읽는다(설치 도구가 대상 레포를 볼 때).
export function readEvents(file = F.log) {
  const t = read(file)
  if (!t) return []
  return t.split('\n').flatMap((l) => {
    try {
      return l.trim() ? [JSON.parse(l)] : []
    } catch {
      return []
    }
  })
}

export function defaultState() {
  return {
    project: path.basename(ROOT),
    stage: 'plan',
    milestone: null,
    step: null,
    waiting_for: 'none',
    human_ask: null,
    interview: { asked: 0 },
    gates: { scene_checked: {}, rehearsed: {} },
    closed: [],
    updated: null
  }
}
export function loadState(file = F.state) {
  const raw = read(file)
  if (raw === null) return defaultState()
  const s = JSON.parse(raw)
  const d = defaultState()
  return { ...d, ...s, gates: { ...d.gates, ...(s.gates ?? {}) }, interview: { ...d.interview, ...(s.interview ?? {}) } }
}
// 쓰기는 늘 잠금 안에서 한다. 읽고-고치고-쓰는 명령은 명령 전체가 잠금을 잡는다(아래 LOCKED).
export function saveState(s) {
  s.updated = now()
  withLock(() => {
    fs.mkdirSync(path.dirname(F.state), { recursive: true })
    // 다른 이름에 다 쓴 뒤 바꿔 넣는다. 읽는 쪽이 반쯤 쓴 파일을 보지 않는다.
    const tmpFile = `${F.state}.${process.pid}.tmp`
    fs.writeFileSync(tmpFile, JSON.stringify(s, null, 2) + '\n')
    fs.renameSync(tmpFile, F.state)
  })
}
export function appendLog(event, st, data = {}) {
  fs.mkdirSync(path.dirname(F.log), { recursive: true })
  const line = { t: now(), event, stage: st?.stage ?? null, milestone: st?.milestone ?? null, ...data }
  withLock(() => fs.appendFileSync(F.log, JSON.stringify(line) + '\n'))
}

// ---------- 파일 잠금 ----------
// 상태 파일·step 표·사건 기록을 고치는 명령은 .rail/.lock 을 원자적으로 만들고(wx) 끝나면 지운다. 동시에 불린 명령은 차례를 기다린다.
// 주인 프로세스가 죽었거나 너무 오래된 잠금은 버린다. 같은 프로세스 안에서는 겹쳐 잡아도 된다.
export const LOCK_FILE = path.join(ROOT, '.rail/.lock')
export const LOCK_WAIT_MS = Number(process.env.RAIL_LOCK_WAIT_MS) || 180_000
export const LOCK_STALE_MS = 10 * 60_000
let lockDepth = 0
export const sleepMs = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
export function staleLock() {
  let text
  try {
    text = fs.readFileSync(LOCK_FILE, 'utf8')
  } catch {
    return null
  }
  try {
    const info = JSON.parse(text)
    if (Date.now() - Date.parse(info.at) > LOCK_STALE_MS) return text
    process.kill(info.pid, 0)
    return null
  } catch (e) {
    if (e?.code === 'ESRCH') return text
    if (e?.code === 'EPERM') return null
    // 막 만들어져 아직 비었을 수 있다. 몇 초 지나도 읽히지 않으면 버린다.
    try {
      return Date.now() - fs.statSync(LOCK_FILE).mtimeMs > 5000 ? text : null
    } catch {
      return null
    }
  }
}
// soft: 기다리다 못 얻으면 실패로 끝내지 않고 false 를 준다(작업 중 표시처럼 건너뛰어도 되는 쓰기).
export function lock(waitMs = LOCK_WAIT_MS, soft = false) {
  if (lockDepth++ > 0) return true
  fs.mkdirSync(path.dirname(LOCK_FILE), { recursive: true })
  const deadline = Date.now() + waitMs
  for (;;) {
    try {
      const fd = fs.openSync(LOCK_FILE, 'wx')
      fs.writeSync(fd, JSON.stringify({ pid: process.pid, at: now(), cmd: process.argv.slice(2, 4).join(' ') }))
      fs.closeSync(fd)
      return true
    } catch (e) {
      if (e?.code !== 'EEXIST') {
        lockDepth = 0
        throw e
      }
    }
    const stale = staleLock()
    if (stale !== null) {
      // 버리기 직전에 다시 읽어 같은 잠금일 때만 지운다(그사이 남이 새로 잡았으면 건드리지 않는다).
      try {
        if (fs.readFileSync(LOCK_FILE, 'utf8') === stale) fs.unlinkSync(LOCK_FILE)
      } catch {}
      continue
    }
    if (Date.now() > deadline) {
      lockDepth = 0
      if (soft) return false
      fail(`[잠금] ${path.relative(ROOT, LOCK_FILE)} 을 ${Math.round(LOCK_WAIT_MS / 1000)}초 동안 얻지 못했습니다. 다른 레일 명령이 아직 돕니다. 끝난 뒤 다시 부르세요.`)
    }
    sleepMs(15 + Math.floor(Math.random() * 30))
  }
}
export function unlock() {
  if (lockDepth === 0 || --lockDepth > 0) return
  try {
    if (JSON.parse(fs.readFileSync(LOCK_FILE, 'utf8')).pid === process.pid) fs.unlinkSync(LOCK_FILE)
  } catch {}
}
export function withLock(fn) {
  lock()
  try {
    return fn()
  } finally {
    unlock()
  }
}
// fail() 은 process.exit 로 끝난다. 그때도 잡은 잠금을 푼다.
process.on('exit', () => {
  if (lockDepth > 0) (lockDepth = 1), unlock()
})

// ---------- 자율 모드: 작업 중 표시, 멈춤 규칙, next ----------
// 누가: Claude 세션 번호, 없으면 Orca 세션 번호, 없으면 Orca 창. 모르면 'unknown'(그때는 늘 남으로 본다).
export function whoAmI() {
  const e = process.env
  if (e.CLAUDE_CODE_SESSION_ID) return `claude:${e.CLAUDE_CODE_SESSION_ID}`
  if (e.ORCA_AGENT_SESSION_ID) return `orca:${e.ORCA_AGENT_SESSION_ID}`
  if (e.ORCA_TERMINAL_HANDLE) return `orca:${e.ORCA_TERMINAL_HANDLE}`
  return 'unknown'
}
// 레일 명령이 돌 때마다 상태의 busy(누가, 언제, 무슨 명령)를 갱신한다. next 는 보기만 하므로 갱신하지 않는다.
// 마무리 검사 훅처럼 남의 일을 보는 호출은 RAIL_NO_TOUCH=1 을 붙인다. 상태 파일이 아직 없으면 만들지 않는다.
// 같은 세션이 1분 안에 다시 부르면 다시 쓰지 않는다.
export function touchBusy(cmd) {
  if (process.env.RAIL_NO_TOUCH || !fs.existsSync(F.state)) return
  // 세션 시작 훅(10초 제한)에서도 불리므로 잠금을 오래 기다리지 않는다. 못 얻으면 이번 갱신은 건너뛴다.
  if (!lock(2000, true)) return
  try {
    const st = loadState()
    const who = whoAmI()
    const b = st.busy
    if (b && b.who === who && Date.now() - Date.parse(b.at) < 60_000) return
    st.busy = { who, at: now(), cmd }
    saveState(st)
  } catch {
    // 상태 파일이 깨졌으면 표시는 건너뛴다. 명령 자신이 그 오류를 알린다.
  } finally {
    unlock()
  }
}
export const softLog = (event, st, data) => {
  if (!lock(3000, true)) return
  try {
    appendLog(event, st, data)
  } finally {
    unlock()
  }
}
