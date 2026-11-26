import axios from 'axios'
import type { ChatMessage, QuestionsConfig } from '../types'

// 普通 REST 请求使用 axios：相对路径在开发环境走 Vite proxy，生产环境同源。
const client = axios.create({
  baseURL: '/',
  timeout: 15000,
})

export { client }

/** 获取需求澄清问题配置。 */
export function getQuestions(): Promise<QuestionsConfig> {
  return client
    .get<QuestionsConfig>('/api/conversation/questions')
    .then((res) => res.data)
}

// ==================================================================
// SSE 流式处理
// ==================================================================

/** document 事件定版载荷（对应后端 event: document）。 */
export interface DocumentPayload {
  doc_type: string
  content: string
}

/** 流式事件回调，UI 按需传入。 */
export interface StreamHandlers {
  /** 每段 AI 文本（对应后端 event: chunk） */
  onChunk?: (text: string) => void
  /** 一轮结束时后端回传的完整消息历史（event: messages） */
  onMessages?: (messages: ChatMessage[]) => void
  /** 文档生成开始提示（event: progress） */
  onProgress?: (message: string) => void
  /** 文档生成定版（event: document） */
  onDocument?: (payload: DocumentPayload) => void
  /** 流正常结束（event: done） */
  onDone?: () => void
  /** 流内业务异常（event: error） */
  onError?: (message: string) => void
}

/** 发起流式请求的可选项。 */
export interface StreamOptions {
  provider?: string
  model?: string
  /** 传入 AbortController.signal 可中止生成（同时停止后端上游调用） */
  signal?: AbortSignal
}

interface ParsedSSEEvent {
  event: string
  data: string
}

/** 解析单个 SSE 帧（帧内行以 \n 分隔）。无 data 行的帧返回 null。 */
function parseFrame(rawFrame: string): ParsedSSEEvent | null {
  let event = 'message'
  const dataLines: string[] = []

  for (const line of rawFrame.split('\n')) {
    if (!line || line.startsWith(':')) continue // 空行 / 注释行（心跳）
    if (line.startsWith('event:')) {
      event = line.slice(6).trim()
    } else if (line.startsWith('data:')) {
      // SSE 规范：data: 后若紧跟一个空格，去掉这一个空格
      dataLines.push(line.slice(5).replace(/^ /, ''))
    }
  }

  if (dataLines.length === 0) return null
  return { event, data: dataLines.join('\n') }
}

/**
 * 通用 SSE 流读取：持续从 ReadableStream 解码、按帧切分并分发事件。
 *
 * 关键点：网络 chunk 不保证按 SSE 帧边界到达，必须用 buffer 缓存，
 * 只处理已经以空行结束的完整帧，最后不足一帧的残片留到下次拼接。
 */
export async function readStream(
  response: Response,
  handlers: StreamHandlers,
): Promise<void> {
  if (!response.ok) {
    throw new Error(`流式请求失败：HTTP ${response.status}`)
  }
  if (!response.body) {
    throw new Error('当前浏览器不支持 ReadableStream')
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder('utf-8')
  let buffer = ''

  const dispatch = (parsed: ParsedSSEEvent) => {
    switch (parsed.event) {
      case 'chunk': {
        const data = JSON.parse(parsed.data) as { text?: string }
        if (data.text) handlers.onChunk?.(data.text)
        break
      }
      case 'messages': {
        const data = JSON.parse(parsed.data) as { messages?: ChatMessage[] }
        if (Array.isArray(data.messages)) handlers.onMessages?.(data.messages)
        break
      }
      case 'progress': {
        const data = JSON.parse(parsed.data) as { message?: string }
        if (data.message) handlers.onProgress?.(data.message)
        break
      }
      case 'document': {
        const data = JSON.parse(parsed.data) as DocumentPayload
        if (typeof data.content === 'string') handlers.onDocument?.(data)
        break
      }
      case 'done':
        handlers.onDone?.()
        break
      case 'error': {
        const data = JSON.parse(parsed.data) as { message?: string }
        handlers.onError?.(data.message ?? '未知错误')
        break
      }
      default:
        // 未识别事件直接忽略，保证前向兼容
        break
    }
  }

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      // stream: true 告知 decoder 可能存在跨 chunk 的多字节字符（如中文）
      buffer += decoder.decode(value, { stream: true })

      // 统一换行符后，按空行切出完整帧
      buffer = buffer.replace(/\r\n/g, '\n').replace(/\r/g, '\n')

      let sepIndex: number
      while ((sepIndex = buffer.indexOf('\n\n')) !== -1) {
        const rawFrame = buffer.slice(0, sepIndex)
        buffer = buffer.slice(sepIndex + 2)
        const parsed = parseFrame(rawFrame)
        if (parsed) dispatch(parsed)
      }
    }

    // 冲刷 decoder 残余字节，处理可能未带结尾空行的最后一帧
    buffer += decoder.decode()
    if (buffer.trim()) {
      const parsed = parseFrame(buffer)
      if (parsed) dispatch(parsed)
    }
  } finally {
    reader.releaseLock()
  }
}

/** POST + SSE 的内部统一入口。 */
async function postStream(
  url: string,
  body: Record<string, unknown>,
  handlers: StreamHandlers,
  signal?: AbortSignal,
): Promise<void> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  })
  await readStream(response, handlers)
}

/** 首轮：提交表单，AI 产品经理开始澄清访谈。 */
export function startConversationStream(
  formData: Record<string, string>,
  handlers: StreamHandlers,
  options?: StreamOptions,
): Promise<void> {
  return postStream(
    '/api/conversation/start-stream',
    {
      form_data: formData,
      provider: options?.provider,
      model: options?.model,
    },
    handlers,
    options?.signal,
  )
}

/** 后续轮次：携带完整历史消息接续对话。 */
export function continueConversationStream(
  message: string,
  history: ChatMessage[],
  handlers: StreamHandlers,
  options?: StreamOptions,
): Promise<void> {
  return postStream(
    '/api/conversation/continue-stream',
    {
      message,
      history,
      provider: options?.provider,
      model: options?.model,
    },
    handlers,
    options?.signal,
  )
}

// ==================================================================
// 文档生成流式接口
// ==================================================================

/** 生成 PRD：表单数据 + 澄清对话历史。 */
export function generatePrdStream(
  formData: Record<string, string>,
  history: ChatMessage[],
  handlers: StreamHandlers,
  options?: StreamOptions,
): Promise<void> {
  return postStream(
    '/api/conversation/generate-prd-stream',
    {
      history,
      form_data: formData,
      provider: options?.provider,
      model: options?.model,
    },
    handlers,
    options?.signal,
  )
}

/** 生成接口文档：传入 PRD Markdown 全文。 */
export function generateApiDocsStream(
  prdContent: string,
  handlers: StreamHandlers,
  options?: StreamOptions,
): Promise<void> {
  return postStream(
    '/api/conversation/generate-api-docs-stream',
    {
      prd_content: prdContent,
      provider: options?.provider,
      model: options?.model,
    },
    handlers,
    options?.signal,
  )
}

/** 生成提示词套件：传入 PRD Markdown 全文。 */
export function generatePromptsStream(
  prdContent: string,
  handlers: StreamHandlers,
  options?: StreamOptions,
): Promise<void> {
  return postStream(
    '/api/conversation/generate-prompts-stream',
    {
      prd_content: prdContent,
      provider: options?.provider,
      model: options?.model,
    },
    handlers,
    options?.signal,
  )
}

/** 优化文档：按用户指令改进已有文档，docType 默认 prd。 */
export function optimizeDocumentStream(
  document: string,
  instruction: string,
  docType: string,
  handlers: StreamHandlers,
  options?: StreamOptions,
): Promise<void> {
  return postStream(
    '/api/conversation/optimize-document-stream',
    {
      document,
      instruction,
      doc_type: docType,
      provider: options?.provider,
      model: options?.model,
    },
    handlers,
    options?.signal,
  )
}
