"""对话业务逻辑：PM 角色的需求澄清访谈。

职责划分:
- format_form_data / _build_lc_messages / _serialize_messages: 纯数据转换函数
- ConversationService: 组织上下文并通过 LangChain ``astream`` 流式产出 AI 回复

流式产出约定（配合 api/conversation.py 的 _make_sse_generator）:
- 逐字产出 ``str``，前端按 ``event: delta`` 追加
- 流末尾产出一个 dict 事件 ``{"event": "messages", "data": {...}}``，
  回传完整消息历史，前端用它替换本地历史后再发起下一轮
"""

from collections.abc import AsyncIterator
from typing import ClassVar

from langchain_core.messages import (
    AIMessage,
    BaseMessage,
    HumanMessage,
    SystemMessage,
)

from core.config import get_settings
from services.llm_factory import get_llm
from services.prompts import SYSTEM_PROMPT

# 表单字段名 -> 中文标签（未命中的字段退化为下划线转空格）
_FIELD_LABELS: dict[str, str] = {
    "product_name": "产品名称",
    "tagline": "一句话定位",
    "core_problem": "核心问题",
    "target_users": "目标用户",
    "user_scenarios": "典型使用场景",
    "mvp_features": "MVP 功能清单",
    "non_goals": "明确不做",
    "success_metrics": "成功指标",
    "constraints": "资源与时间约束",
    "dependencies": "外部依赖",
    "product_stage": "产品当前阶段",
    "target_platform": "目标平台",
}

RoleContent = dict[str, str]


# ------------------------------------------------------------------
# 1. 表单字典 -> 易读文本
# ------------------------------------------------------------------

def format_form_data(form_data: dict[str, object]) -> str:
    """把表单字典渲染为模型易读的多行文本。

    - 跳过空值；值为列表时逐项展开
    - 已知字段名显示中文标签，未知字段名做下划线转空格处理
    """
    lines: list[str] = []
    for key, raw_value in form_data.items():
        if raw_value is None:
            continue
        if isinstance(raw_value, str) and not raw_value.strip():
            continue

        label = _FIELD_LABELS.get(key, key.replace("_", " "))

        if isinstance(raw_value, (list, tuple)):
            items = [str(item).strip() for item in raw_value if str(item).strip()]
            if not items:
                continue
            value_text = "\n" + "\n".join(f"  - {item}" for item in items)
        else:
            value_text = str(raw_value).strip()

        lines.append(f"- {label}: {value_text}")

    return "\n".join(lines) if lines else "（表单未填写有效内容）"


# ------------------------------------------------------------------
# 2. 前端消息 -> LangChain 消息
# ------------------------------------------------------------------

def _as_role_content(message: object) -> tuple[str, str]:
    """从 dict 或 pydantic ChatMessage 中提取 (role, content)。"""
    if isinstance(message, dict):
        role = str(message.get("role", ""))
        content = str(message.get("content", ""))
    else:
        role = str(getattr(message, "role", ""))
        content = str(getattr(message, "content", ""))
    return role, content


def _build_lc_messages(
    messages: list[object],
    system_prompt: str = SYSTEM_PROMPT,
) -> list[BaseMessage]:
    """把前端消息列表转换为 LangChain 消息列表。

    若历史中没有 system 消息，则自动把 system_prompt 置顶；
    若已存在 system 消息，则保留历史中的、不重复添加。
    """
    lc_messages: list[BaseMessage] = []
    has_system = False

    for message in messages:
        role, content = _as_role_content(message)
        role = role.lower()
        if role == "system":
            lc_messages.append(SystemMessage(content=content))
            has_system = True
        elif role == "assistant":
            lc_messages.append(AIMessage(content=content))
        elif role == "user":
            lc_messages.append(HumanMessage(content=content))
        else:
            raise ValueError(f"不支持的消息角色: {role!r}")

    if not has_system:
        lc_messages = [SystemMessage(content=system_prompt), *lc_messages]

    return lc_messages


# ------------------------------------------------------------------
# 3. LangChain 消息 -> 前端消息
# ------------------------------------------------------------------

def _serialize_messages(messages: list[BaseMessage]) -> list[RoleContent]:
    """把 LangChain 消息列表转回前端可 JSON 序列化的格式。"""
    role_map = {
        SystemMessage: "system",
        HumanMessage: "user",
        AIMessage: "assistant",
    }
    serialized: list[RoleContent] = []
    for message in messages:
        role = next(
            (name for cls, name in role_map.items() if isinstance(message, cls)),
            None,
        )
        if role is None:
            continue
        serialized.append({"role": role, "content": str(message.content)})
    return serialized


# ------------------------------------------------------------------
# 4. 对话服务
# ------------------------------------------------------------------

class ConversationService:
    """AI 产品经理澄清对话服务。

    一次实例对应一次会话的模型配置（provider / model / temperature）。
    会话历史由调用方（前端）持有并在每轮回传，服务端不做持久化。
    """

    system_prompt: ClassVar[str] = SYSTEM_PROMPT

    def __init__(
        self,
        provider: str | None = None,
        model: str | None = None,
        temperature: float = 0.7,
    ) -> None:
        self.provider = provider
        self.model = model
        self.llm = get_llm(
            provider=provider,
            model=model,
            temperature=temperature,
            max_tokens=get_settings().llm_max_tokens,
            streaming=True,
        )

    @staticmethod
    def _extract_text(chunk: object) -> str:
        """从 LangChain chunk 提取文本；兼容 content 为列表的情况。"""
        content = getattr(chunk, "content", "")
        if isinstance(content, str):
            return content
        if isinstance(content, list):
            parts: list[str] = []
            for part in content:
                if isinstance(part, dict):
                    parts.append(str(part.get("text", "")))
                else:
                    parts.append(str(part))
            return "".join(parts)
        return str(content)

    async def start_conversation_stream(
        self,
        form_data: dict[str, object],
    ) -> AsyncIterator[str | dict[str, object]]:
        """首轮：把表单内容作为上下文，AI 主动开始澄清访谈。"""
        intro = (
            "以下是用户通过表单填写的产品信息：\n\n"
            f"{format_form_data(form_data)}\n\n"
            "请基于以上信息开始需求澄清访谈：先简要复述你对产品的理解，"
            "然后提出 1-3 个最关键的追问。"
        )
        lc_messages = _build_lc_messages(
            [{"role": "user", "content": intro}],
            system_prompt=self.system_prompt,
        )
        async for event in self._run_and_collect(lc_messages):
            yield event

    async def continue_conversation_stream(
        self,
        history: list[object],
        message: str,
    ) -> AsyncIterator[str | dict[str, object]]:
        """后续轮次：在历史上下文后追加用户新消息，继续流式对话。"""
        lc_messages = _build_lc_messages(history, system_prompt=self.system_prompt)
        lc_messages.append(HumanMessage(content=message))
        async for event in self._run_and_collect(lc_messages):
            yield event

    async def _run_and_collect(
        self,
        lc_messages: list[BaseMessage],
    ) -> AsyncIterator[str | dict[str, object]]:
        """共用流程: astream 逐字产出，结束后追加 AI 消息并回传完整历史。"""
        assistant_parts: list[str] = []

        async for chunk in self.llm.astream(lc_messages):
            text = self._extract_text(chunk)
            if text:
                assistant_parts.append(text)
                yield text

        lc_messages.append(AIMessage(content="".join(assistant_parts)))

        # 末尾事件：前端据此把完整历史落库，保证下一轮上下文一致
        yield {
            "event": "messages",
            "data": {"messages": _serialize_messages(lc_messages)},
        }
