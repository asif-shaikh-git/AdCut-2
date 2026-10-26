import { useRef, useState } from 'react'
import { importFile } from '../media'
import { useStore } from '../store'
import { fmt } from '../types'
import AudioPanel from './AudioPanel'
import PublishPanel from './PublishPanel'
import UGCAdCreator from './UGCAdCreator'

type Tab = 'media' | 'adkit' | 'captions' | 'ugc' | 'publish' | 'audio'

const TABS: { id: Tab; label: string }[] = [
  { id: 'media', label: 'Media' },
  { id: 'ugc', label: 'UGC Creator' },
  { id: 'adkit', label: 'Ad Kit' },
  { id: 'captions', label: 'Captions' },
  { id: 'audio', label: 'Voice+Music' },
  { id: 'publish', label: 'Publish' },
]

function MediaTab() {
  const assetMap = useStore((s) => s.assets)
  const list = Object.values(assetMap)
  const input = useRef<HTMLInputElement>(null)
  const [msg, setMsg] = useState('')
  const [over, setOver] = useState(false)
  const [busy, setBusy] = useState(false)

  async function handleFiles(files: FileList | File[]) {
    setBusy(true)
    const failed: string[] = []
    for (const f of Array.from(files)) {
      try {
        useStore.getState().addAsset(await importFile(f))
      } catch {
        failed.push(f.name)
      }
    }
    setBusy(false)
    setMsg(failed.length ? `Couldn't read: ${failed.join(', ')} (try MP4/WebM/JPG/PNG/MP3)` : '')
  }

  const S = useStore.getState

  return (
    <div
      className={`tab ${over ? 'over' : ''}`}
      onDragOver={(e) => {
        e.preventDefault()
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        setOver(false)
        void handleFiles(e.dataTransfer.files)
      }}
    >
      <input
        ref={input}
        type="file"
        multiple
        accept="video/*,image/*,audio/*"
        hidden
        onChange={(e) => {
          if (e.target.files) void handleFiles(e.target.files)
          e.target.value = ''
        }}
      />
      <button className="primary wide" onClick={() => input.current?.click()} disabled={busy}>
        {busy ? 'Importing…' : '＋ Import photos, videos, music'}
      </button>
      <p className="hint">or drag and drop files here. Everything stays in your browser.</p>
      {msg && <p className="warn">{msg}</p>}

      {list.some((a) => a.kind === 'image') && (
        <button className="wide" onClick={() => S().addAllImages()}>
          ▦ Add all photos as a slideshow
        </button>
      )}

      <div className="assets">
        {list.map((a) => (
          <div className="asset" key={a.id}>
            <div className="thumb" style={{ backgroundImage: a.thumb ? `url(${a.thumb})` : undefined }}>
              {a.kind === 'audio' && <span className="note">♪</span>}
              <span className="badge">{a.kind === 'video' ? fmt(a.duration) : a.kind === 'image' ? 'PHOTO' : 'AUDIO'}</span>
            </div>
            <div className="aname" title={a.name}>
              {a.name}
            </div>
            <div className="arow">
              <button onClick={() => S().addToTimeline(a.id)}>{a.kind === 'audio' ? 'Use as music' : '+ Timeline'}</button>
              {a.kind === 'image' && (
                <button onClick={() => S().setLogo({ assetId: a.id, corner: 'tl', scale: 0.16 })} title="Use as your logo watermark">
                  Logo
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function AdKitTab() {
  const kit = useStore((s) => s.kit)
  const brand = useStore((s) => s.project.brand)
  const logo = useStore((s) => s.project.logo)
  const assets = useStore((s) => s.assets)
  const [msg, setMsg] = useState('')
  const S = useStore.getState
  const logoAsset = logo ? assets[logo.assetId] : undefined

  const loadDiwaanPreset = () => {
    S().setAspect('9:16')

    S().setBrand('#B8864B')

    S().setKit({
      name: 'DIWAAN DIY Candle Making Kit',
      price: '',
      offer: '',
      cta: 'Order Yours Today!',
      script: [
        'Ghar par beautiful candles banana chahte ho?',
        'Introducing DIWAAN DIY Candle Making Kit!',
        'Is kit mein candle making ke liye zaroori materials milte hain.',
        'Bas instructions follow karo aur apni creativity ko explore karo.',
        'Apni khud ki beautiful candles banao!',
        'DIWAAN DIY Candle Making Kit aaj hi order karo!'
      ].join('\n')
    })

    setMsg('DIWAAN preset loaded! Add your product media and customize your offer.')
  }

  return (
    <div className="tab">
      <p className="hint">
        Fill in your product details and AdCut lays out a proper ad: a hook at the start, price and offer in the middle,
        and a call-to-action end card.
      </p>

      <div className="preset-card">
        <div>
          <strong>DIWAAN UGC Ad Preset</strong>
          <p className="hint">
            Preload your candle kit product name, Hindi/Hinglish script,
            brand color and call to action.
          </p>
        </div>

        <button
          className="primary wide"
          onClick={loadDiwaanPreset}
        >
          Load DIWAAN Preset
        </button>
      </div>
      <label className="field">
        Brand color
        <input type="color" value={brand} onChange={(e) => S().setBrand(e.target.value)} />
      </label>
      <label className="field">
        Product name (hook)
        <input value={kit.name} onChange={(e) => S().setKit({ name: e.target.value })} placeholder="GlowNest LED Mirror" />
      </label>
      <label className="field">
        Price
        <input value={kit.price} onChange={(e) => S().setKit({ price: e.target.value })} placeholder="₹499" />
      </label>
      <label className="field">
        Offer
        <input value={kit.offer} onChange={(e) => S().setKit({ offer: e.target.value })} placeholder="50% OFF today" />
      </label>
      <label className="field">
        Call to action (end card)
        <input value={kit.cta} onChange={(e) => S().setKit({ cta: e.target.value })} placeholder="Shop now" />
      </label>
      <div className="row">
        <button className="primary" onClick={() => setMsg(S().applyAdKit())}>
          Apply to timeline
        </button>
        <button onClick={() => S().clearTag('adkit')}>Remove</button>
      </div>
      {msg && <p className="hint">{msg}</p>}

      <h4>Logo watermark</h4>
      {!logo || !logoAsset ? (
        <p className="hint">Import a PNG logo in the Media tab and press “Logo” on it.</p>
      ) : (
        <>
          <p className="hint">Using: {logoAsset.name}</p>
          <div className="row">
            {(['tl', 'tr', 'bl', 'br'] as const).map((c) => (
              <button
                key={c}
                className={logo.corner === c ? 'on' : ''}
                onClick={() => S().setLogo({ ...logo, corner: c })}
                title="Logo corner"
              >
                {{ tl: '↖', tr: '↗', bl: '↙', br: '↘' }[c]}
              </button>
            ))}
          </div>
          <label className="field">
            Size
            <input
              type="range"
              min={0.06}
              max={0.4}
              step={0.01}
              value={logo.scale}
              onChange={(e) => S().setLogo({ ...logo, scale: +e.target.value })}
            />
          </label>
          <button onClick={() => S().setLogo(null)}>Remove logo</button>
        </>
      )}
    </div>
  )
}

function CaptionsTab() {
  const script = useStore((s) => s.kit.script)
  const [msg, setMsg] = useState('')
  const S = useStore.getState
  return (
    <div className="tab">
      <p className="hint">
        Paste your ad script (English, Hindi or Hinglish). AdCut splits it into sentences and times the captions across
        your whole video.
      </p>
      <textarea
        rows={9}
        value={script}
        onChange={(e) => S().setKit({ script: e.target.value })}
        placeholder={'Tired of dim mirrors? Meet the GlowNest LED mirror.\nSoft light, perfect makeup, every time.\nOrder today and get free delivery!'}
      />
      <div className="row">
        <button className="primary" onClick={() => setMsg(S().makeCaptions())}>
          Generate captions
        </button>
        <button onClick={() => S().clearTag('caption')}>Remove</button>
      </div>
      {msg && <p className="hint">{msg}</p>}
      <p className="hint">Tip: drag a caption on the timeline to fine-tune its timing, click it to restyle.</p>
    </div>
  )
}

export default function LeftPanel() {
  const [tab, setTab] = useState<Tab>('media')
  return (
    <aside className="panel left">
      <div className="tabs">
        {TABS.map((t) => (
          <button key={t.id} className={tab === t.id ? 'on' : ''} onClick={(e) => {
              setTab(t.id)
              e.currentTarget.scrollIntoView({ inline: 'nearest', block: 'nearest', behavior: 'smooth' })
            }}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'media' && <MediaTab />}
      {tab === 'ugc' && <UGCAdCreator />}
      {tab === 'adkit' && <AdKitTab />}
      {tab === 'captions' && <CaptionsTab />}
      {tab === 'publish' && <PublishPanel />}
      {tab === 'audio' && <AudioPanel />}
    </aside>
  )
}
