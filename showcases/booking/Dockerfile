FROM node:22-slim
WORKDIR /app
COPY package.json ./
RUN npm install --no-audit --no-fund --legacy-peer-deps
COPY tsconfig.json ./
COPY src/ ./src/
COPY public/ ./public/
CMD ["npm", "start"]
