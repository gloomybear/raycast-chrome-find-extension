# Agent Instructions

This file contains instructions for Claude Code when working on this repository. These guidelines help prevent common mistakes and ensure consistent quality.

---

## Pre-Commit Checklist

Before every commit, always run:

```bash
git status
```

**Verify:**
1. All modified files that should be committed are staged
2. No unintended files are being committed
3. No files were accidentally modified (e.g., formatting changes from file recreation)

If you deleted and recreated a file, use `git diff <file>` to verify the content is intentionally changed, not just reformatted.

---

## File Recreation Rule

**Never recreate files using `echo` or similar one-liners.** This often changes formatting (e.g., multi-line JSON becomes single-line).

Instead:
- Use the `Edit` tool to modify existing files
- Use `git checkout -- <file>` to restore a file to its last committed state
- If you must recreate a file, use the `Write` tool with properly formatted content

---

## Post-Task Verification

After completing any task that modifies files:

1. Run `git status` to check for uncommitted changes
2. Run `git diff` to review what changed
3. Ensure all intentional changes are committed
4. Ensure no unintentional changes remain

---

## After Code Changes

**Always run `npm run dev` after making code changes** so the user has the latest version running in Raycast for testing. Run it in the background so it doesn't block further work.

---

## Dependency Updates

When updating npm dependencies:

1. Always run `npm audit` before and after
2. Run `npm run lint` to verify ESLint compatibility
3. Run `npm test` to verify tests still pass
4. Run `npm run build` to verify build works
5. Commit both `package.json` and `package-lock.json` together

---

## Testing Requirements

Before marking any implementation task as complete:

1. `npm test` - all tests must pass
2. `npm run test:coverage` - coverage must be ≥90%
3. `npm run lint` - no errors
4. `npm run build` - successful build
5. `npm audit` - no high-severity vulnerabilities
