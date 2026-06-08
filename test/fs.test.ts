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

    it('uploads multiple files at once', async function () {
      const { body: uploadResult } = await supertest(app as any)
        .post('/uploads')
        .attach('files', Buffer.from('file a'), 'a.txt')
        .attach('files', Buffer.from('file b'), 'b.txt')
        .expect(201)

      expect(Array.isArray(uploadResult)).toBe(true)
      expect(uploadResult.length).toBe(2)
      expect(uploadResult[0].id).not.toBe(uploadResult[1].id)

      const exists = async (id: string) =>
        fsp
          .access(path.join(__dirname, 'uploads', id))
          .then(() => true)
          .catch(() => false)

      expect(await exists(uploadResult[0].id)).toBe(true)
      expect(await exists(uploadResult[1].id)).toBe(true)
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

  // NOTE: FS range is read from `params.range` (S3 reads `params.headers.range`),
  // so an HTTP `Range` header is NOT mapped automatically — range only works via
  // a direct service call. The S3 HTTP `Range` path is covered in s3.test.ts /
  // s3-minio.test.ts. See plan: "FS-Range über HTTP greift nicht".
  it('serves partial content for a range request (206)', async function () {
    const buffer = Buffer.from('0123456789')
    const id = 'test-range-file.txt'
    await fsp.writeFile(path.join(__dirname, 'uploads', id), buffer)

    const result = await app.service('uploads').get(id, { range: 'bytes=0-3' })

    expect(result.status).toBe(206)
    expect(result.header['Content-Range']).toBe('bytes 0-3/10')
    expect(result.header['Content-Length']).toBe(4)

    const chunks: Buffer[] = []
    for await (const chunk of result.stream) {
      chunks.push(chunk as Buffer)
    }
    expect(Buffer.concat(chunks)).toEqual(Buffer.from('0123'))
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
