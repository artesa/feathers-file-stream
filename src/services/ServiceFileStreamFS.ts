import type { Params } from '@feathersjs/feathers'
import { FeathersError, GeneralError, NotFound } from '@feathersjs/errors'
import { createReadStream, createWriteStream, existsSync } from 'node:fs'
import {
  mkdir,
  writeFile,
  unlink,
  stat,
  access,
  rename,
} from 'node:fs/promises'
import path from 'node:path'
import streamPomises from 'node:stream/promises'
import type {
  ServiceFileStream,
  ServiceFileStreamCreateResult,
  ServiceFileStreamGetResult,
} from '../types'
import type { MaybeArray } from '../utility-types'
import { asArray } from '../utils'
import mime from 'mime-types'
import parseRange from 'range-parser'
import type { Readable } from 'node:stream'

export type ServiceFileStreamFSOptions = {
  root: string
}

export type ServiceFileStreamFSCreateData = {
  id: string
  stream: Readable | Buffer
}

export type ServiceFileStreamFSGetParams = {
  /** the request's headers, as Feathers' REST transport passes them */
  headers?: { range?: string; [key: string]: any }
  /** a `Range` header value, for calls without one */
  range?: string
  [key: string]: any
}

/**
 * The one byte range a `Range` header asks for, or undefined for the whole file: HTTP lets a
 * server ignore what it doesn't support, like several ranges at once.
 */
function singleRange(size: number, header: string | undefined) {
  if (!header) return undefined
  const ranges = parseRange(size, header, { combine: true })
  if (ranges === -1) {
    throw new FeathersError(
      'Range Not Satisfiable',
      'RangeNotSatisfiable',
      416,
      'range-not-satisfiable',
      { size },
    )
  }
  if (ranges === -2 || ranges.type !== 'bytes' || ranges.length !== 1) {
    return undefined
  }
  return ranges[0]
}

export class ServiceFileStreamFS implements ServiceFileStream {
  options: ServiceFileStreamFSOptions
  constructor(options: ServiceFileStreamFSOptions) {
    this.options = options
  }

  async _get(
    id: string,
    params?: ServiceFileStreamFSGetParams,
  ): Promise<ServiceFileStreamGetResult> {
    const info = await this.getStat(id)

    // `params.range` predates reading the header like the S3 service does
    const range = singleRange(
      info.size,
      params?.headers?.range ?? params?.range,
    )

    const { root } = this.options
    const stream = createReadStream(path.join(root, id), range)

    const contentType = mime.lookup(id) || 'application/octet-stream'

    return {
      header: {
        'Accept-Ranges': 'bytes',
        'Content-Type': contentType,
        'Content-disposition': 'inline',
        'Content-Length': range ? range.end - range.start + 1 : info.size,
        ...(range
          ? {
              'Content-Range': `bytes ${range.start}-${range.end}/${info.size}`,
            }
          : {}),
      },
      status: range ? 206 : 200,
      stream,
    }
  }

  async _create(
    data: ServiceFileStreamFSCreateData,
    _params?: any,
  ): Promise<ServiceFileStreamCreateResult>
  async _create(
    data: ServiceFileStreamFSCreateData[],
    _params?: any,
  ): Promise<ServiceFileStreamCreateResult[]>
  async _create(
    data: MaybeArray<ServiceFileStreamFSCreateData>,
    _params?: any,
  ): Promise<MaybeArray<ServiceFileStreamCreateResult>> {
    const { root } = this.options
    const { isArray, items } = asArray(data)
    const promises = items.map(async (item) => {
      const { id, stream } = item
      const filePath = path.join(root, id)

      // create the directory if it doesn't exist
      await this.mkdir(path.dirname(filePath))

      if (Buffer.isBuffer(stream)) {
        await writeFile(filePath, stream)
        return
      } else {
        const writeStream = createWriteStream(path.join(root, id))
        await streamPomises.pipeline(stream, writeStream)
      }
    })
    await Promise.all(promises)

    const results = items.map((item) => {
      const { id } = item
      return {
        id,
      }
    })

    return isArray ? results : results[0]
  }

  async _remove(
    id: string,

    _params?: Params,
  ): Promise<ServiceFileStreamCreateResult> {
    await this.checkExistence(id)

    const { root } = this.options
    const file = path.join(root, id)

    try {
      await unlink(file)
      return { id }
    } catch (error) {
      throw new GeneralError(`Could not remove file ${id}`, {
        error,
      })
    }
  }

  /**
   * Get the file stats and throw a NotFound error if the file doesn't exist
   * @param id
   * @returns The file stats
   */
  private async getStat(id: string) {
    const file = path.join(this.options.root, id)
    try {
      return await stat(file)
    } catch {
      throw new NotFound('File not found')
    }
  }

  private async mkdir(dir: string) {
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true })
    }
  }

  /**
   * Check if a file exists and throws a NotFound error if it doesn't
   * @param id The filename to check
   */
  async checkExistence(id: string) {
    const file = path.join(this.options.root, id)
    try {
      await access(file)
    } catch {
      throw new NotFound('File not found')
    }
  }

  get(id: string, params?: any): Promise<ServiceFileStreamGetResult> {
    return this._get(id, params)
  }

  create(
    data: ServiceFileStreamFSCreateData,
    params?: any,
  ): Promise<ServiceFileStreamCreateResult>
  create(
    data: ServiceFileStreamFSCreateData[],
    params?: any,
  ): Promise<ServiceFileStreamCreateResult[]>
  create(
    data: MaybeArray<ServiceFileStreamFSCreateData>,
    params?: any,
  ): Promise<MaybeArray<ServiceFileStreamCreateResult>> {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    return this._create(data, params)
  }

  remove(id: string, params?: Params): Promise<ServiceFileStreamCreateResult> {
    return this._remove(id, params)
  }

  async move(oldId: string, newId: string) {
    await this.checkExistence(oldId)

    const { root } = this.options
    const oldFile = path.join(root, oldId)
    const newFile = path.join(root, newId)

    try {
      await this.mkdir(path.dirname(newFile))
      await rename(oldFile, newFile)
      return { id: newId }
    } catch (error) {
      throw new GeneralError(`Could not move file ${oldId} to ${newId}`, {
        error,
      })
    }
  }
}
