import type { Point } from '../model/sample'

/**
 * Where a dragged preset can land (D219). The panes register how to read a pointer position:
 * the preview as a place in the scene and the object under it, the timeline as the object
 * whose clip is there and the time, snapped as the playhead snaps. Nothing is registered until
 * the pane has mounted.
 */
export interface DropTargets {
  /** A place in the scene, the object drawn there, and how big a scene pixel is on the screen, for a ghost drawn to scale (D222). */
  preview?: (clientX: number, clientY: number) => { inside: boolean; world: Point; hit: string | null; zoom: number }
  /** The middle of the camera's view, in the scene: where an object dropped on the timeline goes. */
  previewCenter?: () => Point
  timeline?: (clientX: number, clientY: number) => { inside: boolean; object: string | null; time: number; pps: number }
}

export const dropTargets: DropTargets = {}
