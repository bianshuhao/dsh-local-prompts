export interface TocEntry {
  level: number
  text: string
  line: number
  index: number
}

export interface TocNode {
  entry: TocEntry
  children: TocNode[]
}

function headingText(value: string): string {
  return value
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/[*_~`]/g, '')
    .replace(/\\([\\`*{}\[\]()#+\-.!_>])/g, '$1')
    .trim()
}

/** Extract ATX headings from Markdown, ignoring headings inside fenced code. */
export function extractToc(markdown: string): TocEntry[] {
  const lines = markdown.split('\n')
  const entries: TocEntry[] = []
  let fence: { char: string; length: number } | null = null

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    const fenceMatch = line.match(/^\s{0,3}(`{3,}|~{3,})/)
    if (fence) {
      if (fenceMatch && fenceMatch[1][0] === fence.char && fenceMatch[1].length >= fence.length) {
        fence = null
      }
      continue
    }
    if (fenceMatch) {
      fence = { char: fenceMatch[1][0], length: fenceMatch[1].length }
      continue
    }

    const match = line.match(/^\s{0,3}(#{1,6})[ \t]+(.*?)[ \t]*$/)
    if (!match) continue
    const raw = match[2].replace(/[ \t]+#+[ \t]*$/, '').trim()
    if (!raw) continue
    entries.push({
      level: match[1].length,
      text: headingText(raw) || '未命名标题',
      line: index + 1,
      index: entries.length,
    })
  }
  return entries
}

/** Build a collapsible heading tree in document order. */
export function buildTocTree(entries: TocEntry[]): TocNode[] {
  const roots: TocNode[] = []
  const stack: TocNode[] = []
  for (const entry of entries) {
    const node: TocNode = { entry, children: [] }
    while (stack.length > 0 && stack[stack.length - 1].entry.level >= entry.level) stack.pop()
    if (stack.length > 0) stack[stack.length - 1].children.push(node)
    else roots.push(node)
    stack.push(node)
  }
  return roots
}
