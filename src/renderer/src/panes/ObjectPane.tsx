import { useMemo, type MouseEvent as ReactMouseEvent } from 'react'
import { showMenu } from '../components/ContextMenu'
import { actionIdents, classActionIdents, classGroups, classKey, classSpan, overrideOf, typeGroups, type ClassGroup } from '../model/groups'
import { VERB_COLORS } from '../model/registry'
import type { Action, SceneObject } from '../model/types'
import { addObject, deleteAction, deleteClassAction, deleteObjects, duplicateObjects, jumpToAction, jumpToClass, jumpToObject, materializeClassAction, overrideClassAction, removeFromClass, requestClasses, requestRename, selectClass, selectClassAction } from '../project/operations'
import { isActionSelected, useStore, type Tool } from '../state/store'
import { timecode } from '../state/time'

const GLYPHS: Record<string, string> = { Rect: '▭', Circle: '○', Text: 'T' }
const TOOLS: Exclude<Tool, 'select'>[] = ['Rect', 'Circle', 'Text']

function actionLabel(action: Action): string {
  const what = action.verb === 'to' ? Object.keys(action.changes).join(', ') || 'to' : action.verb
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
  const foldable = [...objects.filter((o) => o.actions.length > 0).map((o) => o.name), ...groups.map((g) => classKey(g.className))]
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
    showMenu(e, [
      { label: 'Jump to code', run: () => jumpToObject(obj.name) },
      ...(many ? [] : [{ label: 'Rename…', run: () => requestRename({ object: obj.name }) }]),
      { label: 'Classes…', run: () => requestClasses(targets) },
      { label: many ? `Duplicate ${targets.length} objects` : 'Duplicate', run: () => duplicateObjects(targets) },
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
      { label: action?.name ? 'Rename…' : 'Name…', run: () => requestRename({ object: obj.name, index }) },
      { label: 'Delete action', run: () => deleteAction(obj.name, index), danger: true },
    ])
  }

  const classMenu = (group: ClassGroup) => (e: ReactMouseEvent) => {
    e.stopPropagation()
    selectClass(group.className)
    showMenu(e, [
      { label: 'Jump to code', run: () => jumpToClass(group.className) },
      { label: 'Select members', run: () => selectClass(group.className) },
    ])
  }

  const classActionMenu = (group: ClassGroup, id: number) => (e: ReactMouseEvent) => {
    e.stopPropagation()
    const classAction = group.actions.find((a) => a.id === id)
    if (!classAction) return
    selectClassAction(classAction)
    showMenu(e, [
      { label: 'Jump to code', run: () => jumpToClass(group.className) },
      { label: classAction.name ? 'Rename…' : 'Name…', run: () => requestRename({ classAction: id }) },
      { label: 'Delete for every member', run: () => deleteClassAction(id), danger: true },
    ])
  }

  /** Right-click on empty space: add an object at the frame center. */
  const blankMenu = (e: ReactMouseEvent) => {
    if (!(e.target instanceof Element) || !e.target.matches('.object-list, .empty, .group-head')) return
    showMenu(
      e,
      TOOLS.map((t) => ({ label: 'Add', keyword: t, run: () => addObject(t, 0, 0) })),
    )
  }

  const renderObject = (obj: SceneObject, member: boolean) => {
    const selected = selection.includes(obj.name) && selectedActions.length === 0
    const folded = !!collapsed[obj.name]
    return (
      <li key={`${member ? 'm:' : ''}${obj.name}`} className={`object${selected ? ' selected' : ''}${member ? ' member' : ''}`}>
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
          {obj.codeDriven && <span className="badge">code</span>}
        </div>
        {obj.actions.length > 0 && !folded && (
          <ul className="action-list">
            {obj.actions.map((action, index) => {
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
          {project ? 'No objects yet. Pick Rect, Circle, or Text above the preview and click where it goes, or right-click here.' : 'Open or create a project to begin.'}
        </div>
      ) : (
        <>
          <div className="objects-tools">
            <span className="dim">
              {objects.length} {objects.length === 1 ? 'object' : 'objects'}
              {selection.length > 1 ? `, ${selection.length} selected` : ''}
            </span>
            {foldable.length > 0 && (
              <button className="small" onClick={() => setAllCollapsed('objects', anyExpanded ? foldable : null)} title={anyExpanded ? 'Hide every action list' : 'Show every action list'}>
                {anyExpanded ? 'Collapse all' : 'Expand all'}
              </button>
            )}
          </div>
          <ul className="object-list" onContextMenu={blankMenu}>
            {groups.map(renderClass)}
            {types.map((group) => (
              <li key={group.className} className="group">
                <div className="group-head dim">
                  {group.className} <span className="mono">{group.objects.length}</span>
                </div>
                <ul className="type-list">{group.objects.map((obj) => renderObject(obj, false))}</ul>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}
