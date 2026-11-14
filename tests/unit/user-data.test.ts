import { describe, expect, it } from 'vitest'
import { createUserDataPaths } from '../../src/main/user-data'

describe('createUserDataPaths', () => {
  it('keeps application files under userData/Userdata', () => {
    const paths = createUserDataPaths('/tmp/reader-bai')

    expect(paths).toEqual({
      dataRoot: '/tmp/reader-bai/Userdata',
      libraryFile: '/tmp/reader-bai/Userdata/library.json',
      annotationsFile: '/tmp/reader-bai/Userdata/annotations.json',
      settingsFile: '/tmp/reader-bai/Userdata/settings.json',
      pluginsStateFile: '/tmp/reader-bai/Userdata/plugins.json',
      pluginsDirectory: '/tmp/reader-bai/Userdata/plugins',
      papersDirectory: '/tmp/reader-bai/Userdata/papers'
    })
  })
})
