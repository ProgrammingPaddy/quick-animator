import * as acorn from 'acorn'
import type { TextEdit } from './edits'
import { CLASS_NAMES, EASE_NAMES, TIMING_KEY_NAMES, VERB_NAMES } from './registry'

const RESERVED = new Set([
  'break', 'case', 'catch', 'class', 'const', 'continue', 'debugger', 'default', 'delete', 'do', 'else', 'export', 'extends', 'finally', 'for', 'function', 'if', 'import', 'in', 'instanceof', 'let', 'new', 'return', 'super', 'switch', 'this', 'throw', 'try', 'typeof', 'var', 'void', 'while', 'with', 'yield', 'await', 'enum', 'null', 'true', 'false', 'undefined', 'NaN', 'Infinity',
])

/** Why a name cannot be used, or null when it can. */
export function nameProblem(name: string, taken: ReadonlySet<string>): string | null {
  if (!/^[A-Za-z_$][\w$]*$/.test(name)) return 'Use letters, digits, and underscores, starting with a letter.'
  if (RESERVED.has(name)) return `"${name}" is a JavaScript word.`
  if (CLASS_NAMES.has(name) || VERB_NAMES.has(name) || TIMING_KEY_NAMES.has(name) || (EASE_NAMES as readonly string[]).includes(name)) return `"${name}" is part of the animation language.`
  if (taken.has(name)) return `"${name}" is already used.`
  return null
}

/**
 * Edits that replace every use of an identifier, by tokenizing the code: a `box` that is a
 * property after a dot, as in `other.box`, is left alone, and so are strings and comments.
 */
export function identifierEdits(source: string, renames: Record<string, string>): TextEdit[] {
  const edits: TextEdit[] = []
  let previous: acorn.Token | null = null
  try {
    for (const token of acorn.tokenizer(source, { ecmaVersion: 2022 })) {
      // Tokens carry their text in `value`, which acorn's types leave out.
      const value = (token as unknown as { value?: unknown }).value
      const replacement = token.type.label === 'name' && typeof value === 'string' ? renames[value] : undefined
      if (replacement !== undefined && previous?.type.label !== '.') edits.push({ from: token.start, to: token.end, insert: replacement })
      previous = token
    }
  } catch {
    // Unparseable text: rename what we found so far.
  }
  return edits
}

/** The text with every use of the given identifiers replaced. */
export function replaceIdentifiers(text: string, renames: Record<string, string>): string {
  let out = text
  for (const edit of identifierEdits(text, renames).sort((a, b) => b.from - a.from)) out = out.slice(0, edit.from) + edit.insert + out.slice(edit.to)
  return out
}
