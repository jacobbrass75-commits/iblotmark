import Database from "better-sqlite3";
import { applyJumpLinksToMarkdown, type QuoteJumpTarget } from "../server/quoteJumpLinks";
import { buildProjectAnnotationJumpPath, buildTextFingerprint } from "../shared/annotationLinks";

type ConversationRow = {
  id: string;
  project_id: string | null;
};

type ProjectAnnotationRow = {
  annotation_id: string;
  project_document_id: string;
  project_id: string;
  highlighted_text: string;
  start_position: number;
};

type MessageRow = {
  id: string;
  content: string;
};

const db = new Database("C:/Users/Jacob/Desktop/DEV2/anotations-jan-26-local/data/sourceannotator.db");

const selectConversations = db.prepare<[string?], ConversationRow>(`
  SELECT id, project_id
  FROM conversations
  WHERE project_id IS NOT NULL
    AND (? IS NULL OR project_id = ?)
`);

const selectProjectAnnotations = db.prepare<[string], ProjectAnnotationRow>(`
  SELECT
    pa.id AS annotation_id,
    pa.project_document_id,
    pd.project_id,
    pa.highlighted_text,
    pa.start_position
  FROM project_annotations pa
  JOIN project_documents pd ON pd.id = pa.project_document_id
  WHERE pd.project_id = ?
`);

const selectAssistantMessages = db.prepare<[string], MessageRow>(`
  SELECT id, content
  FROM messages
  WHERE conversation_id = ?
    AND role = 'assistant'
`);

const updateMessage = db.prepare<[string, string]>(`
  UPDATE messages
  SET content = ?
  WHERE id = ?
`);

function buildTargets(projectId: string): QuoteJumpTarget[] {
  const rows = selectProjectAnnotations.all(projectId);
  return rows
    .filter((row) => row.highlighted_text?.trim())
    .map((row) => ({
      quote: row.highlighted_text,
      jumpPath: buildProjectAnnotationJumpPath({
        projectId: row.project_id,
        projectDocumentId: row.project_document_id,
        annotationId: row.annotation_id,
        startPosition: row.start_position,
        anchorFingerprint: buildTextFingerprint(row.highlighted_text),
      }),
    }));
}

function main() {
  const projectIdArg = process.argv[2] || null;
  const conversations = selectConversations.all(projectIdArg, projectIdArg);
  const targetsByProject = new Map<string, QuoteJumpTarget[]>();

  let scannedMessages = 0;
  let updatedMessages = 0;

  const tx = db.transaction(() => {
    for (const conversation of conversations) {
      if (!conversation.project_id) continue;
      let targets = targetsByProject.get(conversation.project_id);
      if (!targets) {
        targets = buildTargets(conversation.project_id);
        targetsByProject.set(conversation.project_id, targets);
      }
      if (targets.length === 0) continue;

      const messages = selectAssistantMessages.all(conversation.id);
      for (const message of messages) {
        scannedMessages += 1;
        const linked = applyJumpLinksToMarkdown(message.content, targets);
        if (linked !== message.content) {
          updateMessage.run(linked, message.id);
          updatedMessages += 1;
        }
      }
    }
  });

  tx();

  console.log(
    JSON.stringify(
      {
        projectId: projectIdArg,
        conversations: conversations.length,
        scannedMessages,
        updatedMessages,
      },
      null,
      2
    )
  );
}

main();
