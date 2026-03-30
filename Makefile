.PHONY: help package pack-patch pack-minor pack-major clean release download install publish-ovsx

# Load environment variables from .env if it exists
ifneq (,$(wildcard ./.env))
    include .env
    export
endif

VERSION := $(shell node -p "require('./package.json').version")
VSIX_FILE := gllm-companion-$(VERSION).vsix
VSIX_PATH := dist/$(VSIX_FILE)
DOWNLOAD_URL := https://github.com/activebook/gllm-companion/releases/download/v$(VERSION)/$(VSIX_FILE)

.DEFAULT_GOAL := help

help: ## Show this help
	@grep -hE '^[a-zA-Z_-]+:.*##' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*## "}; {printf "\033[36m%-15s\033[0m %s\n", $$1, $$2}'

clean: ## Remove dist folder
	rm -rf dist

package: ## Package extension (no version bump)
	@mkdir -p dist
	./node_modules/.bin/vsce package --out $(VSIX_PATH)
	@echo "\033[32m✔ Package created: $(VSIX_PATH)\033[0m"
	@echo "\033[36mTip: To install locally, run: make install\033[0m"

install: ## Install the extension locally to VSCode (requires local build)
	@echo "\033[36mInstalling extension v$(VERSION) from $(VSIX_PATH)...\033[0m"
	@if [ ! -f $(VSIX_PATH) ]; then $(MAKE) package; fi
	code --install-extension $(VSIX_PATH) --force

download: ## Download the vsix from GitHub releases to verify it exists
	@echo "\033[36mChecking if v$(VERSION) is available on GitHub...\033[0m"
	@mkdir -p dist
	@curl -s -I -f $(DOWNLOAD_URL) > /dev/null || (echo "\033[31m✘ Release v$(VERSION) not found on GitHub yet. Wait a few minutes for CI to finish.\033[0m" && exit 1)
	@echo "\033[36mDownloading $(VSIX_FILE)...\033[0m"
	curl -L -f $(DOWNLOAD_URL) -o $(VSIX_PATH)
	@echo "\033[32m✔ Downloaded to $(VSIX_PATH)\033[0m"

publish-ovsx: package ## Publish to Open VSX (loads OVSX_TOKEN from .env)
	@if [ -z "$(OVSX_TOKEN)" ]; then echo "\033[31m✘ OVSX_TOKEN is not set.\033[0m" && exit 1; fi
	npx ovsx publish $(VSIX_PATH) -p $(OVSX_TOKEN)
	@echo "\033[32m✔ Published to Open VSX\033[0m"

pack-patch: ## Bump patch version and package
	npm version patch
	$(MAKE) package

pack-minor: ## Bump minor version and package
	npm version minor
	$(MAKE) package

pack-major: ## Bump major version and package
	npm version major
	$(MAKE) package

release: ## Create a GitHub release based on package.json version
	@echo "\033[36mEnsuring tag v$(VERSION) exists locally...\033[0m"
	git tag v$(VERSION) || true
	@echo "\033[36mPushing tag v$(VERSION) to remote...\033[0m"
	git push origin v$(VERSION)
	@echo "\033[36mCreating GitHub release v$(VERSION)...\033[0m"
	gh release create v$(VERSION) --generate-notes
