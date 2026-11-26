import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const user = sqliteTable("user", {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    email: text("email").notNull().unique(),
    emailVerified: integer("email_verified", { mode: "boolean" }).notNull().default(false),
    image: text("image"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export const session = sqliteTable("session", {
    id: text("id").primaryKey(),
    expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
    token: text("token").notNull().unique(),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
        .notNull()
        .references(() => user.id, { onDelete: "cascade" }),
});

export const account = sqliteTable("account", {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
        .notNull()
        .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: integer("access_token_expires_at", { mode: "timestamp" }),
    refreshTokenExpiresAt: integer("refresh_token_expires_at", { mode: "timestamp" }),
    scope: text("scope"),
    password: text("password"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export const verification = sqliteTable("verification", {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp" }),
    updatedAt: integer("updated_at", { mode: "timestamp" }),
});

export const workspaces = sqliteTable("workspaces", {
    id: text("id").primaryKey(),
    ownerUserId: text("owner_user_id")
        .notNull()
        .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    domain: text("domain").notNull().default("general"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
});

export const dummyItems = sqliteTable("dummy_items", {
    id: integer("id").primaryKey({ autoIncrement: true }),
    message: text("message").notNull(),
});

export const processingJobs = sqliteTable("processing_jobs", {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull().default("default"),
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
    workspaceId: text("workspace_id").notNull().default("default"),
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

export const provisions = sqliteTable("provisions", {
    id: text("id").primaryKey(),
    documentId: text("document_id").notNull(),
    parentId: text("parent_id"),
    ordinal: integer("ordinal").notNull(),
    level: text("level").notNull(),
    number: text("number").notNull(),
    title: text("title"),
    text: text("text"),
    articleNo: text("article_no"),
    paragraphNo: text("paragraph_no"),
    pointNo: text("point_no"),
    pageStart: integer("page_start"),
    pageEnd: integer("page_end"),
    sourceQuote: text("source_quote"),
    readQuality: text("read_quality"),
    sourceSnapshotId: text("source_snapshot_id"),
    pdfSha256: text("pdf_sha256"),
    readMethod: text("read_method"),
    sourceRegions: text("source_regions").notNull().default("[]"),
    contentRole: text("content_role").notNull(),
    relevance: text("relevance").notNull(),
    containerProvisionId: text("container_provision_id"),
    quotedSegments: text("quoted_segments").notNull().default("[]"),
    flags: text("flags").notNull().default("[]"),
    roleMethod: text("role_method").notNull(),
    roleVersion: text("role_version").notNull(),
    createdAt: text("created_at").notNull(),
});

export const draftDocuments = sqliteTable("draft_documents", {
    id: text("id").primaryKey(),
    title: text("title").notNull(),
    documentNumber: text("document_number"),
    documentType: text("document_type"),
    agency: text("agency"),
    content: text("content").notNull(),
    sourceDocumentId: text("source_document_id"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
});
