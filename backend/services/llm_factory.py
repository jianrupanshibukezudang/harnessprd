"""LLM 工厂：根据配置统一创建 LangChain 聊天模型实例。

业务代码只通过 get_llm() 获取模型，切换 Provider / 网关无需改动调用方。

密钥与端点均从 Settings（.env）显式传入，而不是依赖 LangChain/SDK
自行读取 os.environ —— 因为 pydantic-settings 解析 .env 后并不会注入
os.environ，隐式读取会导致 .env 中的密钥实际传不到客户端。
"""

from langchain_anthropic import ChatAnthropic
from langchain_core.language_models.chat_models import BaseChatModel
from langchain_openai import ChatOpenAI

from core.config import get_settings


def get_llm(
    provider: str | None = None,
    model: str | None = None,
    temperature: float = 0.7,
    max_tokens: int | None = None,
    **kwargs,
) -> BaseChatModel:
    """返回对应 Provider 的 LangChain Chat 模型。

    Args:
        provider: "anthropic" 或 "openai"；为 None 时使用 DEFAULT_LLM_PROVIDER。
        model: 模型名；为 None 时使用 DEFAULT_LLM_MODEL。
        temperature: 采样温度，生成文档类任务可适当调低（如 0.3）。
        max_tokens: 单次输出上限；None 表示不显式设置（用模型默认值）。
        **kwargs: 透传给 LangChain Chat 模型的其他参数。

    Raises:
        ValueError: provider 不在支持范围内。
    """
    settings = get_settings()
    provider = (provider or settings.default_llm_provider).lower()
    model = model or settings.default_llm_model

    # max_tokens 放入通用透传，两个 Provider 的 Chat 类均支持该参数
    if max_tokens is not None:
        kwargs["max_tokens"] = max_tokens

    if provider == "anthropic":
        anthropic_kwargs: dict = {"model": model, "temperature": temperature}
        # 显式传入密钥；为空则传 None 交回 SDK 走标准的环境变量/报错路径
        anthropic_kwargs["api_key"] = settings.anthropic_api_key or None
        if settings.anthropic_base_url:
            anthropic_kwargs["base_url"] = settings.anthropic_base_url
        anthropic_kwargs.update(kwargs)
        return ChatAnthropic(**anthropic_kwargs)

    if provider == "openai":
        # 同时兼容 OpenAI 官方与 OpenAI 兼容网关（如火山方舟 Ark、各类中转）
        openai_kwargs: dict = {"model": model, "temperature": temperature}
        openai_kwargs["api_key"] = settings.openai_api_key or None
        if settings.openai_base_url:
            openai_kwargs["base_url"] = settings.openai_base_url

            # 网关模型关闭深度思考（官方 API 不认此参数，故仅网关透传）。
            # 经 openai SDK 的 extra_body 通道下发（ChatOpenAI 的显式参数）。
            if not settings.llm_thinking_enabled:
                extra_body = dict(kwargs.pop("extra_body", None) or {})
                extra_body.setdefault("thinking", {"type": "disabled"})
                openai_kwargs["extra_body"] = extra_body

        openai_kwargs.update(kwargs)
        return ChatOpenAI(**openai_kwargs)

    raise ValueError(
        f"不支持的 LLM provider: {provider!r}，可选: anthropic / openai"
    )
