# 对局服务器镜像：零依赖，不需要 npm install
FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production

COPY server.js ./
COPY package.json ./
COPY public ./public

EXPOSE 8080
CMD ["node", "server.js"]
