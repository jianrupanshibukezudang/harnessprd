"""文档生成业务逻辑：PRD / 接口文档 / 提示词套件，以及文档优化。

与对话服务一致的流式约定（配合 api/conversation.py 的 _make_sse_generator）:
- 逐字产出 ``str``              -> SSE event: chunk
- 开始时产出 progress 事件      -> SSE event: progress（前端可选用）
- 结束时产出定版事件            -> SSE event: document
  data: {"doc_type": "...", "content": "完整 Markdown"}
"""

from collections.abc import AsyncIterator
from typing import ClassVar

from langchain_core.messages import BaseMessage, HumanMessage, SystemMessage

from core.config import get_settings
from services.conversation_service import format_form_data
from services.llm_factory import get_llm
from services.prompts import (
    API_DOCS_GENERATION_PROMPT,
    OPTIMIZE_DOCUMENT_PROMPT_TEMPLATE,
    PRD_GENERATION_PROMPT,
    PROMPTS_GENERATION_PROMPT,
)

RoleContent = dict[str, str]


class DocumentService:
    """文档生成服务，一次实例对应一种模型配置。

    文档类任务对稳定性要求高，默认 temperature=0.3（低于闲聊的 0.7）。
    """

    # 模板注册表：doc_type -> 生成提示词（"模板加载"的唯一入口）
    TEMPLATES: ClassVar[dict[str, str]] = {
        "prd": PRD_GENERATION_PROMPT,
        "api": API_DOCS_GENERATION_PROMPT,
        "prompts": PROMPTS_GENERATION_PROMPT,
    }

    def __init__(
        self,
        provider: str | None = None,
        model: str | None = None,
        temperature: float = 0.3,
    ) -> None:
        self.provider = provider
        self.model = model
        self.llm = get_llm(
            provider=provider,
            model=model,
            temperature=temperature,
            max_tokens=get_settings().doc_max_tokens,
            streaming=True,
        )

    # ------------------------------------------------------------------
    # 模板加载与 Prompt 拼接
    # ------------------------------------------------------------------

    @classmethod
    def load_template(cls, doc_type: str) -> str:
        """按 doc_type 加载生成模板。"""
        try:
            return cls.TEMPLATES[doc_type]
        except KeyError:
            raise ValueError(
                f"未知的文档类型: {doc_type!r}，可选: {', '.join(cls.TEMPLATES)}"
            ) from None

    @staticmethod
    def _build_generation_messages(
        template: str,
        context_title: str,
        context: str,
    ) -> list[BaseMessage]:
        """Prompt 拼接：生成模板作为 system 指令，收集到的素材放在 user 消息中。"""
        return [
            SystemMessage(content=template),
            HumanMessage(content=f"【{context_title}】\n\n{context}"),
        ]

    @staticmethod
    def _conversation_to_text(history: list[object]) -> str:
        """把澄清对话历史渲染为可读的访谈记录（跳过 system 消息）。

        同时兼容 dict 与 pydantic ChatMessage。
        """
        role_label = {"user": "用户", "assistant": "AI 产品经理"}
        turns: list[str] = []

        for message in history:
            if isinstance(message, dict):
                role = str(message.get("role", ""))
                content = str(message.get("content", ""))
            else:
                role = str(getattr(message, "role", ""))
                content = str(getattr(message, "content", ""))

            if role not in role_label or not content.strip():
                continue
            turns.append(f"{role_label[role]}：{content.strip()}")

        return "\n\n".join(turns) if turns else "（无对话记录）"

    @staticmethod
    def _extract_text(chunk: object) -> str:
        """从 LangChain chunk 提取文本，兼容 content 为分段列表。"""
        content = getattr(chunk, "content", "")
        if isinstance(content, str):
            return content
        if isinstance(content, list):
            parts = [
                str(part.get("text", "")) if isinstance(part, dict) else str(part)
                for part in content
            ]
            return "".join(parts)
        return str(content)

    # ------------------------------------------------------------------
    # 通用流式骨架
    # ------------------------------------------------------------------

    async def _run_stream(
        self,
        doc_type: str,
        messages: list[BaseMessage],
        progress_message: str,
    ) -> AsyncIterator[str | dict[str, object]]:
        """共用流程：progress -> 逐字 chunk -> document 定版事件。"""
        yield {"event": "progress", "data": {"message": progress_message}}

        parts: list[str] = []
        async for chunk in self.llm.astream(messages):
            text = self._extract_text(chunk)
            if text:
                parts.append(text)
                yield text

        yield {
            "event": "document",
            "data": {"doc_type": doc_type, "content": "".join(parts)},
        }

    # ------------------------------------------------------------------
    # 三个流式生成方法
    # ------------------------------------------------------------------

    async def generate_prd_stream(
        self,
        history: list[object] | None = None,
        form_data: dict[str, object] | None = None,
    ) -> AsyncIterator[str | dict[str, object]]:
        """根据表单 + 澄清对话生成 PRD。"""
        context_parts = [
            "## 表单信息",
            format_form_data(form_data or {}),
            "",
            "## 需求澄清对话记录",
            self._conversation_to_text(history or []),
        ]
        messages = self._build_generation_messages(
            template=self.load_template("prd"),
            context_title="需求素材",
            context="\n".join(context_parts),
        )
        async for event in self._run_stream("prd", messages, "正在生成 PRD 文档…"):
            yield event

    async def generate_api_docs_stream(
        self,
        prd_content: str,
    ) -> AsyncIterator[str | dict[str, object]]:
        """根据 PRD 生成接口文档。"""
        if not prd_content.strip():
            raise ValueError("PRD 内容为空，无法生成接口文档")

        messages = self._build_generation_messages(
            template=self.load_template("api"),
            context_title="PRD / 需求信息",
            context=prd_content,
        )
        async for event in self._run_stream(
            "api", messages, "正在生成接口文档…"
        ):
            yield event

    async def generate_prompts_stream(
        self,
        prd_content: str,
    ) -> AsyncIterator[str | dict[str, object]]:
        """根据 PRD 生成提示词套件。"""
        if not prd_content.strip():
            raise ValueError("PRD 内容为空，无法生成提示词套件")

        messages = self._build_generation_messages(
            template=self.load_template("prompts"),
            context_title="产品需求 / PRD",
            context=prd_content,
        )
        async for event in self._run_stream(
            "prompts", messages, "正在生成提示词套件…"
        ):
            yield event

    # ------------------------------------------------------------------
    # 文档优化
    # ------------------------------------------------------------------

    async def optimize_document_stream(
        self,
        document: str,
        instruction: str,
        doc_type: str = "prd",
    ) -> AsyncIterator[str | dict[str, object]]:
        """按优化要求审阅并改进文档，流式返回优化后的完整文档。"""
        if not document.strip():
            raise ValueError("待优化文档内容为空")
        if not instruction.strip():
            raise ValueError("优化要求不能为空")

        rendered = OPTIMIZE_DOCUMENT_PROMPT_TEMPLATE.format(
            instruction=instruction.strip(),
            document=document,
        )
        # 优化模板自身已包含完整指令，作为单条 user 消息即可
        messages = [HumanMessage(content=rendered)]

        async for event in self._run_stream(
            doc_type, messages, "正在优化文档…"
        ):
            yield event
