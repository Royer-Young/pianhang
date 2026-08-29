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
- **安全设计**：API 密钥仅存储于后端 `.env`，前端不接触密钥；同源部署天然规避跨域问题

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

> 生产环境使用稳定模式运行，不开启热重载。

启动后访问 `http://localhost:8002` 即可看到前端页面，AI 接口在 `http://localhost:8002/api/*`。

#### 4. cpolar 内网穿透暴露公网

下载安装 [cpolar](https://www.cpolar.com/)，然后：

```bash
cpolar http 8002
```

cpolar 会返回一个公网 HTTPS 地址（如 `https://xxxx.cpolar.top`），任何设备访问该地址即可使用。

> 公网访问地址为动态生成，重启隧道后需更新访问链接。

### 七牛云 CDN 加速（可选）

七牛 Kodo 可用于托管 js/css/图片等静态资源以加速访问，页面入口仍由应用服务器提供。如需使用：

```bash
# 在 backend/.env 中填入七牛密钥
QINIU_ACCESS_KEY=你的AK
QINIU_SECRET_KEY=你的SK
QINIU_BUCKET=pianhang-web
QINIU_REGION=z1

# 运行上传脚本
python scripts/upload_qiniu.py
```

上传后将 `dist/` 内的 js/css 引用替换为七牛 CDN 地址即可，页面入口仍由 FastAPI 提供。

### Serverless 备选方案

`worker/` 目录提供了 Cloudflare Worker 版 AI 后端的 Serverless 实现，可作为弹性扩缩容的备选部署方式。

## 注意事项

- **密钥安全**：所有 API 密钥仅保存在后端 `.env` 文件中，前端不包含任何密钥。`.env` 已加入 `.gitignore`，不会提交到代码仓库。
- **同源部署**：线上采用 FastAPI 同源服务前端，无需配置 CORS；本地前后端分离开发时需确保 `CORS_ORIGINS` 包含前端地址。
- **服务可用性**：采用本地服务 + 内网穿透方案，需保持后端服务持续运行以保障公网访问。
- **地图服务**：使用 OpenStreetMap 瓦片，无需额外密钥。
- **天气服务**：使用 Open-Meteo 公开接口，无需密钥。
- **POI 服务**：使用 Overpass API，无需密钥。
- **路线服务**：使用 OSRM 公开接口，无需密钥。

## 部署最佳实践

- **HTTPS 协议**：线上环境统一使用 `https://`，确保所有外部资源请求符合 Mixed Content 安全策略
- **生产模式运行**：部署时使用稳定模式启动后端，避免热重载影响服务稳定性
- **环境隔离**：区分开发与生产环境变量，生产环境密钥通过 `.env` 注入，不硬编码于源码
- **访问验证**：上线后通过浏览器无痕模式完成完整流程验证，排除缓存与插件干扰
- **资源加速**：静态资源可通过七牛云 CDN 分发，降低应用服务器负载

## 参赛信息

- **项目名称**：偏航
- **赛道**：城市探索 / 黑客松
- **Demo 地址**：通过内网穿透动态生成（演示时提供）
- **演示视频**：（待填写）

## 截图

（请在此处插入项目截图）

- 开始界面
- 地图选点
- 路线推荐
- 导航界面
