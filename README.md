# 偏航

[![CI](https://github.com/Royer-Young/pianhang/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/Royer-Young/pianhang/actions/workflows/ci.yml)

一款城市步行探索 Web 应用，鼓励用户偏离最短路径，在城市中发现意外的风景。

## 功能特性

- **时间选择**：支持 30 分钟、60 分钟快捷选择，或通过自定义轮盘精确设置（上限 4 小时 59 分）
- **目的地问询**：支持有目的地与无目的地两种探索模式
- **偏好设置**：出行方式（步行 / 骑行·自行车 / 骑行·电动车）与地点偏好（公园、咖啡店、书店、博物馆、广场、景点）
- **智能推荐**：综合天气、时间与用户偏好，通过大模型生成 3 条偏航路线
- **全屏导航**：进入沉浸式导航界面，展示完整路线、方向指引与途经点位
- **重新偏航**：随时返回起点，开启新一轮探索

## 技术栈

| 层级 | 技术选型 | 用途 |
|------|----------|------|
| 前端 | HTML5 + CSS3 + JavaScript（ES6+） | 页面结构、样式与交互逻辑 |
| 地图 | Leaflet.js 1.9 + OpenStreetMap | 地图渲染、Marker 标注与路线绘制 |
| 后端 | Python 3.9+ / FastAPI 0.100+ / Uvicorn 0.23+ | RESTful 接口服务与静态资源托管 |
| AI | OpenAI 兼容大模型接口 | 偏好解析、路线推荐理由生成、地点简介 |
| 数据 | Overpass API | 周边 POI 查询（公园、咖啡店等） |
| 数据 | OSRM（Open Source Routing Machine） | 步行 / 骑行路径规划 |
| 数据 | Open-Meteo | 实时天气数据获取 |
| 构建 | Node.js 16+ | 前端资源打包与 API 地址注入 |
| CI | GitHub Actions | 自动构建验证与后端启动检查 |

## 环境要求

- **Node.js** >= 16（用于前端构建）
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
| `CORS_ORIGINS` | 否 | `*` | 允许跨域的来源，逗号分隔。同源部署时保持 `*` 即可 |

> 模拟模式下，路线推荐理由与地点简介由内置规则生成，可正常体验完整流程，但内容为预设文本。

## 快速开始（Windows 一键启动）

如果只是想快速跑起来看效果，且使用 **Windows**：

1. 安装 [Python 3.9+](https://www.python.org/downloads/)（安装时务必勾选 **Add Python to PATH**）
2. 安装后端依赖：

   ```bash
   pip install -r backend/requirements.txt
   ```

3. **双击项目根目录下的 `start.bat`**
4. 脚本会自动启动后端（8001 端口）与前端（8000 端口）两个服务，并自动打开浏览器访问 `http://localhost:8000`

> 未配置大模型密钥时自动进入模拟模式，无需任何额外配置即可完整体验全部功能；配置真实 AI 推荐见下文「环境变量配置」。

## 本地运行

### 1. 克隆仓库

```bash
git clone https://github.com/Royer-Young/pianhang.git
cd pianhang
```

### 2. 安装前端依赖

```bash
npm install
```

### 3. 配置后端环境变量

```bash
cd backend
cp .env.example .env
```

按需编辑 `backend/.env`，填入大模型 API 密钥（可选）。

### 4. 安装后端依赖并启动

```bash
cd backend
pip install -r requirements.txt
python -m uvicorn main:app --host 0.0.0.0 --port 8001 --reload
```

后端启动后监听 `8001` 端口，`--reload` 用于开发时热重载。

### 5. 构建前端

```bash
npm run build
```

构建产物输出至 `dist/` 目录，默认指向本地后端 `http://localhost:8001`。

如需指向其他后端地址：

```bash
# Windows PowerShell
$env:VITE_API_BASE_URL="http://localhost:8002"; npm run build

# macOS / Linux
VITE_API_BASE_URL=http://localhost:8002 npm run build
```

### 6. 启动前端静态服务

```bash
python -m http.server 8000
```

### 7. 访问应用

浏览器打开 `http://localhost:8000`。

### 常见问题

| 现象 | 可能原因 | 解决方式 |
|------|----------|----------|
| 地图不显示 | 网络无法访问 OpenStreetMap 瓦片 | 检查网络连接 |
| 推荐理由为固定文本 | 未配置 `LLM_API_KEY` | 在 `backend/.env` 中填入密钥并重启后端 |
| 前端请求后端失败 | 构建时 API 地址与实际后端端口不一致 | 使用 `VITE_API_BASE_URL` 重新构建 |
| 定位失败 | 浏览器或网络限制 IP 查询 | 手动在地图上选择起点 |

## 部署

本项目采用前后端同源部署架构：前端构建产物由 FastAPI 直接托管，AI 接口与页面同域，无需额外配置跨域。

### 同源部署（推荐）

1. **以同源模式构建前端**

   ```bash
   VITE_API_BASE_URL=SAME_ORIGIN npm run build
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
   npm install
   VITE_API_BASE_URL=SAME_ORIGIN npm run build
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
| POST | `/api/parse_pref` | 解析用户偏好为结构化参数 |
| POST | `/api/get_reason` | 生成路线推荐理由 |
| POST | `/api/get_intro` | 生成地点简介 |

## 项目结构

```
pianhang/
├── index.html              # 页面骨架与各视图结构
├── css/
│   └── style.css           # 界面样式与响应式布局
├── js/
│   └── app.js              # 交互逻辑、地图渲染与路线计算
├── backend/
│   ├── main.py             # FastAPI 主服务：AI 接口 + IP 定位代理 + 静态资源托管
│   ├── requirements.txt    # 后端 Python 依赖清单
│   └── .env.example        # 环境变量配置模板（不含真实密钥）
├── scripts/
│   └── build.js            # 前端构建：注入 API 地址并输出 dist 产物
├── .github/
│   └── workflows/ci.yml    # GitHub Actions：构建验证与后端启动测试
├── package.json            # 前端构建依赖
└── README.md
```

## 安全说明

- 所有 API 密钥仅存储于后端 `backend/.env`，前端代码不包含任何密钥
- `.env` 已加入 `.gitignore`，不会提交至代码仓库
- 同源部署架构天然规避跨域风险
- IP 定位经后端代理请求，避免前端直接调用第三方接口
