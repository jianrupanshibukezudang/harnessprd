import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeft,
  CheckCircle2,
  Download,
  FileCode2,
  FileText,
  Loader2,
  Sparkles,
  Square,
} from 'lucide-react'
import FormStep from './components/FormStep'
import MessageList from './components/MessageList'
import ChatInput from './components/ChatInput'
import DocumentReview from './components/DocumentReview'
import type { DocumentAction } from './components/DocumentReview'
import {
  continueConversationStream,
  generateApiDocsStream,
  generatePrdStream,
  generatePromptsStream,
  getQuestions,
  optimizeDocumentStream,
  startConversationStream,
} from './services/api'
import type { StreamHandlers } from './services/api'
import { buildDocFilename, downloadFile } from './utils/download'
import { STEPS } from './types'
import type { ChatMessage, QuestionsConfig, ViewState } from './types'

const SESSION_KEY = 'harnessprd:session'

/** 完整会话快照：所有会话级数据集中存为一条记录。 */
interface SessionData {
  formData: Record<string, string>
  messages: ChatMessage[]
  conversationId: string
  prdContent: string
  apiDocsContent: string
  promptsContent: string
  viewState: ViewState
}

const EMPTY_SESSION: SessionData = {
  formData: {},
  messages: [],
  conversationId: '',
  prdContent: '',
  apiDocsContent: '',
  promptsContent: '',
  viewState: 'form',
}

/** 刷新降级：被中断的 generating-* 一律归并到对应审阅态。 */
function downgradeViewState(view: ViewState): ViewState {
  switch (view) {
    case 'generating-prd':
      return 'review-prd'
    case 'generating-api-docs':
      return 'review-api-docs'
    case 'generating-prompts':
      return 'review-prompts'
    default:
      return view
  }
}

/** 保存完整会话到 localStorage（持久化为尽力而为，失败不打断使用）。 */
function saveSession(data: SessionData): void {
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(data))
  } catch {
    // 容量不足 / 隐私模式：忽略
  }
}

/** 读取会话；记录缺失、损坏或字段不全时回退默认值。 */
function loadSession(): SessionData {
  try {
    const raw = localStorage.getItem(SESSION_KEY)
    if (!raw) return EMPTY_SESSION

    const parsed = JSON.parse(raw) as Partial<SessionData>
    return {
      formData:
        parsed.formData && typeof parsed.formData === 'object'
          ? parsed.formData
          : {},
      messages: Array.isArray(parsed.messages) ? parsed.messages : [],
      conversationId: parsed.conversationId ?? '',
      prdContent: parsed.prdContent ?? '',
      apiDocsContent: parsed.apiDocsContent ?? '',
      promptsContent: parsed.promptsContent ?? '',
      viewState: downgradeViewState(
        typeof parsed.viewState === 'string'
          ? (parsed.viewState as ViewState)
          : 'form',
      ),
    }
  } catch {
    return EMPTY_SESSION
  }
}

type DocType = 'prd' | 'api' | 'prompts'

interface DocStageConfig {
  generatingView: ViewState
  reviewView: ViewState
  title: string
}

/** 文档类型 -> 生成/审阅视图与标题 */
const DOC_STAGES: Record<DocType, DocStageConfig> = {
  prd: {
    generatingView: 'generating-prd',
    reviewView: 'review-prd',
    title: 'PRD 产品需求文档',
  },
  api: {
    generatingView: 'generating-api-docs',
    reviewView: 'review-api-docs',
    title: '接口文档',
  },
  prompts: {
    generatingView: 'generating-prompts',
    reviewView: 'review-prompts',
    title: '提示词套件',
  },
}

const EMPTY_QUESTIONS: QuestionsConfig = {
  base_questions: [],
  advanced_questions: [],
}

/** 首轮时后端注入的合成消息（表单摘要）：需随历史回传，但不在 UI 展示。 */
function isSyntheticIntro(message: ChatMessage): boolean {
  return (
    message.role === 'user' &&
    message.content.trimStart().startsWith('以下是用户通过表单填写的产品信息')
  )
}

function newConversationId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  return `conv-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

/**
 * 将细粒度视图状态映射到进度条上的主步骤序号。
 * 返回值 === STEPS.length 表示全部完成（done）。
 */
function activeStepIndex(view: ViewState): number {
  switch (view) {
    case 'form':
      return 0
    case 'chatting':
      return 1
    case 'generating-prd':
    case 'review-prd':
      return 2
    case 'generating-api-docs':
    case 'review-api-docs':
      return 3
    case 'generating-prompts':
    case 'review-prompts':
      return 4
    case 'done':
      return STEPS.length
  }
}

function App() {
  // 初始化时加载一次完整会话（仅解析一次 localStorage）
  const [initialSession] = useState<SessionData>(loadSession)

  const [questions, setQuestions] = useState<QuestionsConfig>(EMPTY_QUESTIONS)
  const [formData, setFormData] = useState<Record<string, string>>(
    initialSession.formData,
  )

  // 会话级数据（messages 为后端回传的权威历史，含 system 与首轮合成摘要）
  const [messages, setMessages] = useState<ChatMessage[]>(initialSession.messages)
  const [conversationId, setConversationId] = useState<string>(
    initialSession.conversationId,
  )
  const [streamingContent, setStreamingContent] = useState('')

  // 文档内容
  const [prdContent, setPrdContent] = useState<string>(initialSession.prdContent)
  const [apiDocsContent, setApiDocsContent] = useState<string>(
    initialSession.apiDocsContent,
  )
  const [promptsContent, setPromptsContent] = useState<string>(
    initialSession.promptsContent,
  )

  // 文档生成中的瞬态数据
  const [docStreamingContent, setDocStreamingContent] = useState('')
  const [isGenerating, setIsGenerating] = useState(false)

  const [viewState, setViewState] = useState<ViewState>(initialSession.viewState)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [streamError, setStreamError] = useState<string | null>(null)

  const abortRef = useRef<AbortController | null>(null)
  // 流式文本的 ref 镜像：catch / finally 闭包中读取最终累计结果
  const streamingRef = useRef('')
  // 聊天流的显式状态
  const [isStreaming, setIsStreaming] = useState(false)

  const currentStep = activeStepIndex(viewState)

  // 获取问题配置
  useEffect(() => {
    getQuestions()
      .then((data) => {
        if (!data?.base_questions || !data?.advanced_questions) {
          throw new Error('返回的问题配置结构不正确')
        }
        setQuestions(data)
      })
      .catch((err: unknown) => {
        setLoadError(err instanceof Error ? err.message : '问题配置加载失败')
      })
      .finally(() => setLoading(false))
  }, [])

  // 任一会话状态变化，即保存完整会话快照
  useEffect(() => {
    saveSession({
      formData,
      messages,
      conversationId,
      prdContent,
      apiDocsContent,
      promptsContent,
      viewState,
    })
  }, [
    formData,
    messages,
    conversationId,
    prdContent,
    apiDocsContent,
    promptsContent,
    viewState,
  ])

  /** 中止当前生成；已产出的文字会被保留（对话/文档均是）。 */
  const stopStreaming = () => abortRef.current?.abort()

  /** 聊天流收尾：未定版时把半截文本补写为 assistant 消息。 */
  const finalizeChatStream = (finalized: boolean) => {
    if (!finalized && streamingRef.current.trim()) {
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: streamingRef.current },
      ])
    }
    streamingRef.current = ''
    setStreamingContent('')
    setIsStreaming(false)
    abortRef.current = null
  }

  // 表单提交：开启首轮对话
  const handleStartConversation = async (data: Record<string, string>) => {
    const controller = new AbortController()
    abortRef.current = controller
    streamingRef.current = ''
    setStreamError(null)
    setMessages([])
    setStreamingContent('')
    setIsStreaming(true)
    setConversationId(newConversationId())
    setViewState('chatting')

    let finalized = false

    try {
      await startConversationStream(
        data,
        {
          onChunk: (text) => {
            streamingRef.current += text
            setStreamingContent(streamingRef.current)
          },
          onMessages: (history) => {
            finalized = true
            setMessages(history)
          },
          onError: (message) => setStreamError(message),
        },
        { signal: controller.signal },
      )
    } catch (err) {
      if (!controller.signal.aborted) {
        setStreamError(err instanceof Error ? err.message : '对话启动失败')
      }
    } finally {
      finalizeChatStream(finalized)
    }
  }

  // 后续轮次
  const handleSendMessage = async (text: string) => {
    if (abortRef.current) return

    const controller = new AbortController()
    abortRef.current = controller
    streamingRef.current = ''
    setStreamError(null)
    setStreamingContent('')
    setIsStreaming(true)

    const history = messages // 旧历史（后端自行拼接新 user 消息）
    setMessages((prev) => [...prev, { role: 'user', content: text }])

    let finalized = false

    try {
      await continueConversationStream(
        text,
        history,
        {
          onChunk: (chunk) => {
            streamingRef.current += chunk
            setStreamingContent(streamingRef.current)
          },
          onMessages: (fullHistory) => {
            finalized = true
            setMessages(fullHistory)
          },
          onError: (message) => setStreamError(message),
        },
        { signal: controller.signal },
      )
    } catch (err) {
      if (!controller.signal.aborted) {
        setStreamError(err instanceof Error ? err.message : '消息发送失败')
      }
    } finally {
      finalizeChatStream(finalized)
    }
  }

  // ---------------- 文档生成 ----------------

  const docContentSetters: Record<DocType, (value: string) => void> = {
    prd: setPrdContent,
    api: setApiDocsContent,
    prompts: setPromptsContent,
  }

  /**
   * 文档流通用编排：progress/chunk 实时预览，document 定版并进入审阅；
   * 中断或异常时保留已生成的半截内容（进入审阅，可继续编辑或重新生成）。
   */
  const runDocumentStream = async (
    docType: DocType,
    streamFactory: (
      handlers: StreamHandlers,
      options: { signal: AbortSignal },
    ) => Promise<void>,
  ) => {
    const stage = DOC_STAGES[docType]
    const controller = new AbortController()
    abortRef.current = controller
    streamingRef.current = ''
    setStreamError(null)
    setDocStreamingContent('')
    setIsGenerating(true)
    setViewState(stage.generatingView)

    let finalized = false

    try {
      await streamFactory(
        {
          onChunk: (text) => {
            streamingRef.current += text
            setDocStreamingContent(streamingRef.current)
          },
          onDocument: (payload) => {
            finalized = true
            docContentSetters[docType](payload.content)
          },
          onError: (message) => setStreamError(message),
        },
        { signal: controller.signal },
      )
    } catch (err) {
      if (!controller.signal.aborted) {
        setStreamError(err instanceof Error ? err.message : '文档生成失败')
      }
    } finally {
      const newText = streamingRef.current.trim()
      // 未定版但有半截文字：保留为该文档内容
      if (!finalized && newText) {
        docContentSetters[docType](streamingRef.current)
      }
      // 目标页判定：新内容已定版/有半截产出 -> 审阅页；
      // 否则若该文档已有旧内容（如优化失败）-> 留在原审阅页；都没有才退回对话
      const existingContent = {
        prd: prdContent,
        api: apiDocsContent,
        prompts: promptsContent,
      }[docType].trim()
      setViewState(
        finalized || newText || existingContent ? stage.reviewView : 'chatting',
      )
      streamingRef.current = ''
      setDocStreamingContent('')
      setIsGenerating(false)
      abortRef.current = null
    }
  }

  /** 生成 PRD：历史去掉 system 与首轮合成摘要（表单已单独传入，避免重复）。 */
  const handleGeneratePrd = () => {
    if (!canGeneratePrd) return // 防御性校验（按钮本身已按条件隐藏）
    const prdHistory = messages.filter(
      (m) => m.role !== 'system' && !isSyntheticIntro(m),
    )
    void runDocumentStream('prd', (handlers, options) =>
      generatePrdStream(formData, prdHistory, handlers, options),
    )
  }

  const handleGenerateApiDocs = () => {
    // 前置条件：PRD 已定版且非空；生成中禁止重入
    if (!prdContent.trim() || isGenerating) return
    void runDocumentStream('api', (handlers, options) =>
      generateApiDocsStream(prdContent, handlers, options),
    )
  }

  const handleGeneratePrompts = () => {
    // 提示词以 PRD 为素材，故校验 prdContent
    if (!prdContent.trim() || isGenerating) return
    void runDocumentStream('prompts', (handlers, options) =>
      generatePromptsStream(prdContent, handlers, options),
    )
  }

  /** AI 优化当前文档。 */
  const handleOptimizeDocument = (docType: DocType, instruction: string) => {
    const currentContent = {
      prd: prdContent,
      api: apiDocsContent,
      prompts: promptsContent,
    }[docType]
    void runDocumentStream(docType, (handlers, options) =>
      optimizeDocumentStream(
        currentContent,
        instruction,
        docType,
        handlers,
        options,
      ),
    )
  }

  /** 结束任务：仅当提示词套件已生成时进入完成页，保证完成页内容齐全。 */
  const handleEndTask = () => {
    if (!promptsContent.trim() || isGenerating) return
    setStreamError(null)
    setViewState('done')
  }

  /** 重置：清空全部会话数据并回到起点。 */
  const handleRestart = () => {
    // 先中止在途请求，否则重置后旧请求的回调仍会把数据写回新会话
    abortRef.current?.abort()
    abortRef.current = null
    streamingRef.current = ''

    setFormData({})
    setMessages([])
    setPrdContent('')
    setApiDocsContent('')
    setPromptsContent('')
    setConversationId('')
    setStreamingContent('')
    setDocStreamingContent('')
    setStreamError(null)
    setIsStreaming(false)
    setIsGenerating(false)
    setViewState('form')
  }

  // 界面消息：隐藏首轮合成摘要；聊天流式进行中追加临时 assistant 消息
  const displayMessages = useMemo<ChatMessage[]>(() => {
    const visible = messages.filter((m) => !isSyntheticIntro(m))
    if (isStreaming) {
      return [...visible, { role: 'assistant', content: streamingContent }]
    }
    return visible
  }, [messages, streamingContent, isStreaming])

  // 对话页"生成 PRD"条件：至少完成一轮 AI 回复，且当前不在生成中
  const canGeneratePrd =
    messages.some((m) => m.role === 'assistant' && m.content.trim().length > 0) &&
    !isStreaming &&
    !isGenerating

  /**
   * 安全回退：只跳转到数据齐备的阶段；目标内容缺失时，
   * 沿 PRD → 对话 → 表单 级联到最近一个有效页面，杜绝空页面。
   * 流式进行中一律禁止跳转。
   */
  const goBack = (target: ViewState) => {
    if (isGenerating || isStreaming) return

    if (target === 'chatting') {
      setViewState(messages.length > 0 ? 'chatting' : 'form')
      return
    }
    if (target === 'review-prd') {
      if (prdContent.trim()) setViewState('review-prd')
      else setViewState(messages.length > 0 ? 'chatting' : 'form')
      return
    }
    if (target === 'review-api-docs') {
      if (apiDocsContent.trim()) setViewState('review-api-docs')
      else if (prdContent.trim()) setViewState('review-prd')
      else setViewState(messages.length > 0 ? 'chatting' : 'form')
      return
    }
    if (target === 'review-prompts') {
      if (promptsContent.trim()) setViewState('review-prompts')
      else if (apiDocsContent.trim()) setViewState('review-api-docs')
      else if (prdContent.trim()) setViewState('review-prd')
      else setViewState(messages.length > 0 ? 'chatting' : 'form')
    }
  }

  const isDocView =
    viewState.startsWith('generating-') || viewState.startsWith('review-')

  // 完成页展示的三类文档卡片
  const completionDocs = [
    {
      key: 'prd',
      label: 'prd',
      title: 'PRD 产品需求文档',
      desc: '完整产品需求，含功能优先级与验收标准',
      icon: FileText,
      content: prdContent,
      reviewView: 'review-prd' as ViewState,
    },
    {
      key: 'api',
      label: 'api-docs',
      title: '接口文档',
      desc: '接口定义、参数说明与请求响应示例',
      icon: FileCode2,
      content: apiDocsContent,
      reviewView: 'review-api-docs' as ViewState,
    },
    {
      key: 'prompts',
      label: 'prompts',
      title: '提示词套件',
      desc: '可直接复制使用的场景化提示词',
      icon: Sparkles,
      content: promptsContent,
      reviewView: 'review-prompts' as ViewState,
    },
  ]

  /** 渲染某个文档审阅页。 */
  const renderDocumentView = (docType: DocType) => {
    const stage = DOC_STAGES[docType]
    // isGenerating 驱动组件状态；当前页与生成中视图一致时才显示生成态
    const status: 'generating' | 'ready' =
      isGenerating && viewState === stage.generatingView
        ? 'generating'
        : 'ready'
    const content = {
      prd: prdContent,
      api: apiDocsContent,
      prompts: promptsContent,
    }[docType]
    const setContent = docContentSetters[docType]

    const actions: DocumentAction[] = []

    if (docType === 'prd') {
      actions.push({
        key: 'back-chat',
        label: '返回对话',
        variant: 'secondary',
        onClick: () => goBack('chatting'),
      })
      actions.push({
        key: 'gen-api',
        label: '生成接口文档',
        variant: 'primary',
        disabled: !prdContent.trim(),
        onClick: handleGenerateApiDocs,
      })
    } else if (docType === 'api') {
      actions.push({
        key: 'back-prd',
        label: '返回 PRD',
        variant: 'secondary',
        onClick: () => goBack('review-prd'),
      })
      actions.push({
        key: 'gen-prompts',
        label: '生成提示词套件',
        variant: 'primary',
        disabled: !prdContent.trim(),
        onClick: handleGeneratePrompts,
      })
    } else {
      actions.push({
        key: 'back-api',
        label: '返回接口文档',
        variant: 'secondary',
        onClick: () => goBack('review-api-docs'),
      })
      actions.push({
        key: 'finish',
        label: '完成',
        variant: 'primary',
        disabled: !promptsContent.trim(),
        onClick: handleEndTask,
      })
    }

    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-bold text-slate-900">文档输出</h1>
          <div className="flex items-center gap-2">
            {isGenerating && (
              <button
                type="button"
                onClick={stopStreaming}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-50"
              >
                <Square size={12} />
                停止生成
              </button>
            )}
            <span className="text-xs text-slate-400">
              步骤 {currentStep + 1} / {STEPS.length}
            </span>
          </div>
        </div>

        {streamError && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-xs text-red-600">
            {streamError}
          </div>
        )}

        <DocumentReview
          title={stage.title}
          status={status}
          content={content}
          streamingContent={docStreamingContent}
          onContentChange={setContent}
          onOptimize={(instruction) =>
            handleOptimizeDocument(docType, instruction)
          }
          actions={actions}
        />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-4">
          <span className="text-lg font-bold text-primary-600">HarnessPRD</span>
          {viewState === 'chatting' && conversationId && (
            <span className="text-xs text-slate-400">
              会话：{conversationId.slice(0, 8)}
            </span>
          )}
        </div>

        {/* 步骤进度条 */}
        <div className="mx-auto max-w-3xl px-6 pb-4">
          <ol className="flex items-center">
            {STEPS.map((step, i) => {
              const completed = i < currentStep
              const active = i === currentStep
              return (
                <li
                  key={step.id}
                  className="flex flex-1 items-center last:flex-none"
                >
                  <div className="flex items-center gap-2">
                    <span
                      className={[
                        'flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-xs font-medium transition',
                        completed
                          ? 'border-primary bg-primary text-white'
                          : active
                            ? 'border-primary text-primary ring-2 ring-primary/20'
                            : 'border-slate-300 text-slate-400',
                      ].join(' ')}
                    >
                      {completed ? '✓' : i + 1}
                    </span>
                    <span
                      className={[
                        'whitespace-nowrap text-xs font-medium',
                        completed || active ? 'text-slate-700' : 'text-slate-400',
                      ].join(' ')}
                    >
                      {step.label}
                    </span>
                  </div>
                  {i < STEPS.length - 1 && (
                    <span
                      className={[
                        'mx-3 h-px flex-1',
                        i < currentStep ? 'bg-primary' : 'bg-slate-200',
                      ].join(' ')}
                    />
                  )}
                </li>
              )
            })}
          </ol>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-10">
        {/* 步骤一：需求填写 */}
        {viewState === 'form' && (
          <>
            <h1 className="text-2xl font-bold text-slate-900">
              告诉我们你的产品想法
            </h1>
            <p className="mt-1 text-sm text-slate-500">
              先填写基础信息，提交后 AI 产品经理会立即开始与你对话澄清。
            </p>

            <div className="mt-8 rounded-xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
              {loading && (
                <div className="flex items-center justify-center gap-2 py-16 text-sm text-slate-500">
                  <Loader2 size={18} className="animate-spin text-primary" />
                  正在加载问题配置…
                </div>
              )}

              {!loading && loadError && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
                  配置加载失败：{loadError}
                </div>
              )}

              {!loading && !loadError && (
                <FormStep
                  questions={questions}
                  value={formData}
                  onChange={setFormData}
                  onSubmit={handleStartConversation}
                />
              )}
            </div>
          </>
        )}

        {/* 步骤二：AI 对话澄清 */}
        {viewState === 'chatting' && (
          <>
            <div className="mb-4 flex items-center justify-between gap-2">
              <h1 className="text-xl font-bold text-slate-900">AI 需求澄清对话</h1>
              <div className="flex items-center gap-2">
                {isStreaming && (
                  <button
                    type="button"
                    onClick={stopStreaming}
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-50"
                  >
                    <Square size={12} />
                    停止生成
                  </button>
                )}
                {canGeneratePrd && (
                  <button
                    type="button"
                    onClick={handleGeneratePrd}
                    className="rounded-lg bg-primary px-3.5 py-1.5 text-xs font-medium text-white transition hover:bg-primary-600"
                  >
                    生成 PRD
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setViewState('form')}
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-50"
                >
                  <ArrowLeft size={12} />
                  返回
                </button>
              </div>
            </div>

            <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
              <div className="h-[56vh] overflow-y-auto p-4">
                <MessageList
                  messages={displayMessages}
                  streaming={isStreaming}
                />
              </div>

              <div className="space-y-2 border-t border-slate-200 p-3">
                {streamError && (
                  <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">
                    {streamError}
                  </div>
                )}
                <ChatInput onSend={handleSendMessage} loading={isStreaming} />
              </div>
            </div>
          </>
        )}

        {/* 步骤三~五：文档生成 / 审阅 */}
        {isDocView &&
          (viewState.includes('prd') && !viewState.includes('prompts')
            ? renderDocumentView('prd')
            : viewState.includes('api-docs')
              ? renderDocumentView('api')
              : viewState.includes('prompts')
                ? renderDocumentView('prompts')
                : null)}

        {/* 完成页 */}
        {viewState === 'done' && (
          <div className="space-y-8">
            <div className="text-center">
              <CheckCircle2 size={44} className="mx-auto text-green-500" />
              <h1 className="mt-3 text-2xl font-bold text-slate-900">
                全部文档已生成完毕
              </h1>
              <p className="mt-1 text-sm text-slate-500">
                下载 Markdown 文档保存到本地，或返回任一文档继续查看与优化。
              </p>
            </div>

            {/* 文档卡片 */}
            <div className="grid gap-4 sm:grid-cols-3">
              {completionDocs.map(
                ({ key, label, title, desc, icon: Icon, content, reviewView }) => {
                  const ready = content.trim().length > 0
                  return (
                    <div
                      key={key}
                      className="flex flex-col rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
                    >
                      <div className="mb-3 inline-flex w-fit rounded-lg bg-primary-50 p-2 text-primary-600">
                        <Icon size={18} />
                      </div>
                      <h2 className="text-sm font-semibold text-slate-900">
                        {title}
                      </h2>
                      <p className="mt-1 flex-1 text-xs leading-relaxed text-slate-500">
                        {desc}
                      </p>
                      <span className="mt-3 text-[11px] text-slate-400">
                        {ready ? `约 ${content.length} 字符` : '未生成'}
                      </span>

                      <div className="mt-3 flex gap-2 border-t border-slate-100 pt-3">
                        <button
                          type="button"
                          disabled={!ready}
                          onClick={() =>
                            downloadFile(
                              buildDocFilename(label, formData.product_name),
                              content,
                            )
                          }
                          className="inline-flex flex-1 items-center justify-center gap-1 rounded-lg bg-primary px-2 py-1.5 text-xs font-medium text-white transition hover:bg-primary-600 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400"
                        >
                          <Download size={13} />
                          下载
                        </button>
                        <button
                          type="button"
                          disabled={!ready}
                          onClick={() => goBack(reviewView)}
                          className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          查看
                        </button>
                      </div>
                    </div>
                  )
                },
              )}
            </div>

            {/* 重新开始 */}
            <div className="text-center">
              <button
                type="button"
                onClick={handleRestart}
                className="rounded-lg border border-slate-300 bg-white px-5 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-50"
              >
                重新开始
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}

export default App
