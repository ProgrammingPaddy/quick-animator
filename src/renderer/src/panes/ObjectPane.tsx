import type { MouseEvent as ReactMouseEvent } from 'react'
import { showMenu } from '../components/ContextMenu'
import { VERB_COLORS } from '../model/registry'
import type { Action, SceneObject } from '../model/types'
import { newProject, pickProject } from '../project/controller'
import { deleteAction, deleteObjects, jumpToAction, jumpToObject } from '../project/operations'
import { useStore } from '../state/store'
import { timecode } from '../state/time'

const GLYPHS: Record<string, string> = { Rect: '▭', Circle: '○', Text: 'T' }

/**
 * The project, its objects, and under each object its actions. Click selects, double-click
 * jumps to the code, right-click for more.
 */
export function ObjectPane() {
  const project = useStore((s) => s.project)
  const model = useStore((s) => s.model)
  const fps = useStore((s) => s.settings.fps)
  const selection = useStore((s) => s.selection)
  const selectedAction = useStore((s) => s.selectedAction)
  const select = useStore((s) => s.select)
  const selectAction = useStore((s) => s.selectAction)
  const objects = model?.objects ?? []

  const objectMenu = (obj: SceneObject) => (e: ReactMouseEvent) => {
    select([obj.name])
    showMenu(e, [
      { label: 'Jump to code', run: () => jumpToObject(obj.name) },
      { label: 'Delete object', run: () => deleteObjects([obj.name]), danger: true },
    ])
  }

  const actionMenu = (obj: SceneObject, index: number) => (e: ReactMouseEvent) => {
    e.stopPropagation()
    selectAction(obj.name, index)
    showMenu(e, [
      { label: 'Jump to code', run: () => jumpToAction(obj.name, index) },
      { label: 'Delete action', run: () => deleteAction(obj.name, index), danger: true },
    ])
  }

  const actionLabel = (action: Action): string => {
    const what = action.verb === 'to' ? Object.keys(action.changes).join(', ') || 'to' : action.verb
    return action.timing.relative ? `${what} (relative)` : what
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
      </div>
      {objects.length === 0 ? (
        <div className="empty">{project ? 'No objects yet. Pick Rect, Circle, or Text above the preview, then click where it goes.' : 'Open or create a project to begin.'}</div>
      ) : (
        <ul className="object-list">
          {objects.map((obj) => {
            const selected = selection.includes(obj.name) && !selectedAction
            return (
              <li key={obj.name} className={`object${selected ? ' selected' : ''}`}>
                <div
                  className="object-row"
                  onClick={() => select([obj.name])}
                  onDoubleClick={() => jumpToObject(obj.name)}
                  onContextMenu={objectMenu(obj)}
                  title="Double-click to jump to the code, right-click for more"
                >
                  <span className="glyph">{GLYPHS[obj.className] ?? '?'}</span>
                  <span className="name">{obj.name}</span>
                  <span className="dim">{obj.className}</span>
                  {obj.codeDriven && <span className="badge">code</span>}
                </div>
                {obj.actions.length > 0 && (
                  <ul className="action-list">
                    {obj.actions.map((action, index) => {
                      const isSelected = selectedAction?.object === obj.name && selectedAction.index === index
                      return (
                        <li
                          key={action.id}
                          className={`action-row${isSelected ? ' selected' : ''}`}
                          onClick={() => selectAction(obj.name, index)}
                          onDoubleClick={() => jumpToAction(obj.name, index)}
                          onContextMenu={action.stmt ? actionMenu(obj, index) : undefined}
                          title="Double-click to jump to the code, right-click for more"
                        >
                          <span className="dot" style={{ background: VERB_COLORS[action.verb] }} />
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
          })}
        </ul>
      )}
    </div>
  )
}
