# 偏航

[![CI](https://github.com/Royer-Young/pianhang/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/Royer-Young/pianhang/actions/workflows/ci.yml)

一款城市步行探索 Web 应用，鼓励用户偏离最短路径，在城市中发现意外的风景。

## 功能特性

- **时间选择**：支持 30 分钟、60 分钟快捷选择，或通过自定义轮盘精确设置（上限 4 小时 59 分）
- **目的地问询**：支持有目的地与无目的地两种探索模式
- **偏好设置**：出行方式（步行 / 骑行·自行车 / 骑行·电动车）与地点偏好（公园、咖啡店、书店、博物馆、广场、景点）
- **智能推荐**：综合天气、时间与用户偏好，用规则打分和 OSRM 生成 3 条候选路线；大模型负责解析偏好、生成推荐理由
- **沉浸式路线视图**：全屏展示完整路线、途经站点、距离、出行方式与天气（非逐转向 GPS 导航）
- **账号与同步**：注册 / 登录 / 个人中心，偏好设置登录后跨设备同步
- **足迹与收藏**：选择路线后自动记录本次偏航与统计，途经点可收藏，收藏夹支持取消
- **偏航记录与成就**：回看历史路线、点亮 6 枚城市徽章
- **重新偏航**：随时返回起点，开启新一轮探索

## 技术栈

| 层级 | 技术选型 | 用途 |
|------|----------|------|
| 前端 | HTML5 + CSS3 + JavaScript（ES6+） | 页面结构、样式与交互逻辑，无前端框架 |
| 地图渲染 | Leaflet.js 1.9 + 高德瓦片（GCJ-02） | 地图渲染、Marker 标注与路线绘制 |
| 后端 | Python 3.9+ / FastAPI 0.100+ / Uvicorn 0.23+ | RESTful 接口服务、第三方代理与静态资源托管 |
| AI | OpenAI 兼容大模型接口 | 偏好解析、路线推荐理由生成、地点简介；未配置密钥时自动降级 |
| 地点数据 | Photon + Overpass API（OpenStreetMap） | 按类别检索附近真实公园、咖啡店、书店等；Overpass 多镜像并行补充 |
| 地点数据 | 高德逆地理编码（公开网页端接口） | 真实地点不足时兜底附近道路、路口与地标；后端代理并缓存 |
| 路线 | OSRM（Open Source Routing Machine） | 计算路线几何与距离；比赛版使用公共 demo 服务 |
| 天气 | Open-Meteo | 实时天气与温度，用于调整地点偏好和距离预算 |
| 存储 | SQLite（WAL） | 账号、会话、偏好、偏航记录与收藏 |
| 构建 | Node.js 16+ | 前端资源复制与 API 地址注入，无 npm 依赖 |
| CI | GitHub Actions | 自动构建验证与后端启动检查 |

## 技术实现说明

### 前后端分工

- **前端**：原生单页应用，负责交互、Leaflet 地图渲染、坐标转换、地点筛选与候选路线组织。
- **后端**：FastAPI 负责三件事——代理第三方数据、调用大模型、托管 `dist/` 前端产物；账号与业务数据存入 SQLite。
- **同源部署**：页面与 `/api/*` 在同一个服务、同一个域名下，Cookie 会话不依赖跨域配置。

### 一次路线生成的数据流

1. 读取时间、出行方式、节奏、地点偏好与可选的自然语言描述。
2. 定位：浏览器定位 → IP 定位 → 地图中心，逐级兜底。
3. `/api/parse_pref` 把自然语言解析为结构化偏好；失败时使用关键词规则。
4. Open-Meteo 读取天气；雨雪提高室内地点权重，极端温度缩短搜索半径与距离预算。
5. 地点按优先级获取：Photon（OSM 真实地点）→ Overpass（多镜像并行）→ 高德逆地理（道路 / 路口 / 地标）→ 方位街角兜底。
6. 按距离、时间预算、新奇度、用户偏好与顺路程度打分，选出 2–4 个途经点并做贪心排序。
7. OSRM 计算路线几何与距离；超过预算 1.35 倍的候选会被丢弃并重试，最终保留 3 条候选。
8. 大模型为每条候选生成推荐理由；用户选中后，轨迹压缩到最多 900 个点写入偏航记录。

### AI 的边界

大模型只负责**语言层**：偏好解析、推荐理由、地点简介。路线坐标由 OSRM 计算，地点来自 OSM / 高德真实数据，途经点由前端规则打分选出。这样既避免模型编造不存在的街道和地点，也能在关闭大模型时保留完整的路线生成能力。

### 坐标系

高德瓦片使用 GCJ-02，OSM / Photon / OSRM 使用 WGS-84。前端在绘制前把 WGS-84 转为 GCJ-02，用户点击地图时再转回 WGS-84 查询地点。

## 环境要求

- **Node.js** >= 16（仅用于运行构建脚本，构建脚本不依赖任何 npm 包，无需 `npm install`）
- **Python** >= 3.9（用于后端服务）
- **pip**（Python 包管理）
- 现代浏览器（Chrome / Edge / Firefox 最新版）

## 环境变量配置

后端通过 `backend/.env` 文件读取配置。首次运行需从模板复制：

```bash
cd backend
cp .env.example .env
```

| 变量名 | 必填 | 默认值 | 说明 |
|--------|------|--------|------|
| `LLM_API_KEY` | 否 | 空 | 大模型 API 密钥。配置后启用真实 AI 推荐；留空则自动进入模拟模式 |
| `LLM_BASE_URL` | 否 | `https://api.openai-next.com/v1` | OpenAI 兼容接口的 Base URL |
| `LLM_MODEL` | 否 | `deepseek-v4-flash` | 使用的模型名称 |
| `CORS_ORIGINS` | 否 | 本地 `8000` / `8124` | 允许跨域的来源，逗号分隔。账号 Cookie 需要明确来源，**不能使用 `*`**；同源部署无需调整 |
| `PIANHANG_DB` | 否 | `backend/pianhang.db` | SQLite 账号数据库路径；运行后自动创建，已加入 `.gitignore` |
| `COOKIE_SECURE` | 否 | `0` | 部署到 HTTPS 时设为 `1`，会话 Cookie 将带上 `Secure` |

> 模拟模式下，路线推荐理由与地点简介由内置规则生成，可正常体验完整流程，但内容为预设文本。

> 首次启动会自动创建账号数据库，并预置演示账号 **`demo` / `pianhang`**，可直接体验个人中心。

## 快速开始（Windows 一键启动）

如果只是想快速跑起来看效果，且使用 **Windows**：

1. 安装 [Python 3.9+](https://www.python.org/downloads/)（安装时务必勾选 **Add Python to PATH**）
2. 安装后端依赖：

   ```bash
   pip install -r backend/requirements.txt
   ```

3. **双击项目根目录下的 `start.bat`**
4. 脚本会：自动用同源模式（`SAME_ORIGIN`）构建前端 → 启动**单个**后端服务（同时托管页面与 `/api` 接口）→ 自动打开浏览器

运行后只需保留弹出的 **`pianhang-service`** 黑色窗口即可。脚本会打印实际访问地址。

> - **端口自动选择**：`:8000` 经常被酷狗等本机软件占用，脚本不再硬编码 8000。它会先确认该端口上运行的是不是偏航（检查 `/api/status`），是则直接复用，否则在 `8000–8099` 中挑选一个空闲端口启动，并把端口写入 `.pianhang-port`（已 gitignore），浏览器和 `go-online.bat` 都会跟随这个端口。若输出 `Port 8000 is busy - using port 8001 instead.`，属正常现象。
> - 需要 [Node.js 16+](https://nodejs.org/) 用于前端构建。`dist/` 构建产物**不入库**，所以新克隆的仓库没有 `dist/`：本机装了 Node 时双击即自动构建；若已存在 `dist/`（例如构建过一次），则即使没有 Node 也会直接复用。
> - 未配置大模型密钥时自动进入模拟模式，无需任何额外配置即可完整体验全部功能；配置真实 AI 推荐见下文「环境变量配置」。
> - 本机其他设备可访问 `http://<本机IP>:<实际端口>`（同一 Wi-Fi，允许 Python 通过防火墙即可）。

### macOS / Linux 一键启动

macOS / Linux 使用 `start.sh`（效果与 `start.bat` 相同，同源单服务）：

```bash
# 1. 安装后端依赖
pip install -r backend/requirements.txt

# 2. 一键启动（自动用 SAME_ORIGIN 构建前端后，托管页面与接口）
./start.sh
```

脚本会打印实际访问地址（`http://localhost:<端口>`）。`:8000` 被占用时会自动改用 `8001` 起的空闲端口。停止服务按 `Ctrl+C`。

> 若提示 `Permission denied`，先执行 `chmod +x start.sh`。
> 同样需要 Node.js 用于首次前端构建（`dist/` 不入库）；无 Node 且无 `dist/` 时会给出明确报错。

## 本地运行

### 1. 克隆仓库

```bash
git clone https://github.com/Royer-Young/pianhang.git
cd pianhang
```

### 2. 配置后端环境变量

```bash
cd backend
cp .env.example .env
```

按需编辑 `backend/.env`，填入大模型 API 密钥（可选）。

### 3. 安装后端依赖并启动

```bash
cd backend
pip install -r requirements.txt
python -m uvicorn main:app --host 0.0.0.0 --port 8001 --reload
```

后端启动后监听 `8001` 端口，`--reload` 用于开发时热重载。

### 4. 构建前端

```bash
node scripts/build.js
```

构建产物输出至 `dist/` 目录，默认指向本地后端 `http://localhost:8001`。

如需指向其他后端地址：

```bash
# Windows PowerShell
$env:VITE_API_BASE_URL="http://localhost:8002"; node scripts/build.js

# macOS / Linux
VITE_API_BASE_URL=http://localhost:8002 node scripts/build.js
```

### 5. 启动前端静态服务

```bash
python -m http.server 8000
```

### 6. 访问应用

浏览器打开 `http://localhost:8000`。

### 常见问题

| 现象 | 可能原因 | 解决方式 |
|------|----------|----------|
| 地图不显示 | 网络无法访问高德瓦片或 Leaflet CDN | 检查网络连接 |
| 推荐理由为固定文本 | 未配置 `LLM_API_KEY` | 在 `backend/.env` 中填入密钥并重启后端 |
| 前端请求后端失败 | 构建时 API 地址与实际后端端口不一致 | 使用 `VITE_API_BASE_URL` 重新构建 |
| 定位失败 | 浏览器或网络限制 IP 查询 | 手动在地图上选择起点 |

## 部署

本项目采用前后端同源部署架构：前端构建产物由 FastAPI 直接托管，AI 接口与页面同域，无需额外配置跨域。

### 同源部署（推荐）

1. **以同源模式构建前端**

   ```bash
   VITE_API_BASE_URL=SAME_ORIGIN node scripts/build.js
   ```

   `SAME_ORIGIN` 表示前端请求相对路径 `/api/*`，由同源后端处理。

2. **启动后端服务**

   ```bash
   cd backend
   pip install -r requirements.txt
   python -m uvicorn main:app --host 0.0.0.0 --port 8000
   ```

   后端会自动挂载 `dist/` 目录，访问根路径即返回前端页面。

3. **访问应用**

   浏览器打开 `http://<服务器地址>:8000`。

### 云服务器部署

项目可直接部署至任意支持 Python 的云服务器。

1. 拉取代码至服务器

   ```bash
   git clone https://github.com/Royer-Young/pianhang.git
   cd pianhang
   ```

2. 配置环境变量

   ```bash
   cd backend
   cp .env.example .env
   # 编辑 .env，填入 LLM_API_KEY
   ```

3. 安装依赖并构建前端

   ```bash
   pip install -r backend/requirements.txt
   VITE_API_BASE_URL=SAME_ORIGIN node scripts/build.js
   ```

4. 使用进程守护工具保持后端运行（以 systemd 为例）

   ```ini
   # /etc/systemd/system/pianhang.service
   [Unit]
   Description=Pianhang FastAPI Service
   After=network.target

   [Service]
   WorkingDirectory=/path/to/pianhang/backend
   ExecStart=python -m uvicorn main:app --host 0.0.0.0 --port 8000
   Restart=always

   [Install]
   WantedBy=multi-user.target
   ```

   ```bash
   sudo systemctl daemon-reload
   sudo systemctl enable pianhang
   sudo systemctl start pianhang
   ```

5. 可选：通过 Nginx 反向代理并配置 HTTPS

   ```nginx
   server {
       listen 80;
       server_name your-domain.com;

       location / {
           proxy_pass http://127.0.0.1:8000;
           proxy_set_header Host $host;
           proxy_set_header X-Real-IP $remote_addr;
       }
   }
   ```

### 接口说明

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/status` | 服务状态与运行模式（real / mock） |
| GET | `/api/ip` | IP 定位代理，返回经纬度与城市 |
| GET | `/api/amap/regeo` | 高德逆地理编码代理（无需 key，后端缓存），返回附近道路 / 路口 / 地标 |
| POST | `/api/parse_pref` | 解析用户偏好为结构化参数 |
| POST | `/api/get_reason` | 生成路线推荐理由 |
| POST | `/api/get_intro` | 生成地点简介 |
| GET | `/api/auth/me` | 获取当前登录用户与统计（游客返回 `authenticated: false`） |
| POST | `/api/auth/register` | 注册并写入 HttpOnly 会话 Cookie |
| POST | `/api/auth/login` | 登录，演示账号 `demo` / `pianhang` |
| POST | `/api/auth/logout` | 退出并清除会话 |
| PATCH | `/api/auth/profile` | 修改昵称、常驻城市与一句话简介 |
| PUT | `/api/auth/preferences` | 保存出行方式、节奏与地点偏好（登录后跨设备同步） |
| POST | `/api/detours` | 记录一次完成的偏航（起点、终点、途经点、天气、距离） |
| GET | `/api/detours` | 拉取当前用户的偏航记录与统计（足迹 / 记录 / 成就页共用） |
| GET | `/api/favorites` | 拉取当前用户的收藏地点与统计 |
| POST | `/api/favorites` | 收藏一个地点（同名同坐标自动去重） |
| DELETE | `/api/favorites/{id}` | 取消收藏 |

> 账号接口仅使用 Cookie 会话，没有前端可读的 Token；密码以 PBKDF2-SHA256（24 万次迭代）加盐哈希存储。

## 项目结构

```
pianhang/
├── index.html              # 页面骨架与各视图结构
├── css/
│   ├── style.css           # 主流程（时间 / 偏好 / 路线 / 导航）样式
│   ├── shell.css           # 应用外壳、侧边栏与页面底图
│   ├── home.css            # 首页、足迹、收藏、成就等页面样式
│   └── auth.css            # 登录 / 注册弹层与个人中心
├── js/
│   ├── app.js              # 交互逻辑、地图渲染与路线计算
│   ├── prefs.js            # 偏好设置的本地缓存与共享约定
│   ├── shell.js            # 侧边栏、Hash 路由与开屏动画
│   └── auth.js             # 登录状态、足迹 / 收藏 / 成就与账号弹层
├── assets/
│   └── bg/                 # 按页配的城市夜景 WebP 底图
├── backend/
│   ├── main.py             # FastAPI：AI 接口、账号会话与静态资源托管
│   ├── requirements.txt    # 后端 Python 依赖清单
│   ├── pianhang.db         # 首次运行生成的账号库（已忽略，不入库）
│   └── .env.example        # 环境变量配置模板（不含真实密钥）
├── scripts/
│   ├── build.js            # 前端构建：注入 API 地址并输出 dist 产物
│   └── server_port.py      # 启动脚本的端口探测 / 服务健康检查
├── .github/
│   └── workflows/ci.yml    # GitHub Actions：构建验证与后端启动测试
├── start.bat               # Windows 一键启动（同源单服务）
├── start.sh                # macOS / Linux 一键启动
├── go-online.bat           # 可选：cpolar 公网演示
├── package.json            # 仅保留构建命令（无第三方依赖）
└── README.md
```

## 已知边界与后续计划

本项目当前定位是**可现场演示的比赛原型**，以下边界如实说明：

- **路线服务**：使用 OSRM 公共 demo 服务。该服务实际只提供一套路网权重，`foot` / `bike` profile 不会改变路线几何；步行 / 骑行时间预算由前端速度模型控制。正式版本应自建 OSRM 并加载步行、骑行 profile，或改用 Valhalla / GraphHopper。
- **地图与逆地理**：比赛版使用高德公开瓦片和网页端逆地理接口，仅用于演示；正式上线应使用有授权的地图服务。
- **外部依赖**：地点、天气、路线均依赖第三方公共服务，存在限流和网络波动；代码已做多级降级，但现场演示仍建议准备录屏。
- **未实现功能**：偏航记录删除、照片上传、把所有轨迹聚合到一张真实地图、逐转向 GPS 导航、完整单元测试、生产级接口限流。
- **账号规模**：SQLite + 单进程适合演示和小规模使用；正式多用户部署建议换 PostgreSQL 并增加连接池、限流与备份。
- **接口限流**：`/api/*` 当前没有登录限制和速率限制，正式对外提供服务前需要补充。

## 安全说明

- 所有 API 密钥仅存储于后端 `backend/.env`，前端代码不包含任何密钥
- `.env` 已加入 `.gitignore`，不会提交至代码仓库
- 同源部署架构天然规避跨域风险
- IP 定位经后端代理请求，避免前端直接调用第三方接口
- 密码使用 PBKDF2-SHA256（24 万次迭代）加盐哈希；数据库不保存明文密码
- 会话 Token 仅以 SHA-256 哈希存入数据库，浏览器端使用 `HttpOnly` + `SameSite=Lax` Cookie
- `backend/*.db` 等本地账号数据已加入 `.gitignore`，不会误提交
