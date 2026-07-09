FROM node:20-alpine AS admin-ui
WORKDIR /platform
COPY admin-ui/package.json ./admin-ui/
RUN cd admin-ui && npm install --no-audit --no-fund
COPY admin-ui ./admin-ui
RUN cd admin-ui && npm run build

FROM golang:1.22-alpine AS build
RUN apk add --no-cache git ca-certificates
ENV GOPROXY=https://goproxy.cn,https://mirrors.aliyun.com/goproxy/,direct
ENV GOSUMDB=sum.golang.google.cn
WORKDIR /src
COPY go.mod ./
COPY cmd ./cmd
COPY internal ./internal
COPY --from=admin-ui /platform/internal/admin/static ./internal/admin/static
RUN go mod tidy && go test -tags production ./internal/rbac/... ./internal/license/... && go build -tags production -o /platform ./cmd/server

FROM alpine:3.20
RUN apk add --no-cache ca-certificates
COPY --from=build /platform /usr/local/bin/enterprise-platform
COPY migrations /migrations
ENV PLATFORM_MIGRATIONS_DIR=/migrations
EXPOSE 8090
ENTRYPOINT ["/usr/local/bin/enterprise-platform"]
