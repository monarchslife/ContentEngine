# agent-squad

A Claude Code mod: an animated sidebar that gives each running subagent its own cartoon mascot (🦊 🐼 🐸 🐙 🦉 🐧 …), shows the task it is working on, and keeps a live % progress bar with the mascot riding the front of it.

```
🎪 2 working · 1 finished
█████████████░░░░░░░░░░░░░░░░░  44%

🦊💡 Explore ⠹ 1m12s
Hunt TODOs across src
█████████████🦊░░░░░░░░░░░░░  50%
↳ Scanning src (1/2 todos)

🐼🏁 general-purpose done in 48s
Write release notes
█████████████████████████████ 100%
↳ 14 tool calls
```

## How progress is measured

- If the subagent keeps a todo list (`TodoWrite`), progress is `completed / total` (held at 99% until it finishes).
- Otherwise it is an estimate from tool calls and elapsed time that flattens toward 95%, marked with `~`.
- Finished agents show 🏁 (done), 💥 (failed) or 💤 (stopped).

## Install

```
/plugin install agent-squad --marketplace monarchslife/ContentEngine
```

Answer `y` to add the marketplace, then pick a scope.

## Use

- The sidebar opens by itself when Claude spawns a subagent (wide terminals dock it beside the transcript).
- `/squad` opens it; `/squad clear` forgets finished agents.
- Closing it by hand stops it reopening on its own until you run `/squad`.

## Develop

```
claude plugin validate claude-mods/agent-squad
claude plugin test claude-mods/agent-squad
```
