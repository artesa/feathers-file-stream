import type { Application } from '@feathersjs/express'
import type { ServiceAddons } from '@feathersjs/feathers'
import { feathers } from '@feathersjs/feathers'
import express, {
  json,
  urlencoded,
  rest,
  notFound,
  errorHandler,
} from '@feathersjs/express'
import getPort from 'get-port'
import multer from 'multer'
import compress from 'compression'
import cors from 'cors'
import helmet from 'helmet'
import {
  expressHandleIncomingStreams,
  expressHandleMulterError,
  expressSendStreamForGet,
  ServiceFileStreamFS,
} from '../../src'
import path from 'node:path'

import makeRestClient from '@feathersjs/rest-client'
import fetch from 'node-fetch'

type Services = {
  uploads: ServiceFileStreamFS & ServiceAddons<any>
}

type MockFSServerOptions = {
  transformItems: (file: Express.Multer.File, req: any, res: any) => any
}

export const mockFSServer = async (options?: MockFSServerOptions) => {
  const app = express<Services>(feathers())

  app.use(helmet())
  app.use(cors())
  app.use(compress())
  app.use(json())
  app.use(
    urlencoded({
      extended: true,
    }),
  )

  app.configure(rest())

  const port = await getPort()

  app.set('port', port)

  const multerInstance = multer({
    dest: path.join(__dirname, '../', 'temp-uploads/fs'),
    limits: {
      fileSize: 1e6 * 1, // 1MB
    },
  })

  ;(app as any).use(
    '/uploads',
    multerInstance.array('files'),
    expressHandleMulterError(),
    expressHandleIncomingStreams({
      field: 'files',
      isArray: true,
      transform: options?.transformItems,
    }),
    new ServiceFileStreamFS({
      root: path.join(__dirname, '../', 'uploads'),
    }),
    expressSendStreamForGet(),
  )

  app.use(notFound())
  app.use(errorHandler())

  await app.listen(port)

  return app
}

export const mockClient = (app: Application) => {
  const port = app.get('port')

  const client = feathers()

  // Connect to a different URL
  const restClient = makeRestClient(`http://localhost:${port}`)

  client.configure(restClient.fetch(fetch))

  return client
}
