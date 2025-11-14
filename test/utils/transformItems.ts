import crypto from 'node:crypto'
import type { HookContext } from '@feathersjs/feathers'
import { alterItems } from 'feathers-hooks-common'
import 'multer'
import path from 'node:path'

export const transformItems =
  () =>
  <H extends HookContext>(context: H) => {
    return alterItems((item: Express.Multer.File) => {
      const hash = crypto.randomBytes(16).toString('hex')
      const ext = path.extname(item.filename)
      const id = `${hash}${ext}`
      const result: Express.Multer.File & { id: string } = { ...item, id }
      return result
    })(context)
  }

export const transformItemsNested =
  () =>
  <H extends HookContext>(context: H) => {
    return alterItems((item: Express.Multer.File) => {
      const hash = crypto.randomBytes(16).toString('hex')
      const ext = path.extname(item.filename)
      const id = `test/test/${hash}${ext}`
      const result: Express.Multer.File & { id: string } = { ...item, id }
      return result
    })(context)
  }
