import supertest from 'supertest'
import { mockFSServer } from './utils/mockApp'
import { transformItems } from './utils'
import { expect } from 'vitest'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { unpipe } from '../src'

describe('fs.test.ts', function () {
  let app: Awaited<ReturnType<typeof mockFSServer>>

  beforeAll(async () => {
    app = await mockFSServer()

    const uploadsService = app.service('uploads')

    uploadsService.hooks({
      before: {
        create: [transformItems()],
      },
      after: {
        create: [unpipe({ unlink: 'path' })],
      },
      error: {
        create: [unpipe({ unlink: 'path' })],
      },
    })
  })

  it('get throws NotFound for non-existing file', async () => {
    await supertest(app as any)
      .get('/uploads/does-not-exist')
      .expect(404)
  })

  it('remove throws NotFound for non-existing file', async () => {
    await supertest(app as any)
      .delete('/uploads/does-not-exist')
      .expect(404)
  })

  describe('upload', () => {
    it('throws appropriate error for big file', async function () {
      const buffer = Buffer.from('a'.repeat(1e6 * 5)) // 5MB

      const result = await supertest(app as any)
        .post('/uploads')
        .attach('files', buffer, 'test.txt')
        .expect(400)

      expect(result.body.name).toBe('BadRequest')
      expect(result.body.message).toBe('File too large')
    })

    it('uploads file', async function () {
      const buffer = Buffer.from('some data')

      const { body: uploadResult } = await supertest(app as any)
        .post('/uploads')
        .attach('files', buffer, 'test.txt')
        .expect(201)

      expect(Array.isArray(uploadResult)).toBe(true)
      expect(uploadResult.length).toBe(1)
      expect(typeof uploadResult[0]).toBe('object')
      expect(typeof uploadResult[0].id).toBe('string')
    })

    it('uploads buffer file', async function () {
      const result = await app.service('uploads').create({
        id: 'test.txt',
        stream: Buffer.from('some data'),
        filename: 'test.txt',
      } as any)

      expect(typeof result).toBe('object')
      expect(result).toHaveProperty('id')
      expect(typeof result.id).toBe('string')

      const file = await app.service('uploads').get(result.id)

      expect(typeof file).toBe('object')
      expect(file).toHaveProperty('stream')
    })
  })

  it('downloads file', async function () {
    const buffer = Buffer.from('some data download file')
    const id = 'test-download-file.txt'
    const filepath = path.join(__dirname, 'uploads', id)
    await fsp.writeFile(filepath, buffer)

    const result = await supertest(app as any)
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

    expect(result.body).toBeInstanceOf(Buffer)
    expect(result.body).toEqual(buffer)
    expect(result.header['content-type']).toBe('text/plain; charset=utf-8')
    expect(result.header['content-disposition']).toBe('inline')
    expect(result.header['content-length']).toBe(`${buffer.length}`)
  })

  it('removes file', async function () {
    const buffer = Buffer.from('some data download file')
    const id = 'test-remove-file.txt'
    const filepath = path.join(__dirname, 'uploads', id)
    await fsp.writeFile(filepath, buffer)

    const result = await supertest(app as any)
      .delete(`/uploads/${id}`)
      .expect(200)

    expect(typeof result.body).toBe('object')
    expect(result.body.id).toBe(id)
  })

  it('moves file', async function () {
    const buffer = Buffer.from('some data download file')
    const oldId = 'test-move-file.txt'
    const newId = 'test-move-file-2.txt'
    const idFolder = (id: string) => path.join(__dirname, 'uploads', id)
    await fsp.writeFile(idFolder(oldId), buffer)

    const exists = async (file: any) =>
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
