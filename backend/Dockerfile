FROM node:20-bookworm-slim
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY . .
RUN mkdir -p /app/data
ENV PORT=4000 DATABASE_PATH=/app/data/meridian.db
EXPOSE 4000
CMD ["npm", "start"]
