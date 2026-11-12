import { describe, expect, it, vi } from 'vitest'
import {
  applySettingsPatch,
  normalizeStoredSettings,
  type EncodeApiKey,
  type StoredSettings
} from '../../src/main/settings'

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
      ai: {
        profiles: [
          {
            id: 'a',
            baseUrl: 'https://api.example.com/v1',
            apiKey: 'sk-test',
            apiKeyEncrypted: false,
            model: 'gpt-test'
          }
        ],
        activeId: 'a'
      }
    })
  })

  it('migrates a legacy single config into a default profile', () => {
    const result = normalizeStoredSettings({
      theme: 'light',
      ai: {
        baseUrl: 'https://legacy.example/v1',
        apiKey: 'sk-legacy',
        apiKeyEncrypted: false,
        model: 'legacy-model'
      }
    })

    expect(result.theme).toBe('light')
    expect(result.ai.profiles).toEqual([
      {
        id: 'default',
        baseUrl: 'https://legacy.example/v1',
        apiKey: 'sk-legacy',
        apiKeyEncrypted: false,
        model: 'legacy-model'
      }
    ])
    expect(result.ai.activeId).toBe('default')
  })

  it('keeps an empty list for empty legacy settings and explicit empty profiles', () => {
    expect(normalizeStoredSettings({ ai: {} }).ai).toEqual({ profiles: [], activeId: '' })
    expect(
      normalizeStoredSettings({
        ai: {
          profiles: [],
          baseUrl: 'https://legacy.example/v1',
          apiKey: 'sk-legacy',
          apiKeyEncrypted: false,
          model: 'legacy-model'
        }
      }).ai
    ).toEqual({ profiles: [], activeId: '' })
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
})
