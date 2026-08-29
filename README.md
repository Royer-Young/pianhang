# 偏航

一款城市步行探索 Web App，偏离最短路径，遇见意外风景。

## 功能说明

- **时间选择**：30分钟、60分钟快速选择，或通过自定义轮盘精确选择（上限4小时59分）
- **目的地问询**：支持有/无目的地两种模式
- **偏好设置**：选择出行方式（步行/骑行·自行车/骑行·电动车）和地点偏好（公园、咖啡店、书店、博物馆、广场、景点）
- **智能推荐**：基于天气、时间、偏好，通过大模型生成3条偏航路线
- **全屏导航**：选中路线后进入沉浸式导航界面，显示完整路线、方向箭头和途经点
- **重新偏航**：随时可以返回起点，开启新一轮探索

## 技术栈

- **前端**：原生 HTML5 + CSS3 + JavaScript（ES5/ES6），Leaflet.js 地图
- **后端**：Python FastAPI + Uvicorn
- **AI**：DeepSeek 大模型（通过 openai-next 中转）
- **数据源**：Overpass API（POI）、OSRM（步行/骑行路线）、Open-Meteo（天气）

## 本地运行

### 前置要求

- Node.js >= 16
- Python >= 3.9
- pip

### 1. 克隆仓库

```bash
git clone https://github.com/<your-username>/pianhang.git
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
# 编辑 .env，填入你的 DeepSeek API Key
```

### 4. 安装后端依赖并启动

```bash
cd backend
pip install -r requirements.txt
python -m uvicorn main:app --host 0.0.0.0 --port 8001 --reload
```

> 若 8001 端口被占用，可改用其他端口（如 8002），构建前端时通过 `VITE_API_BASE_URL=http://localhost:8002 npm run build` 指定。

### 5. 构建前端

```bash
# 本地开发默认指向 http://localhost:8001
npm run build
```

### 6. 启动前端静态服务

```bash
python -m http.server 8000
# 或使用 npx serve dist -p 8000
```

### 7. 访问

打开浏览器访问：http://localhost:8000

## 线上部署

本项目采用 **FastAPI 同源服务 + cpolar 内网穿透** 方案，前端页面与 AI 接口同域部署，无需配置跨域。

### 方案说明

- **前端**：由 FastAPI 挂载 `dist/` 目录同源提供（`app.mount("/", StaticFiles(directory="dist", html=True))`）
- **后端**：FastAPI 提供 `/api/*` AI 接口，与前端同域
- **公网暴露**：通过 cpolar 内网穿透将本地端口映射为公网 HTTPS 地址
- **优势**：密钥仅存本地后端 `.env`，绝不下发前端；同源部署免 CORS 配置

### 部署步骤

#### 1. 构建前端（同源模式）

```bash
# SAME_ORIGIN 表示页面与 AI 接口同域，无需跨域
VITE_API_BASE_URL=SAME_ORIGIN npm run build
```

> Windows PowerShell 写法：`$env:VITE_API_BASE_URL="SAME_ORIGIN"; npm run build`

#### 2. 配置后端环境变量

编辑 `backend/.env`，填入：

```env
LLM_API_KEY=你的DeepSeek密钥
LLM_BASE_URL=https://api.openai-next.com/v1
LLM_MODEL=deepseek-v4-flash
CORS_ORIGINS=*
```

#### 3. 启动后端（同源服务前端）

```bash
cd backend
pip install -r requirements.txt
python -m uvicorn main:app --host 0.0.0.0 --port 8002
```

> 演示时建议去掉 `--reload`，避免代码变动导致服务重启。

启动后访问 `http://localhost:8002` 即可看到前端页面，AI 接口在 `http://localhost:8002/api/*`。

#### 4. cpolar 内网穿透暴露公网

下载安装 [cpolar](https://www.cpolar.com/)，然后：

```bash
cpolar http 8002
```

cpolar 会返回一个公网 HTTPS 地址（如 `https://xxxx.cpolar.top`），任何设备访问该地址即可使用。

> **注意**：cpolar 免费版每次重启子域名会变化，演示前需重新获取并发送给评委。

### 七牛云托管静态资源（可选）

七牛 Kodo 测试域名**禁止托管 html 文件**，仅可用于托管 js/css/图片等非 html 资源。如需使用：

```bash
# 在 backend/.env 中填入七牛密钥
QINIU_ACCESS_KEY=你的AK
QINIU_SECRET_KEY=你的SK
QINIU_BUCKET=pianhang-web
QINIU_REGION=z1

# 运行上传脚本
python scripts/upload_qiniu.py
```

上传后将 `dist/` 内的 js/css 引用替换为七牛 CDN 地址即可（index.html 仍由 FastAPI 提供）。

### Cloudflare Worker 备用方案（国内不可达）

`worker/` 目录提供了 Cloudflare Worker 版 AI 后端，可作为备用。但 `workers.dev` 域名在国内网络环境下 TCP 连接被阻断，**国内用户无法访问**，仅作技术保留。

## 注意事项

- **密钥安全**：所有 API 密钥仅保存在后端 `.env` 文件中，前端不包含任何密钥。`.env` 已加入 `.gitignore`，不会提交到代码仓库。
- **同源部署**：线上采用 FastAPI 同源服务前端，无需配置 CORS；本地前后端分离开发时需确保 `CORS_ORIGINS` 包含前端地址。
- **电脑必须开机**：cpolar 内网穿透方案依赖本地后端运行，演示期间电脑需保持开机且不睡眠。
- **地图服务**：使用 OpenStreetMap 瓦片，无需额外密钥。
- **天气服务**：使用 Open-Meteo 公开接口，无需密钥。
- **POI 服务**：使用 Overpass API，无需密钥。
- **路线服务**：使用 OSRM 公开接口，无需密钥。

## 上线坑点清单

- [x] **七牛测试域名禁 html**：七牛 Kodo 测试域名禁止托管 html 文件（返回 403），前端页面必须由 FastAPI 同源提供，七牛仅可托管 js/css 等非 html 资源
- [x] **workers.dev 国内被墙**：Cloudflare Worker 的 `workers.dev` 域名在国内 TCP 连接被阻断，无法作为线上方案，仅作备用
- [x] **Mixed Content**：https 页面无法加载 http 资源，所有外部 API（如 ip-api）必须使用 https
- [x] **cpolar 子域名变化**：免费版每次重启子域名会变，演示前需重新获取公网地址
- [x] **后端去掉 --reload**：演示时不要加 `--reload`，避免代码变动或文件监听导致服务重启
- [x] **防休眠**：电脑需关闭自动睡眠/休眠，否则 cpolar 隧道会断开
- [x] **无痕浏览器测试**：上线后务必用 Chrome 无痕模式完整走一遍流程，排除缓存/插件干扰

## 参赛信息

- **项目名称**：偏航
- **赛道**：城市探索 / 黑客松
- **Demo 地址**：通过 cpolar 内网穿透生成（每次重启变化，演示前提供）
- **演示视频**：（待填写）

## 截图

（请在此处插入项目截图）

- 开始界面
- 地图选点
- 路线推荐
- 导航界面
