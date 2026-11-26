"""API 请求 / 响应模型 (Pydantic v2)。

约定: 路由层只做参数解析与校验，所有业务逻辑放在 services 层。
"""

from typing import Literal

from pydantic import BaseModel, Field

ProviderName = Literal["anthropic", "openai"]


# ---------------- 对话相关 ----------------

class ChatMessage(BaseModel):
    role: Literal["system", "user", "assistant"]
    content: str = Field(..., min_length=1)


class StartStreamRequest(BaseModel):
    """POST /start-stream 请求体：基于表单内容开启首轮澄清对话。"""
    form_data: dict[str, object] = Field(
        default_factory=dict, description="表单字段名 -> 用户填写的值"
    )
    provider: ProviderName | None = None
    model: str | None = None


class ContinueStreamRequest(BaseModel):
    """POST /continue-stream 请求体：携带历史接续对话。"""
    message: str = Field(..., min_length=1, description="用户本轮输入")
    history: list[ChatMessage] = Field(default_factory=list, description="完整历史消息")
    provider: ProviderName | None = None
    model: str | None = None


# ---------------- 文档生成 ----------------

class GeneratePRDRequest(BaseModel):
    """POST /generate-prd-stream：表单 + 澄清对话 -> PRD。"""
    history: list[ChatMessage] = Field(default_factory=list, description="澄清对话历史")
    form_data: dict[str, object] = Field(default_factory=dict, description="表单数据")
    provider: ProviderName | None = None
    model: str | None = None


class GenerateApiDocsRequest(BaseModel):
    """POST /generate-api-docs-stream：PRD -> 接口文档。"""
    prd_content: str = Field(..., min_length=1)
    provider: ProviderName | None = None
    model: str | None = None


class GeneratePromptsRequest(BaseModel):
    """POST /generate-prompts-stream：PRD -> 提示词套件。"""
    prd_content: str = Field(..., min_length=1)
    provider: ProviderName | None = None
    model: str | None = None


class OptimizeDocumentRequest(BaseModel):
    """POST /optimize-document-stream：按要求优化已有文档。"""
    document: str = Field(..., min_length=1)
    instruction: str = Field(..., min_length=1)
    doc_type: str = Field(default="prd", description="回传标识，前端用于区分文档类型")
    provider: ProviderName | None = None
    model: str | None = None


# ---------------- 会话 ----------------

class SessionInfo(BaseModel):
    session_id: str
    title: str | None = None
    created_at: str | None = None


# ---------------- 澄清问题配置 ----------------

QuestionType = Literal["text", "textarea", "select", "radio"]


class QuestionItem(BaseModel):
    name: str
    label: str
    type: QuestionType
    required: bool = False
    # select / radio 的可选项；text / textarea 时为 None
    options: list[str] | None = None


class QuestionsConfig(BaseModel):
    base_questions: list[QuestionItem]
    advanced_questions: list[QuestionItem]
