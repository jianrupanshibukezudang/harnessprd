"""全局配置管理。

使用 pydantic-settings 从环境变量与 .env 文件加载配置:
- 字段名不区分大小写，自动映射同名环境变量 (如 anthropic_api_key -> ANTHROPIC_API_KEY)
- 所有密钥只从环境读取，不硬编码、不下发前端
- 通过 get_settings() 获取单例，避免重复解析 .env
"""

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",  # .env 中多余的变量不报错
    )

    # ---- LLM 密钥（留空则对应 Provider 无法使用）----
    anthropic_api_key: str = ""
    openai_api_key: str = ""

    # ---- 默认 LLM 配置 ----
    default_llm_provider: str = "anthropic"  # anthropic | openai
    default_llm_model: str = "claude-sonnet-4-20250514"

    # ---- 推理开关 ----
    # 部分网关模型（如方舟豆包 Seed / DeepSeek-R 系）默认开启深度思考，
    # 思考 token 计入输出上限，复杂任务可能耗尽预算导致正文为空。
    # False = 关闭思考（更快、更省、输出长度可控）；仅对 OpenAI 兼容网关生效。
    llm_thinking_enabled: bool = False

    # ---- 输出长度 ----
    # 对话回复一般较短；文档（PRD/接口文档/提示词套件）需要更大的输出上限，
    # 否则会在长文档中途被模型截断
    llm_max_tokens: int = 4096
    doc_max_tokens: int = 16384

    # ---- 自定义网关端点（可选）----
    # 使用 OpenAI 兼容网关时填写，例如火山方舟:
    #   https://ark.cn-beijing.volces.com/api/v3
    openai_base_url: str = ""
    anthropic_base_url: str = ""

    # ---- 服务配置 ----
    # .env 中以逗号分隔的字符串存储，使用时通过 cors_origins_list 解析
    cors_origins: str = "http://localhost:5173"
    host: str = "0.0.0.0"
    port: int = 8000

    # ---- 应用常量 ----
    app_name: str = "HarnessPRD"
    app_env: str = "development"
    api_v1_prefix: str = "/api"

    @property
    def cors_origins_list(self) -> list[str]:
        """将逗号分隔的 CORS_ORIGINS 解析为去空白后的列表。"""
        return [
            origin.strip()
            for origin in self.cors_origins.split(",")
            if origin.strip()
        ]


@lru_cache
def get_settings() -> Settings:
    """返回全局唯一的配置实例。"""
    return Settings()
