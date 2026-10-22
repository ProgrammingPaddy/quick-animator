/** The slice of opentype.js this app reads: a font's names and metrics, and the path of a run of text (D273). */
declare module 'opentype.js' {
  export interface PathCommand {
    type: 'M' | 'L' | 'C' | 'Q' | 'Z'
    x?: number
    y?: number
    x1?: number
    y1?: number
    x2?: number
    y2?: number
  }
  export interface Path {
    commands: PathCommand[]
    toPathData(decimals?: number): string
  }
  export interface Font {
    names: Record<string, Record<string, Record<string, string> | undefined> | undefined>
    unitsPerEm: number
    ascender: number
    descender: number
    getPath(text: string, x: number, y: number, fontSize: number, options?: { kerning?: boolean; letterSpacing?: number }): Path
  }
  export function parse(buffer: ArrayBuffer, options?: { lowMemory?: boolean }): Font
}
