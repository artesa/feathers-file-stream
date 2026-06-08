import { expect, vi } from 'vitest'
import { MulterError } from 'multer'
import { BadRequest, GeneralError, NotAuthenticated } from '@feathersjs/errors'
import { expressHandleMulterError } from '../src'

const run = (err: any) => {
  const next = vi.fn()
  expressHandleMulterError()(err, {} as any, {} as any, next)
  return next
}

describe('multer-error.test.ts', function () {
  // [multer code, expected BadRequest message]
  const cases = [
    ['LIMIT_PART_COUNT', 'Too many parts'],
    ['LIMIT_FILE_SIZE', 'File too large'],
    ['LIMIT_FILE_COUNT', 'Too many files'],
    ['LIMIT_FIELD_KEY', 'Field name too long'],
    ['LIMIT_FIELD_VALUE', 'Field value too long'],
    ['LIMIT_FIELD_COUNT', 'Too many fields'],
    ['LIMIT_UNEXPECTED_FILE', 'Unexpected field'],
  ] as const

  it.each(cases)('maps multer code %s to BadRequest', (code, message) => {
    const next = run(new MulterError(code as any))

    expect(next).toHaveBeenCalledTimes(1)
    const err = next.mock.calls[0][0]
    expect(err).toBeInstanceOf(BadRequest)
    expect(err.message).toBe(message)
  })

  it('maps an unknown multer code to GeneralError', () => {
    const next = run({ code: 'SOME_UNKNOWN_CODE', message: 'whatever' })

    const err = next.mock.calls[0][0]
    expect(err).toBeInstanceOf(GeneralError)
  })

  it('maps a generic Error without code to GeneralError', () => {
    const next = run(new Error('boom'))

    const err = next.mock.calls[0][0]
    expect(err).toBeInstanceOf(GeneralError)
  })

  it('passes a FeathersError through unchanged', () => {
    const original = new NotAuthenticated('nope')
    const next = run(original)

    expect(next).toHaveBeenCalledTimes(1)
    expect(next.mock.calls[0][0]).toBe(original)
  })

  it('calls next() without an error when err is undefined', () => {
    const next = run(undefined)

    expect(next).toHaveBeenCalledTimes(1)
    expect(next.mock.calls[0][0]).toBeUndefined()
  })
})
