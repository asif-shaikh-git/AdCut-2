import { Asset, uid } from './types'

function once(el: EventTarget, ok: string, bad = 'error', ms = 10000) {
  return new Promise<void>((res, rej) => {
    const timer = setTimeout(() => rej(new Error('timeout')), ms)
    el.addEventListener(
      ok,
      () => {
        clearTimeout(timer)
        res()
      },
      { once: true },
    )
    el.addEventListener(
      bad,
      () => {
        clearTimeout(timer)
        rej(new Error('failed'))
      },
      { once: true },
    )
  })
}

/** Reads a user file into an Asset (blob URL + metadata + small thumbnail). */
export async function importFile(file: File): Promise<Asset> {
  const url = URL.createObjectURL(file)
  const id = uid()
  try {
    if (file.type.startsWith('image/')) {
      const img = new Image()
      img.src = url
      await once(img, 'load')
      return {
        id,
        kind: 'image',
        name: file.name,
        url,
        duration: 2.5,
        width: img.naturalWidth,
        height: img.naturalHeight,
        thumb: url,
      }
    }

    if (file.type.startsWith('video/')) {
      const v = document.createElement('video')
      v.muted = true
      v.preload = 'auto'
      v.playsInline = true
      v.src = url
      await once(v, 'loadedmetadata')
      if (!isFinite(v.duration) || v.duration <= 0) throw new Error('bad duration')
      let thumb = ''
      try {
        v.currentTime = Math.min(0.5, v.duration / 2)
        await once(v, 'seeked', 'error', 4000)
        const c = document.createElement('canvas')
        c.height = 96
        c.width = Math.max(1, Math.round((96 * v.videoWidth) / v.videoHeight))
        c.getContext('2d')!.drawImage(v, 0, 0, c.width, c.height)
        thumb = c.toDataURL('image/jpeg', 0.7)
      } catch {
        /* thumbnail is optional */
      }
      return {
        id,
        kind: 'video',
        name: file.name,
        url,
        duration: v.duration,
        width: v.videoWidth,
        height: v.videoHeight,
        thumb,
      }
    }

    if (file.type.startsWith('audio/')) {
      const a = new Audio()
      a.preload = 'metadata'
      a.src = url
      await once(a, 'loadedmetadata')
      if (!isFinite(a.duration)) throw new Error('bad duration')
      return { id, kind: 'audio', name: file.name, url, duration: a.duration, width: 0, height: 0, thumb: '' }
    }

    throw new Error('unsupported')
  } catch (e) {
    URL.revokeObjectURL(url)
    throw e
  }
}
