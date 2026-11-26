import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { Loader2, SendHorizontal } from 'lucide-react'

interface ChatInputProps {
  /** 回车（无 Shift）发送，参数为去除首尾空白后的文本 */
  onSend: (message: string) => void
  /** 生成中：禁用输入与发送按钮 */
  loading?: boolean
  placeholder?: string
}

const MAX_TEXTAREA_HEIGHT = 200 // 超过该高度后出现内部滚动，而不是无限增高

export default function ChatInput({
  onSend,
  loading = false,
  placeholder = '输入你的回答，Enter 发送，Shift+Enter 换行',
}: ChatInputProps) {
  const [value, setValue] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // 内容变化时高度自适应：先收回到最小，再按 scrollHeight 撑开
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, MAX_TEXTAREA_HEIGHT)}px`
  }, [value])

  const send = () => {
    const trimmed = value.trim()
    if (!trimmed || loading) return
    onSend(trimmed)
    setValue('') // 发送后清空（height 的 effect 会随之收回单行高度）
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // 中文输入法组合期间（如选词按 Enter）不触发发送
    if (e.nativeEvent.isComposing) return
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send()
    }
  }

  const canSend = value.trim().length > 0 && !loading

  return (
    <div className="flex items-end gap-2 rounded-xl border border-slate-300 bg-white p-2 transition focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20">
      <textarea
        ref={textareaRef}
        rows={1}
        value={value}
        disabled={loading}
        placeholder={placeholder}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        className="max-h-[200px] flex-1 resize-none bg-transparent px-2 py-1.5 text-sm text-slate-800 outline-none placeholder:text-slate-400 disabled:cursor-not-allowed disabled:opacity-60"
      />

      <button
        type="button"
        onClick={send}
        disabled={!canSend}
        aria-label="发送"
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary text-white transition hover:bg-primary-600 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400"
      >
        {loading ? <Loader2 size={16} className="animate-spin" /> : <SendHorizontal size={16} />}
      </button>
    </div>
  )
}
