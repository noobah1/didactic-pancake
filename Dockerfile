FROM node:lts-alpine
WORKDIR /usr/src/app
COPY package*.json ./
RUN npm install --include=dev
COPY . .
RUN rm -rf .next && chown -R node:node /usr/src/app
USER node
RUN npm run build
EXPOSE 3000
ENV NODE_ENV=production
CMD ["npm", "start"]