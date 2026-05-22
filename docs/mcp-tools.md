# MCP Tools

## `reading_list_books`

Returns all imported books with progress and annotation counts. Annotation counts are cached by `annotations.jsonl` file signature so repeated calls do not re-parse the JSONL file unless it changes.

## `reading_list_chunks`

Input:

```json
{ "bookId": "anthropic-guidelines" }
```

Returns chunks in reading order, including `prevId`, `nextId`, `read`, and `annotationCount`.

## `reading_read_chunk`

Input:

```json
{ "bookId": "anthropic-guidelines", "chunkId": "ch00" }
```

Returns the chunk text plus neighboring ids.

## `reading_search_chunks`

Input:

```json
{ "bookId": "anthropic-guidelines", "query": "values", "limit": 10 }
```

Returns matching snippets.

Chunk text is cached by file signature after first read. Search is still a simple substring scan, but repeated searches avoid re-reading every chunk from disk.

## `reading_import_book`

Input:

```json
{
  "filename": "book.epub",
  "dataBase64": "...",
  "bookId": "optional-stable-id",
  "overwrite": false
}
```

Imports one EPUB or TXT/Markdown file from base64 content. Use this when the file fits inside one MCP request. `dataBase64` can be raw base64 or a `data:*;base64,...` URL.

For TXT/Markdown imports, optional fields mirror `scripts/import_text.py`:

```json
{
  "filename": "book.txt",
  "dataBase64": "...",
  "title": "Book Title",
  "author": "Author",
  "headingRegex": "^Chapter\\s+\\w+",
  "minSectionChars": 100,
  "maxChars": 6000
}
```

The server validates the file type, upload size, and `bookId`, writes the book into `data/books`, and returns the imported `bookId`, title, and chunk count.

## Chunked Import

Use chunked import when a file is too large for one JSON-RPC body.

1. Start:

```json
{
  "filename": "large.epub",
  "expectedBytes": 1234567,
  "bookId": "large-book"
}
```

Call `reading_import_begin` and keep the returned `uploadId`.

2. Append base64 parts:

```json
{
  "uploadId": "...",
  "index": 0,
  "dataBase64": "..."
}
```

Call `reading_import_part` once per binary part. Each part should be independently base64-encoded; do not split a single base64 string at arbitrary characters.

3. Finish:

```json
{ "uploadId": "..." }
```

Call `reading_import_finish` to run the importer. Use `reading_import_cancel` to discard an unfinished upload.

## `reading_annotate_passage`

Input:

```json
{
  "bookId": "anthropic-guidelines",
  "chunkId": "ch00",
  "quote": "this line matters",
  "note": "This is a resonance note.",
  "author": "claude",
  "kind": "resonance",
  "mood": "quiet",
  "tags": ["identity"],
  "status": "published",
  "parentId": null
}
```

Writes one JSONL annotation. If the quote is present in the chunk, the returned object includes a `quoteOffset`.

For a user-facing reading app, create user notes with:

```json
{
  "bookId": "anthropic-guidelines",
  "chunkId": "ch00",
  "quote": "this line matters",
  "note": "I want Claude to comment on this.",
  "author": "user",
  "status": "open"
}
```

## `reading_list_annotations`

Input:

```json
{ "bookId": "anthropic-guidelines", "chunkId": "ch00", "kind": "resonance", "status": "published" }
```

All fields are optional except `bookId` in most practical use.

## `reading_submit_user_notes`

Input:

```json
{
  "bookId": "anthropic-guidelines",
  "sessionId": "claude-session-2026-05-22",
  "contextMode": "chunk-once-per-session"
}
```

Finds all user annotations with `status: "open"`, returns them as one batch for Claude, and rewrites them to `status: "submitted"` so the same notes are not sent again.

This is the tool a companion app should call when the user taps “Send notes to Claude”.

By default, `contextMode` is `chunk-once-per-session`: the first submitted user note for a chunk includes that chunk's full text in `context.chunks`. Later notes for the same chunk and `sessionId` only send the new notes, with the repeated chunk listed in `context.omittedChunks`. A new `sessionId` starts fresh and includes the chunk again.

Supported context modes:

- `chunk-once-per-session`: default; send each chunk once per Claude session
- `chunk-always`: include full chunk text every time
- `notes-only`: send only the submitted notes and quote anchors

Set `forceChunkContext: true` to re-send chunk text inside the same session.

## `reading_reply_to_annotation`

Input:

```json
{
  "parentId": "ann_guidelines_user_001",
  "note": "Claude's reply under this user note.",
  "kind": "reply"
}
```

Creates a Claude annotation with `parentId` pointing to the original note. If `bookId`, `chunkId`, or `quote` are omitted, they are inherited from the parent annotation.

## `reading_mark_read`

Input:

```json
{ "bookId": "anthropic-guidelines", "chunkId": "ch00" }
```

Marks a chunk as read and updates `lastChunkId`.

## `reading_get_progress`

Input:

```json
{ "bookId": "anthropic-guidelines" }
```
