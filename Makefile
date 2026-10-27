.PHONY: dev build run server web clean install

# Run backend (serving web/dist) and the Vite dev server together.
dev:
	@bash scripts/dev.sh

# Build frontend then backend.
build:
	@bash scripts/build.sh

# Build and run the production server at :8080.
run: build
	./server/curlui-server -addr :8080

server:
	cd server && go build -o curlui-server .

web:
	cd web && pnpm run build

install:
	cd web && pnpm install

clean:
	rm -rf web/dist server/curlui-server data
