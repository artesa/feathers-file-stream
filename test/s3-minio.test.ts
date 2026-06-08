import supertest from 'supertest'
import { expect } from 'vitest'
import { S3Client, CreateBucketCommand } from '@aws-sdk/client-s3'
import { mockS3Server } from './utils/mockS3App'
import { transformItems } from './utils'
import { unpipe } from '../src'

/**
 * Integration tests against a *real* S3 server (MinIO).
 *
 * Skipped unless `S3_ENDPOINT` is set, so `pnpm test` (local + the cross-OS CI
 * matrix) ignores it. The dedicated `s3-integration` CI job starts a MinIO
 * container (`pgsty/minio` republish — MinIO Inc. discontinued the free
 * `minio/minio` images in 2025) and runs this file via `pnpm test:integration`.
 *
 * Unlike `s3.test.ts` (aws-sdk-client-mock), these exercise real S3 semantics:
 * multipart upload, real streaming bodies, real `Range`/206, and real 404s.
 */
const endpoint = process.env.S3_ENDPOINT

// mockS3Server hardcodes the bucket name "test"
const BUCKET = 'test'

const parseBinary = (req: supertest.Test) =>
  req.buffer().parse((res: any, cb) => {
    res.setEncoding('binary')
    res.data = ''
    res.on('data', (chunk: any) => {
      res.data += chunk
    })
    res.on('end', () => cb(null, Buffer.from(res.data, 'binary')))
  })

describe.skipIf(!endpoint)('s3-minio.test.ts (integration)', function () {
  let app: Awaited<ReturnType<typeof mockS3Server>>
  let client: S3Client

  beforeAll(async function () {
    client = new S3Client({
      region: process.env.S3_REGION || 'us-east-1',
      endpoint,
      forcePathStyle: true,
      credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY_ID || 'minioadmin',
        secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || 'minioadmin',
      },
    })

    try {
      await client.send(new CreateBucketCommand({ Bucket: BUCKET }))
    } catch {
      // bucket already exists — ignore
    }

    app = await mockS3Server({ s3: client })

    app.service('uploads').hooks({
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

  it('uploads a single file', async function () {
    const buffer = Buffer.from('minio single upload')

    const { body } = await supertest(app as any)
      .post('/uploads')
      .attach('files', buffer, 'single.txt')
      .expect(201)

    expect(Array.isArray(body)).toBe(true)
    expect(body.length).toBe(1)
    expect(typeof body[0].id).toBe('string')
  })

  it('uploads multiple files at once', async function () {
    const { body } = await supertest(app as any)
      .post('/uploads')
      .attach('files', Buffer.from('file a'), 'a.txt')
      .attach('files', Buffer.from('file b'), 'b.txt')
      .expect(201)

    expect(Array.isArray(body)).toBe(true)
    expect(body.length).toBe(2)
    expect(body[0].id).not.toBe(body[1].id)
  })

  it('downloads a file', async function () {
    const buffer = Buffer.from('minio download content')

    const { body } = await supertest(app as any)
      .post('/uploads')
      .attach('files', buffer, 'download.txt')
      .expect(201)
    const id = body[0].id

    const result = await parseBinary(
      supertest(app as any).get(`/uploads/${id}`),
    ).expect(200)

    expect(result.body).toEqual(buffer)
    expect(result.header['content-length']).toBe(`${buffer.length}`)
  })

  it('downloads partial content with a range header (206)', async function () {
    const buffer = Buffer.from('0123456789')

    const { body } = await supertest(app as any)
      .post('/uploads')
      .attach('files', buffer, 'range.txt')
      .expect(201)
    const id = body[0].id

    const result = await parseBinary(
      supertest(app as any)
        .get(`/uploads/${id}`)
        .set('Range', 'bytes=0-3'),
    ).expect(206)

    expect(result.body).toEqual(Buffer.from('0123'))
    expect(result.header['content-range']).toBe('bytes 0-3/10')
  })

  it('removes a file', async function () {
    const { body } = await supertest(app as any)
      .post('/uploads')
      .attach('files', Buffer.from('to be removed'), 'remove.txt')
      .expect(201)
    const id = body[0].id

    await supertest(app as any)
      .delete(`/uploads/${id}`)
      .expect(200)
    await supertest(app as any)
      .get(`/uploads/${id}`)
      .expect(404)
  })

  it('moves a file', async function () {
    const buffer = Buffer.from('to be moved')

    const { body } = await supertest(app as any)
      .post('/uploads')
      .attach('files', buffer, 'move.txt')
      .expect(201)
    const oldId = body[0].id
    const newId = `${oldId}-moved.txt`

    await app.service('uploads').move(oldId, newId)

    await supertest(app as any)
      .get(`/uploads/${oldId}`)
      .expect(404)

    const result = await parseBinary(
      supertest(app as any).get(`/uploads/${newId}`),
    ).expect(200)
    expect(result.body).toEqual(buffer)
  })

  it('get throws NotFound for a non-existing file', async function () {
    await supertest(app as any)
      .get('/uploads/does-not-exist.txt')
      .expect(404)
  })

  it('remove throws NotFound for a non-existing file', async function () {
    await supertest(app as any)
      .delete('/uploads/does-not-exist.txt')
      .expect(404)
  })
})
