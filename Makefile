.PHONY: build install test lint

build:
	npm run compile

install: package-lock.json
	npm install

test:
	npm run test

LINTFILES=src/**.ts src/test/**.ts

lint:
	npx eslint ${LINTFILES}
	npx prettier ${LINTFILES} --check

lint-fix:
	npx eslint ${LINTFILES} --fix
	npx prettier ${LINTFILES} --write
