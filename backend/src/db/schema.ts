import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const dummyItems = sqliteTable("dummy_items", {
    id: integer("id").primaryKey({ autoIncrement: true }),
    message: text("message").notNull(),
});

export const processingJobs = sqliteTable("processing_jobs", {
    id: text("id").primaryKey(),
    fileKey: text("file_key").notNull(),
    originalFilename: text("original_filename").notNull(),
    mimeType: text("mime_type"),
    fileSize: integer("file_size").notNull(),
    status: text("status").notNull(),
    step: text("step"),
    progress: integer("progress").notNull().default(0),
    errorMessage: text("error_message"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    completedAt: text("completed_at"),
});

export const legalDocuments = sqliteTable("legal_documents", {
    id: text("id").primaryKey(),
    jobId: text("job_id").notNull().unique(),
    documentTitle: text("document_title"),
    jsonContent: text("json_content").notNull(),
    snapshotR2Key: text("snapshot_r2_key").notNull(),
    artifactR2Key: text("artifact_r2_key").notNull(),
    pdfSha256: text("pdf_sha256").notNull(),
    reviewStatus: text("review_status").notNull().default("ACCEPTED"),
    validationIssues: text("validation_issues").notNull().default("[]"),
    pageCount: integer("page_count"),
    extractionModel: text("extraction_model"),
    promptVersion: text("prompt_version"),
    schemaVersion: text("schema_version"),
    createdAt: text("created_at").notNull(),
});

export const vocabEntries = sqliteTable("vocab_entries", {
    id: text("id").primaryKey(),
    canonicalId: text("canonical_id").notNull().unique(),
    type: text("type").notNull(),
    canonicalLabel: text("canonical_label").notNull(),
    aliases: text("aliases").notNull().default("[]"),
    definition: text("definition"),
    evidence: text("evidence"),
    sourceProvisionId: text("source_provision_id"),
    sourceDocumentId: text("source_document_id"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    vocabularyVersion: integer("vocabulary_version").notNull(),
});

export const vocabMetadata = sqliteTable("vocab_metadata", {
    key: text("key").primaryKey(),
    value: text("value").notNull(),
    updatedAt: text("updated_at").notNull(),
});
