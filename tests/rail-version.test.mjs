// 레일 판 번호: 원본은 .rail/config.json 의 railVersion 하나. status 가 그것을 보인다.
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, test } from 'node:test'
import { put, rail, tmp } from './helpers.mjs'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const doc = (v) => `# 레일 사용법 (한 쪽)\n레일 ${v}판\n\n본문\n`

describe('status 의 판 번호', () => {
  test('config 의 railVersion 을 읽어 첫 줄과 훅 머리에 보인다', () => {
    const root = tmp()
    put(root, '.rail/config.json', JSON.stringify({ railVersion: '9.9' }))
    const r = rail(root, 'status')
    assert.equal(r.code, 0)
    assert.match(r.out.split('\n')[0], /^위치: .*레일 9\.9판/)
    const h = JSON.parse(rail(root, 'status', '--hook').out)
    assert.match(h.systemMessage, /^\[레일 9\.9판\]/)
    assert.match(h.hookSpecificOutput.additionalContext, /^\[레일 9\.9판 상태\]/)
    assert.equal(JSON.parse(rail(root, 'status', '--json').out).rail_version, '9.9')
  })

  test('railVersion 이 없으면 죽지 않고 "판 번호 없음" 이라고 알린다', () => {
    const root = tmp()
    put(root, '.rail/config.json', '{"checkCommand": ""}')
    const r = rail(root, 'status')
    assert.equal(r.code, 0)
    assert.match(r.out.split('\n')[0], /판 번호 없음/)
    assert.match(JSON.parse(rail(root, 'status', '--hook').out).systemMessage, /판 번호 없음/)
    assert.equal(JSON.parse(rail(root, 'status', '--json').out).rail_version, null)
  })
})
