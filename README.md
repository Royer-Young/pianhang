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

| 层级 | 技术选型 |
|------|----------|
| 前端 | 原生 HTML5 + CSS3 + JavaScript，Leaflet.js 地图 |
| 后端 | Python FastAPI + Uvicorn |
| AI | 大语言模型（通过 OpenAI 兼容接口接入） |
| 数据 | Overpass API（POI）、OSRM（路径规划）、Open-Meteo（天气） |

## 本地运行

### 环境要求

- Node.js >= 16
- Python >= 3.9
- pip

### 运行步骤

1. **克隆仓库**

   ```bash
   git clone https://github.com/Royer-Young/pianhang.git
   cd pianhang
   ```

2. **安装前端依赖**

   ```bash
   npm install
   ```

3. **配置后端环境变量**

   ```bash
   cd backend
   cp .env.example .env
   ```

   编辑 `backend/.env`，填入大模型 API 密钥。未配置密钥时后端自动启用模拟模式。

4. **安装后端依赖并启动**

   ```bash
   cd backend
   pip install -r requirements.txt
   python -m uvicorn main:app --host 0.0.0.0 --port 8001 --reload
   ```

5. **构建前端**

   ```bash
   npm run build
   ```

   构建产物输出至 `dist/` 目录，默认指向本地后端 `http://localhost:8001`。如需指定其他地址：

   ```bash
   VITE_API_BASE_URL=http://localhost:8002 npm run build
   ```

6. **启动前端静态服务**

   ```bash
   python -m http.server 8000
   ```

7. **访问应用**

   浏览器打开 `http://localhost:8000`。

## 部署

本项目采用前后端同源部署架构，前端静态资源由 FastAPI 直接托管，AI 接口与页面同域，无需额外配置跨域。

### 同源部署

1. 以同源模式构建前端：

   ```bash
   VITE_API_BASE_URL=SAME_ORIGIN npm run build
   ```

2. 启动后端服务（默认挂载 `dist/` 目录提供静态页面）：

   ```bash
   cd backend
   pip install -r requirements.txt
   python -m uvicorn main:app --host 0.0.0.0 --port 8000
   ```

3. 访问 `http://<服务器地址>:8000` 即可使用完整功能。

### 云服务器部署

项目可直接部署至任意支持 Python 的云服务器。推荐流程：

1. 将代码拉取至服务器
2. 配置 `backend/.env`（填入大模型密钥与 `CORS_ORIGINS=*`）
3. 以同源模式构建前端
4. 使用进程守护工具（如 systemd、PM2、Supervisor）保持后端运行
5. 可选：通过 Nginx 反向代理并配置 HTTPS

### 接口说明

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/status` | 服务状态与运行模式 |
| GET | `/api/ip` | IP 定位代理（返回经纬度与城市） |
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

## 参赛信息

- **项目名称**：偏航
- **赛道**：城市探索 / 黑客松
