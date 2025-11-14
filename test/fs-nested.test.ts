import supertest from 'supertest'
import { mockFSServer } from './utils/mockApp'
import { transformItemsNested } from './utils'
import { expect } from 'vitest'
import fsp from 'node:fs/promises'
import path from 'node:path'
import type { HookContext } from '@feathersjs/feathers'
import { unpipe } from '../src'

describe('fs-nested.test.ts', function () {
  let app: Awaited<ReturnType<typeof mockFSServer>>

  beforeAll(async () => {
    app = await mockFSServer()

    const uploadsService = app.service('uploads')

    uploadsService.hooks({
      before: {
        get: [
          (context: HookContext) => {
            // Modifying id in context
            ;(context as any).id = `test/test/${context.id}`
            return context
          },
        ],
        create: [transformItemsNested()],
        remove: [
          (context: HookContext) => {
            // Modifying id in context
            ;(context as any).id = `test/test/${context.id}`
            return context
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
  })

  it('upload file', async function () {
    const buffer = Buffer.from('some data')

    const { body: uploadResult } = await supertest(app as any)
      .post('/uploads')
      .attach('files', buffer, 'test.txt')
      .expect(201)

    expect(Array.isArray(uploadResult)).toBe(true)
    expect(uploadResult.length).toBe(1)
    expect(typeof uploadResult[0]).toBe('object')
    expect(typeof uploadResult[0].id).toBe('string')
    expect(uploadResult[0].id.startsWith('test/test/')).toBe(true)
  })

  it('download file', async function () {
    const buffer = Buffer.from('some data download file')
    const id = 'test-download-file.txt'
    const filepath = path.join(__dirname, 'uploads/test/test/', id)
    await fsp.writeFile(filepath, buffer)

    const { body: downloadResult } = await supertest(app as any)
      .get(`/uploads/${id}`)
      .buffer()
      .parse((res: any, cb) => {
        res.setEncoding('binary')
        res.data = ''
        res.on('data', (chunk: any) => {
          res.data += chunk
        })
        res.on('end', () => cb(null, Buffer.from(res.data, 'binary')))
      })
      .expect(200)

    expect(downloadResult).toBeInstanceOf(Buffer)
    expect(downloadResult).toEqual(buffer)
  })

  it('remove file', async function () {
    const buffer = Buffer.from('some data download file')
    const id = 'test-remove-file.txt'
    const filepath = path.join(__dirname, 'uploads/test/test/', id)
    await fsp.writeFile(filepath, buffer)

    const result = await supertest(app as any)
      .delete(`/uploads/${id}`)
      .expect(200)

    expect(typeof result.body).toBe('object')
    expect(result.body.id).toBe(`test/test/${id}`)
  })

  it('move file', async function () {
    const buffer = Buffer.from('some data download file')
    const oldId = 'test1/test/test-move-file.txt'
    const newId = 'test2/test/test-move-file-2.txt'
    const idFolder = (id: string) => path.join(__dirname, 'uploads', id)
    await fsp.mkdir(path.dirname(idFolder(oldId)), { recursive: true })
    await fsp.writeFile(idFolder(oldId), buffer)

    const exists = async (file: string) =>
      fsp
        .access(file)
        .then(() => true)
        .catch(() => false)

    expect(await exists(idFolder(oldId))).toBe(true)

    await app.service('uploads').move(oldId, newId)

    expect(await exists(idFolder(newId))).toBe(true)
    expect(await fsp.readFile(idFolder(newId))).toEqual(buffer)

    expect(await exists(idFolder(oldId))).toBe(false)
  })
})
