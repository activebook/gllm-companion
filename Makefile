.PHONY: help package pack-patch pack-minor pack-major clean

.DEFAULT_GOAL := help

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-15s\033[0m %s\n", $$1, $$2}'

clean: ## Remove dist folder
	rm -rf dist

package: ## Package extension (no version bump)
	./node_modules/.bin/vsce package --out dist/

pack-patch: ## Bump patch version and package
	npm version patch
	./node_modules/.bin/vsce package --out dist/

pack-minor: ## Bump minor version and package
	npm version minor
	./node_modules/.bin/vsce package --out dist/

pack-major: ## Bump major version and package
	npm version major
	./node_modules/.bin/vsce package --out dist/
