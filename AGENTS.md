<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Skills: use them, do not reinvent them

Invoke these with the Skill tool. Pick the one that matches the work before
starting, not after.

| Situation | Skill |
| --- | --- |
| Any feature or bugfix implementation | `test-driven-development` |
| Writing or refactoring code at all | `karpathy-guidelines` |
| Before finishing a task, or before a merge | `requesting-code-review` |
| Reviewing a PR or a diff in depth | `code-review-skill` |
| Cleaning up code you just wrote | `code-simplifier` |
| New UI, restyling, visual direction | `frontend-design` |
| Exploring an ill-defined feature request | `brainstorming` |
| Turning a spec into steps before coding | `writing-plans` |
| Executing a written plan | `executing-plans` |
| Any work that needs workspace isolation | `using-git-worktrees` |

`karpathy-guidelines` and `test-driven-development` apply to essentially every
code change here. Reach for them by default.

# Repo rules learned the hard way

These are not style preferences. Each one has already cost real time.

**Work in a git worktree when another agent might be running.** Several agents
have shared this checkout and clobbered each other. A release commit once swept
another agent's half-written Java into it via `git add -A`, shipping code that
could not compile. **Never `git add -A` here.** Stage explicit paths.

**Local `main` is stale.** Read canonical content with
`git show origin/main:<path>`. Branch from `origin/main`, not from whatever the
working tree happens to be on.

**Bump `CACHE_VERSION` in `public/sw.js` for any client JS or markup change**,
and add a changelog comment matching the entries above it. Skip it and phone
WebViews keep running the old bundle indefinitely. Users then need two app
restarts to recover.

**Never run `npx cap sync`.** It rewrites `Package.swift` with absolute paths
and corrupts the iOS project.

**Verify native changes in the BUILT artifact, not the source.**
`TaxotticDeviceStatusPlugin.swift` existed, looked correct, and compiled to
nothing for weeks because it was missing from the pbxproj. Check with
`unzip -p app-debug.apk 'classes*.dex' | strings` on Android, `strings` over the
built dylib on iOS, and prefer `dexdump` over string grep when proving
registration.

**Migrations must be purely additive**: new tables, new nullable columns, new
indexes. No altered or dropped columns, and no UPDATE or DELETE against
production rows without explicit sign-off.

**Web CI does not compile Android or iOS.** A green PR proves nothing about the
native builds. Anything touching `android/` or `ios/` needs a real build.

**Mileage numbers are IRS-deductible.** A fabricated mile is worse than a missed
one. Never invent distance or route to fill a gap; surface the gap instead.

**Prove it, do not infer it.** Several confident hypotheses on the mileage
pipeline turned out wrong (jitter suppression on ingest, activity recognition,
a stationary phone read as a capture failure). State plainly which claims you
proved from code or data and which remain hypotheses, and never present the
second kind as the first.
