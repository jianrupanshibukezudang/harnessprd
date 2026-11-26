import { useEffect, useRef } from 'react'
import ReactMarkdown from 'react-markdown'
import { Bot, User } from 'lucide-react'
import type { ChatMessage } from '../types'

interface MessageListProps {
  messages: ChatMessage[]
  /** true 时 AI 回复进行中，可在最后一条 AI 消息后展示打字光标 */
  streaming?: boolean
}

export default function MessageList({ messages, streaming = false }: MessageListProps) {
  // 隐藏 system 消息（角色设定不应暴露给用户）
  const visible = messages.filter((m) => m.role !== 'system')

  const bottomRef = useRef<HTMLDivElement>(null)

  // 消息内容变化时自动滚动到底部（流式逐字追加也会持续跟随）
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages, streaming])

  if (visible.length === 0) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center text-sm text-slate-400">
        AI 产品经理正在等待开始，请先在下方查看对话…
      </div>
    )
  }

  return (
    <div className="space-y-6 px-1 py-2">
      {visible.map((message, index) => {
        const isUser = message.role === 'user'
        const isLast = index === visible.length - 1

        return (
          <div
            key={index}
            className={`flex gap-3 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}
          >
            {/* 头像 */}
            <div
              className={[
                'flex h-8 w-8 shrink-0 items-center justify-center rounded-full',
                isUser ? 'bg-slate-700 text-white' : 'bg-primary text-white',
              ].join(' ')}
            >
              {isUser ? <User size={16} /> : <Bot size={16} />}
            </div>

            {/* 消息体 */}
            <div
              className={[
                'max-w-[78%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed',
                isUser
                  ? 'bg-primary text-white'
                  : 'border border-slate-200 bg-white text-slate-800',
              ].join(' ')}
            >
              {isUser ? (
                // 用户消息按纯文本展示，保留换行
                <p className="whitespace-pre-wrap">{message.content}</p>
              ) : (
                <div className="markdown-body">
                  <ReactMarkdown
                    components={{
                      p: ({ children }) => (
                        <p className="my-1.5 first:mt-0 last:mb-0">{children}</p>
                      ),
                      ul: ({ children }) => (
                        <ul className="my-1.5 list-disc space-y-1 pl-5">{children}</ul>
                      ),
                      ol: ({ children }) => (
                        <ol className="my-1.5 list-decimal space-y-1 pl-5">{children}</ol>
                      ),
                      h1: ({ children }) => (
                        <h1 className="mb-2 mt-3 text-base font-bold first:mt-0">{children}</h1>
                      ),
                      h2: ({ children }) => (
                        <h2 className="mb-2 mt-3 text-sm font-bold first:mt-0">{children}</h2>
                      ),
                      h3: ({ children }) => (
                        <h3 className="mb-1 mt-2 text-sm font-semibold first:mt-0">{children}</h3>
                      ),
                      code: ({ children, className }) =>
                        className ? (
                          <code className={className}>{children}</code>
                        ) : (
                          <code className="rounded bg-slate-100 px-1 py-0.5 text-[0.8em] text-pink-600">
                            {children}
                          </code>
                        ),
                      pre: ({ children }) => (
                        <pre className="my-2 overflow-x-auto rounded-lg bg-slate-900 p-3 text-xs text-slate-100">
                          {children}
                        </pre>
                      ),
                      a: ({ children, href }) => (
                        <a href={href} className="text-primary-600 underline" target="_blank" rel="noreferrer">
                          {children}
                        </a>
                      ),
                    }}
                  >
                    {message.content}
                  </ReactMarkdown>

                  {/* 流式打字光标：最后一条 AI 消息且生成中 */}
                  {streaming && isLast && (
                    <span className="ml-0.5 inline-block h-4 w-[2px] animate-pulse bg-primary align-middle" />
                  )}
                </div>
              )}
            </div>
          </div>
        )
      })}

      <div ref={bottomRef} />
    </div>
  )
}
