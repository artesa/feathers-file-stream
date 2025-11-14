import supertest from 'supertest'
import { mockS3Server } from './utils/mockS3App'
import { transformItems } from './utils'
import { expect } from 'vitest'
import {
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  S3Client,
  UploadPartCommand,
} from '@aws-sdk/client-s3'
import { mockClient } from 'aws-sdk-client-mock'
import { Readable } from 'node:stream'
import { unpipe } from '../src'

describe('s3.test.ts', function () {
  let app: Awaited<ReturnType<typeof mockS3Server>>
  let mock: ReturnType<typeof mockClient>
  let client: S3Client

  beforeEach(async function () {
    mock = mockClient(S3Client)
    client = new S3Client({})

    app = await mockS3Server({ s3: client })

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

  afterEach(function () {
    mock.reset()
  })

  it('get throws NotFound for non-existing file', async () => {
    mock.on(HeadObjectCommand).rejects()

    await supertest(app as any)
      .get('/uploads/does-not-exist')
      .expect(404)
  })

  it('remove throws NotFound for non-existing file', async () => {
    mock.on(HeadObjectCommand).rejects()

    await supertest(app as any)
      .delete('/uploads/does-not-exist')
      .expect(404)
  })

  it('upload file', async function () {
    const buffer = Buffer.from('some data')

    mock.on(CreateMultipartUploadCommand).resolves({ UploadId: '123' })
    mock.on(UploadPartCommand).resolves({ ETag: '123' })

    const { body: uploadResult } = await supertest(app as any)
      .post('/uploads')
      .attach('files', buffer, 'test.txt')
      .expect(201)

    expect(Array.isArray(uploadResult)).toBe(true)
    expect(uploadResult.length).toBe(1)
    expect(typeof uploadResult[0]).toBe('object')
    expect(typeof uploadResult[0].id).toBe('string')
  })

  it('download file', async function () {
    const buffer = Buffer.from('some data download file')
    const id = 'test-download-file.txt'

    mock.on(HeadObjectCommand).resolves({
      ContentLength: buffer.length,
      ContentType: 'text/plain',
      ETag: '123',
      ContentDisposition: 'inline',
    })
    mock.on(GetObjectCommand).resolves({ Body: Readable.from(buffer) as any })

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

  it('remove file', async function () {
    const id = 'test-remove-file.txt'

    mock.on(HeadObjectCommand).resolves({})
    mock.on(GetObjectCommand).resolves({})
    mock.on(DeleteObjectCommand).resolves({})

    const result = await supertest(app as any)
      .delete(`/uploads/${id}`)
      .expect(200)

    expect(typeof result.body).toBe('object')
    expect(result.body.id).toBe(id)
  })

  it('move file', async function () {
    const buffer = Buffer.from('some data download file')
    const oldId = 'test-move-file.txt'
    const newId = 'test-move-file-2.txt'

    // download
    mock.on(HeadObjectCommand).resolves({})
    mock.on(GetObjectCommand).resolves({ Body: Readable.from(buffer) as any })

    // upload
    mock.on(CreateMultipartUploadCommand).resolves({ UploadId: '123' })
    mock.on(UploadPartCommand).resolves({ ETag: '123' })

    await app.service('uploads').move(oldId, newId)
  })
})
