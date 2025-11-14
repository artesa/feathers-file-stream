import type {
  DeleteObjectCommandInput,
  HeadObjectCommandOutput,
  PutObjectCommandInput,
  S3Client,
} from '@aws-sdk/client-s3'
import {
  DeleteObjectCommand,
  CopyObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
} from '@aws-sdk/client-s3'
import { FeathersError, GeneralError, NotFound } from '@feathersjs/errors'
import type { Readable } from 'node:stream'
import { PassThrough } from 'node:stream'
import type {
  ServiceFileStream,
  ServiceFileStreamCreateData,
  ServiceFileStreamCreateResult,
  ServiceFileStreamGetResult,
} from '../types'
import type { MaybeArray } from '../utility-types'
import { asArray } from '../utils'

export type ServiceFileStreamS3Options = {
  s3: S3Client
  bucket: string
}

export type ServiceFileStreamS3GetParams = {
  bucket?: string
  [key: string]: any
}

export type ServiceFileStreamS3GetResult = ServiceFileStreamGetResult

export type ServiceFileStreamS3CreateData = ServiceFileStreamCreateData & {
  size?: number
  mimeType?: string
}

export type ServiceFileStreamS3CreateParams = {
  bucket?: string
  [key: string]: any
}

export type ServiceFileStreamS3RemoveParams = {
  s3?: {
    bucket?: string
    options: DeleteObjectCommandInput
  }
  [key: string]: any
}

export class ServiceFileStreamS3 implements ServiceFileStream {
  s3: S3Client
  bucket: string
  options: ServiceFileStreamS3Options
  constructor(options: ServiceFileStreamS3Options) {
    this.s3 = options.s3
    this.bucket = options.bucket
    this.options = options
  }

  async _create(
    data: ServiceFileStreamS3CreateData,
    params?: ServiceFileStreamS3CreateParams,
  ): Promise<ServiceFileStreamCreateResult>
  async _create(
    data: ServiceFileStreamS3CreateData[],
    params?: ServiceFileStreamS3CreateParams,
  ): Promise<ServiceFileStreamCreateResult[]>
  async _create(
    data: MaybeArray<ServiceFileStreamS3CreateData>,
    params?: ServiceFileStreamS3CreateParams,
  ): Promise<MaybeArray<ServiceFileStreamCreateResult>> {
    const { items } = asArray(data)

    const bucket = params?.bucket || this.bucket

    const promises = items.map(async (item) => {
      const { stream, id, size, mimeType } = item

      const passThroughStream = new PassThrough()
      stream.pipe(passThroughStream)

      const putObjectInput: PutObjectCommandInput = {
        Bucket: bucket,
        Key: id,
        Body: passThroughStream,
      }

      if (size) {
        putObjectInput.ContentLength = size
      }

      if (mimeType) {
        putObjectInput.ContentType = mimeType
      }

      try {
        await this.s3.send(new PutObjectCommand(putObjectInput))
      } catch (err) {
        this.errorHandler(err)
      }
    })

    await Promise.all(promises)

    return items.map((item) => ({ id: item.id }))
  }

  async _get(
    id: string,
    params?: ServiceFileStreamS3GetParams,
  ): Promise<ServiceFileStreamS3GetResult> {
    const headResponse = await this.getHeadForObject(id, params)
    const bucket = params?.bucket || this.bucket

    const range = params?.headers?.range as string | undefined

    try {
      const { s3 } = this
      const params = {
        Bucket: bucket,
        Key: id,
        Range: range,
      }

      const header: Record<string, any> = {
        ETag: headResponse.ETag,
        'Content-Disposition': 'inline',
      }

      if (headResponse.ContentLength) {
        header['Content-Length'] = headResponse.ContentLength
      }

      if (headResponse.ContentType) {
        header['Content-Type'] = headResponse.ContentType
      }

      if (headResponse.ContentEncoding) {
        header['Content-Encoding'] = headResponse.ContentEncoding
      }

      if (headResponse.AcceptRanges) {
        header['Accept-Ranges'] = headResponse.AcceptRanges
      }

      // Now get the object data and stream it
      const response = await s3.send(new GetObjectCommand(params))

      let status = 200

      if (response.ContentRange) {
        header['Content-Range'] = response.ContentRange
        status = 206
      }

      const stream = response.Body as Readable

      return {
        header,
        stream,
        status,
      } as ServiceFileStreamS3GetResult
    } catch (err) {
      this.errorHandler(err)
      throw err
    }
  }

  async _remove(
    id: string,
    params?: ServiceFileStreamS3RemoveParams,
  ): Promise<ServiceFileStreamCreateResult> {
    await this.checkExistence(id, params)
    const bucket = params?.s3?.bucket || this.bucket

    const options = params?.s3?.options || {}

    try {
      await this.s3.send(
        new DeleteObjectCommand({
          ...options,
          Bucket: bucket,
          Key: id,
        }),
      )

      return {
        id,
      }
    } catch (err) {
      this.errorHandler(err)
      throw err
    }
  }

  get(id: string, params?: any): Promise<ServiceFileStreamGetResult> {
    return this._get(id, params)
  }

  create(
    data: ServiceFileStreamS3CreateData,
    params?: ServiceFileStreamS3CreateParams,
  ): Promise<ServiceFileStreamCreateResult>
  create(
    data: ServiceFileStreamS3CreateData[],
    params?: ServiceFileStreamS3CreateParams,
  ): Promise<ServiceFileStreamCreateResult[]>
  create(
    data: MaybeArray<ServiceFileStreamS3CreateData>,
    params?: ServiceFileStreamS3CreateParams,
  ): Promise<MaybeArray<ServiceFileStreamCreateResult>> {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    return this._create(data, params)
  }

  remove(
    id: string,
    params?: ServiceFileStreamS3RemoveParams,
  ): Promise<ServiceFileStreamCreateResult> {
    return this._remove(id, params)
  }

  async getHeadForObject(
    id: string,
    params?: any,
  ): Promise<HeadObjectCommandOutput> {
    const bucket = params?.bucket || this.bucket
    const { s3 } = this

    try {
      return await s3.send(
        new HeadObjectCommand({
          Bucket: bucket,
          Key: id,
        }),
      )
    } catch (err) {
      throw new NotFound('File not found', {
        error: err,
      })
    }
  }

  async checkExistence(
    id: string,
    params?: ServiceFileStreamS3GetParams,
  ): Promise<void> {
    await this.getHeadForObject(id, params)
  }

  async move(oldId: string, newId: string) {
    try {
      await this.s3.send(
        new CopyObjectCommand({
          Bucket: this.bucket,
          CopySource: `${this.bucket}/${oldId}`,
          Key: newId,
        }),
      )

      await this.s3.send(
        new DeleteObjectCommand({
          Bucket: this.bucket,
          Key: oldId,
        }),
      )

      return {
        id: newId,
      }
    } catch (err) {
      this.errorHandler(err)
      throw err
    }
  }

  errorHandler(err: any) {
    if (!err) return

    if (err instanceof FeathersError) {
      throw err
    }

    throw new GeneralError('Error', {
      error: err,
    })
  }
}
