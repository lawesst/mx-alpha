import path from 'node:path'
import {
  buildPaidIntelAuditReportIndex,
  collectPaidIntelAuditReports,
  persistPaidIntelAuditIndexArtifacts,
} from './paid-intel-report-index.ts'

const HELP_TEXT = `
Usage:
  npm run example:report-index -- [REPORTS_DIR] [OUTPUT_DIR]

Arguments:
  REPORTS_DIR   Directory containing JSON audit reports (default: ./reports)
  OUTPUT_DIR    Directory for index artifacts (default: REPORTS_DIR)
`.trim()

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  if (args[0] === '--help' || args[0] === '-h') {
    console.log(HELP_TEXT)
    return
  }

  const reportsDir = path.resolve(args[0] ?? './reports')
  const outputDir = path.resolve(args[1] ?? reportsDir)

  const { records, invalidReports } = await collectPaidIntelAuditReports({
    reportsDir,
  })
  const index = buildPaidIntelAuditReportIndex({
    reportsDir,
    records,
    invalidReports,
  })
  const artifacts = await persistPaidIntelAuditIndexArtifacts({
    index,
    outputDir,
  })

  console.log(
    JSON.stringify(
      {
        reportsDir,
        outputDir,
        totals: index.totals,
        artifacts,
      },
      null,
      2,
    ),
  )
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error(message)
  process.exitCode = 1
})
