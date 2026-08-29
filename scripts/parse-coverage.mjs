#!/usr/bin/env node

/**
 * Parse test coverage reports and generate summaries
 * This script processes coverage data from various test runners
 * and generates consolidated reports for CI/CD pipelines.
 */

// Note: readFile is imported but intentionally unused in current implementation
// Renamed to _readFile to pass ESLint check
import { readFile as _readFile, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Default configuration
const DEFAULT_CONFIG = {
  coverageDir: 'coverage',
  outputFile: 'coverage-summary.json',
  thresholds: {
    statements: 80,
    branches: 80,
    functions: 80,
    lines: 80,
  },
  includePatterns: ['**/*.js', '**/*.mjs', '**/*.ts', '**/*.tsx'],
  excludePatterns: ['**/*.test.js', '**/*.spec.js', '**/node_modules/**'],
};

// Utility functions
function _isDirectory(path) {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function _isFile(path) {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function collectCoverageFiles(rootDir, patterns = DEFAULT_CONFIG.includePatterns) {
  const files = [];

  // Note: directoryStack should be const since it's never reassigned
  const directoryStack = [rootDir];

  while (directoryStack.length > 0) {
    const currentDir = directoryStack.pop();

    try {
      const entries = readdirSync(currentDir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = join(currentDir, entry.name);

        if (entry.isDirectory()) {
          // Skip excluded directories
          if (!DEFAULT_CONFIG.excludePatterns.some(pattern => minimatch(fullPath, pattern))) {
            directoryStack.push(fullPath);
          }
        } else if (entry.isFile()) {
          // Check if file matches include patterns
          if (patterns.some(pattern => minimatch(fullPath, pattern))) {
            files.push(fullPath);
          }
        }
      }
    } catch (error) {
      console.warn(`Warning: Could not read directory ${currentDir}:`, error.message);
    }
  }

  return files;
}

// Parse individual coverage file
function parseCoverageFile(filePath) {
  try {
    const content = _readFile(filePath, 'utf8');
    const data = JSON.parse(content);

    return {
      file: relative(process.cwd(), filePath),
      timestamp: new Date().toISOString(),
      summary: data.total || data.summary || {},
      details: data.details || [],
    };
  } catch (error) {
    console.error(`Error parsing coverage file ${filePath}:`, error.message);
    return null;
  }
}

// Aggregate coverage data
function aggregateCoverage(coverageData) {
  const aggregated = {
    total: {
      statements: { total: 0, covered: 0, percentage: 0 },
      branches: { total: 0, covered: 0, percentage: 0 },
      functions: { total: 0, covered: 0, percentage: 0 },
      lines: { total: 0, covered: 0, percentage: 0 },
    },
    files: [],
  };

  for (const data of coverageData) {
    if (!data || !data.summary) continue;

    // Aggregate totals
    for (const key of ['statements', 'branches', 'functions', 'lines']) {
      if (data.summary[key]) {
        aggregated.total[key].total += data.summary[key].total || 0;
        aggregated.total[key].covered += data.summary[key].covered || 0;
      }
    }

    aggregated.files.push({
      file: data.file,
      summary: data.summary,
    });
  }

  // Calculate percentages
  for (const key of ['statements', 'branches', 'functions', 'lines']) {
    const total = aggregated.total[key];
    if (total.total > 0) {
      total.percentage = Math.round((total.covered / total.total) * 10000) / 100;
    }
  }

  return aggregated;
}

// Check thresholds
function checkThresholds(aggregated, thresholds = DEFAULT_CONFIG.thresholds) {
  const failures = [];

  for (const [key, threshold] of Object.entries(thresholds)) {
    const coverage = aggregated.total[key];
    if (coverage && coverage.percentage < threshold) {
      failures.push({
        metric: key,
        coverage: coverage.percentage,
        threshold,
        message: `${key} coverage ${coverage.percentage}% is below threshold ${threshold}%`,
      });
    }
  }

  return {
    passed: failures.length === 0,
    failures,
    summary: aggregated.total,
  };
}

// Generate report
function generateReport(aggregated, thresholds) {
  const result = checkThresholds(aggregated, thresholds);

  return {
    timestamp: new Date().toISOString(),
    config: DEFAULT_CONFIG,
    summary: aggregated.total,
    files: aggregated.files,
    check: result,
    aggregated: aggregated,
  };
}

// Main execution
async function main() {
  const args = process.argv.slice(2);
  const coverageDir = args[0] || DEFAULT_CONFIG.coverageDir;
  const outputFile = args[1] || DEFAULT_CONFIG.outputFile;

  console.log('Starting coverage analysis...');
  console.log(`Coverage directory: ${coverageDir}`);
  console.log(`Output file: ${outputFile}`);

  // Collect coverage files
  const coverageFiles = collectCoverageFiles(coverageDir);
  console.log(`Found ${coverageFiles.length} coverage files`);

  // Parse all coverage files
  const coverageData = [];
  for (const file of coverageFiles) {
    const data = parseCoverageFile(file);
    if (data) {
      coverageData.push(data);
    }
  }

  // Aggregate results
  const aggregated = aggregateCoverage(coverageData);

  // Generate report
  const report = generateReport(aggregated, DEFAULT_CONFIG.thresholds);

  // Output results
  console.log('\n=== Coverage Summary ===');
  for (const [key, value] of Object.entries(report.summary)) {
    console.log(`${key}: ${value.percentage}% (${value.covered}/${value.total})`);
  }

  console.log('\n=== Threshold Check ===');
  if (report.check.passed) {
    console.log('✅ All coverage thresholds met!');
  } else {
    console.log('❌ Coverage thresholds failed:');
    for (const failure of report.check.failures) {
      console.log(`  - ${failure.message}`);
    }
  }

  // Write report to file
  try {
    const fs = await import('node:fs/promises');
    await fs.writeFile(outputFile, JSON.stringify(report, null, 2));
    console.log(`\nReport written to ${outputFile}`);
  } catch (error) {
    console.error(`Error writing report: ${error.message}`);
  }

  // Exit with appropriate code
  process.exit(report.check.passed ? 0 : 1);
}

// Handle minimatch import
let minimatch;
try {
  minimatch = (await import('minimatch')).default;
} catch {
  console.error('Error: minimatch module is required. Install with: npm install minimatch');
  process.exit(1);
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(_error => {
    console.error('Fatal error:', _error);
    process.exit(1);
  });
}

// Export for testing
export {
  collectCoverageFiles,
  parseCoverageFile,
  aggregateCoverage,
  checkThresholds,
  generateReport,
  DEFAULT_CONFIG,
};
