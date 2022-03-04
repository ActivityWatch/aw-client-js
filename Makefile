.PHONY: build install test lint

build:
	npm run compile

install: package-lock.json
	npm install

test:
	npm run test

lint:
	npx tslint src/**.ts src/test/**.ts
