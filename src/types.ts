import type { Readable } from 'node:stream'

export type ServiceFileStreamCreateData = {
  id: string
  stream: Readable
}

export type ServiceFileStreamCreateResult = {
  id: string
}

export type ServiceFileStreamGetResult = {
  header: Record<string, any>
  stream: Readable
  status: number
}

export interface ServiceFileStream {
  _get(id: string, params?: any): Promise<ServiceFileStreamGetResult>
  get(id: string, params?: any): Promise<ServiceFileStreamGetResult>

  _create(
    data: ServiceFileStreamCreateData,
    params?: any,
  ): Promise<ServiceFileStreamCreateResult>
  create(
    data: ServiceFileStreamCreateData,
    params?: any,
  ): Promise<ServiceFileStreamCreateResult>

  _remove(id: string, params?: any): Promise<ServiceFileStreamCreateResult>
  remove(id: string, params?: any): Promise<ServiceFileStreamCreateResult>

  checkExistence(id: string, params?: any): Promise<void>

  move(oldId: string, newId: string): Promise<ServiceFileStreamCreateResult>
}
