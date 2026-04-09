.PHONY: build-sdk test-sdk test-facilitator report-index smoke-paid-upload check

build-sdk:
	cd mppx-multiversx && npm run build

test-sdk:
	cd mppx-multiversx && npm test

test-facilitator:
	cd mpp-facilitator-mvx && npx prisma generate && DATABASE_URL=file:./dev.db npx jest app.controller.spec.ts storage.service.spec.ts verifier.service.spec.ts intel.service.spec.ts discovery.controller.spec.ts payment-gateway.service.spec.ts audit-reports.service.spec.ts database-bootstrap.service.spec.ts --runInBand

report-index:
	cd mppx-multiversx && npm run example:report-index -- ./reports

smoke-paid-upload:
	node scripts/smoke-paid-upload.mjs

check: build-sdk test-sdk test-facilitator
