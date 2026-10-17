import { useMemo, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { showMenu } from '../components/ContextMenu'
import { LinkIcon } from '../components/LinkIcon'
import { actionLinks, dependentsByTarget, objectLinks, targetKey } from '../model/links'
import { actionIdents, classActionIdents, classGroups, classKey, classSpan, overrideOf, typeGroups, type ClassGroup } from '../model/groups'
import { GROUP, PIVOT_PARAMS, VERB_COLORS } from '../model/registry'
import { isVisibleAt } from '../model/sample'
import type { Action, SceneObject } from '../model/types'
import { addObject, deleteAction, deleteClass, deleteClassAction, deleteObjects, duplicateObjects, jumpToAction, jumpToClass, jumpToObject, materializeClassAction, overrideClassAction, removeFromClass, requestClasses, requestRename, selectClass, selectClassAction, ungroup, setLifetime } from '../project/operations'
import { isActionSelected, OBJECT_KINDS, useStore } from '../state/store'
import { timecode } from '../state/time'

const GLYPHS: Record<string, string> = { Rect: '▭', Circle: '○', Text: 'T', Group: '⊞' }

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
 * The project, then its objects in every place they belong: class groups first, with the
 * class's actions and its members beneath, then every object grouped by type (D80, D84). The
 * pane folds on its own, apart from the timeline (D98). Click selects, Ctrl-click adds or
 * removes, double-click jumps to the code, right-click for more, and a right-click on empty
 * space adds an object.
 */
export function ObjectPane() {
  const project = useStore((s) => s.project)
  const model = useStore((s) => s.model)
  const fps = useStore((s) => s.settings.fps)
  const selection = useStore((s) => s.selection)
  const anchored = useStore((s) => s.anchored)
  const time = useStore((s) => s.time)
  /** The search, and whether only what is active at the playhead is listed (D176). */
  const [query, setQuery] = useState('')
  const [activeOnly, setActiveOnly] = useState(false)
  /** Whether only the animations running at the playhead are listed under each object (D184). */
  const [activeAnimations, setActiveAnimations] = useState(false)
  const running = (a: { start: number; end: number }): boolean => a.start <= time && time < a.end
  const dependents = useMemo(() => (model ? dependentsByTarget(model) : new Map<string, string[]>()), [model])
  /** Link marks, icons only, saying what in their tooltips (D169). */
  const marks = (links: { key: string; text: string; kind: string }[], referredBy: string[] | undefined) => (
    <>
      {links.map((l) => (
        <span key={l.key} className={`link ${l.kind}`} title={l.kind === 'value' ? `${l.key} follows ${l.text}` : `${l.key === 'at' ? 'Starts at' : l.key === 'until' ? 'Ends at' : l.key + ' is'} ${l.text}`}>
          <LinkIcon />
        </span>
      ))}
      {referredBy && referredBy.length > 0 && (
        <span className="link target" title={`Referred to by:\n${referredBy.join('\n')}`}>
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
  const groups = useMemo(() => (model ? classGroups(model) : []), [model])
  const types = useMemo(() => typeGroups(objects), [objects])
  /** Active at the playhead: within its life and visible; a group when any member is (D176). */
  const isActive = (obj: SceneObject): boolean => {
    if (!model) return true
    if (obj.className === GROUP) return (model.groups.get(obj.name) ?? []).some((n) => {
      const m = model.objects.find((o) => o.name === n)
      return !!m && isVisibleAt(model, m, time)
    })
    return isVisibleAt(model, obj, time)
  }
  const q = query.trim().toLowerCase()
  const matches = (obj: SceneObject): boolean => !q || `${obj.name} ${obj.className} ${obj.classes.join(' ')} ${obj.actions.map((a) => `${a.name ?? ''} ${a.verb}`).join(' ')}`.toLowerCase().includes(q)
  const shown = (obj: SceneObject): boolean => matches(obj) && (!activeOnly || isActive(obj))
  /** Everything that folds: the type sections, the class groups, and the objects with actions (D177). */
  const foldable = [...types.map((t) => `type:${t.className}`), ...groups.map((g) => classKey(g.className)), ...objects.filter((o) => o.actions.length > 0).map((o) => o.name)]
  const anyExpanded = foldable.some((key) => !collapsed[key])
  const selectedClassActions = useMemo(() => {
    const set = new Set<unknown>()
    if (!model) return set
    for (const ref of selectedActions) {
      const action = model.objects.find((o) => o.name === ref.object)?.actions[ref.index]
      if (action?.classAction) set.add(action.classAction)
    }
    return set
  }, [model, selectedActions])

  const clickObject = (name: string) => (e: ReactMouseEvent) => {
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
    if (obj.className === GROUP && !many) {
      showMenu(e, [
        { label: 'Jump to code', run: () => jumpToObject(obj.name) },
        { label: 'Rename', run: () => requestRename({ object: obj.name }) },
        { label: 'Ungroup', run: () => ungroup(obj.name) },
      ])
      return
    }
    showMenu(e, [
      { label: 'Jump to code', run: () => jumpToObject(obj.name) },
      ...(many ? [] : [{ label: 'Rename', run: () => requestRename({ object: obj.name }) }]),
      { label: 'Classes', run: () => requestClasses(targets) },
      ...(many ? [] : [{ label: 'Edit links', run: () => useStore.getState().openLinksDialog({ object: obj.name }) }]),
      { label: many ? `Duplicate ${targets.length} objects` : 'Duplicate', run: () => duplicateObjects(targets) },
      ...(many ? [] : [{ label: 'End at', keyword: timecode(s.time, s.settings.fps), run: () => setLifetime(obj.name, { until: useStore.getState().time }) }]),
      { label: many ? `Delete ${targets.length} objects` : 'Delete object', run: () => deleteObjects(targets), danger: true },
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
          { label: 'Jump to the override', run: () => selectAction(obj.name, override) },
          { label: 'Remove the override', run: () => deleteAction(obj.name, override), danger: true },
        ])
        return
      }
      showMenu(e, [
        { label: `Override for ${obj.name}`, run: () => overrideClassAction(obj.name, index) },
        { label: 'Copy as own action', run: () => materializeClassAction(obj.name, index) },
        { label: 'Jump to class code', run: () => jumpToAction(obj.name, index) },
        { label: `Remove ${obj.name} from ${classAction.className}`, run: () => removeFromClass(obj.name, classAction.className) },
        { label: 'Delete for every member', run: () => deleteAction(obj.name, index), danger: true },
      ])
      return
    }
    showMenu(e, [
      { label: 'Jump to code', run: () => jumpToAction(obj.name, index) },
      { label: action?.name ? 'Rename' : 'Name', run: () => requestRename({ object: obj.name, index }) },
      { label: 'Edit links', run: () => useStore.getState().openLinksDialog({ object: obj.name, index }) },
      { label: 'Delete action', run: () => deleteAction(obj.name, index), danger: true },
    ])
  }

  const classMenu = (group: ClassGroup) => (e: ReactMouseEvent) => {
    e.stopPropagation()
    selectClass(group.className)
    showMenu(e, [
      { label: 'Jump to code', run: () => jumpToClass(group.className) },
      { label: 'Select members', run: () => selectClass(group.className) },
      { label: 'Delete class', run: () => deleteClass(group.className), danger: true },
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
      { label: 'Delete for every member', run: () => deleteClassAction(id), danger: true },
    ])
  }

  /** Right-click on empty space: add an object at the frame center. */
  const blankMenu = (e: ReactMouseEvent) => {
    if (!(e.target instanceof Element) || !e.target.matches('.object-list, .empty, .group-head')) return
    showMenu(
      e,
      [{ label: 'Add', children: OBJECT_KINDS.map((k) => ({ label: k, run: () => addObject(k, 0, 0) })) }],
    )
  }

  const renderObject = (obj: SceneObject, member: boolean) => {
    if (!shown(obj)) return null
    const selected = selection.includes(obj.name) && selectedActions.length === 0
    const folded = !!collapsed[obj.name]
    const active = isActive(obj)
    return (
      <li key={`${member ? 'm:' : ''}${obj.name}`} className={`object${selected ? ' selected' : ''}${member ? ' member' : ''}${active ? '' : ' inactive'}`} title={active ? undefined : 'Not on screen at the playhead'}>
        <div className="object-row" onClick={clickObject(obj.name)} onDoubleClick={() => jumpToObject(obj.name)} onContextMenu={objectMenu(obj)} title="Click to select, Ctrl-click to add, double-click to jump to the code, right-click for more">
          {obj.actions.length > 0 ? (
            <button
              className={`chevron${folded ? '' : ' open'}`}
              onClick={(e) => {
                e.stopPropagation()
                toggleCollapsed('objects', obj.name)
              }}
              onDoubleClick={(e) => e.stopPropagation()}
              title={folded ? 'Show actions' : 'Hide actions'}
              aria-label={folded ? 'Show actions' : 'Hide actions'}
              aria-expanded={!folded}
            />
          ) : (
            <span className="chevron none" />
          )}
          <span className="glyph">{GLYPHS[obj.className] ?? '?'}</span>
          <span className="name">{obj.name}</span>
          <span className="dim">{obj.className}</span>
          {obj.className === GROUP && <span className="dim members">{(model?.groups.get(obj.name) ?? []).join(' · ')}</span>}
          {marks(objectLinks(obj), dependents.get(targetKey({ object: obj })))}
          {obj.codeDriven && <span className="badge">code</span>}
          {anchored.includes(obj.name) && (
            <span className="badge anchor" title="Anchored: a push never moves it (D136)">
              anchored
            </span>
          )}
        </div>
        {obj.actions.length > 0 && !folded && (
          <ul className="action-list">
            {obj.actions.map((action, index) => {
              if (activeAnimations && !running(action)) return null
              const isSelected = isActionSelected(selectedActions, obj.name, index)
              const title = action.overridden
                ? `From all('${action.classAction!.className}'), switched off for ${obj.name} by its own override.`
                : action.classAction
                  ? `From all('${action.classAction.className}'). Right-click to override it for this object.`
                  : action.overrides
                    ? `Overrides ${action.overrides.name} for ${obj.name}.`
                    : 'Click to select, Ctrl-click to add, double-click to jump to the code, right-click for more'
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
      </li>
    )
  }

  const renderClass = (group: ClassGroup) => {
    const key = classKey(group.className)
    const folded = !!collapsed[key]
    const allSelected = group.members.length > 0 && group.members.every((m) => selection.includes(m.name)) && selectedActions.length === 0
    return (
      <li key={key} className={`group class-group${allSelected ? ' selected' : ''}`}>
        <div className="object-row class-row" onClick={() => selectClass(group.className)} onDoubleClick={() => jumpToClass(group.className)} onContextMenu={classMenu(group)} title="Click to select every member, double-click to jump to the code">
          <button
            className={`chevron${folded ? '' : ' open'}`}
            onClick={(e) => {
              e.stopPropagation()
              toggleCollapsed('objects', key)
            }}
            onDoubleClick={(e) => e.stopPropagation()}
            title={folded ? 'Show members' : 'Hide members'}
            aria-label={folded ? 'Show members' : 'Hide members'}
            aria-expanded={!folded}
          />
          <span className="glyph">{'◆'}</span>
          <span className="name">{group.className}</span>
          <span className="dim">class</span>
          <span className="dim mono">{group.members.length}</span>
        </div>
        {!folded && group.actions.length > 0 && (
          <ul className="action-list">
            {group.actions.map((classAction) => {
              const span = classSpan(classAction)
              if (activeAnimations && (!span || !running(span))) return null
              const isSelected = selectedClassActions.has(classAction)
              return (
                <li
                  key={classAction.id}
                  className={`action-row${isSelected ? ' selected' : ''}`}
                  onClick={() => selectClassAction(classAction)}
                  onDoubleClick={() => jumpToClass(group.className)}
                  onContextMenu={classAction.stmt ? classActionMenu(group, classAction.id) : undefined}
                  title="Applies to every member. Double-click to jump to the code, right-click for more"
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
        {!folded && <ul className="member-list">{group.members.map((m) => renderObject(m, true))}</ul>}
      </li>
    )
  }

  return (
    <div className="objects">
      {objects.length === 0 ? (
        <div className="empty" onContextMenu={blankMenu}>
          {project ? 'No objects yet. Turn on Add object above the preview and click where it goes, or right-click here.' : 'Open or create a project to begin.'}
        </div>
      ) : (
        <>
          <div className="objects-tools">
            <div className="objects-tools-row">
              <input className="objects-search" type="search" placeholder="Search" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search objects" title="Objects whose name, kind, class, or animations contain this" />
              {foldable.length > 0 && (
                <button className="small" onClick={() => setAllCollapsed('objects', anyExpanded ? foldable : null)} title={anyExpanded ? 'Fold every section, class, and action list' : 'Unfold everything'}>
                  {anyExpanded ? 'Collapse all' : 'Expand all'}
                </button>
              )}
            </div>
            <div className="objects-tools-row">
              <span className="dim" title="Only what is active at the playhead">Active:</span>
              <button className={`small${activeOnly ? ' on' : ''}`} onClick={() => setActiveOnly(!activeOnly)} title={activeOnly ? 'Listing only the objects on screen at the playhead. Click to list every object; the ones not on screen are dimmed.' : 'Listing every object, the ones not on screen at the playhead dimmed. Click to list only the ones on screen.'} aria-pressed={activeOnly}>
                objects
              </button>
              <button className={`small${activeAnimations ? ' on' : ''}`} onClick={() => setActiveAnimations(!activeAnimations)} title={activeAnimations ? 'Listing only the animations running at the playhead. Click to list every animation.' : 'Listing every animation. Click to list only the ones running at the playhead.'} aria-pressed={activeAnimations}>
                animations
              </button>
              <span className="dim count">
                {objects.length} {objects.length === 1 ? 'object' : 'objects'}
                {selection.length > 1 ? `, ${selection.length} selected` : ''}
              </span>
            </div>
          </div>
          <ul className="object-list" onContextMenu={blankMenu}>
            {groups.filter((g) => g.members.some(shown)).map(renderClass)}
            {types
              .filter((group) => group.objects.some(shown))
              .map((group) => {
                const key = `type:${group.className}`
                const folded = !!collapsed[key]
                const count = group.objects.filter(shown).length
                return (
                  <li key={group.className} className="group">
                    <div className="group-head dim" onClick={() => toggleCollapsed('objects', key)} title={folded ? 'Show these' : 'Hide these'}>
                      <button className={`chevron${folded ? '' : ' open'}`} onClick={(e) => { e.stopPropagation(); toggleCollapsed('objects', key) }} aria-label={folded ? 'Show these' : 'Hide these'} aria-expanded={!folded} />
                      {group.className} <span className="mono">{count}</span>
                    </div>
                    {!folded && <ul className="type-list">{group.objects.map((obj) => renderObject(obj, false))}</ul>}
                  </li>
                )
              })}
            {(q || activeOnly) && !objects.some(shown) && <li className="empty dim">Nothing matches.</li>}
          </ul>
        </>
      )}
    </div>
  )
}
