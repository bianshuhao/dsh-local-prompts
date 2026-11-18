# Prompts

A local Markdown prompt folder inside a DeepSeek main panel. The left rail comes from local folders, the right side lists prompts, and a prompt opens in a three modes — source, rich text, and preview — with a collapsible heading outline (jump links and a whole-panel toggle) and a Reference picker for local prompts/files (with a file chooser that copies chosen files into the fixed `assets/` folder), with rich text serialized back to Markdown and debounce-saved to the original file after about 1.2s of idle input; explicit Save remains available.

## Use

1. Select **Prompts** in the left sidebar.
2. Default folder: `~/Documents/DSH Prompts` (auto-created; override with `LOCAL_DOCS_ROOT` or `local.config.json`). Each row and the editor file section has a **Copy full path** button.
3. Create a folder locally and the panel picks it up; refresh from the folder header if needed.
4. A new prompt creates a `.md` file in the selected folder. Changing the title renames the file; changing the folder moves it.
5. Delete moves a file to `.trash/`; restore or delete permanently from Trash.

## Mention prompts in chat

Type `@` in any conversation. A **Local prompts** group appears in the candidate menu; keep typing to search names. Picking one inserts an absolute-path mention that the model can read with the `read` tool.

## Notes

Restart DeepSeek Harness after installing or updating the plugin so the Host-side local API loads the latest code.

- Folders are the categories. There is no in-app folder creation.
- Supports `.md`, `.markdown`, `.txt`, and extensionless text files.
- The summary is derived from the body; the title is the file name.
- The local API listens on `127.0.0.1:45127` and accepts only local origins.
- Both the DSH Host and Web client must be active.
