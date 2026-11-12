import { NumberField } from '../components/NumberField'
import { keysLabel, NO_OVERRIDES } from '../state/hotkeys'
import { PREVIEW_VIEWS, useStore, type Pick, type PreviewView } from '../state/store'

const PICK_LABEL: Record<Pick, string> = { object: 'Object', group: 'Group', class: 'Class' }
const PICK_TIP: Record<Pick, string> = { object: 'A click picks the object', group: 'A click picks the group it is in', class: 'A click picks every object of its class' }

/** What the preview shows (D359), as its switch names them. */
const VIEW_LABEL: Record<PreviewView, string> = { preview: 'Preview', both: 'Both', camera: 'Camera' }
const VIEW_TIP: Record<PreviewView, string> = { preview: "The scene, with the camera's frame in it", both: 'The scene and what the camera sees, side by side', camera: 'What the camera sees' }

/**
 * The preview's own choices, in its pane's header (D371): what a click picks, where a Shift-drag's
 * animation sits and whether they chain, snapping to the grid and to edges, the paths, the
 * masks, and the cameras shown (D374), collision; then what the pane shows, Preview, Both, or Camera (D359). The tools and
 * what the tool in hand can do stay over the preview, with the zoom and Fit. A right-click on any
 * of it does nothing, as on the preview's own bars (D308).
 */
export function PreviewHeader() {
  const pick = useStore((s) => s.pick)
  const setPick = useStore((s) => s.setPick)
  const pin = useStore((s) => s.pin)
  const setPin = useStore((s) => s.setPin)
  const chain = useStore((s) => s.chain)
  const setChain = useStore((s) => s.setChain)
  const previewSnap = useStore((s) => s.previewSnap)
  const setPreviewSnap = useStore((s) => s.setPreviewSnap)
  const showPaths = useStore((s) => s.showPaths)
  const toggleShowPaths = useStore((s) => s.toggleShowPaths)
  const showMasks = useStore((s) => s.showMasks)
  const toggleShowMasks = useStore((s) => s.toggleShowMasks)
  const showCameras = useStore((s) => s.showCameras)
  const toggleShowCameras = useStore((s) => s.toggleShowCameras)
  const collide = useStore((s) => s.collide)
  const setCollide = useStore((s) => s.setCollide)
  const push = useStore((s) => s.push)
  const setPush = useStore((s) => s.setPush)
  const previewView = useStore((s) => s.previewView)
  const setPreviewView = useStore((s) => s.setPreviewView)
  const hotkeys = useStore((s) => s.prefs.hotkeys ?? NO_OVERRIDES)
  const key = keysLabel('previewView', hotkeys, true)
  return (
    <>
      <div className="preview-options" role="group" aria-label="Preview options" onContextMenu={(e) => e.preventDefault()}>
        <div className="preview-modes" role="group" aria-label="What a click picks">
          {(['object', 'group', 'class'] as const).map((p) => (
            <button key={p} className={pick === p ? 'active' : ''} onClick={() => setPick(p)} title={PICK_TIP[p]} aria-pressed={pick === p}>
              {PICK_LABEL[p]}
            </button>
          ))}
        </div>
        <button
          className="preview-toggle"
          onClick={() => {
            const next = pin === 'start' ? 'end' : 'start'
            setPin(next)
            // With an animation selected, the playhead goes to the end the pin names (D187).
            const s = useStore.getState()
            const ref = s.selectedActions.find((r) => s.selection.includes(r.object)) ?? s.selectedActions[0]
            const action = ref ? s.model?.objects.find((o) => o.name === ref.object)?.actions[ref.index] : undefined
            if (action) s.setTime(next === 'end' ? action.end : action.start)
          }}
          title={pin === 'start' ? 'Shift-drags start at the playhead' : 'Shift-drags end at the playhead'}
        >
          {pin === 'start' ? 'Starts at playhead' : 'Ends at playhead'}
        </button>
        {pin === 'start' && (
          <button className={`preview-toggle${chain ? ' on' : ''}`} onClick={() => setChain(!chain)} title={chain ? 'Shift-drags follow one another' : 'Shift-drags all start at the playhead'} aria-pressed={chain}>
            Chain
          </button>
        )}
        <button className={previewSnap.on ? 'on' : ''} onClick={() => setPreviewSnap({ on: !previewSnap.on })} title={previewSnap.on ? 'Snapping to the grid' : 'Free placement'} aria-pressed={previewSnap.on}>
          Snap
        </button>
        {previewSnap.on && <NumberField label="Grid, in pixels" value={previewSnap.grid} unit="px" onChange={(grid) => setPreviewSnap({ grid })} />}
        {previewSnap.on && <NumberField label="Angle step, in degrees" value={previewSnap.angle} unit={'°'} onChange={(angle) => setPreviewSnap({ angle })} />}
        <button className={showPaths ? 'on' : ''} onClick={toggleShowPaths} title={showPaths ? "Showing the selected object's paths" : 'Showing a path only while it is selected'} aria-pressed={showPaths}>
          Show Paths
        </button>
        <button className={showMasks ? 'on' : ''} onClick={toggleShowMasks} title={showMasks ? 'Showing the edges of the masks on what is selected, or of every mask with nothing selected' : "Showing a mask's edge only while it is selected"} aria-pressed={showMasks}>
          Show Masks
        </button>
        <button className={showCameras ? 'on' : ''} onClick={toggleShowCameras} title={showCameras ? "Showing every camera's frame" : "Showing a camera's frame only while it is selected"} aria-pressed={showCameras}>
          Show Cameras
        </button>
        <button className={previewSnap.edges ? 'on' : ''} onClick={() => setPreviewSnap({ edges: !previewSnap.edges })} title={previewSnap.edges ? 'Aligning to edges and centers' : 'Not aligning to other objects'} aria-pressed={previewSnap.edges}>
          Edges
        </button>
        <button className={collide ? 'on' : ''} onClick={() => setCollide(!collide)} title={collide ? 'Objects collide' : 'Objects pass through each other'} aria-pressed={collide}>
          Collision
        </button>
        {collide && (
          <button className={push ? 'on' : ''} onClick={() => setPush(!push)} title={push ? 'Dragged objects push others' : 'Dragged objects stop at others'} aria-pressed={push}>
            Push
          </button>
        )}
      </div>
      <div className="preview-views" role="group" aria-label="What the preview shows" onContextMenu={(e) => e.preventDefault()}>
        {PREVIEW_VIEWS.map((v) => (
          <button key={v} className={previewView === v ? 'active' : ''} onClick={() => setPreviewView(v)} title={key ? `${VIEW_TIP[v]} (${key} for the next)` : VIEW_TIP[v]} aria-pressed={previewView === v}>
            {VIEW_LABEL[v]}
          </button>
        ))}
      </div>
    </>
  )
}
