import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  AI_BASE_URL_ERROR,
  applySettingsPatch,
  findBaseUrlChanges,
  isAllowedAiBaseUrl,
  normalizeStoredSettings,
  type EncodeApiKey,
  type StoredSettings
} from '../../src/main/settings'

const LIBRARY_DIRECTORY = join(tmpdir(), 'reader-bai-papers')

const plainEncode: EncodeApiKey = (apiKey) => ({ apiKey, apiKeyEncrypted: false })

const encryptedEncode: EncodeApiKey = (apiKey) => ({
  apiKey: `enc:${apiKey}`,
  apiKeyEncrypted: true
})

const withProfiles = (): StoredSettings =>
  normalizeStoredSettings({
    theme: 'dark',
    ai: {
      profiles: [
        { id: 'a', baseUrl: 'https://a.example/v1', apiKey: 'sk-a', model: 'model-a' },
        { id: 'b', baseUrl: 'https://b.example/v1', apiKey: 'sk-b', model: 'model-b' }
      ],
      activeId: 'b'
    }
  })

describe('normalizeStoredSettings', () => {
  it('normalizes the profiles format', () => {
    const result = normalizeStoredSettings({
      theme: 'dark',
      ai: {
        profiles: [
          {
            id: ' a ',
            baseUrl: ' https://api.example.com/v1 ',
            apiKey: ' sk-test ',
            apiKeyEncrypted: false,
            model: ' gpt-test '
          }
        ],
        activeId: 'a'
      }
    })

    expect(result).toEqual({
      theme: 'dark',
      language: 'zh',
      ai: {
        profiles: [
          {
            id: 'a',
            provider: 'openai',
            baseUrl: 'https://api.example.com/v1',
            apiKey: 'sk-test',
            apiKeyEncrypted: false,
            model: 'gpt-test'
          }
        ],
        activeId: 'a'
      },
      library: { directory: '', autoAnalyze: true }
    })
  })

  it('defaults missing or unknown providers to openai and keeps anthropic', () => {
    const result = normalizeStoredSettings({
      ai: {
        profiles: [
          { id: 'a', baseUrl: 'https://a', model: 'm' },
          { id: 'b', provider: 'anthropic', baseUrl: 'https://b', model: 'm' },
          { id: 'c', provider: 'gemini', baseUrl: 'https://c', model: 'm' }
        ],
        activeId: 'a'
      }
    })

    expect(result.ai.profiles.map((profile) => profile.provider)).toEqual([
      'openai',
      'anthropic',
      'openai'
    ])
  })

  it('migrates removed themes to light', () => {
    expect(normalizeStoredSettings({ theme: 'system' }).theme).toBe('light')
    expect(normalizeStoredSettings({ theme: 'mono' }).theme).toBe('light')
    expect(normalizeStoredSettings({ theme: 'unknown' }).theme).toBe('light')
    expect(normalizeStoredSettings({}).theme).toBe('light')
  })

  it('keeps valid language tags and falls back to Chinese', () => {
    expect(normalizeStoredSettings({ language: ' zh ' }).language).toBe('zh')
    expect(normalizeStoredSettings({ language: 'en' }).language).toBe('en')
    // 允许 BCP 47 变体，以后新增语言不需要改主进程
    expect(normalizeStoredSettings({ language: 'pt-BR' }).language).toBe('pt-BR')
    expect(normalizeStoredSettings({ language: 'zh-Hans' }).language).toBe('zh-Hans')
    expect(normalizeStoredSettings({ language: 'not a language' }).language).toBe('zh')
    expect(normalizeStoredSettings({ language: 42 }).language).toBe('zh')
    expect(normalizeStoredSettings({}).language).toBe('zh')
  })

  it('keeps an absolute library directory and drops invalid ones', () => {
    expect(
      normalizeStoredSettings({ library: { directory: ` ${LIBRARY_DIRECTORY} ` } }).library
    ).toEqual({ directory: LIBRARY_DIRECTORY, autoAnalyze: true })
    expect(normalizeStoredSettings({ library: { directory: 'relative/papers' } }).library).toEqual({
      directory: '',
      autoAnalyze: true
    })
    expect(normalizeStoredSettings({ library: { directory: 42 } }).library).toEqual({
      directory: '',
      autoAnalyze: true
    })
    expect(normalizeStoredSettings({}).library).toEqual({ directory: '', autoAnalyze: true })
  })

  it('keeps the auto-analyze switch and defaults it to on', () => {
    expect(normalizeStoredSettings({}).library.autoAnalyze).toBe(true)
    expect(normalizeStoredSettings({ library: { autoAnalyze: false } }).library.autoAnalyze).toBe(
      false
    )
    expect(normalizeStoredSettings({ library: { autoAnalyze: 'no' } }).library.autoAnalyze).toBe(
      true
    )
  })

  it('keeps an empty list when profiles are missing or empty', () => {
    expect(normalizeStoredSettings({ ai: {} }).ai).toEqual({ profiles: [], activeId: '' })
    expect(normalizeStoredSettings({ ai: { profiles: [] } }).ai).toEqual({
      profiles: [],
      activeId: ''
    })
  })

  it('generates stable ids for missing or duplicate ids', () => {
    const first = normalizeStoredSettings({
      ai: {
        profiles: [{ baseUrl: 'https://a' }, { id: 'x' }, { id: 'x' }],
        activeId: 'missing'
      }
    })
    const second = normalizeStoredSettings({
      ai: {
        profiles: [{ baseUrl: 'https://a' }, { id: 'x' }, { id: 'x' }],
        activeId: 'missing'
      }
    })

    expect(first.ai.profiles.map((profile) => profile.id)).toEqual(['profile-1', 'x', 'profile-3'])
    expect(second.ai.profiles.map((profile) => profile.id)).toEqual(
      first.ai.profiles.map((profile) => profile.id)
    )
    // 失效的 activeId 回退到第一条
    expect(first.ai.activeId).toBe('profile-1')

    // 生成的兜底 id 不能和已有 id 冲突
    const collision = normalizeStoredSettings({
      ai: {
        profiles: [{ id: 'profile-2', baseUrl: 'https://a' }, { baseUrl: 'https://b' }],
        activeId: 'profile-2'
      }
    })
    expect(collision.ai.profiles.map((profile) => profile.id)).toEqual(['profile-2', 'profile-2-2'])
  })

  it('does not truncate encrypted keys but caps plaintext keys', () => {
    const cipher = 'c'.repeat(1000)
    const result = normalizeStoredSettings({
      ai: {
        profiles: [
          { id: 'a', baseUrl: 'https://a', apiKey: cipher, apiKeyEncrypted: true, model: 'm' },
          {
            id: 'b',
            baseUrl: 'https://b',
            apiKey: 'p'.repeat(600),
            apiKeyEncrypted: false,
            model: 'm'
          }
        ],
        activeId: 'a'
      }
    })

    expect(result.ai.profiles[0].apiKey).toBe(cipher)
    expect(result.ai.profiles[1].apiKey.length).toBe(500)
  })

  it('caps the number of profiles at 20', () => {
    const profiles = Array.from({ length: 25 }, (_, index) => ({
      id: `p-${index}`,
      baseUrl: 'https://example.com/v1',
      apiKey: 'sk',
      model: 'm'
    }))

    const result = normalizeStoredSettings({ ai: { profiles, activeId: 'p-24' } })

    expect(result.ai.profiles).toHaveLength(20)
    // 被截断的 activeId 回退到第一条
    expect(result.ai.activeId).toBe('p-0')
  })
})

describe('applySettingsPatch', () => {
  it('replaces profiles, encodes keys, and switches the active id', () => {
    const encode = vi.fn(encryptedEncode)
    const base = withProfiles()

    const next = applySettingsPatch(
      base,
      {
        ai: {
          profiles: [
            { id: 'c', baseUrl: ' https://c.example/v1 ', apiKey: ' secret ', model: ' model-c ' }
          ]
        }
      },
      encode
    )

    expect(encode).toHaveBeenCalledWith('secret')
    expect(next.ai.profiles).toEqual([
      {
        id: 'c',
        provider: 'openai',
        baseUrl: 'https://c.example/v1',
        apiKey: 'enc:secret',
        apiKeyEncrypted: true,
        model: 'model-c'
      }
    ])
    // 原 activeId b 已不存在，回退到剩余第一条
    expect(next.ai.activeId).toBe('c')
  })

  it('changes only activeId and leaves encrypted profiles untouched', () => {
    const encode = vi.fn(encryptedEncode)
    const base = normalizeStoredSettings({
      ai: {
        profiles: [
          {
            id: 'a',
            baseUrl: 'https://a',
            apiKey: 'c'.repeat(800),
            apiKeyEncrypted: true,
            model: 'm'
          }
        ],
        activeId: 'a'
      }
    })

    const next = applySettingsPatch(base, { ai: { activeId: 'a' } }, encode)

    expect(encode).not.toHaveBeenCalled()
    expect(next.ai.profiles).toEqual(base.ai.profiles)
    expect(next.ai.activeId).toBe('a')
  })

  it('treats an empty ai patch as a no-op', () => {
    const base = withProfiles()

    expect(applySettingsPatch(base, { ai: {} }, plainEncode)).toEqual(base)
    expect(applySettingsPatch(base, null, plainEncode)).toEqual(base)
  })

  it('falls back to the first profile when activeId is unknown', () => {
    const base = withProfiles()

    expect(applySettingsPatch(base, { ai: { activeId: 'missing' } }, plainEncode).ai.activeId).toBe(
      'a'
    )
  })

  it('normalizes activeId after the active profile is deleted', () => {
    const base = withProfiles()
    const remaining = base.ai.profiles.filter((profile) => profile.id === 'a')

    const next = applySettingsPatch(base, { ai: { profiles: remaining } }, plainEncode)

    expect(next.ai.activeId).toBe('a')
  })

  it('applies theme patches independently from profiles', () => {
    const base = withProfiles()

    const next = applySettingsPatch(base, { theme: 'light' }, plainEncode)

    expect(next.theme).toBe('light')
    expect(next.ai).toEqual(base.ai)
  })

  it('applies language patches independently from other settings', () => {
    const base = withProfiles()

    const next = applySettingsPatch(base, { language: 'en' }, plainEncode)

    expect(next.language).toBe('en')
    expect(next.theme).toBe(base.theme)
    expect(next.ai).toEqual(base.ai)
    expect(next.library).toEqual(base.library)

    // 未提供 language 时保持原值
    expect(applySettingsPatch(next, { theme: 'light' }, plainEncode).language).toBe('en')
    // 非法标签回退到默认语言
    expect(applySettingsPatch(next, { language: 'en US' }, plainEncode).language).toBe('zh')
  })

  it('sets and resets the library directory', () => {
    const base = withProfiles()

    const moved = applySettingsPatch(
      base,
      { library: { directory: ` ${LIBRARY_DIRECTORY} ` } },
      plainEncode
    )
    expect(moved.library).toEqual({ directory: LIBRARY_DIRECTORY, autoAnalyze: true })
    expect(moved.ai).toEqual(base.ai)

    const reset = applySettingsPatch(moved, { library: { directory: '' } }, plainEncode)
    expect(reset.library).toEqual({ directory: '', autoAnalyze: true })

    // 只给 theme 时不动目录
    expect(applySettingsPatch(moved, { theme: 'dark' }, plainEncode).library).toEqual(moved.library)
  })

  it('updates auto-analyze without touching the library directory', () => {
    const base = withProfiles()

    const disabled = applySettingsPatch(base, { library: { autoAnalyze: false } }, plainEncode)
    expect(disabled.library).toEqual({ directory: '', autoAnalyze: false })
    expect(disabled.ai).toEqual(base.ai)

    const ignored = applySettingsPatch(base, { library: { autoAnalyze: 'no' } }, plainEncode)
    expect(ignored.library.autoAnalyze).toBe(true)
  })

  it('rejects a relative library directory', () => {
    const base = withProfiles()

    expect(() =>
      applySettingsPatch(base, { library: { directory: 'relative/papers' } }, plainEncode)
    ).toThrow('论文库存储位置需要是绝对路径')
  })

  it('keeps the stored key when a redacted profile is submitted without apiKey', () => {
    const encode = vi.fn(encryptedEncode)
    const base = withProfiles()

    const next = applySettingsPatch(
      base,
      {
        ai: {
          profiles: [{ id: 'a', baseUrl: 'https://a.example/v2', model: 'model-a2' }]
        }
      },
      encode
    )

    expect(encode).not.toHaveBeenCalled()
    expect(next.ai.profiles[0]).toEqual({
      id: 'a',
      provider: 'openai',
      baseUrl: 'https://a.example/v2',
      apiKey: 'sk-a',
      apiKeyEncrypted: false,
      model: 'model-a2'
    })
    // 未提交的配置被移除，其 Key 也不会带回来
    expect(next.ai.profiles).toHaveLength(1)
  })

  it('leaves a new profile without apiKey empty', () => {
    const encode = vi.fn(encryptedEncode)

    const next = applySettingsPatch(
      withProfiles(),
      { ai: { profiles: [{ id: 'new', baseUrl: 'https://new.example/v1', model: 'm' }] } },
      encode
    )

    expect(encode).not.toHaveBeenCalled()
    expect(next.ai.profiles[0]).toEqual({
      id: 'new',
      provider: 'openai',
      baseUrl: 'https://new.example/v1',
      apiKey: '',
      apiKeyEncrypted: false,
      model: 'm'
    })
  })

  it('preserves the provider when a patch omits it and accepts explicit changes', () => {
    const base = normalizeStoredSettings({
      ai: {
        profiles: [
          {
            id: 'a',
            provider: 'anthropic',
            baseUrl: 'https://a.example',
            apiKey: 'sk-a',
            model: 'm'
          }
        ],
        activeId: 'a'
      }
    })

    const kept = applySettingsPatch(
      base,
      { ai: { profiles: [{ id: 'a', baseUrl: 'https://a.example', model: 'm2' }] } },
      plainEncode
    )
    expect(kept.ai.profiles[0].provider).toBe('anthropic')

    const changed = applySettingsPatch(
      base,
      {
        ai: {
          profiles: [{ id: 'a', provider: 'openai', baseUrl: 'https://a.example', model: 'm2' }]
        }
      },
      plainEncode
    )
    expect(changed.ai.profiles[0].provider).toBe('openai')
  })

  it('rejects AI base URLs that would send the key over plain HTTP', () => {
    expect(isAllowedAiBaseUrl('https://api.example.com/v1')).toBe(true)
    expect(isAllowedAiBaseUrl('http://localhost:11434/v1')).toBe(true)
    expect(isAllowedAiBaseUrl('http://127.0.0.1:11434/v1')).toBe(true)
    expect(isAllowedAiBaseUrl('http://[::1]:11434/v1')).toBe(true)
    expect(isAllowedAiBaseUrl('http://api.example.com/v1')).toBe(false)
    expect(isAllowedAiBaseUrl('file:///etc/passwd')).toBe(false)
    expect(isAllowedAiBaseUrl('not a url')).toBe(false)
    expect(isAllowedAiBaseUrl('')).toBe(false)
  })

  it('detects origin changes for profiles that already hold a key', () => {
    const base = withProfiles()

    expect(
      findBaseUrlChanges(base, {
        ai: { profiles: [{ id: 'a', baseUrl: 'https://evil.example/v1', model: 'model-a' }] }
      })
    ).toEqual([{ id: 'a', from: 'https://a.example/v1', to: 'https://evil.example/v1' }])

    // 端口变化同样会改变 Key 的去向
    expect(
      findBaseUrlChanges(base, {
        ai: { profiles: [{ id: 'a', baseUrl: 'https://a.example:8443/v1', model: 'model-a' }] }
      })
    ).toHaveLength(1)
  })

  it('does not ask for path-only edits, new profiles, missing keys or deletions', () => {
    const base = withProfiles()

    // 仅路径变化
    expect(
      findBaseUrlChanges(base, {
        ai: { profiles: [{ id: 'a', baseUrl: 'https://a.example/v2', model: 'model-a' }] }
      })
    ).toEqual([])

    // 新增配置
    expect(
      findBaseUrlChanges(base, {
        ai: {
          profiles: [
            ...base.ai.profiles.map(({ id, baseUrl, model }) => ({ id, baseUrl, model })),
            { id: 'new', baseUrl: 'https://new.example/v1', apiKey: 'sk-new', model: 'm' }
          ]
        }
      })
    ).toEqual([])

    // 没有 Key 的配置改了地址也不需要确认
    const noKey = normalizeStoredSettings({
      ai: { profiles: [{ id: 'a', baseUrl: 'https://a.example/v1', model: 'model-a' }] }
    })
    expect(
      findBaseUrlChanges(noKey, {
        ai: { profiles: [{ id: 'a', baseUrl: 'https://evil.example/v1', model: 'm' }] }
      })
    ).toEqual([])

    // 删除配置或只切换 activeId 不触发
    expect(findBaseUrlChanges(base, { ai: { profiles: [], activeId: '' } })).toEqual([])
    expect(findBaseUrlChanges(base, { ai: { activeId: 'a' } })).toEqual([])
  })

  it('rejects saving a non-HTTPS base URL', () => {
    expect(() =>
      applySettingsPatch(
        withProfiles(),
        {
          ai: {
            profiles: [{ id: 'a', baseUrl: 'http://evil.example/v1', apiKey: 'sk', model: 'm' }]
          }
        },
        plainEncode
      )
    ).toThrow(AI_BASE_URL_ERROR)

    expect(() =>
      applySettingsPatch(
        withProfiles(),
        { ai: { profiles: [{ id: 'a', baseUrl: 'file:///tmp/key', model: 'm' }] } },
        plainEncode
      )
    ).toThrow(AI_BASE_URL_ERROR)
  })
})
