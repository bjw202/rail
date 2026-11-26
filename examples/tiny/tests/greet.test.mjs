import assert from 'node:assert/strict'
import { test } from 'node:test'
import { greet } from '../src/greet.mjs'

test('이름을 넣으면 인사 한 줄이 나온다', () => {
  assert.equal(greet('민지'), '안녕하세요, 민지님')
})
