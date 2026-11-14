import type { Paper } from '@renderer/types'

/**
 * 书库检索只匹配已加载的元数据（标题、原始文件名和 AI 解析出的书目信息），
 * 不做 PDF 全文索引。空查询返回原数组，方便调用方直接用于分组。
 */
export const filterPapers = (papers: Paper[], query: string): Paper[] => {
  const keyword = query.trim().toLowerCase()
  if (!keyword) return papers
  return papers.filter((paper) => {
    if (paper.title.toLowerCase().includes(keyword)) return true
    if (paper.fileName.toLowerCase().includes(keyword)) return true

    const metadata = paper.metadata
    if (!metadata) return false
    const fields = [
      metadata.title,
      metadata.venue,
      metadata.doi,
      metadata.summary,
      ...metadata.authors,
      ...metadata.keywords
    ]
    return fields.some((field) => field?.toLowerCase().includes(keyword))
  })
}
