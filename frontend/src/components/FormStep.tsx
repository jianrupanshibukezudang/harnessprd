import { useState } from 'react'
import type { FormEvent } from 'react'
import { ChevronDown, ChevronUp, Send } from 'lucide-react'
import type { QuestionConfig, QuestionsConfig } from '../types'

interface FormStepProps {
  /** 问题配置：基础问题 + 高级问题 */
  questions: QuestionsConfig
  /** 表单数据，按 question.name 建键 */
  value: Record<string, string>
  /** 任一字段变化时回传完整表单数据（双向绑定） */
  onChange: (data: Record<string, string>) => void
  /** 仅在必填校验通过后触发 */
  onSubmit?: (data: Record<string, string>) => void
}

const fieldBase =
  'w-full rounded-lg border bg-white px-3 py-2 text-sm text-slate-800 outline-none transition focus:ring-2 focus:ring-primary/30 focus:border-primary'

export default function FormStep({
  questions,
  value,
  onChange,
  onSubmit,
}: FormStepProps) {
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})

  const baseQuestions = questions.base_questions ?? []
  const advancedQuestions = questions.advanced_questions ?? []

  const updateField = (name: string, fieldValue: string) => {
    onChange({ ...value, [name]: fieldValue })
    // 修改时清除该字段的错误提示
    if (errors[name]) {
      setErrors((prev) => {
        const next = { ...prev }
        delete next[name]
        return next
      })
    }
  }

  /** 校验必填项。高级问题收起时不校验（用户看不到错误），展开后才校验。 */
  const validate = (): boolean => {
    const next: Record<string, string> = {}
    const checkRequired = (list: QuestionConfig[]) => {
      for (const q of list) {
        if (q.required && !(value[q.name] ?? '').trim()) {
          next[q.name] = `请填写${q.label}`
        }
      }
    }
    checkRequired(baseQuestions)
    if (showAdvanced) checkRequired(advancedQuestions)

    setErrors(next)
    return Object.keys(next).length === 0
  }

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    if (validate()) onSubmit?.(value)
  }

  const renderField = (q: QuestionConfig) => {
    const error = errors[q.name]
    const borderClass = error ? 'border-red-400' : 'border-slate-300'

    return (
      <div key={q.name}>
        <label className="mb-1.5 block text-sm font-medium text-slate-700">
          {q.label}
          {q.required && <span className="ml-0.5 text-red-500">*</span>}
        </label>

        {q.type === 'text' && (
          <input
            type="text"
            className={`${fieldBase} ${borderClass}`}
            value={value[q.name] ?? ''}
            onChange={(e) => updateField(q.name, e.target.value)}
          />
        )}

        {q.type === 'textarea' && (
          <textarea
            rows={4}
            className={`${fieldBase} ${borderClass} resize-y`}
            value={value[q.name] ?? ''}
            onChange={(e) => updateField(q.name, e.target.value)}
          />
        )}

        {q.type === 'select' && (
          <select
            className={`${fieldBase} ${borderClass}`}
            value={value[q.name] ?? ''}
            onChange={(e) => updateField(q.name, e.target.value)}
          >
            <option value="">请选择</option>
            {q.options?.map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </select>
        )}

        {q.type === 'radio' && (
          <div className="flex flex-wrap gap-4 pt-1">
            {q.options?.map((opt) => (
              <label
                key={opt}
                className="flex cursor-pointer items-center gap-1.5 text-sm text-slate-700"
              >
                <input
                  type="radio"
                  name={q.name}
                  value={opt}
                  checked={value[q.name] === opt}
                  onChange={(e) => updateField(q.name, e.target.value)}
                  className="h-4 w-4 accent-primary"
                />
                {opt}
              </label>
            ))}
          </div>
        )}

        {error && <p className="mt-1 text-xs text-red-500">{error}</p>}
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-5">
      {/* 基础问题 */}
      <div className="space-y-5">{baseQuestions.map(renderField)}</div>

      {/* 高级问题：展开/收起 */}
      {advancedQuestions.length > 0 && (
        <div className="border-t border-slate-200 pt-4">
          <button
            type="button"
            onClick={() => setShowAdvanced((v) => !v)}
            className="flex items-center gap-1 text-sm font-medium text-primary-600 hover:text-primary-700"
          >
            {showAdvanced ? (
              <>
                收起高级问题 <ChevronUp size={16} />
              </>
            ) : (
              <>
                展开高级问题 <ChevronDown size={16} />
              </>
            )}
          </button>

          {showAdvanced && (
            <div className="mt-5 space-y-5">
              {advancedQuestions.map(renderField)}
            </div>
          )}
        </div>
      )}

      <div className="flex items-center gap-3 border-t border-slate-200 pt-5">
        <button
          type="submit"
          className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-5 py-2 text-sm font-medium text-white transition hover:bg-primary-600"
        >
          <Send size={15} />
          提交
        </button>
        <span className="text-xs text-slate-400">
          带 <span className="text-red-500">*</span> 为必填项
        </span>
      </div>
    </form>
  )
}
