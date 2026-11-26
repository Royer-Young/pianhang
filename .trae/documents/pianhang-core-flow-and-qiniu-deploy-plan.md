# 偏航：核心闭环 + 七牛云上线准备 实施计划

## Context

项目当前状态：前端同源架构已就绪，后端 FastAPI + SQLite + demo 账号跑通了账号、足迹、收藏；但部署前有三个 P0 阻断项必须修复——云端 IP 定位不准、选中路线即记完成（无“真实完成”确认）、无目的地路线没有回起点策略。同时需要做好生产安全（限流、禁用 demo 账号、固定依赖）和部署便携性（Docker + Node/Python 双轨支持、SQLite 持久卷）。

本轮范围：核心闭环改造 + 上线准备；暂不迁移 PostgreSQL、暂不切换正式授权地图服务、暂不接入真实 GPS 轨迹。托管方式兼容 Docker 和 Node+Python 两条路径，为七牛云全站/全栈托管做准备。

## 改动清单

### A. 核心主流程改造

**A1. 浏览器精确优先定位 + 手动兜底**

- 文件：`js/app.js`
- 当前 `locateUser()` 只走 IP 定位（后端 `/api/ip` + 公开兜底），部署后云端 IP 会把所有用户定位到七牛云机房。
- 改动：新增 `geolocateUser()` 走 `navigator.geolocation.getCurrentPosition`（超时 6s），与 IP 定位并行竞速，精确结果覆盖 IP 位置。定位条/起点字段展示来源（GPS / IP / 地图中心）。保留手动选点覆盖。
- 复用：`applyUserLocation()`、`ensureUserLocation()`、`ipLocate()`。

**A2. 结束偏航确认才记录完成**

- 文件：`js/app.js`、`js/auth.js`
- 当前 `selectRoute(i)` 直接调用 `recordDetour()` 写入成就；`exitNav()` 只是退出导航。
- 改动：`selectRoute()` 改为创建一次"进行中"的内存会话（记录所选路线、开始时间、天气），**不立即提交后端**。`enterNav()` 导航栏里的"结束偏航"按钮弹出确认对话框（"确认完成这次偏航？"），用户确认后才调用 `recordDetour()` 提交。中途取消/切换路线/退出不成就。
- 复用：`recordDetour()`、`enterNav()`、`exitNav()`。
- 回归关注：`cleanupReplay()` / `pendingReplay` 回放流程、`resetToStart()` 重置逻辑、足迹页 `loadDetours()`。

**A3. 无目的地增加回起点策略**

- 文件：`js/app.js`、`index.html`、`css/style.css`
- 当前无目的地模式路线不回起点（OSRM 请求没传终点）。
- 改动：目的地问询屏（`view-dest`）两个选项升级为三个——①有目的地、②无目的地→回到起点、③无目的地→走到哪算哪。偏好页标题和生成逻辑对应调整。搜索中心仍按起终点中点/起点计算，只是 OSRM 请求可选是否传终点。
- 复用：`buildOsmrUrl()`、`enterPrefView()`。

**A4. 时间预算计入返程与停留**

- 文件：`js/app.js`
- 当前预算 `maxDistance = mc.speed * minutes * weatherFactor * budgetMul * 1.35` 纯按距离，没考虑回起点。
- 改动：回起点模式下，预算提前预留约 15% 返程缓冲；停留时间按途经点数 × 3 分钟扣除（影响可行驶距离）。生成阶段 `showRoutesModal` 里每条卡片增加"预计总时长=路线行驶+停留"的文字提示。
- 复用：`maxDistance` 计算链、`showRoutesModal`。

**A5. 路线选择前预览 + 真正差异化候选**

- 文件：`js/app.js`、`css/style.css`
- 当前三条候选只靠途经点名称去重，路线几何可能高度重叠。
- 改动（轻量版，本轮上线前能做的）：
  1. 路线卡片上增加一个迷你缩略图（在 Leaflet 里用 SVG 生成，或把路线坐标降采样后 `encodeURIComponent` 塞进一个 div 画 path），不引入新依赖。
  2. 候选生成阶段增加"路线重叠率"检测：如果两条候选几何重叠度 > 0.7，换一组途经点重试。
  3. 卡片文案突出一条明确差异（如"更多咖啡店"、"更少折返"、"室内停靠多"）。

### B. 生产安全与数据

**B1. 生产禁用 demo 账号 + 账号删除 + 偏航删除**

- 文件：`backend/main.py`、`js/auth.js`
- 改动：`init_db()` 增加环境变量 `ENABLE_DEMO_ACCOUNT=1` 控制是否创建 `demo/pianhang`。新增 `DELETE /api/auth/me`（删除账号与关联数据）和 `DELETE /api/detours/{id}`。前端足迹页增加删除按钮。

**B2. 接口限流**

- 文件：`backend/main.py`、`backend/requirements.txt`
- 新增依赖 `slowapi`、`limits`。登录/注册（按 IP）、AI 三接口（按 IP）、逆地理（按 IP）各加轻量限流（如 5 次/分钟）。用内存存储（小公测阶段够用）。

**B3. 依赖固定版本**

- 文件：`backend/requirements.txt`
- 把 `>=` 改成精确版本号，锁定一个已验证的组合：
  `fastapi==0.115.0`、`uvicorn[standard]==0.30.6`、`python-dotenv==1.0.1`、`openai==1.42.0`、`slowapi==0.1.9`、`limits==3.13.0`。

**B4. 真实客户端 IP + 安全代理头**

- 文件：`backend/main.py`
- 当前 `/api/ip` 没处理反向代理。加一个依赖 `uvicorn.middleware.proxy_headers.ProxyHeadersMiddleware`，让 `request.client.host` 读到真实 IP（七牛云托管会有代理层）。同步给 `/api/ip` 加上从 request 里取 X-Forwarded-For 或 request.client.host 的能力，而不是全部用 ip-api 返回的那套。

**B5. SQLite 数据目录与备份**

- 文件：`.env.example`、新增 `backend/backup.sh`（或在 README 里）
- 确保 `PIANHANG_DB` 默认为 `${APP_DATA:-backend}/pianhang.db`，部署时设置为持久卷路径。备份脚本执行 `sqlite3 pianhang.db ".backup pianhang.db.bak"`。

**B6. 隐私与安全默认**

- 文件：`backend/.env.example`、`backend/main.py`
- 新增 `ENVIRONMENT=development|production`，生产时自动强制 `COOKIE_SECURE=1`、禁用 demo 账号、收紧 CORS 为 `[]` 并由 Nginx 处理。

### C. 部署与构建

**C1. Docker 多阶段构建**

- 新增 `Dockerfile`：阶段 1 Node 18 构建前端（`VITE_API_BASE_URL=SAME_ORIGIN npm run build`），阶段 2 Python 3.11-slim 安装后端依赖，拷贝 dist + backend，监听 `$PORT`。
- 新增 `.dockerignore`：排除 dist/（由构建生成）、backend/*.db、.env、.tools、*.log 等。

**C2. Node + Python 双轨兼容**

- 文件：`start.sh` 已同源构建逻辑可直接复用；README 补充七牛云"直接用 Node 构建 + Python 启动"模式的命令链。

**C3. 健康检查**

- 文件：`backend/main.py`
- `/api/healthz` 轻量健康检查（返回 200 + 版本号 + DB 连接测试），用于平台健康探针。与已有 `/api/status` 区分：`/api/status` 给用户看，`/api/healthz` 给平台探测。

**C4. Leaflet 自托管**

- 当前 `index.html` 引用 `unpkg.com/leaflet@1.9.4` CDN。下载 CSS/JS 到 `assets/vendor/leaflet/`，改引用为本地路径，避免外部依赖波动。

**C5. 文档更新**

- 更新 README 的部署段、新增七牛云托管指南、更新环境变量说明、列出生产安全配置清单和备份步骤。

## 关键可复用代码

- 定位：`applyUserLocation`、`ensureUserLocation`、`ipLocate`（`js/app.js:167-247`）
- 候选生成：`loadCandidates`、`buildCandidate`、`collect`（`js/app.js:1795-1939`）
- 路线绘制：`drawCandidateRoute`、`enterNav`、`exitNav`（`js/app.js:2319-2410`）
- 记录：`recordDetour`（`js/app.js:2231-2261`）+ `js/auth.js:656-661`
- 偏好选择：`enterPrefView`、`buildOsmrUrl`（`js/app.js:135-148, 935-941`）
- 静态前端托管：`backend/main.py:1161-1168`
- 同源构建：`scripts/build.js`、`start.sh:25-35`

## 验证方案

1. **定位回归**：本机模拟服务器 IP 与浏览器真实 IP 不同的情况，确认 GPS 结果优先于 IP。
2. **结束确认**：选中路线后不退出导航，直接关闭页面 → 重进后足迹不出现；点击"结束偏航"确认后足迹和成就更新。
3. **返程与时间**：无目的地模式生成的路线是否回到起点；短时间（30min）时提示文字是否合理。
4. **候选差异**：三条路线卡片是否有迷你图、是否有差异化描述；手动生成几次观察几何重叠。
5. **限流与禁用**：请求登录接口 >5 次是否被拒；生产环境启动后 demo 账号不存在。
6. **容器启动**：本地 `docker build . && docker run -p 8000:8000 pianhang` 确认页面 200 + `/api/healthz` 正常。
7. **CI 通过**：现有 CI 流程补 Dockerfile lint + 生产依赖安装验证。
