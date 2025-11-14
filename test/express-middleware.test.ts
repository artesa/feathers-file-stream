import supertest from 'supertest'
import { mockFSServer } from './utils/mockApp'
import { expect } from 'vitest'
import { unpipe } from '../src'

describe('express-middleware.test.ts', function () {
  it('upload file', async function () {
    let transformCalled = false
    const app = await mockFSServer({
      transformItems: (file) => {
        transformCalled = true
        return {
          ...file,
          test: true,
        }
      },
    })

    const uploadsService = app.service('uploads')

    let hookCalled = false

    uploadsService.hooks({
      before: {
        create: [
          async (context: any) => {
            const { data } = context

            expect(Array.isArray(data)).toBe(true)
            expect(data.length).toBe(1)

            const [obj] = data

            expect(typeof obj).toBe('object')
            expect(obj).toHaveProperty('stream')
            expect(obj.test).toBe(true)

            hookCalled = true

            throw new Error('')
          },
        ],
      },
      after: {
        create: [unpipe({ unlink: 'path' })],
      },
      error: {
        create: [unpipe({ unlink: 'path' })],
      },
    })

    const buffer = Buffer.from('some data')

    await supertest(app as any)
      .post('/uploads')
      .attach('files', buffer, 'test.txt')

    expect(transformCalled).toBe(true)
    expect(hookCalled).toBe(true)
  })
})
