"""对话 / 文档路由层。

本文件只负责: 参数解析、调用 service、包装响应。
业务逻辑一律写在 services/conversation_service.py / services/document_service.py。

SSE 事件规范:
- event: chunk     单段 AI 文本 (data: {"text": "..."})
- event: messages  对话一轮结束回传完整消息历史 (data: {"messages": [...]})
- event: progress  文档生成开始提示 (data: {"message": "..."})
- event: document  文档生成定版 (data: {"doc_type": "...", "content": "..."})
- event: done      流正常结束 (data: {})
- event: error     发生异常 (data: {"message": "..."})
"""

import json
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, status
from fastapi.responses import StreamingResponse

from api import schemas
from services.conversation_service import ConversationService
from services.document_service import DocumentService

router = APIRouter(prefix="/api/conversation", tags=["conversation"])

# 标准 SSE 响应头：禁缓存、长连接、关闭 Nginx 等代理的缓冲
SSE_HEADERS = {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no",
}

_QUESTIONS_CONFIG_PATH = (
    Path(__file__).resolve().parent.parent / "core" / "questions_config.json"
)


def _make_sse_generator(
    chunks: AsyncIterator[str | dict[str, Any]],
) -> AsyncIterator[str]:
    """把 service 层的异步产出包装成标准 SSE 帧。

    输入块:
    - str: AI 文本增量，包装为 ``event: chunk``
    - dict: 显式事件 (形如 ``{"event": "messages", "data": {...}}``)

    流结束自动补发 ``done``；异常时下发 ``error``，避免连接静默挂死。
    每帧格式: ``event: <名>\\ndata: <json>\\n\\n``
    """

    async def generator() -> AsyncIterator[str]:
        try:
            async for chunk in chunks:
                if isinstance(chunk, str):
                    event, data = "chunk", {"text": chunk}
                else:
                    event = chunk.get("event", "message")
                    data = chunk.get("data", {})
                encoded = json.dumps(data, ensure_ascii=False)
                yield f"event: {event}\ndata: {encoded}\n\n"
            yield "event: done\ndata: {}\n\n"
        except Exception as exc:
            payload = json.dumps({"message": str(exc)}, ensure_ascii=False)
            yield f"event: error\ndata: {payload}\n\n"

    return generator()


def _stream_response(
    chunks: AsyncIterator[str | dict[str, Any]],
) -> StreamingResponse:
    """统一构造 SSE 响应，保证两个端点行为一致。"""
    return StreamingResponse(
        _make_sse_generator(chunks),
        media_type="text/event-stream",
        headers=SSE_HEADERS,
    )


# ---------------- 澄清问题配置 ----------------

@router.get(
    "/questions",
    response_model=schemas.QuestionsConfig,
    summary="获取需求澄清问题配置",
)
def get_questions() -> schemas.QuestionsConfig:
    """读取 core/questions_config.json 并返回结构化的澄清问题清单。"""
    if not _QUESTIONS_CONFIG_PATH.is_file():
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="questions_config.json 配置文件缺失",
        )
    raw = json.loads(_QUESTIONS_CONFIG_PATH.read_text(encoding="utf-8"))
    return schemas.QuestionsConfig.model_validate(raw)


# ---------------- 流式对话 ----------------

@router.post("/start-stream", summary="基于表单开启首轮 AI 澄清对话")
def start_stream(request: schemas.StartStreamRequest) -> StreamingResponse:
    """首轮: AI 阅读表单内容，复述理解并提出 1-3 个关键追问。"""
    service = ConversationService(provider=request.provider, model=request.model)
    chunks = service.start_conversation_stream(request.form_data)
    return _stream_response(chunks)


@router.post("/continue-stream", summary="携带历史消息接续 AI 对话")
def continue_stream(request: schemas.ContinueStreamRequest) -> StreamingResponse:
    """后续轮次: 在历史上下文后追加用户新消息，流式返回 AI 回复。"""
    service = ConversationService(provider=request.provider, model=request.model)
    chunks = service.continue_conversation_stream(
        history=[msg.model_dump() for msg in request.history],
        message=request.message,
    )
    return _stream_response(chunks)


# ---------------- 空壳路由（待接入 service） ----------------

@router.get("", response_model=list[schemas.SessionInfo], summary="会话列表")
def list_sessions() -> list[schemas.SessionInfo]:
    # TODO: items = conversation_service.list_sessions()
    raise HTTPException(
        status_code=status.HTTP_501_NOT_IMPLEMENTED, detail="会话列表待实现"
    )


# ---------------- 文档生成（流式） ----------------

@router.post("/generate-prd-stream", summary="根据表单与对话生成 PRD")
def generate_prd_stream(request: schemas.GeneratePRDRequest) -> StreamingResponse:
    """PRD: 表单数据 + 澄清对话记录作为素材。"""
    service = DocumentService(provider=request.provider, model=request.model)
    chunks = service.generate_prd_stream(
        history=[msg.model_dump() for msg in request.history],
        form_data=request.form_data,
    )
    return _stream_response(chunks)


@router.post("/generate-api-docs-stream", summary="根据 PRD 生成接口文档")
def generate_api_docs_stream(
    request: schemas.GenerateApiDocsRequest,
) -> StreamingResponse:
    """接口文档: PRD Markdown 全文作为素材。"""
    service = DocumentService(provider=request.provider, model=request.model)
    chunks = service.generate_api_docs_stream(request.prd_content)
    return _stream_response(chunks)


@router.post("/generate-prompts-stream", summary="根据 PRD 生成提示词套件")
def generate_prompts_stream(
    request: schemas.GeneratePromptsRequest,
) -> StreamingResponse:
    """提示词套件: PRD Markdown 全文作为素材。"""
    service = DocumentService(provider=request.provider, model=request.model)
    chunks = service.generate_prompts_stream(request.prd_content)
    return _stream_response(chunks)


@router.post("/optimize-document-stream", summary="按优化要求改进文档")
def optimize_document_stream(
    request: schemas.OptimizeDocumentRequest,
) -> StreamingResponse:
    """文档优化: 返回优化后的完整文档。"""
    service = DocumentService(provider=request.provider, model=request.model)
    chunks = service.optimize_document_stream(
        document=request.document,
        instruction=request.instruction,
        doc_type=request.doc_type,
    )
    return _stream_response(chunks)
