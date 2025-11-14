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
  expressSendStreamForGet,
  expressHandleIncomingStreams,
  ServiceFileStreamS3,
} from '../../src'
import type { S3Client } from '@aws-sdk/client-s3'
import path from 'node:path'

type Services = {
  uploads: ServiceFileStreamS3 & ServiceAddons<any>
}

type MockFSServerOptions = {
  s3: S3Client
  transformItems?: (file: Express.Multer.File, req: any, res: any) => any
}

export const mockS3Server = async (options: MockFSServerOptions) => {
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
    dest: path.join(__dirname, '../', 'temp-uploads/s3'),
  })

  ;(app as any).use(
    '/uploads',
    multerInstance.array('files'),
    expressHandleIncomingStreams({
      field: 'files',
      isArray: true,
      transform: options.transformItems,
    }),
    new ServiceFileStreamS3({
      s3: options.s3,
      bucket: 'test',
    }),
    expressSendStreamForGet(),
  )

  app.use(notFound())
  app.use(errorHandler())

  await app.listen(port)

  return app
}
