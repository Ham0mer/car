# 使用官方 Node.js 运行时作为基础镜像
FROM node:18-alpine

# 设置工作目录和运行时环境变量
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000

# 先安装依赖，利用 Docker 层缓存并清理 npm 缓存以缩小镜像
COPY package*.json ./
RUN apk add --no-cache libc6-compat \
	&& npm ci --omit=dev --no-audit --no-fund \
	&& npm cache clean --force

# 仅复制运行时必需文件，避免把无关内容带入镜像
COPY --chown=node:node server.js database.js ./
COPY --chown=node:node public ./public

# 确保上传目录和数据目录存在且可写
RUN mkdir -p /app/public/uploads /app/data && chown -R node:node /app/public/uploads /app/data

# 使用非 root 用户运行
USER node

# 暴露端口
EXPOSE 3000

# 启动应用
CMD ["node", "server.js"]

