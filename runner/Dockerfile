# Runner image for generated projects. Dependencies live in /opt/aise/node_modules;
# the project is bind mounted at /opt/aise/app. Node and tools find packages by
# walking up to /opt/aise/node_modules, so nothing is written into the project.
FROM node:22-slim
WORKDIR /opt/aise
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund && npm cache clean --force
USER node
WORKDIR /opt/aise/app
