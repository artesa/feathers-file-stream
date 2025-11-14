import supertest from 'supertest'
import { mockFSServer } from './utils/mockApp'
import { transformItems } from './utils'
import { expect } from 'vitest'
import { FeathersError } from '@feathersjs/errors'
import { unpipe } from '../src'
import { Readable } from 'node:stream'

describe('unpipe.test.ts', function () {
  it('unpipe', async function () {
    const app = await mockFSServer()

    const uploadsService = app.service('uploads')

    let throwHookRun = false
    let checkErrorRun = false

    uploadsService.hooks({
      before: {
        create: [
          transformItems(),
          (_context) => {
            throw new FeathersError('test', 'test', 900, 'test', {})
          },
        ],
      },
      error: {
        create: [
          (context: any) => {
            expect(context.error).toBeInstanceOf(FeathersError)
            expect(context.error.code).toBe(900)
            expect(Array.isArray(context.data)).toBe(true)
            expect(context.data.length).toBe(1)
            expect(typeof context.data[0]).toBe('object')
            expect(context.data[0].stream).toBeInstanceOf(Readable)

            throwHookRun = true
          },
          unpipe({ unlink: 'path' }),
          (context: any) => {
            checkErrorRun = true
            const isDestroyed = context.data[0].stream.destroyed
            expect(isDestroyed).toBe(true)
          },
        ],
      },
    })
    const buffer = Buffer.from('some data')

    await supertest(app as any)
      .post('/uploads')
      .attach('files', buffer, 'test.txt')
      .expect(900)

    expect(throwHookRun).toBe(true)
    expect(checkErrorRun).toBe(true)
  })
})
