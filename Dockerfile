# ============================================================
# 偏航 Pianhang - 多阶段 Docker 构建
# 阶段 1: Node 构建前端（同源部署，VITE_API_BASE_URL=SAME_ORIGIN）
# 阶段 2: Python 运行后端（FastAPI + uvicorn + SQLite + 静态托管 dist/）
# 运行时: 监听 $PORT（容器默认 8000）
#         数据持久化: /data/pianhang 挂载持久卷，存放 pianhang.db
# 健康检查: GET /api/healthz  → 200 + {"ok":true}
# ============================================================

# ---- 阶段 1: 前端构建 ----
FROM node:18-alpine AS frontend-build
WORKDIR /app
# 先只复制 package.json + 构建脚本，利用 docker 缓存层
COPY package.json ./
COPY scripts/ ./scripts/
# 复制前端资源（不依赖后端代码）
COPY css/ ./css/
COPY js/ ./js/
COPY assets/ ./assets/
COPY index.html ./

# 同源构建：前端与后端同域，无需跨域
ENV VITE_API_BASE_URL=SAME_ORIGIN
RUN npm run build


# ---- 阶段 2: 后端运行 ----
FROM python:3.11-slim AS runtime

# 系统依赖：sqlite3 备份用；ca-certificates 确保 HTTPS 可用
RUN apt-get update \
    && apt-get install -y --no-install-recommends sqlite3 ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 后端依赖（先复制 requirements.txt，利用 docker 缓存层）
COPY backend/requirements.txt ./backend/requirements.txt
RUN pip install --no-cache-dir -r ./backend/requirements.txt

# 后端代码（不含 .env、不含 .db）
COPY backend/ ./backend/

# 前端构建产物（由阶段 1 生成的 dist/）
COPY --from=frontend-build /app/dist ./dist

# 持久数据目录
RUN mkdir -p /data/pianhang

# 环境变量
ENV ENVIRONMENT=production \
    PIANHANG_DB=/data/pianhang/pianhang.db \
    ENABLE_DEMO_ACCOUNT=0 \
    COOKIE_SECURE=1 \
    PORT=8000

EXPOSE 8000

# 健康检查
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -fsS http://localhost:${PORT}/api/healthz || exit 1

CMD ["sh", "-c", "exec uvicorn backend.main:app --host 0.0.0.0 --port ${PORT}"]
