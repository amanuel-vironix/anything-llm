// Route audit declarations: see ./index.js.
// Workspaces, threads, chat, documents and parsed files in the UI API
// (endpoints/workspaces, workspaceThreads, chat, document, workspacesParsedFiles).
module.exports = {
  // endpoints/workspaces.js
  "POST /workspace/new": { actions: ["workspace.created"] },
  "POST /workspace/:slug/update": { actions: ["workspace.updated"] },
  "POST /workspace/:slug/upload": { actions: ["document.uploaded"] },
  "POST /workspace/:slug/upload-link": { actions: ["document.uploaded"] },
  "POST /workspace/:slug/update-embeddings": {
    actions: ["document.removed", "document.embedded"],
    in: ["models/documents.js", "utils/EmbeddingWorkerManager.js"],
  },
  "DELETE /workspace/:slug": { actions: ["workspace.deleted"] },
  "DELETE /workspace/:slug/reset-vector-db": {
    actions: ["workspace.vectors_reset"],
  },
  "DELETE /workspace/:slug/delete-chats": { actions: ["chat.hidden"] },
  "DELETE /workspace/:slug/delete-edited-chats": { actions: ["chat.hidden"] },
  "POST /workspace/:slug/update-chat": { actions: ["chat.edited"] },
  "POST /workspace/:slug/chat-feedback/:chatId": {
    actions: ["chat.feedback"],
  },
  "POST /workspace/:slug/suggested-messages": {
    actions: ["workspace.updated"],
  },
  "POST /workspace/:slug/update-pin": { actions: ["document.pinned"] },
  "POST /workspace/:slug/thread/fork": { actions: ["thread.forked"] },
  "PUT /workspace/workspace-chats/:id": { actions: ["chat.hidden"] },
  "POST /workspace/:slug/upload-and-embed": {
    actions: ["document.uploaded"],
    in: ["models/documents.js"],
  },
  "DELETE /workspace/:slug/remove-and-unembed": {
    actions: ["document.deleted"],
  },
  "DELETE /workspace/:slug/prompt-history": { actions: ["workspace.updated"] },
  "DELETE /workspace/:slug/prompt-history/:id": {
    actions: ["workspace.updated"],
  },
  "POST /workspace/search": {
    exempt: "Read-only search of the caller's own workspaces and threads",
  },
  "DELETE /workspace/:slug/embed-queue": {
    exempt:
      "Drops a file from the in-memory embedding queue; no stored data changes",
  },

  // endpoints/workspacesParsedFiles.js
  "DELETE /workspace/:slug/delete-parsed-files": {
    actions: ["parsed_file.deleted"],
  },
  "POST /workspace/:slug/embed-parsed-file/:fileId": {
    actions: ["parsed_file.embedded"],
    in: ["models/documents.js"],
  },
  "POST /workspace/:slug/move-parsed-files": {
    actions: ["document.uploaded"],
  },
  "POST /workspace/:slug/parse": {
    actions: ["parsed_file.created"],
    in: ["models/workspaceParsedFiles.js"],
  },

  // endpoints/workspaceThreads.js
  "POST /workspace/:slug/thread/new": { actions: ["thread.created"] },
  "DELETE /workspace/:slug/thread/:threadSlug": {
    actions: ["thread.deleted", "chat.hidden"],
  },
  "DELETE /workspace/:slug/thread-bulk-delete": {
    actions: ["thread.deleted", "chat.hidden"],
  },
  "POST /workspace/:slug/thread/:threadSlug/update": {
    actions: ["thread.renamed"],
  },
  "DELETE /workspace/:slug/thread/:threadSlug/delete-edited-chats": {
    actions: ["chat.hidden"],
  },
  "POST /workspace/:slug/thread/:threadSlug/update-chat": {
    actions: ["chat.edited"],
  },

  // endpoints/chat.js
  "POST /workspace/:slug/stream-chat": {
    actions: ["chat.sent"],
    in: ["endpoints/chat.js"],
  },
  "POST /workspace/:slug/thread/:threadSlug/stream-chat": {
    actions: ["chat.sent"],
    in: ["endpoints/chat.js"],
  },

  // endpoints/document.js
  "POST /document/create-folder": {
    exempt:
      "Creates an empty folder on disk; no document content or access changes",
  },
  "POST /document/move-files": {
    exempt:
      "Moves unembedded files between folders on disk; no content, access or embedding changes",
  },
};
