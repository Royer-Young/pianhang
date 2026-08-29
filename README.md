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

### 前端：Cloudflare Pages

1. 将代码推送到 GitHub 仓库
2. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com/) → Pages → 创建项目 → 连接 Git 仓库
3. 构建设置：
   - **构建命令**：`npm run build`
   - **构建输出目录**：`dist`
   - **环境变量**（在 Cloudflare Pages → Settings → Environment variables 中设置）：
     - `VITE_API_BASE_URL` = 你的后端 API 地址（如 `https://pianhang-api.onrender.com`）
4. 保存并部署，等待几分钟即可获得 `*.pages.dev` 域名

### 后端：推荐 Render / Railway / Fly.io

本项目后端为 Python FastAPI，需要部署到支持 Python 的 PaaS 平台：

**以 Render 为例：**
1. 在 Render 创建新 Web Service，连接 GitHub 仓库
2. 运行时选择 `Python 3`
3. 构建命令：`pip install -r backend/requirements.txt`
4. 启动命令：`uvicorn backend.main:app --host 0.0.0.0 --port $PORT`
5. 在 Render 环境变量中设置：
   - `LLM_API_KEY` = 你的 DeepSeek API Key
   - `LLM_BASE_URL` = `https://api.openai-next.com/v1`
   - `LLM_MODEL` = `deepseek-v4-flash`
   - `CORS_ORIGINS` = 你的 Cloudflare Pages 域名（如 `https://pianhang.pages.dev`）

部署后，将后端 URL 填入 Cloudflare Pages 的 `VITE_API_BASE_URL` 环境变量，重新触发一次部署即可。

## 注意事项

- **密钥安全**：所有 API 密钥仅保存在后端 `.env` 文件中，前端不包含任何密钥。`.env` 已加入 `.gitignore`，不会提交到代码仓库。
- **CORS**：后端已配置跨域，线上部署时请确保 `CORS_ORIGINS` 包含前端域名。
- **地图服务**：使用高德地图瓦片，无需额外密钥。
- **天气服务**：使用 Open-Meteo 公开接口，无需密钥。
- **POI 服务**：使用 Overpass API，无需密钥。
- **路线服务**：使用 OSRM 公开接口，无需密钥。

## 上线坑点清单

- [ ] **CORS 跨域**：确保后端 `CORS_ORIGINS` 包含前端域名，否则浏览器会拦截 API 请求
- [ ] **环境变量大小写**：Cloudflare Pages / Render 等平台环境变量名区分大小写，请严格对照文档填写
- [ ] **Linux 路径大小写**：如部署到 Linux 服务器，注意 `backend/main.py` 与 `Backend/main.py` 是不同路径
- [ ] **构建输出目录**：Cloudflare Pages 的"构建输出目录"必须填 `dist`，否则会 404
- [ ] **API 地址协议**：线上必须使用 `https://`，否则会被浏览器 Mixed Content 策略拦截
- [ ] **后端端口**：Render 等平台使用 `$PORT` 环境变量，不要硬编码 `8001`
- [ ] **无痕浏览器测试**：上线后务必用 Chrome 无痕模式完整走一遍流程，排除缓存/插件干扰

## 参赛信息

- **项目名称**：偏航
- **赛道**：城市探索 / 黑客松
- **Demo 地址**：（待填写）
- **演示视频**：（待填写）

## 截图

（请在此处插入项目截图）

- 开始界面
- 地图选点
- 路线推荐
- 导航界面
