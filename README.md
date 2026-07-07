# TaskTodo

TaskTodo is an Obsidian plugin that adds a planning view and a today dashboard on top of TaskLite Core.

![TaskTodo demo](imgs/demo.gif)

## Requirements

- Obsidian `1.8.0` or newer
- [TaskLite Core](https://github.com/SunnyYYLin/obsidian-taskslite) enabled

## Features

- Two built-in task views: `In plan` and `Today`
- Custom tabs and custom columns/groups
- GUI filters with DQL fallback for advanced queries
- Drag-and-drop sort order for task groups and tabs
- Priority color customization
- Task creation and subtask creation from the view

## Installation

### From GitHub releases

1. Open the latest release for this repository.
2. Download `manifest.json`, `main.js`, and `styles.css`.
3. Create a folder named `tasktodo` under `.obsidian/plugins/`.
4. Copy the three files into that folder.
5. Enable `TaskTodo` in Obsidian community plugins.

## Usage

After enabling TaskLite Core and TaskTodo:

- Use the ribbon icon to open TaskTodo.
- Run the command `Open task list`.
- Configure tabs, columns, sort order, and priority colors in the plugin settings.

## Development

```bash
bun install
bun run build
bun test
bun run lint
```

## Release Files

Each release includes:

- `manifest.json`
- `main.js`
- `styles.css`

## License

`0BSD`
