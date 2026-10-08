import type { MouseEvent as ReactMouseEvent } from 'react'
import { showMenu } from '../components/ContextMenu'
import { classGroups, classKey, classSpan, typeGroups, unclassed, type ClassGroup } from '../model/groups'
import { VERB_COLORS } from '../model/registry'
import type { Action, SceneObject } from '../model/types'
import { newProject, pickProject } from '../project/controller'
import { addObject, deleteAction, deleteClassAction, deleteObjects, duplicateObject, jumpToAction, jumpToClass, jumpToObject, materializeClassAction, removeFromClass, requestClasses, requestRename, selectClass, selectClassAction } from '../project/operations'
import { useStore, type Tool } from '../state/store'
import { timecode } from '../state/time'

const GLYPHS: Record<string, string> = { Rect: '▭', Circle: '○', Text: 'T' }
const TOOLS: Exclude<Tool, 'select'>[] = ['Rect', 'Circle', 'Text']

function actionLabel(action: Action): string {
  const what = action.verb === 'to' ? Object.keys(action.changes).join(', ') || 'to' : action.verb
  return action.timing.relative ? `${what} (relative)` : what
}

/**
 * The project, then its objects: class groups first, with the class's actions and its members
 * beneath, then the rest grouped by type (D80, D84). Each object folds its actions away; one
 * button folds or unfolds everything. Click selects, double-click jumps to the code, right-click
 * for more, and a right-click on empty space adds an object.
 */
export function ObjectPane() {
  const project = useStore((s) => s.project)
  const model = useStore((s) => s.model)
  const fps = useStore((s) => s.settings.fps)
  const selection = useStore((s) => s.selection)
  const selectedAction = useStore((s) => s.selectedAction)
  const collapsed = useStore((s) => s.collapsed)
  const select = useStore((s) => s.select)
  const selectAction = useStore((s) => s.selectAction)
  const toggleCollapsed = useStore((s) => s.toggleCollapsed)
  const setAllCollapsed = useStore((s) => s.setAllCollapsed)
  const setHelp = useStore((s) => s.setHelp)
  const objects = model?.objects ?? []
  const groups = model ? classGroups(model) : []
  const rest = model ? typeGroups(unclassed(model)) : []
  const foldable = [...objects.filter((o) => o.actions.length > 0).map((o) => o.name), ...groups.map((g) => classKey(g.className))]
  const anyExpanded = foldable.some((key) => !collapsed[key])
  const selectedActionRef = selectedAction && model ? model.objects.find((o) => o.name === selectedAction.object)?.actions[selectedAction.index] : undefined

  const objectMenu = (obj: SceneObject) => (e: ReactMouseEvent) => {
    e.stopPropagation()
    select([obj.name])
    showMenu(e, [
      { label: 'Jump to code', run: () => jumpToObject(obj.name) },
      { label: 'Rename…', run: () => requestRename({ object: obj.name }) },
      { label: 'Classes…', run: () => requestClasses(obj.name) },
      { label: 'Duplicate', run: () => duplicateObject(obj.name) },
      { label: 'Delete object', run: () => deleteObjects([obj.name]), danger: true },
    ])
  }

  const actionMenu = (obj: SceneObject, index: number) => (e: ReactMouseEvent) => {
    e.stopPropagation()
    selectAction(obj.name, index)
    const action = obj.actions[index]
    if (action?.classAction) {
      const className = action.classAction.className
      showMenu(e, [
        { label: 'Jump to class code', run: () => jumpToAction(obj.name, index) },
        { label: 'Edit for this object only', run: () => materializeClassAction(obj.name, index) },
        { label: `Remove ${obj.name} from ${className}`, run: () => removeFromClass(obj.name, className) },
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
      TOOLS.map((t) => ({ label: `Add ${t}`, run: () => addObject(t, 0, 0) })),
    )
  }

  const renderObject = (obj: SceneObject, member: boolean) => {
    const selected = selection.includes(obj.name) && !selectedAction
    const folded = !!collapsed[obj.name]
    return (
      <li key={obj.name} className={`object${selected ? ' selected' : ''}${member ? ' member' : ''}`}>
        <div className="object-row" onClick={() => select([obj.name])} onDoubleClick={() => jumpToObject(obj.name)} onContextMenu={objectMenu(obj)} title="Double-click to jump to the code, right-click for more">
          {obj.actions.length > 0 ? (
            <button
              className={`chevron${folded ? '' : ' open'}`}
              onClick={(e) => {
                e.stopPropagation()
                toggleCollapsed(obj.name)
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
              const isSelected = selectedAction?.object === obj.name && selectedAction.index === index
              return (
                <li
                  key={action.id}
                  className={`action-row${isSelected ? ' selected' : ''}${action.classAction ? ' derived' : ''}`}
                  onClick={() => selectAction(obj.name, index)}
                  onDoubleClick={() => jumpToAction(obj.name, index)}
                  onContextMenu={action.stmt ? actionMenu(obj, index) : undefined}
                  title={action.classAction ? `From all('${action.classAction.className}'). Right-click to edit it for this object only.` : 'Double-click to jump to the code, right-click for more'}
                >
                  <span className="dot" style={{ background: VERB_COLORS[action.verb] }} />
                  {action.classAction && <span className="ident">{action.classAction.className}</span>}
                  {action.name && <span className="ident">{action.name}</span>}
                  <span className="name">{actionLabel(action)}</span>
                  <span className="dim mono">{timecode(action.start, fps)}</span>
                  {action.codeDriven && <span className="badge">code</span>}
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
    const allSelected = group.members.length > 0 && group.members.every((m) => selection.includes(m.name)) && !selectedAction
    return (
      <li key={key} className={`group class-group${allSelected ? ' selected' : ''}`}>
        <div className="object-row class-row" onClick={() => selectClass(group.className)} onDoubleClick={() => jumpToClass(group.className)} onContextMenu={classMenu(group)} title="Click to select every member, double-click to jump to the code">
          <button
            className={`chevron${folded ? '' : ' open'}`}
            onClick={(e) => {
              e.stopPropagation()
              toggleCollapsed(key)
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
              const isSelected = selectedActionRef?.classAction === classAction
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
                  <span className="ident">all</span>
                  {classAction.name && <span className="ident">{classAction.name}</span>}
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
      <div className="project-bar">
        <span className="project-name" title={project?.path}>
          {project ? project.name : 'No project'}
        </span>
        {window.api && (
          <>
            <button className="small" onClick={() => void pickProject()} title="Open a project folder">
              Open
            </button>
            <button className="small" onClick={() => void newProject()} title="Create a project folder">
              New
            </button>
          </>
        )}
        <button className="small" onClick={() => setHelp(true)} title="Help (F1)" aria-label="Help">
          ?
        </button>
      </div>
      {objects.length === 0 ? (
        <div className="empty" onContextMenu={blankMenu}>
          {project ? 'No objects yet. Pick Rect, Circle, or Text above the preview and click where it goes, or right-click here.' : 'Open or create a project to begin.'}
        </div>
      ) : (
        <>
          <div className="objects-tools">
            <span className="dim">
              {objects.length} {objects.length === 1 ? 'object' : 'objects'}
            </span>
            {foldable.length > 0 && (
              <button className="small" onClick={() => setAllCollapsed(anyExpanded ? foldable : null)} title={anyExpanded ? 'Hide every action list' : 'Show every action list'}>
                {anyExpanded ? 'Collapse all' : 'Expand all'}
              </button>
            )}
          </div>
          <ul className="object-list" onContextMenu={blankMenu}>
            {groups.map(renderClass)}
            {rest.map((group) => (
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
