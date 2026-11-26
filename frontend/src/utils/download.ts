/** 浏览器端文件下载工具。 */

/**
 * 触发浏览器下载：把文本内容包装为 Blob，通过临时 <a> 点击完成，
 * 随后立即释放对象 URL，避免内存泄漏。
 *
 * @param filename 保存到本地的文件名（建议含扩展名）
 * @param content 文件文本内容
 * @param mimeType MIME 类型，默认 UTF-8 Markdown
 */
export function downloadFile(
  filename: string,
  content: string,
  mimeType: string = 'text/markdown;charset=utf-8',
): void {
  const blob = new Blob([content], { type: mimeType })
  const url = URL.createObjectURL(blob)

  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()

  URL.revokeObjectURL(url)
}

/**
 * 生成规范的文档文件名：<产品slug>-<类型>-<日期>.md
 * 对产品名做了文件系统非法字符清洗，缺失时退化为 doc。
 */
export function buildDocFilename(
  docLabel: string,
  productName?: string,
): string {
  const rawSlug = (productName ?? '').trim()
  const slug =
    rawSlug
      .replace(/[\\/:*?"<>|]+/g, '') // Windows / 类 Unix 非法字符
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .toLowerCase() || 'doc'

  const date = new Date().toISOString().slice(0, 10) // YYYY-MM-DD
  return `${slug}-${docLabel}-${date}.md`
}
