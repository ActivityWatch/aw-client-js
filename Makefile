.PHONY: build install test lint

build: install
	npm run compile

install:
	npm install

test:
	npm run test

lint:
	npx tslint src/**.ts src/test/**.ts
