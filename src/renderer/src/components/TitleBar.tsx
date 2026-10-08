import { editorRedo, editorUndo } from '../code/editor'
import { newProject, pickProject } from '../project/controller'
import { useStore } from '../state/store'

/**
 * The top of the window, in place of the system title bar and the menu (D108): the app's own
 * few actions on the left, the app and project names in the middle, and room on the right for
 * the system's window controls. The bar drags the window; its buttons do not.
 */
export function TitleBar() {
  const project = useStore((s) => s.project)
  const setHelp = useStore((s) => s.setHelp)
  return (
    <div className="titlebar">
      <div className="titlebar-actions">
        {window.api && (
          <>
            <button onClick={() => void pickProject()} title="Open a project folder: the folder that holds project.json">
              Open
            </button>
            <button onClick={() => void newProject()} title="Create a project folder">
              New
            </button>
          </>
        )}
        <button onClick={editorUndo} title="Undo (Ctrl+Z)">
          Undo
        </button>
        <button onClick={editorRedo} title="Redo (Ctrl+Y)">
          Redo
        </button>
        <button onClick={() => setHelp(true)} title="Help (F1)">
          Help
        </button>
      </div>
      <div className="titlebar-title" title={project?.path}>
        <span className="app-name">Quick Animator</span>
        {project && <span className="separator">{'·'}</span>}
        {project && <span className="project-name">{project.name}</span>}
      </div>
      <div className="titlebar-spacer" />
    </div>
  )
}
