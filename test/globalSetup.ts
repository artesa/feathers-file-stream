import fsp from 'node:fs/promises'
import path from 'node:path'

export default async function () {
  const unlink = async (dir: string) => {
    await fsp.rm(dir, { recursive: true, force: true })
    fsp.mkdir(dir, { recursive: true })
  }

  return () =>
    new Promise<void>((resolve) => {
      Promise.all([
        unlink(path.join(__dirname, 'uploads')),
        unlink(path.join(__dirname, 'temp-uploads')),
      ]).then(() => resolve())
    })
}
