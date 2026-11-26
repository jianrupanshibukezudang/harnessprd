/** 全局共享类型定义。 */

export interface QuestionConfig {
  name: string
  label: string
  type: 'text' | 'textarea' | 'select' | 'radio'
  required?: boolean
  options?: string[]
}

export interface QuestionsConfig {
  base_questions: QuestionConfig[]
  advanced_questions: QuestionConfig[]
}

/** 聊天消息：history 与 SSE messages 事件共用。 */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

/** 应用的全部视图状态（含各文档的生成中 / 审阅中）。 */
export type ViewState =
  | 'form'
  | 'chatting'
  | 'generating-prd'
  | 'review-prd'
  | 'generating-api-docs'
  | 'review-api-docs'
  | 'generating-prompts'
  | 'review-prompts'
  | 'done'

/** 顶部进度条展示的主步骤（generating-* 等中间态归并到相邻主步骤）。 */
export const STEPS = [
  { id: 'form', label: '描述产品' },
  { id: 'chatting', label: 'AI 对话' },
  { id: 'review-prd', label: 'PRD' },
  { id: 'review-api-docs', label: '接口文档' },
  { id: 'review-prompts', label: '提示词' },
] as const

/** 各视图状态对应的中文文案（占位页使用）。 */
export const VIEW_LABELS: Record<ViewState, string> = {
  form: '描述产品',
  chatting: 'AI 对话澄清',
  'generating-prd': '正在生成 PRD',
  'review-prd': '审阅 PRD',
  'generating-api-docs': '正在生成接口文档',
  'review-api-docs': '审阅接口文档',
  'generating-prompts': '正在生成提示词套件',
  'review-prompts': '审阅提示词套件',
  done: '全部完成',
}
