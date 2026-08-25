FROM apify/actor-node:22

COPY package*.json ./
RUN npm ci --omit=dev
COPY . ./

CMD npm start
