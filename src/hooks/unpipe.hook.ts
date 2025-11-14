import type { HookContext } from '@feathersjs/feathers'
import { checkContext } from 'feathers-hooks-common'
import { Readable } from 'node:stream'
import { asArray } from '../utils'
import fsp from 'node:fs/promises'

export type HookUnpipeOptions = {
  /** The name of the property that contains the filepath to unlink. */
  unlink?: string
}

/**
 * Unpipes a stream from a readable stream. A file can be unlinked if the unlink option is set to the property of the file path.
 * @param options
 * @returns
 */
export const unpipe =
  (options?: HookUnpipeOptions) =>
  async <H extends HookContext>(context: H) => {
    checkContext(context, ['before', 'after', 'error'], 'create', 'unpipe')

    const { data } = context

    const { items } = asArray(data)

    const promises = items.map(async (item) => {
      const { stream } = item
      if (stream instanceof Readable) {
        stream.unpipe()
        stream.destroy()
      }

      if (options?.unlink && typeof item[options.unlink] === 'string') {
        const path = item[options.unlink]

        await fsp.unlink(path).catch(() => {})
      }
    })

    await Promise.all(promises)

    return context
  }
