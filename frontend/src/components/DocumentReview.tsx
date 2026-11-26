import { useState } from 'react'
import type { FormEvent } from 'react'
import ReactMarkdown from 'react-markdown'
import {
  Check,
  Copy,
  FileText,
  Loader2,
  Wand2,
  X,
} from 'lucide-react'

export type DocumentStatus = 'generating' | 'ready'

/** 底部自定义操作按钮（如"生成接口文档""重新生成"）。 */
export interface DocumentAction {
  key: string
  label: string
  variant?: 'primary' | 'secondary'
  disabled?: boolean
  onClick: () => void
}

interface DocumentReviewProps {
  /** 文档标题 */
  title: string
  /** 生成状态：generating=只读流式预览，ready=可编辑 */
  status: DocumentStatus
  /** 已定版的文档内容（ready 时编辑它） */
  content: string
  /** 生成中的实时文本 */
  streamingContent?: string
  /** 编辑内容变化（ready 状态 textarea） */
  onContentChange?: (content: string) => void
  /** 发起 AI 优化，参数为用户填写的优化要求；不传则不显示优化入口 */
  onOptimize?: (instruction: string) => void
  /** 底部自定义操作按钮 */
  actions?: DocumentAction[]
}

export default function DocumentReview({
  title,
  status,
  content,
  streamingContent = '',
  onContentChange,
  onOptimize,
  actions = [],
}: DocumentReviewProps) {
  const [copied, setCopied] = useState(false)
  const [showOptimize, setShowOptimize] = useState(false)
  const [instruction, setInstruction] = useState('')

  const isGenerating = status === 'generating'
  const displayText = isGenerating ? streamingContent : content

  /** 一键复制：优先 Clipboard API，非安全上下文降级到 execCommand。 */
  const handleCopy = async () => {
    if (!displayText) return
    try {
      await navigator.clipboard.writeText(displayText)
    } catch {
      const textarea = document.createElement('textarea')
      textarea.value = displayText
      textarea.style.position = 'fixed'
      textarea.style.opacity = '0'
      document.body.appendChild(textarea)
      textarea.select()
      document.execCommand('copy')
      textarea.remove()
    }
    setCopied(true)
    window.setTimeout(() => setCopied(false), 2000)
  }

  const submitOptimize = (e: FormEvent) => {
    e.preventDefault()
    const trimmed = instruction.trim()
    if (!trimmed || isGenerating || !onOptimize) return
    onOptimize(trimmed)
    setInstruction('')
    setShowOptimize(false)
  }

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      {/* 头部：标题 + 状态 + 工具按钮 */}
      <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-5 py-3.5">
        <div className="flex min-w-0 items-center gap-2">
          <FileText size={17} className="shrink-0 text-primary-600" />
          <h2 className="truncate text-sm font-semibold text-slate-900">{title}</h2>
          <span
            className={[
              'ml-1 inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium',
              isGenerating
                ? 'bg-primary-50 text-primary-700'
                : 'bg-green-50 text-green-700',
            ].join(' ')}
          >
            {isGenerating && <Loader2 size={11} className="animate-spin" />}
            {isGenerating ? '生成中' : '已生成'}
          </span>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          {onOptimize && (
            <button
              type="button"
              disabled={isGenerating}
              onClick={() => setShowOptimize((v) => !v)}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Wand2 size={13} />
              AI 优化
            </button>
          )}
          <button
            type="button"
            onClick={handleCopy}
            disabled={!displayText}
            className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {copied ? (
              <>
                <Check size={13} className="text-green-600" />
                已复制
              </>
            ) : (
              <>
                <Copy size={13} />
                复制
              </>
            )}
          </button>
        </div>
      </div>

      {/* AI 优化指令输入（展开时） */}
      {showOptimize && onOptimize && (
        <form
          onSubmit={submitOptimize}
          className="flex items-center gap-2 border-b border-slate-200 bg-slate-50 px-5 py-3"
        >
          <input
            type="text"
            value={instruction}
            autoFocus
            onChange={(e) => setInstruction(e.target.value)}
            placeholder="描述优化要求，如：让功能优先级更清晰、补充验收标准…"
            className="flex-1 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-800 outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
          />
          <button
            type="submit"
            disabled={!instruction.trim() || isGenerating}
            className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-white transition hover:bg-primary-600 disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            开始优化
          </button>
          <button
            type="button"
            onClick={() => setShowOptimize(false)}
            className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-200 hover:text-slate-600"
            aria-label="取消"
          >
            <X size={14} />
          </button>
        </form>
      )}

      {/* 正文 */}
      <div className="p-5">
        {isGenerating ? (
          // 生成中：只读 Markdown 实时预览（局部 Markdown 也能渐进渲染）
          <div className="min-h-[40vh] rounded-lg border border-slate-200 bg-slate-50/60 p-4 text-sm leading-relaxed text-slate-800">
            {streamingContent ? (
              <>
                <ReactMarkdown
                  components={{
                    p: ({ children }) => <p className="my-1.5 first:mt-0 last:mb-0">{children}</p>,
                    ul: ({ children }) => <ul className="my-1.5 list-disc space-y-1 pl-5">{children}</ul>,
                    ol: ({ children }) => <ol className="my-1.5 list-decimal space-y-1 pl-5">{children}</ol>,
                    pre: ({ children }) => (
                      <pre className="my-2 overflow-x-auto rounded-lg bg-slate-900 p-3 text-xs text-slate-100">{children}</pre>
                    ),
                    code: ({ children, className }) =>
                      className ? (
                        <code className={className}>{children}</code>
                      ) : (
                        <code className="rounded bg-slate-200 px-1 py-0.5 text-[0.8em] text-pink-600">{children}</code>
                      ),
                  }}
                >
                  {streamingContent}
                </ReactMarkdown>
                <span className="ml-0.5 inline-block h-4 w-[2px] animate-pulse bg-primary align-middle" />
              </>
            ) : (
              <div className="flex h-[40vh] items-center justify-center gap-2 text-slate-400">
                <Loader2 size={16} className="animate-spin text-primary" />
                正在准备内容…
              </div>
            )}
          </div>
        ) : (
          // 生成后：可编辑 Markdown 源码
          <textarea
            value={content}
            spellCheck={false}
            onChange={(e) => onContentChange?.(e.target.value)}
            placeholder="文档内容为空…"
            className="h-[52vh] w-full resize-y rounded-lg border border-slate-300 bg-white p-4 font-mono text-[13px] leading-relaxed text-slate-800 outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
          />
        )}
      </div>

      {/* 底部自定义操作 */}
      {actions.length > 0 && (
        <div className="flex items-center justify-end gap-2 border-t border-slate-200 bg-slate-50 px-5 py-3">
          {actions.map((action) => (
            <button
              key={action.key}
              type="button"
              disabled={isGenerating || action.disabled}
              onClick={action.onClick}
              className={[
                'rounded-lg px-4 py-1.5 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-50',
                action.variant === 'primary'
                  ? 'bg-primary text-white hover:bg-primary-600'
                  : 'border border-slate-300 bg-white text-slate-600 hover:bg-slate-50',
              ].join(' ')}
            >
              {action.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
