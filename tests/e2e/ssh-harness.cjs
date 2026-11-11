// Test-only Electron startup hook. Never included in packaged application files.
// Avoid changing HOME: replace only the main-process home lookup for isolated SSH fixtures.
/* global require, process */
/* eslint-disable @typescript-eslint/no-require-imports -- Electron startup hook runs as CommonJS via -r. */
const os = require('node:os')
const path = require('node:path')
const root = process.env.DEVCOMMAND_TEST_ROOT
if (!root || !path.isAbsolute(root) || !path.basename(root).startsWith('devcommand-extended-e2e-')) throw new Error('Isolated test root required')
os.homedir = () => root
