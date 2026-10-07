import { newProject, pickProject } from '../project/controller'
import { jumpToObject } from '../project/operations'
import { useStore } from '../state/store'

const GLYPHS: Record<string, string> = { Rect: '▭', Circle: '○', Text: 'T' }

/** The project and its objects. Click selects, double-click jumps to the code. */
export function ObjectPane() {
  const project = useStore((s) => s.project)
  const model = useStore((s) => s.model)
  const selection = useStore((s) => s.selection)
  const select = useStore((s) => s.select)
  const objects = model?.objects ?? []

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
          {objects.map((obj) => (
            <li
              key={obj.name}
              className={selection.includes(obj.name) ? 'selected' : ''}
              onClick={() => select([obj.name])}
              onDoubleClick={() => jumpToObject(obj.name)}
              title="Double-click to jump to the code"
            >
              <span className="glyph">{GLYPHS[obj.className] ?? '?'}</span>
              <span className="name">{obj.name}</span>
              <span className="dim">{obj.className}</span>
              {obj.codeDriven && <span className="badge">code</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
