# HarnessPRD Backend

FastAPI + LangChain (Anthropic / OpenAI) 后端。

## 目录结构

```
backend/
├── main.py              # 应用入口 (FastAPI app)
├── requirements.txt
├── .env.example         # 环境变量模板 (复制为 .env 使用)
├── api/                     # 路由层（只做参数解析，不写业务逻辑）
│   ├── __init__.py
│   ├── schemas.py           # Pydantic 请求/响应模型
│   ├── conversation.py      # 对话路由 + SSE 包装 + /questions
│   └── config.py            # 配置路由（空壳）
├── core/                    # 配置与静态资源
│   ├── config.py            # 全局配置 (pydantic-settings)
│   └── questions_config.json # 需求澄清问题配置
└── services/                # 业务逻辑
    ├── llm_factory.py       # get_llm() 工厂：选择 Anthropic / OpenAI / 兼容网关
    ├── prompts.py           # 系统提示词 / 文档生成提示词常量
    ├── conversation_service.py # PM 澄清对话（首轮/接续，astream）
    └── document_service.py  # PRD/接口文档/提示词生成与优化（astream）
```

## 本地启动

```bash
# 1. 创建虚拟环境（Python 3.11 / 3.12；3.13+ 部分依赖可能无预编译包）
python -m venv .venv
# Windows
.venv\Scripts\activate
# macOS / Linux
source .venv/bin/activate
# 或使用 uv（可自动下载独立 Python）: uv venv --python 3.12 .venv

# 2. 安装依赖
pip install -r requirements.txt   # 或 uv pip install -r requirements.txt

# 3. 配置环境变量
cp .env.example .env   # Windows: copy .env.example .env

# 4. 启动开发服务器（以下任一方式）
python main.py
uvicorn main:app --reload
```

## LLM Provider 配置

- **Anthropic / OpenAI 官方**：在 `.env` 填入对应 `ANTHROPIC_API_KEY` / `OPENAI_API_KEY`，
  设置 `DEFAULT_LLM_PROVIDER` 与 `DEFAULT_LLM_MODEL` 即可，BASE_URL 留空。
- **OpenAI 兼容网关**（火山方舟 Ark、各类中转）：`DEFAULT_LLM_PROVIDER=openai`，
  填入网关 Key、网关地址 `OPENAI_BASE_URL` 和该平台的模型 ID。
  火山方舟北京区域为 `https://ark.cn-beijing.volces.com/api/v3`，国内直连无需代理；
  注意使用「方舟控制台创建的 API Key（`ark-` 前缀）」而非 IAM API Key，
  且模型需先在模型广场「开通」。
- 长文档生成默认输出上限 `DOC_MAX_TOKENS=16384`（对话 `LLM_MAX_TOKENS=4096`），
  在 `.env` 覆盖；过小会导致 PRD 等长文档中途被截断。

- API 服务: http://127.0.0.1:8000（监听地址/端口读取 .env 中的 HOST / PORT）
- 交互式文档: http://127.0.0.1:8000/docs
- 健康检查: http://127.0.0.1:8000/health
- 澄清问题配置: http://127.0.0.1:8000/api/conversation/questions
- 首轮对话(SSE): POST /api/conversation/start-stream
- 接续对话(SSE): POST /api/conversation/continue-stream
- 生成 PRD(SSE): POST /api/conversation/generate-prd-stream
- 生成接口文档(SSE): POST /api/conversation/generate-api-docs-stream
- 生成提示词套件(SSE): POST /api/conversation/generate-prompts-stream
- 优化文档(SSE): POST /api/conversation/optimize-document-stream
- 配置路由（空壳）: /api/config

SSE 事件: chunk(文本增量) / messages(完整历史) / progress(生成提示) / document(文档定版) / done(结束) / error(异常)。
