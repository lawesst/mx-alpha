.PHONY: build-sdk test-sdk test-facilitator check

build-sdk:
	cd mppx-multiversx && npm run build

test-sdk:
	cd mppx-multiversx && npm test

test-facilitator:
	cd mpp-facilitator-mvx && DATABASE_URL=file:./dev.db npx jest intel.service.spec.ts discovery.controller.spec.ts payment-gateway.service.spec.ts --runInBand

check: build-sdk test-sdk test-facilitator
