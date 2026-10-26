import { useMemo, useRef, useState } from 'react'
import { useStore } from '../store'
import type { Asset } from '../types'
import {
  CAMERA_MOVEMENTS,
  CameraMovement,
  PromptContext,
  ROLE_OPTIONS,
  ReferenceRole,
  ReferenceSettings,
  SHOT_SIZES,
  ShotSize,
  buildPrompt,
  buildPromptPack,
  defaultRefSettings,
  parseScript,
  roleLabel,
  strengthWord,
} from '../ugc'
import { buildTimelineFromScenes } from '../ugcBuild'
import { useUgc } from '../ugcStore'

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 30000)
}

export default function UGCAdCreator() {
  const assetMap = useStore((s) => s.assets)
  const aspect = useStore((s) => s.project.aspect)

  const scenes = useUgc((s) => s.scenes)
  const blocks = useUgc((s) => s.blocks)
  const format = useUgc((s) => s.format)
  const negative = useUgc((s) => s.negative)
  const selectedSceneId = useUgc((s) => s.selectedSceneId)
  const refSettings = useUgc((s) => s.refSettings)
  const opts = useUgc((s) => s.opts)
  const U = useUgc.getState

  const assets = useMemo(() => Object.values(assetMap), [assetMap])
  const audioAssets = useMemo(() => assets.filter((a) => a.kind === 'audio'), [assets])
  const visualAssets = useMemo(() => assets.filter((a) => a.kind === 'image' || a.kind === 'video'), [assets])
  const videoAssets = useMemo(() => assets.filter((a) => a.kind === 'video'), [assets])

  const [expandedReferences, setExpandedReferences] = useState(true)
  const [showDetails, setShowDetails] = useState(false)
  const [message, setMessage] = useState('')
  const [warnings, setWarnings] = useState<string[]>([])
  const [buildOpts, setBuildOpts] = useState({ overlays: true, captions: true, voice: true })
  const scriptInput = useRef<HTMLInputElement>(null)

  const scene = scenes.find((s) => s.id === selectedSceneId) ?? scenes[0]
  const settingsFor = (asset: Asset): ReferenceSettings => refSettings[asset.id] ?? defaultRefSettings(asset)

  const ctx: PromptContext = useMemo(
    () => ({ scenes, blocks, format, negative, assets: assetMap, refs: refSettings, opts }),
    [scenes, blocks, format, negative, assetMap, refSettings, opts],
  )
  const currentPrompt = useMemo(() => (scene ? buildPrompt(ctx, scene.id) : ''), [ctx, scene])

  const totalSeconds = scenes.reduce((sum, s) => sum + s.duration, 0)
  const assigned = scenes.filter((s) => assetMap[s.primaryAssetId]).length
  const selectedRefs = (scene?.referenceIds ?? []).map((id) => assetMap[id]).filter((a): a is Asset => Boolean(a))

  /* ---------------- actions ---------------- */

  async function copy(text: string, ok: string) {
    try {
      await navigator.clipboard.writeText(text)
      setMessage(ok)
    } catch {
      setMessage('Clipboard access failed. Select the text and copy it manually.')
    }
  }

  async function importScriptFile(file: File) {
    const parsed = parseScript(await file.text())
    if (!parsed.scenes.length) {
      setMessage('No “(Shot: 0:00–0:05)” entries found in that file. Check the format in docs/WORKFLOW.md.')
      return
    }
    const keep = scene?.referenceIds ?? []
    parsed.scenes.forEach((s) => (s.referenceIds = [...keep]))
    U().loadParsed(parsed)
    setMessage(`Loaded ${parsed.scenes.length} shots in ${parsed.blocks.length} videos from ${file.name}.`)
    setWarnings([])
  }

  function quickAssign() {
    const imgs = visualAssets.filter((a) => a.kind === 'image').slice(0, 3)
    if (!imgs.length) {
      setMessage('Import your character, product and location images first (Media tab).')
      return
    }
    const roles: ReferenceRole[] = ['character', 'product', 'location']
    const map: Record<string, ReferenceSettings> = {}
    imgs.forEach((a, i) => (map[a.id] = { ...settingsFor(a), role: roles[i], strength: 90 }))
    U().setRefs(map)
    U().setAllRefs(imgs.map((a) => a.id))
    setMessage(
      `Your first ${imgs.length} images are now ${imgs.map((_, i) => roles[i]).join(' / ')} references, used in all ${scenes.length} shots.`,
    )
  }

  function autoAssign() {
    if (!videoAssets.length) {
      setMessage('Import your generated videos first (Media tab), then press this to match them to the shots.')
      return
    }
    const map: Record<string, string> = {}
    const perShot = videoAssets.length === scenes.length
    const blockNumbers = [...new Set(scenes.map((s) => s.block))].sort((a, b) => a - b)
    if (perShot) scenes.forEach((s, i) => (map[s.id] = videoAssets[i].id))
    else blockNumbers.forEach((b, i) => scenes.filter((s) => s.block === b).forEach((s) => (map[s.id] = videoAssets[i]?.id ?? '')))
    U().setPrimaryAssets(map)
    setMessage(
      perShot
        ? `Matched ${videoAssets.length} videos to ${scenes.length} shots one by one (in import order).`
        : `Matched your videos to video blocks 1–${Math.min(videoAssets.length, blockNumbers.length)} in import order. A video used for 2 shots is cut in order.`,
    )
  }

  /** Voice files are matched by the first number in the file name ("shot3.mp3", "vo_03.wav" = shot 3), else in import order. */
  function autoVoice() {
    if (!audioAssets.length) {
      setMessage('Import your voice-over audio files first (Media tab). Name them with the shot number, e.g. shot1.mp3.')
      return
    }
    const map: Record<string, string> = {}
    let byNumber = 0
    scenes.forEach((s, i) => {
      const hit = audioAssets.find((a) => Number(/\d+/.exec(a.name)?.[0]) === i + 1)
      map[s.id] = hit?.id ?? ''
      if (hit) byNumber++
    })
    if (!byNumber && audioAssets.length === scenes.length) scenes.forEach((s, i) => (map[s.id] = audioAssets[i].id))
    U().setVoiceAssets(map)
    const n = Object.values(map).filter(Boolean).length
    setMessage(`Linked ${n} voice-over file${n === 1 ? '' : 's'} to shots.`)
  }

  function build() {
    const r = buildTimelineFromScenes(buildOpts)
    setMessage(r.message)
    setWarnings(r.warnings)
  }

  function applyBrand(color: string, label: string) {
    const S = useStore.getState()
    S.setAspect('9:16')
    S.setBrand(color)
    S.setKit({ name: 'DIWAAN DIY Candle Making Kit', cta: 'Shop now' })
    setMessage(`Applied ${label} brand colour and the vertical 9:16 format.`)
  }

  const packText = () =>
    buildPromptPack(ctx)
      .map((p, i) => `### ${i + 1}. ${p.label}\n\n${p.text}`)
      .join('\n\n' + '='.repeat(60) + '\n\n')

  /* ---------------- render ---------------- */

  return (
    <div className="tab ugc-creator">
      <div className="ugc-hero">
        <div>
          <span className="ugc-eyebrow">AI VIDEO WORKSPACE</span>
          <h3>UGC Ad Creator</h3>
          <p>
            Plan the shots, write prompts with your reference images, then assemble the generated clips into the finished
            ad. AdCut does not generate the video itself: copy a prompt into your AI video tool, import what it makes.
          </p>
        </div>
        <span className="ugc-format">9:16</span>
      </div>

      <div className="ugc-stats">
        <div>
          <strong>{scenes.length}</strong>
          <span>Shots</span>
        </div>
        <div>
          <strong>{totalSeconds}s</strong>
          <span>Planned length</span>
        </div>
        <div>
          <strong>
            {assigned}/{scenes.length}
          </strong>
          <span>Clips linked</span>
        </div>
      </div>

      <div className="row">
        <button onClick={() => applyBrand('#B8864B', 'DIWAAN gold')} title="Gold from the DIWAAN box">
          DIWAAN gold
        </button>
        <button onClick={() => applyBrand('#ffb2b3', 'soft pink')}>Soft pink</button>
      </div>

      {/* ---------- STEP 1: SCRIPT ---------- */}
      <section className="ugc-section">
        <h4>
          <span className="ugc-step">1</span> Script
        </h4>
        <p className="hint">
          Your DIWAAN script is loaded ({scenes.length} shots). You can load a different script file in the same format, or
          the short 5-scene template.
        </p>
        <input
          ref={scriptInput}
          type="file"
          accept=".txt,.md,text/plain"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) void importScriptFile(f)
            e.target.value = ''
          }}
        />
        <div className="row">
          <button onClick={() => scriptInput.current?.click()}>Import script file</button>
          <button
            onClick={() => {
              U().loadDiwaan()
              setMessage('Reset to the DIWAAN script (9 shots).')
            }}
          >
            DIWAAN script
          </button>
          <button
            onClick={() => {
              U().loadQuick()
              setMessage('Loaded the short 5-scene template.')
            }}
          >
            5-scene template
          </button>
        </div>
      </section>

      {/* ---------- STEP 2: REFERENCES ---------- */}
      <section className="ugc-section">
        <button className="ugc-section-toggle" onClick={() => setExpandedReferences((v) => !v)}>
          <span>
            <strong>
              <span className="ugc-step">2</span> References
            </strong>
            <small>{visualAssets.length} imported files · attach the same ones in your AI tool</small>
          </span>
          <span>{expandedReferences ? '−' : '+'}</span>
        </button>

        {expandedReferences && (
          <div className="ugc-reference-library">
            <p className="hint">
              Import your character sheet, product photo and location image in the Media tab. A prompt can only <em>name</em>{' '}
              them: you attach the same image files inside the AI video tool.
            </p>

            <div className="ugc-library-toolbar">
              <button className="primary" onClick={quickAssign} title="First three images become character, product, location">
                Use first 3 images as character · product · location
              </button>
            </div>
            <div className="ugc-library-toolbar">
              <span className="hint">Per-file role and wording strictness.</span>
              <button onClick={() => setShowDetails((v) => !v)}>{showDetails ? 'Compact view' : 'Show details'}</button>
            </div>

            {visualAssets.length === 0 && (
              <div className="ugc-empty">
                <strong>No reference media imported</strong>
                <p>Open Media → Import photos, videos, music. You can import several files together.</p>
              </div>
            )}

            {visualAssets.map((asset) => {
              const st = settingsFor(asset)
              const selected = !!scene && scene.referenceIds.includes(asset.id)
              return (
                <div className={`ugc-reference-card ${selected ? 'is-selected' : ''}`} key={asset.id}>
                  <label className="ugc-reference-check">
                    <input
                      type="checkbox"
                      checked={selected}
                      disabled={!scene}
                      onChange={() => scene && U().toggleRef(scene.id, asset.id)}
                    />
                    <span>Use in this shot</span>
                  </label>

                  <div className="ugc-reference-main">
                    <div
                      className="ugc-reference-thumb"
                      style={{ backgroundImage: `url("${asset.thumb || asset.url}")` }}
                    />
                    <div className="ugc-reference-info">
                      <strong title={asset.name}>{asset.name}</strong>
                      <small>
                        {asset.kind} · {roleLabel(st.role)}
                      </small>
                    </div>
                  </div>

                  <label className="field">
                    Role
                    <select
                      value={st.role}
                      onChange={(e) => U().patchRef(asset, { role: e.target.value as ReferenceRole })}
                    >
                      {ROLE_OPTIONS.map((r) => (
                        <option key={r.value} value={r.value}>
                          {r.label}
                        </option>
                      ))}
                    </select>
                  </label>

                  {showDetails && (
                    <>
                      <label className="field">
                        Strictness: {st.strength}% — prompt says “{strengthWord(st.strength)}”
                        <input
                          type="range"
                          min="0"
                          max="100"
                          step="5"
                          value={st.strength}
                          onChange={(e) => U().patchRef(asset, { strength: Number(e.target.value) })}
                        />
                        <small className="hint">Changes the wording only. The AI tool decides how closely it follows.</small>
                      </label>
                      <label className="field">
                        Extra instructions for this file
                        <textarea
                          rows={2}
                          value={st.instructions}
                          onChange={(e) => U().patchRef(asset, { instructions: e.target.value })}
                          placeholder={
                            st.role === 'character'
                              ? 'e.g. Keep the same face, hijab and outfit.'
                              : st.role === 'product'
                                ? 'e.g. Never change the logo or packaging.'
                                : st.role === 'location'
                                  ? 'e.g. Keep the same room and furniture.'
                                  : 'Describe how the AI should use this reference.'
                          }
                        />
                      </label>
                    </>
                  )}
                </div>
              )
            })}

            {visualAssets.length > 0 && scene && (
              <div className="row">
                <button className="primary" onClick={() => U().applyRefsToAll(scene.id)}>
                  Use this shot’s references in all shots
                </button>
                <button onClick={() => U().setSceneRefs(scene.id, [])}>Clear this shot</button>
              </div>
            )}
          </div>
        )}
      </section>

      {/* ---------- STEP 3: GENERATE PROMPTS ---------- */}
      <h4>
        <span className="ugc-step">3</span> Generate prompts
      </h4>

      <section className="ugc-section">
        <div className="ugc-options">
          <div className="field">
            One prompt per
            <div className="seg">
              <button className={opts.mode === 'shot' ? 'on' : ''} onClick={() => U().setOpts({ mode: 'shot' })}>
                5s shot
              </button>
              <button className={opts.mode === 'block' ? 'on' : ''} onClick={() => U().setOpts({ mode: 'block' })}>
                video (2 shots)
              </button>
            </div>
          </div>
          <div className="field">
            Prompt style
            <div className="seg">
              <button className={opts.style === 'detailed' ? 'on' : ''} onClick={() => U().setOpts({ style: 'detailed' })}>
                Detailed
              </button>
              <button className={opts.style === 'compact' ? 'on' : ''} onClick={() => U().setOpts({ style: 'compact' })}>
                One paragraph
              </button>
            </div>
          </div>
          <label className="check">
            <input
              type="checkbox"
              checked={opts.includeDialogue}
              onChange={(e) => U().setOpts({ includeDialogue: e.target.checked })}
            />
            Ask the AI to speak the spoken lines
          </label>
          <label className="check">
            <input type="checkbox" checked={opts.bakeText} onChange={(e) => U().setOpts({ bakeText: e.target.checked })} />
            Ask the AI to draw the on-screen text (not recommended)
          </label>
          <p className="hint">
            AI tools often garble written text, especially Hindi. Leave this off and AdCut adds the on-screen text and
            captions for you.
          </p>
        </div>
      </section>

      <div className="ugc-scene-list">
        {scenes.map((s, index) => {
          const active = s.id === scene?.id
          const refCount = s.referenceIds.filter((id) => assetMap[id]).length
          return (
            <button
              key={s.id}
              className={`ugc-scene-select ${active ? 'is-active' : ''}`}
              onClick={() => U().select(s.id)}
            >
              <span className="ugc-scene-number">{String(index + 1).padStart(2, '0')}</span>
              <span className="ugc-scene-label">
                <strong>{s.title}</strong>
                <small>
                  {s.duration}s · video {s.block} · {refCount} refs · {assetMap[s.primaryAssetId] ? 'clip linked' : 'no clip yet'}
                </small>
              </span>
              <span>{active ? '●' : '○'}</span>
            </button>
          )
        })}
      </div>
      <div className="row">
        <button onClick={() => U().addScene()}>＋ Add shot</button>
        <button className="danger" disabled={!scene || scenes.length < 2} onClick={() => scene && U().removeScene(scene.id)}>
          Delete selected shot
        </button>
      </div>

      {scene && (
        <section className="ugc-scene-editor">
          <div className="ugc-editor-heading">
            <h4>{scene.title}</h4>
            <span>{scene.duration}s</span>
          </div>

          <label className="field">
            Shot title
            <input value={scene.title} onChange={(e) => U().updateScene(scene.id, { title: e.target.value })} />
          </label>

          <div className="ugc-control-grid">
            <label className="field">
              Duration: {scene.duration}s
              <input
                type="range"
                min="2"
                max="15"
                step="1"
                value={scene.duration}
                onChange={(e) => U().updateScene(scene.id, { duration: Number(e.target.value) })}
              />
            </label>
            <label className="field">
              Generated video no.
              <input
                type="number"
                min={1}
                value={scene.block}
                onChange={(e) => U().updateScene(scene.id, { block: Math.max(1, Number(e.target.value) || 1) })}
              />
            </label>
          </div>

          <label className="field">
            What we see (visual)
            <textarea rows={3} value={scene.visual} onChange={(e) => U().updateScene(scene.id, { visual: e.target.value })} />
          </label>

          <label className="field">
            Spoken line
            <textarea
              rows={2}
              value={scene.dialogue}
              onChange={(e) => U().updateScene(scene.id, { dialogue: e.target.value })}
            />
          </label>

          <label className="field">
            On-screen text (added by AdCut)
            <input value={scene.overlay} onChange={(e) => U().updateScene(scene.id, { overlay: e.target.value })} />
          </label>

          <label className="field">
            Delivery
            <input value={scene.delivery} onChange={(e) => U().updateScene(scene.id, { delivery: e.target.value })} />
          </label>

          <div className="ugc-control-grid">
            <label className="field">
              Shot size
              <select
                value={scene.shotSize}
                onChange={(e) => U().updateScene(scene.id, { shotSize: e.target.value as ShotSize })}
              >
                {SHOT_SIZES.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              Camera movement
              <select
                value={scene.cameraMovement}
                onChange={(e) => U().updateScene(scene.id, { cameraMovement: e.target.value as CameraMovement })}
              >
                {CAMERA_MOVEMENTS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label className="field">
            Lighting
            <input value={scene.lighting} onChange={(e) => U().updateScene(scene.id, { lighting: e.target.value })} />
          </label>
          <label className="field">
            Framing
            <textarea rows={2} value={scene.framing} onChange={(e) => U().updateScene(scene.id, { framing: e.target.value })} />
          </label>
          <label className="field">
            Continuity (how this shot starts)
            <textarea
              rows={2}
              value={scene.continuity}
              onChange={(e) => U().updateScene(scene.id, { continuity: e.target.value })}
              placeholder="Start exactly where the previous video ended…"
            />
          </label>
          <label className="field">
            End frame
            <textarea rows={2} value={scene.endFrame} onChange={(e) => U().updateScene(scene.id, { endFrame: e.target.value })} />
          </label>
          <label className="field">
            Extra direction
            <textarea
              rows={2}
              value={scene.prompt}
              onChange={(e) => U().updateScene(scene.id, { prompt: e.target.value })}
              placeholder="Anything else the AI should do in this shot…"
            />
          </label>
        </section>
      )}

      <section className="ugc-section">
        <h4>Same for every video</h4>
        <label className="field">
          Format and look
          <textarea rows={3} value={format} onChange={(e) => U().setFormat(e.target.value)} />
        </label>
        <label className="field">
          Avoid (negative prompt)
          <textarea rows={3} value={negative} onChange={(e) => U().setNegative(e.target.value)} />
        </label>
      </section>

      <section className="ugc-section">
        <h4>References used in this shot</h4>
        {selectedRefs.length === 0 ? (
          <p className="hint">None selected yet. Tick files in step 2, or press the “first 3 images” button.</p>
        ) : (
          <div className="ugc-selected-reference-list">
            {selectedRefs.map((a) => {
              const st = settingsFor(a)
              return (
                <div className="ugc-selected-reference" key={a.id}>
                  <div>
                    <strong>{a.name}</strong>
                    <small>
                      {roleLabel(st.role)} · {strengthWord(st.strength)}
                    </small>
                  </div>
                  <button onClick={() => scene && U().toggleRef(scene.id, a.id)}>Remove</button>
                </div>
              )
            })}
          </div>
        )}
      </section>

      <section className="ugc-prompt-preview">
        <h4>Prompt to paste into your AI video tool</h4>
        <textarea rows={12} readOnly value={currentPrompt} onFocus={(e) => e.currentTarget.select()} />
        <p className="hint ugc-count">{currentPrompt.length.toLocaleString()} characters</p>
        <button className="primary wide" onClick={() => void copy(currentPrompt, `Prompt copied: ${scene?.title ?? ''}.`)}>
          Copy this prompt
        </button>
        <div className="row">
          <button onClick={() => void copy(packText(), `Copied all ${buildPromptPack(ctx).length} prompts.`)}>Copy all prompts</button>
          <button onClick={() => download('ugc-prompt-pack.txt', packText())}>Download all (.txt)</button>
        </div>
      </section>

      {/* ---------- STEP 4: ASSEMBLE ---------- */}
      <h4>
        <span className="ugc-step">4</span> Assemble the ad
      </h4>
      <section className="ugc-section">
        <p className="hint">
          After your AI tool makes the videos, import them in the Media tab and link each one to its shot. One video made
          for two shots is cut in order (first 5s, then the next 5s).
        </p>
        <button className="wide" onClick={autoAssign}>
          Match imported videos to shots automatically
        </button>

        <div className="ugc-assign">
          {scenes.map((s, i) => (
            <label className="ugc-assign-row" key={s.id}>
              <span>
                {String(i + 1).padStart(2, '0')} · video {s.block}
              </span>
              <select
                value={assetMap[s.primaryAssetId] ? s.primaryAssetId : ''}
                onChange={(e) => U().updateScene(s.id, { primaryAssetId: e.target.value })}
              >
                <option value="">— choose clip —</option>
                {visualAssets.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>

        <h5 className="ugc-sub">Voice-over (optional)</h5>
        <p className="hint">
          Make the Hindi voice with any text-to-speech tool (one audio file per shot, spoken line from the script), import
          the files, and link them here. Each voice starts at its shot.
        </p>
        <button className="wide" onClick={autoVoice}>
          Match voice files to shots (by number in file name)
        </button>
        <div className="ugc-assign">
          {scenes.map((s, i) => (
            <label className="ugc-assign-row" key={s.id}>
              <span>{String(i + 1).padStart(2, '0')} · voice</span>
              <select
                value={assetMap[s.voiceAssetId] ? s.voiceAssetId : ''}
                onChange={(e) => U().updateScene(s.id, { voiceAssetId: e.target.value })}
              >
                <option value="">— none —</option>
                {audioAssets.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
        <label className="check">
          <input
            type="checkbox"
            checked={buildOpts.voice}
            onChange={(e) => setBuildOpts({ ...buildOpts, voice: e.target.checked })}
          />
          Add voice-over track
        </label>

        <label className="check">
          <input
            type="checkbox"
            checked={buildOpts.overlays}
            onChange={(e) => setBuildOpts({ ...buildOpts, overlays: e.target.checked })}
          />
          Add on-screen text (top, brand colour)
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={buildOpts.captions}
            onChange={(e) => setBuildOpts({ ...buildOpts, captions: e.target.checked })}
          />
          Add captions from the spoken lines (bottom)
        </label>

        <button className="primary wide" onClick={build}>
          Build timeline from shots
        </button>
        <button
          className="wide"
          onClick={() => {
            useStore.getState().setKit({ script: scenes.map((s) => s.dialogue.trim()).filter(Boolean).join('\n') })
            setMessage('Spoken lines were sent to the Captions tab.')
          }}
        >
          Send spoken lines to the Captions tab
        </button>
      </section>

      {message && (
        <div className="ugc-message" role="status">
          {message}
        </div>
      )}
      {warnings.length > 0 && (
        <ul className="ugc-warnings">
          {warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}

      <p className="hint">Project format: {aspect}. Prompts are written for vertical 9:16.</p>
    </div>
  )
}
