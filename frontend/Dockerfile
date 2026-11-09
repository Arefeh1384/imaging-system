# Step 1: build the React app with Node.
FROM node:22-alpine AS build
# Set NPM_REGISTRY in .env if the npm registry is slow or blocked where you are.
ARG NPM_REGISTRY=https://registry.npmjs.org/
WORKDIR /app
COPY package.json package-lock.json ./
# npm install (not npm ci) so a lockfile that lags behind package.json still builds.
RUN npm install --registry="$NPM_REGISTRY" --no-audit --no-fund
COPY . .
# hybrid: the patient panel uses the backend; the admin and insurance panels stay on sample data.
ARG VITE_API_MODE=hybrid
ARG VITE_API_BASE_URL=/api/v1
ENV VITE_API_MODE=$VITE_API_MODE VITE_API_BASE_URL=$VITE_API_BASE_URL
RUN npm run build

# Step 2: serve the built files with nginx, which also passes /api to the backend.
FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
