# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## IMPORTANT: Agent Instructions

**Read `agent.md` at the start of every session and after context updates.** It contains critical guidelines to prevent common mistakes (e.g., uncommitted files, formatting issues, verification steps).

## Project Overview

Raycast extension providing unified search across Chrome tabs, bookmarks, and history. Selecting a result either switches to an existing tab or opens the URL in Chrome.

## Documentation

- **PRD**: `docs/PRD.md` - Problem statement, user stories, acceptance criteria (including Raycast Store requirements)
- **Technical Architecture**: `docs/Tech Design.md` - Stack, data flow, design decisions
- **User README**: `README.md` - User-facing documentation for Raycast Store

**Workflow**:
1. Update PRD first to validate requirements
2. Determine any necessary changes to technical architecture
3. Implement changes
4. Achieve ≥90% unit test coverage; all tests must pass
5. Functional QA: verify solution meets all acceptance criteria in PRD before presenting as complete

## Commands

```bash
npm install          # Install dependencies
npm run dev          # Start development mode (registers extension in Raycast)
npm run build        # Build extension
npm run lint         # Run ESLint + Prettier
npm run fix-lint     # Auto-fix lint issues
npm test             # Run unit tests
npm run test:watch   # Run tests in watch mode
npm run test:coverage # Run tests with coverage report
```

## Architecture

Single-file React extension (`src/find-in-chrome.tsx`) with three data sources loaded in parallel:

| Source | Method | Location |
|--------|--------|----------|
| Tabs | AppleScript via `runAppleScript` | Chrome runtime |
| Bookmarks | JSON parsing | `<profile>/Bookmarks` |
| History | `sqlite3` CLI on temp copy | `<profile>/History` |

Results deduplicated with priority: tabs > bookmarks > history. URLs normalized (trailing slashes, fragments removed).

## Key Design Decisions

- **`sqlite3` CLI over `better-sqlite3`**: Avoids native compilation issues (node-gyp/Python/Xcode). `sqlite3` is pre-installed on macOS.
- **Copy History DB**: Chrome holds write lock; copying avoids `SQLITE_BUSY` errors.
- **Google Favicon Service**: Simpler than parsing Chrome's complex Favicons DB.
- **Profile detection**: Reads `Local State` JSON (`profile.last_active_profiles[0]`), falls back to `Default` profile.
