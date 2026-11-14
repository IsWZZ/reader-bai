import type { Paper } from '@renderer/types'

/**
 * 书库检索只匹配已加载的元数据（标题和原始文件名），不做 PDF 全文索引。
 * 空查询返回原数组，方便调用方直接用于分组。
 */
export const filterPapers = (papers: Paper[], query: string): Paper[] => {
  const keyword = query.trim().toLowerCase()
  if (!keyword) return papers
  return papers.filter(
    (paper) =>
      paper.title.toLowerCase().includes(keyword) || paper.fileName.toLowerCase().includes(keyword)
  )
}
