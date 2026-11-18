export interface Category {
  id: string
  name: string
  color: string
  createdAt: number
  updatedAt: number
}

export interface Prompt {
  id: string
  title: string
  summary: string
  content: string
  categoryId: string
  createdAt: number
  updatedAt: number
  deletedAt: number | null
  filePath?: string
}

export interface Workspace {
  categories: Category[]
  prompts: Prompt[]
}

export interface DocAsset {
  path: string
  name: string
  kind: 'image' | 'file'
  size: number
  updatedAt: number
}
