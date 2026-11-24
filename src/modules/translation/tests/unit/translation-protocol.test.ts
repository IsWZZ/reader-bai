import { describe, expect, it } from 'vitest'
import {
  MAX_ERROR_LENGTH,
  MAX_MESSAGES_CHARS,
  MAX_SOURCE_CHARS,
  parseHostMessage,
  parsePlatformMessage,
  parseTranslateRequest
} from '../../main/protocol'

describe('parseTranslateRequest', () => {
  it('accepts a valid request and trims identifiers and text', () => {
    expect(
      parseTranslateRequest({
        requestId: ' r1 ',
        source: ' hello ',
        profileId: ' p1 '
      })
    ).toEqual({ requestId: 'r1', source: 'hello', profileId: 'p1' })
  })

  it('rejects malformed requests', () => {
    expect(() => parseTranslateRequest(null)).toThrow('翻译请求必须是对象')
    expect(() => parseTranslateRequest('request')).toThrow('翻译请求必须是对象')
    expect(() => parseTranslateRequest({ requestId: '', source: 'x', profileId: 'p' })).toThrow(
      '请求标识必须是非空字符串'
    )
    expect(() => parseTranslateRequest({ requestId: 'r', source: '   ', profileId: 'p' })).toThrow(
      '待翻译文本必须是非空字符串'
    )
    expect(() => parseTranslateRequest({ requestId: 'r', source: 'x', profileId: '' })).toThrow(
      'AI 配置必须是非空字符串'
    )
  })

  it('rejects oversized source text', () => {
    expect(() =>
      parseTranslateRequest({
        requestId: 'r',
        source: 'x'.repeat(MAX_SOURCE_CHARS + 1),
        profileId: 'p'
      })
    ).toThrow('待翻译文本过长')
  })
})

describe('parseHostMessage', () => {
  it('accepts lifecycle and translation messages', () => {
    expect(parseHostMessage({ type: 'ready' })).toEqual({ type: 'ready' })
    expect(parseHostMessage({ type: 'stopped' })).toEqual({ type: 'stopped' })
    expect(
      parseHostMessage({
        type: 'chat-request',
        requestId: 'r1',
        messages: [{ role: 'user', content: 'hi' }]
      })
    ).toEqual({
      type: 'chat-request',
      requestId: 'r1',
      messages: [{ role: 'user', content: 'hi' }]
    })
    expect(parseHostMessage({ type: 'done', requestId: 'r1', text: '' })).toEqual({
      type: 'done',
      requestId: 'r1',
      text: ''
    })
    expect(parseHostMessage({ type: 'error', requestId: 'r1', message: 'boom' })).toEqual({
      type: 'error',
      requestId: 'r1',
      message: 'boom'
    })
  })

  it('rejects malformed host messages', () => {
    expect(() => parseHostMessage({ type: 'unknown' })).toThrow('未知的翻译宿主消息')
    expect(() => parseHostMessage({ type: 'chat-request', requestId: '', messages: [] })).toThrow(
      '请求标识必须是非空字符串'
    )
    expect(() =>
      parseHostMessage({
        type: 'error',
        requestId: 'r1',
        message: 'x'.repeat(MAX_ERROR_LENGTH + 1)
      })
    ).toThrow('错误信息过长')
  })

  it('rejects oversized or unserializable messages', () => {
    expect(() =>
      parseHostMessage({
        type: 'chat-request',
        requestId: 'r1',
        messages: { text: 'x'.repeat(MAX_MESSAGES_CHARS) }
      })
    ).toThrow('对话消息过大')

    const circular: Record<string, unknown> = {}
    circular.self = circular
    expect(() =>
      parseHostMessage({ type: 'chat-request', requestId: 'r1', messages: circular })
    ).toThrow('对话消息无法序列化')
  })
})

describe('parsePlatformMessage', () => {
  it('accepts the messages the platform sends to the host', () => {
    expect(parsePlatformMessage({ type: 'translate', requestId: 'r1', source: 'hello' })).toEqual({
      type: 'translate',
      requestId: 'r1',
      source: 'hello'
    })
    expect(
      parsePlatformMessage({
        type: 'response',
        requestId: 'r1',
        ok: true,
        result: { text: '你好' }
      })
    ).toEqual({
      type: 'response',
      requestId: 'r1',
      ok: true,
      result: { text: '你好' }
    })
    expect(
      parsePlatformMessage({ type: 'response', requestId: 'r1', ok: false, error: 'boom' })
    ).toEqual({
      type: 'response',
      requestId: 'r1',
      ok: false,
      error: 'boom'
    })
    expect(parsePlatformMessage({ type: 'cancel', requestId: 'r1' })).toEqual({
      type: 'cancel',
      requestId: 'r1'
    })
    expect(parsePlatformMessage({ type: 'stop' })).toEqual({ type: 'stop' })
  })

  it('rejects malformed platform messages', () => {
    expect(() => parsePlatformMessage(null)).toThrow('平台消息必须是对象')
    expect(() => parsePlatformMessage({ type: 'unknown' })).toThrow('未知的平台消息')
    expect(() =>
      parsePlatformMessage({ type: 'translate', requestId: 'r1', source: ' '.repeat(2) })
    ).toThrow('待翻译文本必须是非空字符串')
    expect(() => parsePlatformMessage({ type: 'response', requestId: 'r1', ok: 'yes' })).toThrow(
      '响应状态不正确'
    )
    expect(() =>
      parsePlatformMessage({ type: 'response', requestId: 'r1', ok: false, error: '' })
    ).toThrow('错误信息必须是非空字符串')
  })
})
