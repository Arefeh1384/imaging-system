# Step 1: build the React app with Node.
FROM node:22-alpine AS build
# Set NPM_REGISTRY in .env if the npm registry is slow or blocked where you are.
ARG NPM_REGISTRY=https://registry.npmjs.org/
WORKDIR /app
COPY package.json package-lock.json ./
# npm install (not npm ci) so a lockfile that lags behind package.json still builds.
RUN npm install --registry="$NPM_REGISTRY" --no-audit --no-fund
COPY . .
# http: every panel uses the backend. VITE_DEMO_ACCOUNTS=true shows the test accounts on the sign-in pages.
ARG VITE_API_MODE=http
ARG VITE_API_BASE_URL=/api/v1
ARG VITE_DEMO_ACCOUNTS=false
ENV VITE_API_MODE=$VITE_API_MODE VITE_API_BASE_URL=$VITE_API_BASE_URL VITE_DEMO_ACCOUNTS=$VITE_DEMO_ACCOUNTS
RUN npm run build

# Step 2: serve the built files with nginx, which also passes /api to the backend.
FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
