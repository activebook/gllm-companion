.PHONY: help package pack-patch pack-minor pack-major clean release

VERSION := $(shell node -p "require('./package.json').version")

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

release: ## Create a GitHub release based on package.json version
	@echo "\033[36mEnsuring tag v$(VERSION) exists locally...\033[0m"
	git tag v$(VERSION) || true
	@echo "\033[36mPushing tag v$(VERSION) to remote...\033[0m"
	git push origin v$(VERSION)
	@echo "\033[36mCreating GitHub release v$(VERSION)...\033[0m"
	gh release create v$(VERSION) --generate-notes
