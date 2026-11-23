import supertest from 'supertest'
import { mockFSServer } from './utils/mockApp'
import { expect } from 'vitest'
import { unpipe } from '../src'
import fsp from 'node:fs/promises'
import http from 'node:http'
import { once } from 'node:events'
import path from 'node:path'
import type { ReadStream } from 'node:fs'

describe('express-middleware.test.ts', function () {
  describe('expressSendStreamForGet', function () {
    it('stops reading the file when the client goes away', async function () {
      const app = await mockFSServer()
      const id = 'test-client-gone.bin'
      const size = 8 * 1024 * 1024
      await fsp.writeFile(
        path.join(__dirname, 'uploads', id),
        Buffer.alloc(size),
      )
      const streams: ReadStream[] = []
      app.service('uploads').hooks({
        after: {
          get: [
            (context: any) => {
              streams.push(context.result.stream)
            },
          ],
        },
      })

      await new Promise<void>((resolve) => {
        http.get(`http://localhost:${app.get('port')}/uploads/${id}`, (res) => {
          res.once('data', () => {
            res.destroy()
            resolve()
          })
        })
      })

      const [stream] = streams
      if (!stream.closed) await once(stream, 'close')
      expect(stream.bytesRead).toBeLessThan(size)
    })

    it('answers with an error when the file fails before its first byte', async function () {
      const app = await mockFSServer()
      // a directory passes the existence check, then fails to read
      const id = 'test-unreadable-dir'
      await fsp.mkdir(path.join(__dirname, 'uploads', id), { recursive: true })

      const result = await supertest(app as any).get(`/uploads/${id}`)

      expect(result.status).toBe(500)
    })
  })

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
