FROM golang:1.22-alpine AS build
WORKDIR /src
COPY go.mod main.go ./
COPY adapter ./adapter
RUN go build -o /bridge .

FROM alpine:3.20
COPY --from=build /bridge /usr/local/bin/enterprise-bridge
EXPOSE 8080
ENTRYPOINT ["/usr/local/bin/enterprise-bridge"]
