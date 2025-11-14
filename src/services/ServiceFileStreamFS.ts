import type { Params } from '@feathersjs/feathers'
import { GeneralError, NotFound } from '@feathersjs/errors'
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
import type { Readable } from 'node:stream'

export type ServiceFileStreamFSOptions = {
  root: string
}

export type ServiceFileStreamFSCreateData = {
  id: string
  stream: Readable | Buffer
}

export class ServiceFileStreamFS implements ServiceFileStream {
  options: ServiceFileStreamFSOptions
  constructor(options: ServiceFileStreamFSOptions) {
    this.options = options
  }

  async _get(id: string, _params?: any): Promise<ServiceFileStreamGetResult> {
    const info = await this.getStat(id)

    const range = _params?.range as string | undefined

    let start = 0
    let end = info.size
    let contentRange = false
    let contentLength = info.size

    if (range) {
      const positions = range.replace(/bytes=/, '').split('-')
      start = parseInt(positions[0], 10)
      end = positions[1] ? parseInt(positions[1], 10) : info.size - 1
      const chunksize = end - start + 1
      contentRange = true
      contentLength = chunksize
    }

    const { root } = this.options
    const stream = createReadStream(path.join(root, id), { start, end })

    const contentType = mime.lookup(id) || 'application/octet-stream'

    // const fileName = path.basename(id);

    return {
      header: {
        'Accept-Ranges': 'bytes',
        'Content-Type': contentType,
        'Content-disposition': 'inline',
        'Content-Length': contentLength,
        ...(contentRange
          ? {
              'Content-Range': 'bytes ' + start + '-' + end + '/' + info.size,
            }
          : {}),
      },
      status: contentRange ? 206 : 200,
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
