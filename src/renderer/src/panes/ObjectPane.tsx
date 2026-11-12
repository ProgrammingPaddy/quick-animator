import { useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { showMenu } from '../components/ContextMenu'
import { Eye, KindIcon } from '../components/KindIcon'
import { LinkIcon } from '../components/LinkIcon'
import { actionLinks, dependentsByTarget, objectLinks, targetKey } from '../model/links'
import { actionIdents, carriedBy, classActionIdents, classGroups, classKey, classSpan, groupMembers, overrideOf, typeGroups, type ClassGroup } from '../model/groups'
import { maskDrawnBy, maskFor, maskNamed, masksOn } from '../model/masks'
import { CAMERA, GROUP, PIVOT_PARAMS, VERB_COLORS } from '../model/registry'
import { cameraAt, containers, isVisibleAt } from '../model/sample'
import type { Action, Mask, SceneObject } from '../model/types'
import { addCamera, addObject, lifetimeMenu, propertiesMenu, canEdit, classMaskItems, cutHereItems, createGroup, prospectiveGroup, deleteAction, deleteClass, deleteClassAction, deleteObjects, duplicateObjects, hideMenuItems, jumpToAction, jumpToClass, jumpToObject, maskedShare, maskListEditable, maskMenuItems, materializeClassAction, moveDeclaration, overrideClassAction, removeFromClass, requestRename, selectClass, selectClassAction, setMasked, ungroup } from '../project/operations'
import { requestSavePreset } from '../project/userPresets'
import { updateSettings } from '../project/controller'
import { ColorPicker } from '../components/ColorPicker'
import { isActionSelected, OBJECT_KINDS, useStore } from '../state/store'
import { timecode } from '../state/time'

/** The fold keys of the types that are not kinds of object (D342). */
const CLASS_TYPE = 'type:Class'
const MASK_TYPE = 'type:Mask'
const CAMERA_TYPE = 'type:Camera'

function actionLabel(action: Action): string {
  const what = action.verb === 'to' ? Object.keys(action.changes).filter((k) => !(PIVOT_PARAMS as readonly string[]).includes(k)).join(', ') || 'to' : action.verb
  return action.timing.relative ? `${what} (relative)` : what
}

const Idents = ({ words }: { words: string[] }) => (
  <>
    {words.map((w, i) => (
      <span key={i} className="ident">
        {w}
      </span>
    ))}
  </>
)

/**
 * The project's objects, two ways (D338, D342). Layers: every object once, in drawing order
 * with the top first, a row dragged up or down to change that order, masks among them where
 * they are; nothing else, since a group and a class have no layer of their own. Type: every
 * object under its kind, then the groups, the classes with their animations and members (D80,
 * D84), and the masks. With a mask selected every row carries a box, ticked where the mask
 * hides it (D333); every object has an eye that hides it in the view (D341). The pane folds on
 * its own, apart from the timeline (D98). Click selects, Ctrl-click adds or removes,
 * double-click jumps to the code, right-click for more; on empty space a click selects nothing
 * and a right-click adds an object.
 */
export function ObjectPane() {
  const project = useStore((s) => s.project)
  const model = useStore((s) => s.model)
  const fps = useStore((s) => s.settings.fps)
  const selection = useStore((s) => s.selection)
  const anchored = useStore((s) => s.anchored)
  const view = useStore((s) => s.objectsView)
  const setView = useStore((s) => s.setObjectsView)
  const hidden = useStore((s) => s.hidden)
  const setHidden = useStore((s) => s.setHidden)
  /** The search, and whether only what is active at the playhead is listed: the objects on screen, and under them the animations running (D176, D184, D338). */
  const [query, setQuery] = useState('')
  const [activeOnly, setActiveOnly] = useState(false)
  // The names on screen at the playhead, as one string: the rows dim by it at any time, and the pane is drawn again only when it changes.
  const onScreen = useStore((s) => (s.model ? s.model.objects.filter((o) => o.className !== GROUP && isVisibleAt(s.model!, o, s.time)).map((o) => o.name).join(' ') : ''))
  const visible = useMemo(() => new Set(onScreen.split(' ')), [onScreen])
  // The camera that has the picture at the playhead (D358): its row is the lit one among the cameras.
  const liveCamera = useStore((s) => (s.model ? (cameraAt(s.model, s.time)?.name ?? '') : ''))
  const background = useStore((s) => s.settings.background)
  // The moment itself matters only to the animations that filter hides, so the pane follows it only while the filter is on.
  const time = useStore((s) => (activeOnly ? s.time : 0))
  const running = (a: { start: number; end: number }): boolean => a.start <= time && time < a.end
  const dependents = useMemo(() => (model ? dependentsByTarget(model) : new Map<string, string[]>()), [model])
  /** Link marks, icons only, saying what in their tooltips (D169). */
  const marks = (links: { key: string; text: string; kind: string }[], referredBy: string[] | undefined) => (
    <>
      {links.map((l) =>
        l.kind === 'code' ? (
          <span key={l.key} className="link code" title={`${l.key}: ${l.text.length > 80 ? `${l.text.slice(0, 79)}…` : l.text}`}>
            ƒ
          </span>
        ) : (
          <span key={l.key} className={`link ${l.kind}`} title={`${l.key === 'at' ? 'start' : l.key === 'until' ? 'end' : l.key} follows ${l.text}`}>
            <LinkIcon />
          </span>
        ),
      )}
      {referredBy && referredBy.length > 0 && (
        <span className="link target" title={`Followed by:\n${referredBy.join('\n')}`}>
          <LinkIcon />
        </span>
      )}
    </>
  )
  const selectedActions = useStore((s) => s.selectedActions)
  const collapsed = useStore((s) => s.collapsed.objects)
  const select = useStore((s) => s.select)
  const selectAction = useStore((s) => s.selectAction)
  const toggleSelected = useStore((s) => s.toggleSelected)
  const toggleSelectedAction = useStore((s) => s.toggleSelectedAction)
  const toggleCollapsed = useStore((s) => s.toggleCollapsed)
  const setAllCollapsed = useStore((s) => s.setAllCollapsed)
  const objects = model?.objects ?? []
  // Two or more selected things show as the group they would make (D326); a change to a value, a key, or a Shift-drag makes it. When they already are a group, it has its own row, and stays unselected (D351).
  const made = selection.length > 1 && selectedActions.length === 0 && model ? prospectiveGroup() : null
  const prospective = made && !made.made ? made : null
  const classes = useMemo(() => (model ? classGroups(model) : []), [model])
  /** What the selected groups carry: it shows as selected with them, as the preview outlines it (D351). */
  const carried = useMemo(() => (model ? carriedBy(model, selection) : new Set<string>()), [model, selection])
  /** A mask's row stands for the mask: the object, or the group whose members are its picture, which sit under it (D336). */
  const maskOwners = useMemo(() => (model ? objects.filter((o) => !!maskNamed(model, o.name)) : []), [model, objects])
  /** The layers, top first (D338): every object but a plain group, which draws nothing of its own, and but the objects of a mask made of several, which sit under it. */
  const layers = useMemo(() => (model ? [...objects].reverse().filter((o) => o.className !== CAMERA && (o.className === GROUP ? !!maskNamed(model, o.name) : (maskDrawnBy(model, o.name)?.name ?? o.name) === o.name)) : []), [model, objects])
  /** By type: the kinds of object, then the plain groups, each without what is a mask or part of one. */
  const types = useMemo(() => typeGroups((model ? objects.filter((o) => !maskFor(model, o.name)) : objects).filter((o) => o.className !== CAMERA)), [model, objects])
  /** The cameras, the highest first: a camera draws nothing, so it is no layer, and is listed by type alone (D357, D358). */
  const cameras = useMemo(() => objects.filter((o) => o.className === CAMERA).reverse(), [objects])
  /** The mask in hand: the one selected, or the one the selected object is part of. Every row then says whether it hides it (D333). */
  const held: Mask | null = model && selection.length === 1 ? maskFor(model, selection[0]!) : null
  const heldEditable = !!held && maskListEditable(held.name)
  /** Active at the playhead: within its life and visible; a group when anything it carries is (D176). */
  const isActive = (obj: SceneObject): boolean => {
    if (!model) return true
    if (obj.className === GROUP) return groupMembers(model, obj.name).some((n) => visible.has(n))
    // A camera is active while it has the picture (D358).
    if (obj.className === CAMERA) return obj.name === liveCamera
    return visible.has(obj.name)
  }
  /** Hidden in the view: itself, or by a group that carries it (D341). */
  const hiddenNow = (obj: SceneObject): boolean => hidden.length > 0 && !!model && (hidden.includes(obj.name) || containers(model, obj).some((g) => hidden.includes(g.name)))
  const q = query.trim().toLowerCase()
  // An imported thing is found by "imported" or by the file it came from (D241), a mask by "mask".
  const matches = (obj: SceneObject): boolean => !q || `${obj.name} ${obj.className} ${obj.classes.join(' ')} ${model && maskFor(model, obj.name) ? 'mask' : ''} ${typeof obj.attrs['imported'] === 'string' ? `imported ${obj.attrs['imported']}` : ''} ${obj.actions.map((a) => `${a.name ?? ''} ${a.verb}`).join(' ')}`.toLowerCase().includes(q)
  const shown = (obj: SceneObject): boolean => matches(obj) && (!activeOnly || isActive(obj))
  const shownClasses = classes.filter((g) => g.members.some(shown))
  const shownMasks = maskOwners.filter(shown)
  const shownCameras = cameras.filter(shown)
  /** What folds with one press (D177, D338): the animations under their objects, and, by type, the objects under their headings. */
  const animationKeys = objects.filter((o) => o.actions.length > 0 || (o.className === GROUP && maskOwners.includes(o))).map((o) => o.name)
  const headingKeys = view === 'type' ? [...types.map((t) => `type:${t.className}`), ...(classes.length > 0 ? [CLASS_TYPE, ...classes.map((g) => classKey(g.className))] : []), ...(maskOwners.length > 0 ? [MASK_TYPE] : []), ...(cameras.length > 0 ? [CAMERA_TYPE] : [])] : []
  const fold = (keys: string[]) => {
    const open = keys.some((key) => !collapsed[key])
    const rest = Object.keys(collapsed).filter((k) => !keys.includes(k))
    setAllCollapsed('objects', open ? [...rest, ...keys] : rest)
  }
  const selectedClassActions = useMemo(() => {
    const set = new Set<unknown>()
    if (!model) return set
    for (const ref of selectedActions) {
      const action = model.objects.find((o) => o.name === ref.object)?.actions[ref.index]
      if (action?.classAction) set.add(action.classAction)
    }
    return set
  }, [model, selectedActions])

  /** A layer's row dragged up or down (D338): where it would land shows as a line, and letting go moves its declaration there. */
  const [drag, setDrag] = useState<{ name: string; over: string | null; above: boolean } | null>(null)
  const justDragged = useRef(false)
  const listRef = useRef<HTMLUListElement>(null)
  const beginLayerDrag = (name: string) => (e: ReactPointerEvent) => {
    if (e.button !== 0 || !canEdit() || (e.target instanceof Element && e.target.closest('button, input'))) return
    const startY = e.clientY
    let current: { name: string; over: string | null; above: boolean } | null = null
    const onMove = (ev: PointerEvent) => {
      if (!current && Math.abs(ev.clientY - startY) < 5) return
      const rows = [...(listRef.current?.querySelectorAll<HTMLElement>('li[data-layer]') ?? [])]
      let over: string | null = null
      let above = true
      for (const el of rows) {
        const r = el.getBoundingClientRect()
        if (ev.clientY < r.top || ev.clientY >= r.bottom) continue
        over = el.dataset['layer'] ?? null
        above = ev.clientY < (r.top + r.bottom) / 2
        break
      }
      // Past the ends of the list is its top or its bottom.
      if (over === null && rows.length > 0) {
        const first = rows[0]!
        const last = rows[rows.length - 1]!
        if (ev.clientY < first.getBoundingClientRect().top) over = first.dataset['layer'] ?? null
        else if (ev.clientY >= last.getBoundingClientRect().bottom) {
          over = last.dataset['layer'] ?? null
          above = false
        }
      }
      current = { name, over: over === name ? null : over, above }
      setDrag(current)
    }
    const end = (apply: boolean) => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('keydown', onKey, true)
      if (current) {
        // The click that ends a drag selects nothing.
        justDragged.current = true
        setTimeout(() => (justDragged.current = false), 0)
        // The list is top first: above a row is after it in the file.
        if (apply && current.over) moveDeclaration(name, current.above ? { after: current.over } : { before: current.over })
      }
      setDrag(null)
    }
    const onUp = () => end(true)
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== 'Escape') return
      ev.stopPropagation()
      end(false)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('keydown', onKey, true)
  }

  const clickObject = (name: string) => (e: ReactMouseEvent) => {
    if (justDragged.current) return
    if (e.ctrlKey || e.metaKey) toggleSelected(name)
    else select([name])
  }

  const clickAction = (name: string, index: number) => (e: ReactMouseEvent) => {
    if (e.ctrlKey || e.metaKey) toggleSelectedAction(name, index)
    else selectAction(name, index)
  }

  const objectMenu = (obj: SceneObject) => (e: ReactMouseEvent) => {
    e.stopPropagation()
    const s = useStore.getState()
    const targets = s.selection.includes(obj.name) ? s.selection : [obj.name]
    if (!s.selection.includes(obj.name)) select([obj.name])
    const many = targets.length > 1
    // The mask items sit one level down, as in the preview's menu (D256, D333).
    const maskItems = maskMenuItems(targets)
    const maskSub = maskItems.length > 0 ? [{ label: 'Mask', children: maskItems }] : []
    if (obj.className === CAMERA && !many) {
      showMenu(e, [
        { label: 'Jump to code', run: () => jumpToObject(obj.name) },
        { label: 'Rename', run: () => requestRename({ object: obj.name }) },
        // Cut to it at the playhead (D377).
        ...cutHereItems(obj.name),
        ...lifetimeMenu(obj.name, s.time),
        ...propertiesMenu(targets),
        { label: 'Duplicate', run: () => duplicateObjects(targets) },
        { label: 'Delete', run: () => deleteObjects(targets), danger: true },
      ])
      return
    }
    if (obj.className === GROUP && !many) {
      showMenu(e, [
        { label: 'Jump to code', run: () => jumpToObject(obj.name) },
        { label: 'Rename', run: () => requestRename({ object: obj.name }) },
        { label: 'Save preset', run: () => requestSavePreset({ object: obj.name }) },
        ...maskSub,
        ...hideMenuItems(targets),
        { label: 'Ungroup', run: () => ungroup(obj.name) },
      ])
      return
    }
    showMenu(e, [
      { label: 'Jump to code', run: () => jumpToObject(obj.name) },
      ...(many ? [] : [{ label: 'Rename', run: () => requestRename({ object: obj.name }) }]),
      ...maskSub,
      ...hideMenuItems(targets),
      // When it is there, and what it is set to be, each one level down (D379).
      ...(many ? [] : lifetimeMenu(obj.name, s.time)),
      ...propertiesMenu(targets),
      { label: many ? `Duplicate ${targets.length} objects` : 'Duplicate', run: () => duplicateObjects(targets) },
      ...(many || !obj.decl ? [] : [{ label: 'Save preset', run: () => requestSavePreset({ object: obj.name }) }]),
      { label: many ? `Delete ${targets.length} objects` : 'Delete', run: () => deleteObjects(targets), danger: true },
    ])
  }

  const actionMenu = (obj: SceneObject, index: number) => (e: ReactMouseEvent) => {
    e.stopPropagation()
    if (!isActionSelected(useStore.getState().selectedActions, obj.name, index)) selectAction(obj.name, index)
    const action = obj.actions[index]
    if (action?.classAction) {
      const classAction = action.classAction
      if (action.overridden) {
        const override = overrideOf(obj, classAction)
        showMenu(e, [
          { label: 'Jump to override', run: () => selectAction(obj.name, override) },
          { label: 'Remove override', run: () => deleteAction(obj.name, override), danger: true },
        ])
        return
      }
      showMenu(e, [
        { label: `Override for ${obj.name}`, run: () => overrideClassAction(obj.name, index) },
        { label: 'Override', run: () => materializeClassAction(obj.name, index) },
        { label: 'Jump to class code', run: () => jumpToAction(obj.name, index) },
        { label: `Remove ${obj.name} from ${classAction.className}`, run: () => removeFromClass(obj.name, classAction.className) },
        { label: 'Delete for all', run: () => deleteAction(obj.name, index), danger: true },
      ])
      return
    }
    showMenu(e, [
      { label: 'Jump to code', run: () => jumpToAction(obj.name, index) },
      { label: action?.name ? 'Rename' : 'Name', run: () => requestRename({ object: obj.name, index }) },
      { label: 'Links', run: () => useStore.getState().openLinksDialog({ object: obj.name, index }) },
      { label: 'Save preset', run: () => requestSavePreset({ object: obj.name, index }) },
      { label: 'Delete', run: () => deleteAction(obj.name, index), danger: true },
    ])
  }

  const classMenu = (group: ClassGroup) => (e: ReactMouseEvent) => {
    e.stopPropagation()
    selectClass(group.className)
    const maskItems = classMaskItems(group.className)
    showMenu(e, [
      { label: 'Jump to code', run: () => jumpToClass(group.className) },
      { label: 'Select members', run: () => selectClass(group.className) },
      { label: 'Save preset', run: () => requestSavePreset({ className: group.className }) },
      ...(maskItems.length > 0 ? [{ label: 'Mask', children: maskItems }] : []),
      { label: 'Delete', run: () => deleteClass(group.className), danger: true },
    ])
  }

  const classActionMenu = (group: ClassGroup, id: number) => (e: ReactMouseEvent) => {
    e.stopPropagation()
    const classAction = group.actions.find((a) => a.id === id)
    if (!classAction) return
    selectClassAction(classAction)
    showMenu(e, [
      { label: 'Jump to code', run: () => jumpToClass(group.className) },
      { label: classAction.name ? 'Rename' : 'Name', run: () => requestRename({ classAction: id }) },
      { label: 'Delete for all', run: () => deleteClassAction(id), danger: true },
    ])
  }

  /** Right-click on empty space: add an object at the frame center. */
  const blankMenu = (e: ReactMouseEvent) => {
    if (!(e.target instanceof Element) || !e.target.matches('.object-list, .empty, .group-head')) return
    showMenu(
      e,
      // A camera among them (D365): from the playhead on, framed as the picture is there.
      [{ label: 'Add', children: [...OBJECT_KINDS.map((k) => ({ label: k, run: () => addObject(k, 0, 0) })), { label: 'Camera', run: () => void addCamera() }] }],
    )
  }

  /**
   * The box at the head of a row while a mask is in hand (D333): ticked where the mask hides all
   * the row stands for, half where some; a click takes it in or lets it out. Its place is kept on
   * every row, empty where there is nothing to tick, so the rows stay in line.
   */
  const tick = (thing: string | null): ReactNode => {
    if (!held || !model || thing === null) return <span className="tick-slot" />
    const share = maskedShare(model, held, thing)
    return (
      <span className="tick-slot">
        <input
          type="checkbox"
          className="mask-tick"
          checked={share === 'all'}
          ref={(el) => {
            if (el) el.indeterminate = share === 'some'
          }}
          disabled={!heldEditable}
          title={`${share === 'all' ? 'Masked' : share === 'some' ? 'Partly masked' : 'Not masked'} by ${held.name}`}
          aria-label={`Masked by ${held.name}`}
          onClick={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
          onChange={(e) => setMasked(held.name, [thing], e.target.checked)}
        />
      </span>
    )
  }

  /** One object's row with its animations beneath. `layer` rows are the Layers view's own: they show what masks them and drag to reorder. */
  const renderObject = (obj: SceneObject, where: { member?: boolean; layer?: boolean } = {}) => {
    if (!shown(obj)) return null
    const selected = (selection.includes(obj.name) || carried.has(obj.name)) && selectedActions.length === 0
    const folded = !!collapsed[obj.name]
    const active = isActive(obj)
    const mask = model ? maskNamed(model, obj.name) : null
    const part = model && !mask ? maskDrawnBy(model, obj.name) : null
    const hiding = model && !mask && !part ? masksOn(model, obj.name) : []
    const shapes = mask && model && obj.className === GROUP ? mask.shapes.map((n) => model.objects.find((o) => o.name === n)).filter((o): o is SceneObject => !!o) : []
    const folds = obj.actions.length > 0 || shapes.length > 0
    const off = hidden.includes(obj.name)
    const isCamera = obj.className === CAMERA
    const drop = where.layer && drag && drag.over === obj.name ? (drag.above ? ' drop-above' : ' drop-below') : ''
    return (
      <li
        key={`${where.member ? 'm:' : ''}${obj.name}`}
        className={`object${selected ? ' selected' : ''}${where.member ? ' member' : ''}${active ? '' : ' inactive'}${mask ? ' mask' : ''}${isCamera ? ' camera' : ''}${isCamera && active ? ' live' : ''}${hiddenNow(obj) ? ' is-hidden' : ''}${where.layer && drag?.name === obj.name ? ' dragging' : ''}${drop}`}
        title={isCamera ? (active ? 'Has the picture at the playhead' : 'Not the camera in use at the playhead') : active ? undefined : 'Not on screen at the playhead'}
        data-layer={where.layer ? obj.name : undefined}
      >
        {where.layer && (mask || hiding.length > 0) && <span className={`mask-line${mask ? ' cap' : ''}${held && (held === mask || hiding.includes(held)) ? ' held' : ''}`} title={mask ? undefined : `Masked by ${hiding.map((m) => m.name).join(', ')}`} />}
        <div className="object-row" onClick={clickObject(obj.name)} onDoubleClick={() => jumpToObject(obj.name)} onContextMenu={objectMenu(obj)} onPointerDown={where.layer && obj.decl ? beginLayerDrag(obj.name) : undefined}>
          {tick(mask || part || isCamera ? null : obj.name)}
          {folds ? (
            <button
              className={`chevron${folded ? '' : ' open'}`}
              onClick={(e) => {
                e.stopPropagation()
                toggleCollapsed('objects', obj.name)
              }}
              onDoubleClick={(e) => e.stopPropagation()}
              title={folded ? 'Expand' : 'Collapse'}
              aria-label={folded ? 'Expand' : 'Collapse'}
              aria-expanded={!folded}
            />
          ) : (
            <span className="chevron none" />
          )}
          <span className={`glyph${mask ? ' mask' : ''}`} title={mask ? (mask.inverted ? 'A mask, inverted: what it lists is hidden where it is' : 'A mask: what it lists shows only where it is') : undefined}>
            <KindIcon kind={mask ? (mask.inverted ? 'InvertedMask' : 'Mask') : obj.className} />
          </span>
          <span className="name">{obj.name}</span>
          {mask && (
            <span className="badge mask" title={mask.inverted ? 'A mask, inverted: what it lists is hidden where it is' : 'A mask: what it lists shows only where it is'}>
              mask
            </span>
          )}
          {mask && typeof obj.attrs['masks'] === 'string' && (
            <span className="dim members" title={`Masks ${obj.attrs['masks']}`}>
              {obj.attrs['masks']}
            </span>
          )}
          {typeof obj.attrs['imported'] === 'string' && (
            <span className="badge imported" title={`Imported from ${obj.attrs['imported']}`}>
              I
            </span>
          )}
          {obj.className === GROUP && !mask && <span className="dim members">{(model?.groups.get(obj.name) ?? []).join(' · ')}</span>}
          {marks(objectLinks(obj), dependents.get(targetKey({ object: obj })))}
          {obj.codeDriven && <span className="badge">code</span>}
          {anchored.includes(obj.name) && (
            <span className="badge anchor" title="Anchored: a push never moves it (D136)">
              anchored
            </span>
          )}
          {obj.attrs['attached'] === true && (
            <span className="badge" title="Held on the screen, whatever the camera does (D362)">
              attached
            </span>
          )}
          <span className="dim kind">{obj.className}</span>
          {isCamera && <span className="eye-slot" />}
          {!part && !isCamera && (
            <button
              className={`eye${off ? ' off' : ''}`}
              onClick={(e) => {
                e.stopPropagation()
                setHidden([obj.name], !off)
              }}
              onDoubleClick={(e) => e.stopPropagation()}
              title={off ? 'Unhide' : 'Hide'}
              aria-label={off ? 'Unhide' : 'Hide'}
              aria-pressed={!off}
            >
              <Eye off={off} />
            </button>
          )}
        </div>
        {obj.actions.length > 0 && !folded && (
          <ul className="action-list">
            {obj.actions.map((action, index) => {
              if (activeOnly && !running(action)) return null
              const isSelected = isActionSelected(selectedActions, obj.name, index)
              const title = action.overridden
                ? `From all('${action.classAction!.className}'), switched off for ${obj.name} by its own override.`
                : action.classAction
                  ? `From all('${action.classAction.className}'). Right-click to override it for this object.`
                  : action.overrides
                    ? `Overrides ${action.overrides.name} for ${obj.name}.`
                    : undefined
              return (
                <li
                  key={action.id}
                  className={`action-row${isSelected ? ' selected' : ''}${action.classAction ? ' derived' : ''}${action.overridden ? ' overridden' : ''}${action.overrides ? ' override' : ''}`}
                  onClick={clickAction(obj.name, index)}
                  onDoubleClick={() => jumpToAction(obj.name, index)}
                  onContextMenu={action.stmt ? actionMenu(obj, index) : undefined}
                  title={title}
                >
                  <span className="dot" style={{ background: VERB_COLORS[action.verb] }} />
                  <Idents words={actionIdents(action)} />
                  <span className="name">{actionLabel(action)}</span>
                  <span className="dim mono">{timecode(action.start, fps)}</span>
                  {marks(actionLinks(action), dependents.get(targetKey({ action })))}
                  {action.codeDriven && <span className="badge">code</span>}
                  {action.overridden && <span className="badge off">off</span>}
                </li>
              )
            })}
          </ul>
        )}
        {shapes.length > 0 && !folded && <ul className="member-list">{shapes.map((m) => renderObject(m, { member: true }))}</ul>}
      </li>
    )
  }

  /** A class's row, with its animations and its members beneath (D80). */
  const renderClass = (group: ClassGroup) => {
    const key = classKey(group.className)
    const folded = !!collapsed[key]
    const allSelected = group.members.length > 0 && group.members.every((m) => selection.includes(m.name)) && selectedActions.length === 0
    return (
      <li key={key} className={`group class-group${allSelected ? ' selected' : ''}`}>
        <div className="object-row class-row" onClick={() => selectClass(group.className)} onDoubleClick={() => jumpToClass(group.className)} onContextMenu={classMenu(group)} title="Class: every member">
          {tick(group.className)}
          <button
            className={`chevron${folded ? '' : ' open'}`}
            onClick={(e) => {
              e.stopPropagation()
              toggleCollapsed('objects', key)
            }}
            onDoubleClick={(e) => e.stopPropagation()}
            title={folded ? 'Expand' : 'Collapse'}
            aria-label={folded ? 'Expand' : 'Collapse'}
            aria-expanded={!folded}
          />
          <span className="glyph">
            <KindIcon kind="Class" />
          </span>
          <span className="name">{group.className}</span>
          <span className="dim">class</span>
          <span className="dim mono">{group.members.length}</span>
        </div>
        {!folded && group.actions.length > 0 && (
          <ul className="action-list">
            {group.actions.map((classAction) => {
              const span = classSpan(classAction)
              if (activeOnly && (!span || !running(span))) return null
              const isSelected = selectedClassActions.has(classAction)
              return (
                <li
                  key={classAction.id}
                  className={`action-row${isSelected ? ' selected' : ''}`}
                  onClick={() => selectClassAction(classAction)}
                  onDoubleClick={() => jumpToClass(group.className)}
                  onContextMenu={classAction.stmt ? classActionMenu(group, classAction.id) : undefined}
                  title="Every member"
                >
                  <span className="dot" style={{ background: VERB_COLORS[classAction.verb] }} />
                  <Idents words={classActionIdents(classAction)} />
                  <span className="name">{classAction.verb}</span>
                  {span && <span className="dim mono">{timecode(span.start, fps)}</span>}
                  {!classAction.stmt && <span className="badge">code</span>}
                </li>
              )
            })}
          </ul>
        )}
        {!folded && <ul className="member-list">{group.members.map((m) => renderObject(m, { member: true }))}</ul>}
      </li>
    )
  }

  /** A type's heading, which folds what is under it. */
  const section = (key: string, label: string, count: number, body: () => ReactNode) => {
    const folded = !!collapsed[key]
    return (
      <li key={key} className="group">
        <div className="group-head dim" onClick={() => toggleCollapsed('objects', key)} title={folded ? 'Expand' : 'Collapse'}>
          <button className={`chevron${folded ? '' : ' open'}`} onClick={(e) => { e.stopPropagation(); toggleCollapsed('objects', key) }} aria-label={folded ? 'Expand' : 'Collapse'} aria-expanded={!folded} />
          {label} <span className="mono">{count}</span>
        </div>
        {!folded && <ul className="type-list">{body()}</ul>}
      </li>
    )
  }

  /** A fold of one press (D338): always there, grayed while there is nothing of its kind to fold. */
  const foldButton = (label: string, keys: string[], what: string) => {
    const none = keys.length === 0
    const open = none || keys.some((key) => !collapsed[key])
    return (
      <button className="small fold" disabled={none} onClick={() => fold(keys)} title={none ? undefined : `${open ? 'Collapse' : 'Expand'} ${what}`} aria-expanded={none ? undefined : open}>
        <span className={`chevron${open ? ' open' : ''}`} />
        {label}
      </button>
    )
  }

  return (
    <div className={`objects${held ? ' masking' : ''}`}>
      {objects.length === 0 ? (
        <div className="empty" onContextMenu={blankMenu}>
          {project ? 'No objects yet.' : 'Open or create a project to begin.'}
        </div>
      ) : (
        <>
          <div className="objects-tools">
            <div className="objects-tools-row">
              <input className="objects-search" type="search" placeholder="Search" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search objects" />
            </div>
            <div className="objects-tools-row">
              <div className="objects-filter" role="group" aria-label="Show">
                <button className={activeOnly ? '' : 'active'} onClick={() => setActiveOnly(false)} aria-pressed={!activeOnly} title="Everything">
                  Show All
                </button>
                <button className={activeOnly ? 'active' : ''} onClick={() => setActiveOnly(true)} aria-pressed={activeOnly} title="What is on screen at the playhead, and the animations running then">
                  Show Only Active
                </button>
              </div>
              <span className="dim count">
                {objects.length} {objects.length === 1 ? 'object' : 'objects'}
                {selection.length > 1 ? `, ${selection.length} selected` : ''}
              </span>
            </div>
            <div className="objects-tools-row wrap">
              <div className="objects-tabs" role="tablist" aria-label="Objects by">
                <button role="tab" aria-selected={view === 'layers'} className={view === 'layers' ? 'active' : ''} onClick={() => setView('layers')} title="Every object once, in drawing order, top first">
                  Layers
                </button>
                <button role="tab" aria-selected={view === 'type'} className={view === 'type' ? 'active' : ''} onClick={() => setView('type')} title="By kind, then the groups, the classes, and the masks">
                  Type
                </button>
              </div>
              <span className="objects-folds">
                {foldButton('Objects', headingKeys, 'the objects under their types')}
                {foldButton('Animations', animationKeys, 'the animations under their objects')}
              </span>
            </div>
          </div>
          <ul
            className="object-list"
            ref={listRef}
            onContextMenu={blankMenu}
            onClick={(e) => {
              if (e.target instanceof Element && e.target.matches('.object-list, .empty') && !justDragged.current && useStore.getState().selection.length + useStore.getState().selectedActions.length > 0) select([])
            }}
          >
            {prospective && (
              <li className="object prospective" title="Not made yet: a value, a key, or a Shift-drag makes it">
                <div
                  className="object-row"
                  onContextMenu={(e) => {
                    e.stopPropagation()
                    showMenu(e, [{ label: 'Group', run: () => createGroup(prospective.members) }, { label: 'Mask', children: maskMenuItems(prospective.members) }, ...hideMenuItems(prospective.members)])
                  }}
                >
                  {tick(null)}
                  <span className="chevron none" />
                  <span className="glyph">
                    <KindIcon kind={GROUP} />
                  </span>
                  <span className="name">{prospective.name}</span>
                  <span className="dim">{GROUP}</span>
                  <span className="dim members">{prospective.members.join(' · ')}</span>
                </div>
              </li>
            )}
            {view === 'layers' ? (
              <>
                {layers.map((obj) => renderObject(obj, { layer: true }))}
                {(!q || 'background'.includes(q)) && !activeOnly && (
                  <li className="object background" title="Behind everything, whatever the camera does">
                    <div className="object-row">
                      {tick(null)}
                      <span className="chevron none" />
                      <span className="glyph">
                        <KindIcon kind="Background" />
                      </span>
                      <span className="name">Background</span>
                      <ColorPicker value={background} onChange={(color) => updateSettings({ background: color })} title="Background" />
                    </div>
                  </li>
                )}
              </>
            ) : (
              <>
                {types.filter((group) => group.objects.some(shown)).map((group) => section(`type:${group.className}`, group.className, group.objects.filter(shown).length, () => group.objects.map((obj) => renderObject(obj))))}
                {shownClasses.length > 0 && section(CLASS_TYPE, 'Class', shownClasses.length, () => shownClasses.map(renderClass))}
                {shownMasks.length > 0 && section(MASK_TYPE, 'Mask', shownMasks.length, () => shownMasks.map((obj) => renderObject(obj)))}
                {shownCameras.length > 0 && section(CAMERA_TYPE, 'Camera', shownCameras.length, () => shownCameras.map((obj) => renderObject(obj)))}
              </>
            )}
            {(q || activeOnly) && !objects.some(shown) && <li className="empty dim">Nothing matches.</li>}
          </ul>
        </>
      )}
    </div>
  )
}
