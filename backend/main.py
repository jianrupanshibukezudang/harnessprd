"""HarnessPRD 后端应用入口。

启动方式（在 backend/ 目录下）:
    python main.py                 # 读取 .env 中的 HOST / PORT，开发模式带热重载
    uvicorn main:app --reload      # 等价的 uvicorn 命令
"""

import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from api.config import router as config_router
from api.conversation import router as conversation_router
from core.config import get_settings

settings = get_settings()

app = FastAPI(
    title=settings.app_name,
    description="HarnessPRD - AI 驱动的 PRD 需求收集工具",
    version="0.1.0",
)

# 本地开发: 允许 Vite 前端跨域访问
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 业务路由（完整前缀已在各自 Router 中声明）
app.include_router(conversation_router)
app.include_router(config_router)


@app.get("/health", tags=["root"])
def health_check() -> dict:
    """健康检查: 供部署探活与前端连通性检测，不挂 /api 前缀。"""
    return {"status": "ok"}


@app.get("/", tags=["root"])
def root() -> dict:
    return {"name": settings.app_name, "env": settings.app_env, "status": "ok"}


if __name__ == "__main__":
    # 直接 python main.py 启动时，监听 HOST:PORT；开发环境开启热重载
    uvicorn.run(
        "main:app",
        host=settings.host,
        port=settings.port,
        reload=settings.app_env == "development",
    )
