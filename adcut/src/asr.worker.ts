/// <reference lib="webworker" />
// Speech-to-text in a background thread. The Whisper library and model are downloaded the first time (then cached
// by the browser), so nothing is bundled into AdCut and nothing leaves the device except that one download.
const LIB = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.2'

type In = { id: number; audio: Float32Array; model: string; language: string }
let loaded: { name: string; pipe: (a: Float32Array, o: object) => Promise<{ chunks?: { text: string; timestamp: [number, number | null] }[]; text: string }> } | null = null

self.onmessage = async (e: MessageEvent<In>) => {
  const { id, audio, model, language } = e.data
  const post = (m: object) => (self as unknown as Worker).postMessage({ id, ...m })
  try {
    if (!loaded || loaded.name !== model) {
      post({ type: 'status', text: 'Loading speech engine…' })
      const lib = await import(/* @vite-ignore */ LIB)
      const pipe = await lib.pipeline('automatic-speech-recognition', model, {
        dtype: 'q8',
        device: 'wasm',
        progress_callback: (p: { status?: string; progress?: number; file?: string }) => {
          if (p.status === 'progress' && typeof p.progress === 'number') post({ type: 'download', progress: p.progress / 100, file: p.file })
        },
      })
      loaded = { name: model, pipe }
    }
    post({ type: 'status', text: 'Listening…' })
    const out = await loaded.pipe(audio, {
      language,
      task: 'transcribe',
      return_timestamps: true,
      chunk_length_s: 30,
      stride_length_s: 5,
    })
    const chunks = (out.chunks ?? []).map((c) => ({ text: c.text, start: c.timestamp[0] ?? 0, end: c.timestamp[1] ?? c.timestamp[0] ?? 0 }))
    post({ type: 'done', chunks, text: out.text })
  } catch (err) {
    post({ type: 'error', message: err instanceof Error ? err.message : String(err) })
  }
}
