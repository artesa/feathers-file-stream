import { expect } from 'vitest'
import * as src from '../src'

describe('index.test.ts', function () {
  it('exports members', function () {
    // services
    expect(typeof src.ServiceFileStreamFS).toBe('function')
    expect(typeof src.ServiceFileStreamS3).toBe('function')

    // hooks
    expect(typeof src.unpipe).toBe('function')

    // middleware
    expect(typeof src.expressHandleIncomingStreams).toBe('function')
    expect(typeof src.expressSendStreamForGet).toBe('function')
  })
})
