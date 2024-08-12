# Create a JavaScript Action

[![GitHub Super-Linter](https://github.com/karpikpl/gh-user-action/actions/workflows/linter.yml/badge.svg)](https://github.com/super-linter/super-linter)
![CI](https://github.com/karpikpl/gh-user-action/actions/workflows/ci.yml/badge.svg)
[![Check dist/](https://github.com/karpikpl/gh-user-action/actions/workflows/check-dist.yml/badge.svg)](https://github.com/karpikpl/gh-user-action/actions/workflows/check-dist.yml)
[![CodeQL](https://github.com/karpikpl/gh-user-action/actions/workflows/codeql-analysis.yml/badge.svg)](https://github.com/karpikpl/gh-user-action/actions/workflows/codeql-analysis.yml)
[![Coverage](./badges/coverage.svg)](./badges/coverage.svg)

Produce a CSV file with information about all the enterprise users. :rocket:

## Usage

Reading user information requires classic GitHub token with following
permissions:

- **project, read:enterprise, read:org, user**

that cannot be granted to a workflow or obtained via GitHub application. Please
use a classic PAT.

- Make sure provided PAT has the appropriate scope for the enterprise the action
  is used for.

### Using PAT

```yaml
steps:
  - name: GH Users Report
    id: gh_user_report
    uses: karpikpl/gh-user-action@v1
    with:
      github-enterprise: your-ent-name
      github-pat: ${{ secrets.PAT_NAME_HERE }}
```

### Detailed example

Example with report upload and action summary.

```yml
name: Create Users Report

on:
  # Run automatically when main updated
  push:
    branches:
      - main
  # Run nightly at 5a UTC / 11p CT
  schedule:
    - cron: '0 5 * * *'
  # Permit manual trigger
  workflow_dispatch:

jobs:
  cleanup_copilot_licenses:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v4

      - name: GH Users Report
        id: gh_user_report
        uses: karpikpl/gh-user-action@v1
        with:
          github-enterprise: your-ent-name
          github-pat: ${{ secrets.PAT_NAME_HERE }}

      # upload artifacts
      - name: Upload users report
        uses: actions/upload-artifact@v4
        with:
          name: gh-user-report
          path: ${{ steps.gh_user_report.outputs.file }}

      # create a github summary using github script
      - name: Add Summary
        uses: actions/github-script@v7
        with:
          script: |
            const fs = require('fs');
            // read summary file
            const data = fs.readFileSync('${{ steps.gh_user_report.outputs.file }}', 'utf8');
            const csv = data.split('\n').map(row => row.split(','))
            // header
            for (let i = 0; i < csv[0].length; i++) {
                csv[0][i] = { data: csv[0][i], header: true };
            }

            await core.summary
            .addHeading('GH Users data')
            .addTable(csv)
            .write()
```

## Inputs

### `github-pat`

**Required** GitHub personal access token with permissions: project,
read:enterprise, read:org, user.

### `github-enterprise`

**Required** Name of the GitHub enterprise.

## Outputs

### `file`

Name of the CSV file
