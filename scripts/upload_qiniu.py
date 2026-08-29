# -*- coding: utf-8 -*-
"""上传 dist/ 构建产物到七牛云 Kodo（公开空间）

配置（在 backend/.env 中填写，密钥不进代码仓库）：
  QINIU_ACCESS_KEY=<你的七牛 AK>
  QINIU_SECRET_KEY=<你的七牛 SK>
  QINIU_BUCKET=<空间名，如 pianhang-web>
  QINIU_REGION=<存储区域，默认 z0 华东>

用法：
  1. npm run build            # 生成 dist/
  2. python scripts/upload_qiniu.py
"""
import mimetypes
import os
import sys
from pathlib import Path

from dotenv import load_dotenv
from qiniu import Auth, BucketManager, put_file

ROOT = Path(__file__).resolve().parent.parent
DIST = ROOT / "dist"

# 读取配置：环境变量优先，其次 backend/.env
load_dotenv(ROOT / "backend" / ".env")
AK = os.environ.get("QINIU_ACCESS_KEY", "").strip()
SK = os.environ.get("QINIU_SECRET_KEY", "").strip()
BUCKET = os.environ.get("QINIU_BUCKET", "").strip()
REGION = os.environ.get("QINIU_REGION", "z0").strip()

if not AK or not SK or not BUCKET:
    sys.exit("请先在 backend/.env 配置 QINIU_ACCESS_KEY / QINIU_SECRET_KEY / QINIU_BUCKET")
if not DIST.is_dir():
    sys.exit(f"未找到构建产物目录 {DIST}，请先运行 npm run build")


def ensure_bucket(auth):
    """空间不存在时自动创建为公开空间"""
    bm = BucketManager(auth)
    _, info = bm.mkbucketv3(BUCKET, REGION)
    if info.status_code in (200, 614):  # 614 = 已存在
        return
    print(f"[WARN] 创建空间失败: {info.status_code} {info.text_body[:200]}，请到控制台确认空间存在")


def main():
    auth = Auth(AK, SK)
    ensure_bucket(auth)
    token = auth.upload_token(BUCKET)
    files = [f for f in DIST.rglob("*") if f.is_file()]
    if not files:
        sys.exit("dist/ 目录为空")
    print(f"共 {len(files)} 个文件，上传到空间 [{BUCKET}] 区域 [{REGION}]")
    for f in files:
        key = f.relative_to(DIST).as_posix()
        mime = mimetypes.guess_type(f.name)[0] or "application/octet-stream"
        ret, info = put_file(token, key, str(f), mime_type=mime, version="v2")
        ok = info.status_code == 200
        print(f"[{'OK' if ok else 'FAIL'}] {key}  ({mime})" + ("" if ok else f" {info.text_body[:200]}"))
        if not ok:
            sys.exit(1)
    print("\n上传完成。访问入口：")
    print(f"  http://{BUCKET}.qiniudns.com/index.html")


if __name__ == "__main__":
    main()
