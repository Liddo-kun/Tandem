# Image attachment locations

A fork-owned plugin saves each inline user image to disk and tells the model where the copy is, so
filesystem-based tools can work on an attached image. In model requests, the line
`Copy of original image (<width>x<height>): <absolute path>` follows each image.

Code: `packages/core/src/plugin/tandem/image-location.ts` (registered in `plugin/internal.ts`), with
`message-metadata.ts` for reading message metadata.

## Saving

- Files go under the runtime scratch `attachments/` directory. Filenames use a 12-character content-hash
  prefix, so identical images reuse one file.
- Files get the default (umask) mode, so copies in Android shared storage stay readable by other apps.
- The pixel size is the saved file's stored size, read from its header; it is omitted when unreadable.
- The saved file is the attachment as sent (data URL or `file:` image), before OpenCode resizes and
  re-encodes it.
- A failed save logs a warning, and no path is claimed.

## Pairing images with their saved files

- The `prompt` hook saves the originals and records their paths and sizes, in order, in the user
  message's `tandemImageLocations` metadata.
- The `context`, `compaction` and `generate` request hooks pair that list with the message's images and
  insert the note.
- Model-request messages carry only their session message ID, so the helper reads the metadata through
  the public plugin `session.context` API. It loads only for image prompts it has not seen and caches by
  message ID.

## Fallback

The image normalized for model input is saved instead, and recreated from conversation bytes when
missing, when:

- the counts differ (deduplicated or converted attachments),
- the metadata is absent (older sessions), or
- an original has been deleted.
